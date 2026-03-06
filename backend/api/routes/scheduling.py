"""Scheduling endpoints: availability, appointments, reconfirmation, cron jobs.

HIPAA Access Control:
  - GET /availability           — authenticated user (own availability)
  - PUT /availability           — clinician-only (require_role)
  - GET /appointments/slots     — authenticated user (read-only slot lookup)
  - POST /appointments          — authenticated, clients can only book for themselves
  - GET /appointments           — clients forced to client_id=own UID
  - PATCH /appointments/{id}    — enforce_client_owns_resource
  - GET /schedule               — clinicians see all their clients; clients see own only
  - GET /my/pending-reconf.     — clients query own pending reconfirmations only
  - POST /my/{id}/confirm|cancel — enforce_client_owns_resource
  - GET /reconfirmation/{token} — unauthenticated, single-use UUID token
  - Cron endpoints              — X-Cron-Secret header auth

All endpoints log to audit_events for HIPAA compliance.
"""
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta, time as dt_time, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, Query, Header
from pydantic import BaseModel

from auth import get_current_user, get_current_user_with_role, require_role, is_clinician, enforce_client_owns_resource, require_practice_member, is_owner

sys.path.insert(0, "../shared")
from db import (
    replace_clinician_availability,
    get_clinician_availability,
    create_appointment,
    get_appointments,
    get_appointment,
    get_appointment_client,
    update_appointment_status,
    cancel_recurring_series,
    get_booked_slots,
    log_audit_event,
    set_reconfirmation_sent,
    get_appointment_by_reconfirmation_token,
    record_reconfirmation_response,
    release_appointment,
    get_expired_reconfirmations,
    get_upcoming_appointments_for_reminders,
    mark_reminder_sent,
    get_past_due_appointments,
    get_next_appointment_in_series,
    reschedule_appointment,
    get_unsigned_docs_count,
    get_appointments_with_unsigned_docs,
    get_practice_profile,
)
from gcal import create_calendar_event, update_calendar_event, delete_calendar_event, strip_conference_data
from mailer import send_email
from routes.documents import auto_generate_consent_package

logger = logging.getLogger(__name__)

router = APIRouter()

# Shared secret for cron endpoint authentication (set via env var)
CRON_SECRET = os.getenv("CRON_SECRET", "dev-cron-secret")

# Base URL for action links in emails
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:5173")
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080")

# Valid appointment types and their display names / CPT codes
APPOINTMENT_TYPES = {
    "assessment": {"display": "Assessment", "cpt": "90791"},
    "individual": {"display": "Individual Session", "cpt": "90834"},
    "individual_extended": {"display": "Individual Session (Extended)", "cpt": "90837"},
}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _verify_cron_secret(x_cron_secret: str | None = Header(None, alias="X-Cron-Secret")) -> None:
    """Verify the shared secret for cron endpoints.

    In production, Cloud Scheduler sends this header. In dev, the default
    secret 'dev-cron-secret' is accepted.
    """
    if x_cron_secret != CRON_SECRET:
        raise HTTPException(403, "Invalid cron secret")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class AvailabilityWindow(BaseModel):
    day_of_week: int
    start_time: str  # "HH:MM"
    end_time: str    # "HH:MM"


class SetAvailabilityRequest(BaseModel):
    windows: list[AvailabilityWindow]


class BookAppointmentRequest(BaseModel):
    client_id: str
    client_email: str
    client_name: str
    clinician_id: str
    clinician_email: str
    type: str  # "assessment" | "individual" | "individual_extended"
    scheduled_at: str  # ISO datetime
    duration_minutes: int = 60
    cadence: str | None = None  # "weekly" | "biweekly" | "monthly" — None for single appointment


class UpdateAppointmentRequest(BaseModel):
    status: str
    cancelled_reason: str | None = None


class SendReconfirmationRequest(BaseModel):
    appointment_id: str


class RescheduleRequest(BaseModel):
    new_scheduled_at: str  # ISO datetime


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------

@router.get("/availability")
async def get_availability(request: Request, user: dict = Depends(get_current_user)):
    """Get the current clinician's availability windows."""
    windows = await get_clinician_availability(user["uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="availability",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {"windows": windows}


@router.put("/availability")
async def set_availability(
    body: SetAvailabilityRequest,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Bulk replace the current clinician's availability. Clinician only."""
    await replace_clinician_availability(
        clinician_id=user["uid"],
        clinician_email=user.get("email", ""),
        windows=[w.model_dump() for w in body.windows],
    )
    await log_audit_event(
        user_id=user["uid"],
        action="updated",
        resource_type="availability",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"window_count": len(body.windows)},
    )
    return {"status": "saved", "window_count": len(body.windows)}


# ---------------------------------------------------------------------------
# Appointment slots
# ---------------------------------------------------------------------------

@router.get("/appointments/slots")
async def get_slots(
    clinician_id: str = Query(...),
    start: str = Query(...),
    end: str = Query(...),
    type: str = Query("assessment"),
    user: dict = Depends(get_current_user),
):
    """Compute available 30-min slots for a clinician in a date range.

    Availability windows are in the practice's local timezone.
    Returned slot times include timezone offset for correct display.
    Released appointments are excluded from booked slots, so their times
    become available again automatically.
    """
    availability = await get_clinician_availability(clinician_id)
    booked = await get_booked_slots(clinician_id, start, end)

    # Determine practice timezone
    profile = await get_practice_profile(clinician_id)
    tz_name = (profile or {}).get("timezone", "America/Chicago")
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/Chicago")

    # Build set of booked datetimes (as UTC for comparison)
    booked_set = set()
    for b in booked:
        slot_start = datetime.fromisoformat(b["start"])
        if slot_start.tzinfo is None:
            slot_start = slot_start.replace(tzinfo=timezone.utc)
        slot_start_utc = slot_start.astimezone(timezone.utc)
        for i in range(0, b["duration_minutes"], 30):
            booked_set.add(slot_start_utc + timedelta(minutes=i))

    # Build availability lookup: day_of_week -> list of (start, end)
    avail_by_day: dict[int, list[tuple[dt_time, dt_time]]] = {}
    for w in availability:
        dow = w["day_of_week"]
        st = dt_time.fromisoformat(w["start_time"])
        et = dt_time.fromisoformat(w["end_time"])
        avail_by_day.setdefault(dow, []).append((st, et))

    # Parse request range (treat as UTC if no tzinfo)
    start_dt = datetime.fromisoformat(start)
    end_dt = datetime.fromisoformat(end)
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=timezone.utc)

    now_utc = datetime.now(timezone.utc)
    slots = []

    # Iterate over days in the practice's local timezone
    local_start = start_dt.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    local_end = end_dt.astimezone(tz)
    current = local_start

    while current.date() <= local_end.date():
        dow = current.weekday()
        # Python weekday: Mon=0. DB uses Sun=0. Convert.
        db_dow = (dow + 1) % 7
        for window_start, window_end in avail_by_day.get(db_dow, []):
            slot = current.replace(hour=window_start.hour, minute=window_start.minute)
            window_end_dt = current.replace(hour=window_end.hour, minute=window_end.minute)
            while slot + timedelta(minutes=30) <= window_end_dt:
                slot_utc = slot.astimezone(timezone.utc)
                if slot_utc > now_utc and slot_utc not in booked_set:
                    slots.append({
                        "start": slot.isoformat(),
                        "end": (slot + timedelta(minutes=30)).isoformat(),
                    })
                slot += timedelta(minutes=30)
        current += timedelta(days=1)

    return {"slots": slots}


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------

def _cadence_timedelta(cadence: str, instance_index: int) -> timedelta:
    """Calculate the timedelta for instance N of a recurring series given cadence."""
    if cadence == "weekly":
        return timedelta(weeks=instance_index)
    elif cadence == "biweekly":
        return timedelta(weeks=instance_index * 2)
    elif cadence == "monthly":
        # Approximate month as 4 weeks for simplicity; Calendar handles exact dates
        return timedelta(weeks=instance_index * 4)
    return timedelta(weeks=instance_index)


@router.post("/appointments")
async def book_appointment(
    body: BookAppointmentRequest,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Book an appointment.

    Assessment = 1 instance.
    Individual/individual_extended = 4 recurring instances at the specified cadence.
    The appointment type (assessment/individual/individual_extended) drives downstream
    behavior: note type, CPT code for billing, and document triggers.
    """
    if body.type not in APPOINTMENT_TYPES:
        raise HTTPException(400, f"Type must be one of: {', '.join(APPOINTMENT_TYPES.keys())}")

    if body.cadence is not None and body.cadence not in ("weekly", "biweekly", "monthly"):
        raise HTTPException(400, "Cadence must be 'weekly', 'biweekly', or 'monthly'")

    # Clients can only book appointments for themselves
    if not is_clinician(user) and body.client_id != user["uid"]:
        raise HTTPException(403, "Clients can only book appointments for themselves")

    # Assessment is always single. Individual types: single if no cadence, 4 recurring if cadence provided.
    if body.type == "assessment" or body.cadence is None:
        count = 1
    else:
        count = 4
    recurrence_id = str(uuid.uuid4()) if count > 1 else None

    scheduled = datetime.fromisoformat(body.scheduled_at)
    appointments = []
    type_info = APPOINTMENT_TYPES[body.type]

    for i in range(count):
        appt_dt = scheduled + _cadence_timedelta(body.cadence, i)
        end_dt = appt_dt + timedelta(minutes=body.duration_minutes)

        summary = f"{type_info['display']} — {body.client_name}"

        try:
            meet_link, event_id = create_calendar_event(
                summary=summary,
                start_dt=appt_dt.isoformat(),
                end_dt=end_dt.isoformat(),
                attendee_emails=[body.client_email, body.clinician_email],
                description=f"Type: {body.type} (CPT {type_info['cpt']})\nClient: {body.client_name}",
                clinician_email=body.clinician_email,
            )
        except Exception as e:
            logger.error("Calendar event creation failed: %s", e)
            meet_link, event_id = None, None

        appt_id = await create_appointment(
            client_id=body.client_id,
            client_email=body.client_email,
            client_name=body.client_name,
            clinician_id=body.clinician_id,
            clinician_email=body.clinician_email,
            appt_type=body.type,
            scheduled_at=appt_dt.isoformat(),
            duration_minutes=body.duration_minutes,
            created_by=user["uid"],
            meet_link=meet_link,
            calendar_event_id=event_id,
            recurrence_id=recurrence_id,
            cadence=body.cadence,
        )
        appointments.append({
            "id": appt_id,
            "scheduled_at": appt_dt.isoformat(),
            "meet_link": meet_link,
            "type": body.type,
            "cpt": type_info["cpt"],
        })

    await log_audit_event(
        user_id=user["uid"],
        action="booked",
        resource_type="appointment",
        resource_id=appointments[0]["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "type": body.type,
            "cpt": type_info["cpt"],
            "count": count,
            "cadence": body.cadence,
            "recurrence_id": recurrence_id,
        },
    )

    # Auto-generate consent document package for assessment appointments
    consent_package_id = None
    if body.type == "assessment":
        consent_package_id = await auto_generate_consent_package(
            client_id=body.client_id,
            client_email=body.client_email,
            client_name=body.client_name,
            clinician_uid=body.clinician_id,
        )
        if consent_package_id:
            logger.info(
                "Auto-generated consent package %s for assessment booking %s",
                consent_package_id, appointments[0]["id"],
            )

    return {
        "appointments": appointments,
        "recurrence_id": recurrence_id,
        "consent_package_id": consent_package_id,
    }


@router.get("/appointments")
async def list_appointments(
    request: Request,
    start: str = Query(...),
    end: str = Query(...),
    client_id: str | None = Query(None),
    clinician_id: str | None = Query(None),
    user: dict = Depends(get_current_user_with_role),
):
    """List appointments in a date range.

    Clients only see their own. Non-owner clinicians are scoped to their own
    appointments. Owners can see all or filter by clinician_id.
    """
    # Clients are forced to filter by their own UID — cannot browse other clients
    if not is_clinician(user):
        client_id = user["uid"]
    elif not is_owner(user):
        # Non-owner clinicians can only see their own appointments
        clinician_id = user["uid"]

    results = await get_appointments(start, end, client_id=client_id, clinician_id=clinician_id)

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="appointments",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"start": start, "end": end, "count": len(results)},
    )

    return {"appointments": results}


@router.patch("/appointments/{appointment_id}")
async def patch_appointment(
    appointment_id: str,
    body: UpdateAppointmentRequest,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Update appointment status (cancel, complete, no_show, released)."""
    appt = await get_appointment(appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")

    # Clients can only modify their own appointments
    enforce_client_owns_resource(user, appt.get("client_id"))

    if body.status == "cancelled" and appt.get("calendar_event_id"):
        try:
            delete_calendar_event(appt["calendar_event_id"], clinician_email=appt.get("clinician_email", ""))
        except Exception as e:
            logger.error("Failed to delete calendar event: %s", e)

    if body.status == "completed" and appt.get("calendar_event_id"):
        try:
            strip_conference_data(appt["calendar_event_id"], clinician_email=appt.get("clinician_email", ""))
        except Exception as e:
            logger.error("Failed to strip conference data: %s", e)

    await update_appointment_status(
        appointment_id, body.status, body.cancelled_reason
    )

    await log_audit_event(
        user_id=user["uid"],
        action=body.status,
        resource_type="appointment",
        resource_id=appointment_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"cancelled_reason": body.cancelled_reason},
    )

    return {"status": body.status}


@router.post("/appointments/series/{recurrence_id}/end")
async def end_series(
    recurrence_id: str,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Cancel all future appointments in a recurring series. Clinician only."""
    count = await cancel_recurring_series(recurrence_id)

    await log_audit_event(
        user_id=user["uid"],
        action="series_ended",
        resource_type="appointment",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"recurrence_id": recurrence_id, "cancelled_count": count},
    )

    return {"cancelled_count": count}


# ---------------------------------------------------------------------------
# Unified Schedule
# ---------------------------------------------------------------------------

@router.get("/schedule")
async def get_schedule(
    request: Request,
    start: str = Query(...),
    end: str = Query(...),
    clinician_id: str | None = Query(None),
    user: dict = Depends(get_current_user_with_role),
):
    """Unified schedule view: appointments for the current user.

    Clinicians see all appointments where they are the clinician.
    Owners can optionally pass clinician_id to view another clinician's schedule.
    Clients see only their own appointments.
    """
    if is_clinician(user):
        if is_owner(user) and clinician_id:
            # Owner viewing a specific clinician's schedule
            target_clinician_id = clinician_id
        else:
            # Non-owner clinicians always see their own; owners default to own
            target_clinician_id = user["uid"]
        appts = await get_appointments(start, end, clinician_id=target_clinician_id)
    else:
        # Client sees only their own appointments
        appts = await get_appointments(start, end, client_id=user["uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="schedule",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"start": start, "end": end, "count": len(appts)},
    )

    return {"appointments": appts}


# ---------------------------------------------------------------------------
# Client-accessible: pending reconfirmations
# ---------------------------------------------------------------------------

@router.get("/appointments/my/pending-reconfirmations")
async def get_my_pending_reconfirmations(
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Get the authenticated client's appointments pending reconfirmation.

    Returns appointments that have a reconfirmation token but no response yet.
    """
    import sys
    sys.path.insert(0, "../shared")
    from db import get_pool

    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM appointments
        WHERE client_id = $1
          AND reconfirmation_sent_at IS NOT NULL
          AND reconfirmation_response IS NULL
          AND status = 'scheduled'
        ORDER BY scheduled_at
        """,
        user["uid"],
    )

    appointments = []
    for r in rows:
        appt = {
            "id": str(r["id"]),
            "scheduled_at": r["scheduled_at"].isoformat(),
            "duration_minutes": r["duration_minutes"],
            "type": r["type"],
            "status": r["status"],
            "meet_link": r.get("meet_link"),
            "clinician_email": r.get("clinician_email"),
            "reconfirmation_token": r.get("reconfirmation_token"),
        }
        appointments.append(appt)

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="pending_reconfirmations",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"count": len(appointments)},
    )

    return {"appointments": appointments}


@router.post("/appointments/my/{appointment_id}/confirm")
async def client_confirm_appointment(
    appointment_id: str,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Client confirms their appointment directly (authenticated, no token needed)."""
    appt = await get_appointment(appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")

    enforce_client_owns_resource(user, appt.get("client_id"))

    if appt["status"] != "scheduled":
        raise HTTPException(400, "Appointment is no longer scheduled")

    if appt.get("reconfirmation_response"):
        return {"status": "already_responded", "response": appt["reconfirmation_response"]}

    await record_reconfirmation_response(appt["id"], "confirmed")

    await log_audit_event(
        user_id=user["uid"],
        action="reconfirmation_confirmed",
        resource_type="appointment",
        resource_id=appt["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"source": "client_portal"},
    )

    return {"status": "confirmed"}


@router.post("/appointments/my/{appointment_id}/cancel")
async def client_cancel_appointment(
    appointment_id: str,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Client cancels/skips one appointment instance (authenticated)."""
    appt = await get_appointment(appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")

    enforce_client_owns_resource(user, appt.get("client_id"))

    if appt["status"] != "scheduled":
        raise HTTPException(400, "Appointment is no longer scheduled")

    if appt.get("calendar_event_id"):
        try:
            delete_calendar_event(appt["calendar_event_id"], clinician_email=appt.get("clinician_email", ""))
        except Exception as e:
            logger.error("Failed to delete calendar event on client cancel: %s", e)

    if appt.get("reconfirmation_response"):
        # Already responded to reconfirmation, just cancel the appointment
        pass
    else:
        await record_reconfirmation_response(appt["id"], "cancelled")

    await update_appointment_status(appt["id"], "cancelled", "Cancelled by client via portal")

    await log_audit_event(
        user_id=user["uid"],
        action="cancelled",
        resource_type="appointment",
        resource_id=appt["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"source": "client_portal"},
    )

    return {"status": "cancelled"}


# ---------------------------------------------------------------------------
# Reconfirmation
# ---------------------------------------------------------------------------

def _build_reconfirmation_html(
    client_name: str,
    next_appt_date: str,
    next_appt_time: str,
    confirm_url: str,
    change_url: str,
    cancel_url: str,
    clinician_name: str = "your therapist",
) -> str:
    """Build the HTML body for a reconfirmation email."""
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e;">Confirm Your Next Appointment</h2>
        <p>Hi {client_name},</p>
        <p>Thank you for your session today with {clinician_name}. Your next appointment is scheduled for:</p>
        <div style="background: #f0f4f8; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="font-size: 18px; font-weight: 600; margin: 0;">{next_appt_date}</p>
            <p style="font-size: 16px; color: #555; margin: 4px 0 0 0;">{next_appt_time}</p>
        </div>
        <p>Please confirm your attendance within 24 hours. If we don't hear from you, the slot will be released and made available to others.</p>
        <div style="margin: 24px 0;">
            <a href="{confirm_url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-right: 8px; margin-bottom: 8px;">Confirm Appointment</a>
            <a href="{change_url}" style="display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-right: 8px; margin-bottom: 8px;">Change Time</a>
            <a href="{cancel_url}" style="display: inline-block; background: #ef4444; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-bottom: 8px;">Skip This Week</a>
        </div>
        <p style="color: #888; font-size: 13px;">If you skip, your recurring series will continue — only this instance is cancelled.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="color: #aaa; font-size: 12px;">Sent by Trellis Health Platform</p>
    </div>
    """


def _build_reconfirmation_text(
    client_name: str,
    next_appt_date: str,
    next_appt_time: str,
    confirm_url: str,
    change_url: str,
    cancel_url: str,
    clinician_name: str = "your therapist",
) -> str:
    """Build the plain text body for a reconfirmation email."""
    return f"""Hi {client_name},

Thank you for your session today with {clinician_name}. Your next appointment is scheduled for:

{next_appt_date} at {next_appt_time}

Please confirm within 24 hours or the slot will be released.

Confirm: {confirm_url}
Change time: {change_url}
Skip this week: {cancel_url}

If you skip, your recurring series continues — only this instance is cancelled.

— Trellis Health Platform"""


def _build_reminder_html(
    client_name: str,
    appt_date: str,
    appt_time: str,
    meet_link: str | None,
    clinician_name: str = "your therapist",
    unsigned_doc_count: int = 0,
    signing_url: str | None = None,
) -> str:
    """Build the HTML body for a 24h reminder email.

    If the client has unsigned documents, includes a prominent notice with a
    link to the signing page.
    """
    meet_section = ""
    if meet_link:
        meet_section = f"""
        <div style="margin: 16px 0;">
            <a href="{meet_link}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Join Google Meet</a>
        </div>
        """

    docs_section = ""
    if unsigned_doc_count > 0 and signing_url:
        docs_section = f"""
        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="font-weight: 600; color: #92400e; margin: 0 0 8px 0;">
                Action Required: {unsigned_doc_count} unsigned document{'s' if unsigned_doc_count != 1 else ''}
            </p>
            <p style="color: #78350f; font-size: 14px; margin: 0 0 12px 0;">
                Please sign your consent documents before your appointment.
            </p>
            <a href="{signing_url}" style="display: inline-block; background: #f59e0b; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">Sign Documents Now</a>
        </div>
        """

    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e;">Appointment Reminder</h2>
        <p>Hi {client_name},</p>
        <p>This is a reminder that you have an upcoming appointment with {clinician_name}:</p>
        <div style="background: #f0f4f8; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="font-size: 18px; font-weight: 600; margin: 0;">{appt_date}</p>
            <p style="font-size: 16px; color: #555; margin: 4px 0 0 0;">{appt_time}</p>
        </div>
        {docs_section}
        {meet_section}
        <p>If you need to cancel or reschedule, please contact us as soon as possible.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="color: #aaa; font-size: 12px;">Sent by Trellis Health Platform</p>
    </div>
    """


def _build_reminder_text(
    client_name: str,
    appt_date: str,
    appt_time: str,
    meet_link: str | None,
    clinician_name: str = "your therapist",
    unsigned_doc_count: int = 0,
    signing_url: str | None = None,
) -> str:
    """Build the plain text body for a 24h reminder email."""
    meet_line = f"\nJoin Meet: {meet_link}\n" if meet_link else ""
    docs_line = ""
    if unsigned_doc_count > 0 and signing_url:
        docs_line = f"\nIMPORTANT: You have {unsigned_doc_count} unsigned document{'s' if unsigned_doc_count != 1 else ''}. Please sign before your appointment: {signing_url}\n"
    return f"""Hi {client_name},

This is a reminder that you have an upcoming appointment with {clinician_name}:

{appt_date} at {appt_time}
{docs_line}{meet_line}
If you need to cancel or reschedule, please contact us as soon as possible.

— Trellis Health Platform"""


@router.post("/appointments/{appointment_id}/reconfirmation")
async def send_reconfirmation(
    appointment_id: str,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Send a reconfirmation email for the next appointment in a recurring series.

    Triggered after a session ends (Meet session completion). Finds the next
    scheduled appointment in the same recurrence series and sends the client
    an email with confirm/change/cancel links.
    """
    appt = await get_appointment(appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")

    # Must be clinician or the client who owns this appointment
    enforce_client_owns_resource(user, appt.get("client_id"))

    if not appt.get("recurrence_id"):
        raise HTTPException(400, "Appointment is not part of a recurring series")

    # Find the next scheduled appointment in the series
    next_appt = await get_next_appointment_in_series(
        appt["recurrence_id"], appt["scheduled_at"]
    )
    if not next_appt:
        return {"status": "no_upcoming", "message": "No future appointments in this series"}

    # Generate a unique reconfirmation token
    token = str(uuid.uuid4())
    await set_reconfirmation_sent(next_appt["id"], token)

    # Build action URLs
    base = API_BASE_URL
    confirm_url = f"{base}/api/reconfirmation/{token}/confirm"
    change_url = f"{APP_BASE_URL}/reconfirmation/{token}/change"
    cancel_url = f"{base}/api/reconfirmation/{token}/cancel"

    # Format date/time for email
    next_dt = datetime.fromisoformat(next_appt["scheduled_at"])
    date_str = next_dt.strftime("%A, %B %d, %Y")
    time_str = next_dt.strftime("%I:%M %p")

    html = _build_reconfirmation_html(
        client_name=next_appt["client_name"],
        next_appt_date=date_str,
        next_appt_time=time_str,
        confirm_url=confirm_url,
        change_url=change_url,
        cancel_url=cancel_url,
    )
    text = _build_reconfirmation_text(
        client_name=next_appt["client_name"],
        next_appt_date=date_str,
        next_appt_time=time_str,
        confirm_url=confirm_url,
        change_url=change_url,
        cancel_url=cancel_url,
    )

    try:
        send_email(
            to=next_appt["client_email"],
            subject=f"Confirm Your Next Appointment — {date_str}",
            html_body=html,
            text_body=text,
        )
    except Exception as e:
        logger.error("Failed to send reconfirmation email: %s", e)
        raise HTTPException(500, "Failed to send reconfirmation email")

    await log_audit_event(
        user_id=user["uid"],
        action="reconfirmation_sent",
        resource_type="appointment",
        resource_id=next_appt["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"token": token, "source_appointment": appointment_id},
    )

    return {
        "status": "sent",
        "next_appointment_id": next_appt["id"],
        "token": token,
    }


# ---------------------------------------------------------------------------
# Reconfirmation action endpoints (unauthenticated, token-based)
# ---------------------------------------------------------------------------

@router.get("/reconfirmation/{token}/confirm")
async def reconfirmation_confirm(token: str, request: Request):
    """Client confirms their next appointment (keeps the recurring slot)."""
    appt = await get_appointment_by_reconfirmation_token(token)
    if not appt:
        raise HTTPException(404, "Invalid or expired reconfirmation link")

    if appt.get("reconfirmation_response"):
        return {"status": "already_responded", "response": appt["reconfirmation_response"]}

    if appt["status"] != "scheduled":
        raise HTTPException(400, "Appointment is no longer scheduled")

    await record_reconfirmation_response(appt["id"], "confirmed")

    await log_audit_event(
        user_id=appt["client_id"],
        action="reconfirmation_confirmed",
        resource_type="appointment",
        resource_id=appt["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    next_dt = datetime.fromisoformat(appt["scheduled_at"])
    return {
        "status": "confirmed",
        "message": f"Your appointment on {next_dt.strftime('%A, %B %d at %I:%M %p')} is confirmed.",
    }


@router.get("/reconfirmation/{token}/cancel")
async def reconfirmation_cancel(token: str, request: Request):
    """Client cancels (skips) one instance — series continues."""
    appt = await get_appointment_by_reconfirmation_token(token)
    if not appt:
        raise HTTPException(404, "Invalid or expired reconfirmation link")

    if appt.get("reconfirmation_response"):
        return {"status": "already_responded", "response": appt["reconfirmation_response"]}

    if appt["status"] != "scheduled":
        raise HTTPException(400, "Appointment is no longer scheduled")

    # Cancel the calendar event
    if appt.get("calendar_event_id"):
        try:
            delete_calendar_event(appt["calendar_event_id"], clinician_email=appt.get("clinician_email", ""))
        except Exception as e:
            logger.error("Failed to delete calendar event on reconfirmation cancel: %s", e)

    await record_reconfirmation_response(appt["id"], "cancelled")
    await update_appointment_status(appt["id"], "cancelled", "Skipped via reconfirmation")

    await log_audit_event(
        user_id=appt["client_id"],
        action="reconfirmation_cancelled",
        resource_type="appointment",
        resource_id=appt["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {
        "status": "cancelled",
        "message": "This appointment has been skipped. Your recurring series will continue.",
    }


@router.get("/reconfirmation/{token}/info")
async def reconfirmation_info(token: str):
    """Get appointment info for the reconfirmation change flow (frontend use)."""
    appt = await get_appointment_by_reconfirmation_token(token)
    if not appt:
        raise HTTPException(404, "Invalid or expired reconfirmation link")

    return {
        "appointment": {
            "id": appt["id"],
            "scheduled_at": appt["scheduled_at"],
            "duration_minutes": appt["duration_minutes"],
            "client_name": appt["client_name"],
            "clinician_id": appt["clinician_id"],
            "type": appt["type"],
            "status": appt["status"],
            "reconfirmation_response": appt.get("reconfirmation_response"),
        }
    }


@router.post("/reconfirmation/{token}/change")
async def reconfirmation_change(
    token: str,
    body: RescheduleRequest,
    request: Request,
):
    """Client picks a different time for this appointment instance."""
    appt = await get_appointment_by_reconfirmation_token(token)
    if not appt:
        raise HTTPException(404, "Invalid or expired reconfirmation link")

    if appt.get("reconfirmation_response"):
        return {"status": "already_responded", "response": appt["reconfirmation_response"]}

    if appt["status"] != "scheduled":
        raise HTTPException(400, "Appointment is no longer scheduled")

    new_dt = datetime.fromisoformat(body.new_scheduled_at)
    end_dt = new_dt + timedelta(minutes=appt["duration_minutes"])

    # Delete old calendar event and create new one
    if appt.get("calendar_event_id"):
        try:
            delete_calendar_event(appt["calendar_event_id"], clinician_email=appt.get("clinician_email", ""))
        except Exception as e:
            logger.error("Failed to delete old calendar event on reschedule: %s", e)

    type_info = APPOINTMENT_TYPES.get(appt["type"], {"display": "Session", "cpt": ""})
    summary = f"{type_info['display']} — {appt['client_name']}"

    try:
        meet_link, event_id = create_calendar_event(
            summary=summary,
            start_dt=new_dt.isoformat(),
            end_dt=end_dt.isoformat(),
            attendee_emails=[appt["client_email"], appt["clinician_email"]],
            description=f"Type: {appt['type']}\nClient: {appt['client_name']}\n(Rescheduled)",
            clinician_email=appt.get("clinician_email", ""),
        )
    except Exception as e:
        logger.error("Calendar event creation failed on reschedule: %s", e)
        meet_link, event_id = None, None

    await reschedule_appointment(
        appt["id"], body.new_scheduled_at, meet_link, event_id
    )
    await record_reconfirmation_response(appt["id"], "changed")

    await log_audit_event(
        user_id=appt["client_id"],
        action="reconfirmation_changed",
        resource_type="appointment",
        resource_id=appt["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "old_scheduled_at": appt["scheduled_at"],
            "new_scheduled_at": body.new_scheduled_at,
        },
    )

    return {
        "status": "changed",
        "new_scheduled_at": body.new_scheduled_at,
        "meet_link": meet_link,
        "message": f"Your appointment has been rescheduled to {new_dt.strftime('%A, %B %d at %I:%M %p')}.",
    }


# ---------------------------------------------------------------------------
# Cron endpoints (called by Cloud Scheduler)
# ---------------------------------------------------------------------------

@router.post("/cron/check-reconfirmations")
async def cron_check_reconfirmations(
    request: Request,
    _: None = Depends(_verify_cron_secret),
):
    """Check for expired reconfirmations (>24h with no response) and release slots.

    When a slot is released:
    - Appointment status is set to 'released'
    - Calendar event is deleted (frees the Meet slot)
    - The slot becomes available again in slot computation (get_booked_slots
      only returns status='scheduled' appointments)
    """
    expired = await get_expired_reconfirmations()
    released_count = 0

    for appt in expired:
        # Delete calendar event to free the slot
        if appt.get("calendar_event_id"):
            try:
                delete_calendar_event(appt["calendar_event_id"], clinician_email=appt.get("clinician_email", ""))
            except Exception as e:
                logger.error("Failed to delete calendar event for expired reconfirmation %s: %s", appt["id"], e)

        # Release the appointment
        await release_appointment(appt["id"])
        released_count += 1

        await log_audit_event(
            user_id=None,
            action="reconfirmation_expired",
            resource_type="appointment",
            resource_id=appt["id"],
            ip_address=_client_ip(request),
            user_agent="Cloud Scheduler",
            metadata={
                "reconfirmation_sent_at": appt.get("reconfirmation_sent_at"),
                "client_id": appt["client_id"],
            },
        )

        logger.info(
            "Released appointment %s (client=%s) — reconfirmation expired",
            appt["id"], appt["client_id"],
        )

    return {"released_count": released_count}


@router.post("/cron/send-reminders")
async def cron_send_reminders(
    request: Request,
    _: None = Depends(_verify_cron_secret),
):
    """Send reminder emails 24 hours before each scheduled session.

    Includes unsigned document count and signing link if the client has
    outstanding consent documents.
    """
    upcoming = await get_upcoming_appointments_for_reminders(hours_ahead=24)
    sent_count = 0
    errors = 0

    for appt in upcoming:
        appt_dt = datetime.fromisoformat(appt["scheduled_at"])
        date_str = appt_dt.strftime("%A, %B %d, %Y")
        time_str = appt_dt.strftime("%I:%M %p")

        # Check for unsigned documents
        unsigned_count = await get_unsigned_docs_count(appt["client_id"])
        # Build signing URL if there are unsigned docs — points to client's
        # most recent package signing page
        signing_url = None
        if unsigned_count > 0:
            from db import get_client_document_signing_status
            doc_status = await get_client_document_signing_status(appt["client_id"])
            if doc_status["packages"]:
                # Link to the most recent package that has pending docs
                for pkg in doc_status["packages"]:
                    if pkg["pending"] > 0:
                        signing_url = f"{APP_BASE_URL}/sign/{pkg['package_id']}"
                        break

        html = _build_reminder_html(
            client_name=appt["client_name"],
            appt_date=date_str,
            appt_time=time_str,
            meet_link=appt.get("meet_link"),
            unsigned_doc_count=unsigned_count,
            signing_url=signing_url,
        )
        text = _build_reminder_text(
            client_name=appt["client_name"],
            appt_date=date_str,
            appt_time=time_str,
            meet_link=appt.get("meet_link"),
            unsigned_doc_count=unsigned_count,
            signing_url=signing_url,
        )

        subject = f"Reminder: Appointment Tomorrow — {date_str}"
        if unsigned_count > 0:
            subject = f"Reminder: Appointment Tomorrow + {unsigned_count} Unsigned Doc{'s' if unsigned_count != 1 else ''}"

        try:
            send_email(
                to=appt["client_email"],
                subject=subject,
                html_body=html,
                text_body=text,
            )
            await mark_reminder_sent(appt["id"])
            sent_count += 1

            await log_audit_event(
                user_id=None,
                action="reminder_sent",
                resource_type="appointment",
                resource_id=appt["id"],
                ip_address=_client_ip(request),
                user_agent="Cloud Scheduler",
                metadata={
                    "client_email": appt["client_email"],
                    "unsigned_doc_count": unsigned_count,
                },
            )
        except Exception as e:
            logger.error("Failed to send reminder for appointment %s: %s", appt["id"], e)
            errors += 1

    return {"sent_count": sent_count, "errors": errors}


@router.post("/cron/check-no-shows")
async def cron_check_no_shows(
    request: Request,
    _: None = Depends(_verify_cron_secret),
):
    """Check for appointments where scheduled time + duration has passed
    and status is still 'scheduled'. Mark them as no_show.

    For MVP, this is a simple time-based check. Future versions may integrate
    with the Meet REST API to check participant join events.
    """
    past_due = await get_past_due_appointments()
    no_show_count = 0

    for appt in past_due:
        await update_appointment_status(appt["id"], "no_show")
        no_show_count += 1

        if appt.get("calendar_event_id"):
            try:
                strip_conference_data(appt["calendar_event_id"], clinician_email=appt.get("clinician_email", ""))
            except Exception as e:
                logger.error("Failed to strip conference data for no-show %s: %s", appt["id"], e)

        await log_audit_event(
            user_id=None,
            action="no_show_detected",
            resource_type="appointment",
            resource_id=appt["id"],
            ip_address=_client_ip(request),
            user_agent="Cloud Scheduler",
            metadata={
                "client_id": appt["client_id"],
                "scheduled_at": appt["scheduled_at"],
            },
        )

        logger.info(
            "Marked appointment %s as no-show (client=%s, was scheduled for %s)",
            appt["id"], appt["client_id"], appt["scheduled_at"],
        )

    return {"no_show_count": no_show_count}


@router.post("/cron/check-unsigned-docs")
async def cron_check_unsigned_docs(
    request: Request,
    _: None = Depends(_verify_cron_secret),
):
    """Check for upcoming appointments (next 24h) where clients have unsigned consent docs.

    Sends two types of alerts:
    1. Client reminder email with signing link (24h before session)
    2. Clinician alert email if docs are still unsigned within 2h of session

    This supplements the regular reminder emails which also mention unsigned docs.
    The dedicated unsigned docs check runs separately to catch cases where the
    regular reminder already sent but docs remain unsigned closer to session time.
    """
    # Get practice profile for clinician info
    practice = await get_practice_profile()
    practice_name = practice["practice_name"] if practice and practice.get("practice_name") else "Trellis"

    # Find appointments in next 2 hours with unsigned docs — alert clinician
    upcoming_imminent = await get_appointments_with_unsigned_docs(hours_ahead=2)
    clinician_alerts = 0

    for appt in upcoming_imminent:
        unsigned_count = appt.get("unsigned_doc_count", 0)
        if unsigned_count <= 0:
            continue

        appt_dt = datetime.fromisoformat(appt["scheduled_at"])
        date_str = appt_dt.strftime("%A, %B %d, %Y")
        time_str = appt_dt.strftime("%I:%M %p")

        # Send alert to clinician
        clinician_email = appt.get("clinician_email")
        if clinician_email:
            html = f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #dc2626;">Unsigned Documents Alert</h2>
                <p>The following client has <strong>{unsigned_count} unsigned consent document{'s' if unsigned_count != 1 else ''}</strong> with a session starting soon:</p>
                <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
                    <p style="font-weight: 600; margin: 0 0 4px 0;">{appt['client_name']}</p>
                    <p style="color: #555; margin: 0;">{date_str} at {time_str}</p>
                    <p style="color: #dc2626; font-weight: 500; margin: 8px 0 0 0;">{unsigned_count} document{'s' if unsigned_count != 1 else ''} still unsigned</p>
                </div>
                <p>Please follow up with the client or proceed at your discretion.</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
                <p style="color: #aaa; font-size: 12px;">Sent by {practice_name}</p>
            </div>
            """

            text = f"""Unsigned Documents Alert

Client: {appt['client_name']}
Session: {date_str} at {time_str}
Unsigned documents: {unsigned_count}

Please follow up with the client or proceed at your discretion.

— {practice_name}"""

            try:
                send_email(
                    to=clinician_email,
                    subject=f"Alert: {appt['client_name']} has {unsigned_count} unsigned doc{'s' if unsigned_count != 1 else ''}",
                    html_body=html,
                    text_body=text,
                )
                clinician_alerts += 1

                await log_audit_event(
                    user_id=None,
                    action="unsigned_docs_clinician_alert",
                    resource_type="appointment",
                    resource_id=appt["id"],
                    ip_address=_client_ip(request),
                    user_agent="Cloud Scheduler",
                    metadata={
                        "client_id": appt["client_id"],
                        "unsigned_doc_count": unsigned_count,
                        "clinician_email": clinician_email,
                    },
                )
            except Exception as e:
                logger.error(
                    "Failed to send unsigned docs alert for appointment %s: %s",
                    appt["id"], e,
                )

    # Find appointments in next 24h with unsigned docs — send client reminder
    upcoming_24h = await get_appointments_with_unsigned_docs(hours_ahead=24)
    client_reminders = 0

    for appt in upcoming_24h:
        unsigned_count = appt.get("unsigned_doc_count", 0)
        if unsigned_count <= 0:
            continue

        appt_dt = datetime.fromisoformat(appt["scheduled_at"])
        date_str = appt_dt.strftime("%A, %B %d, %Y")
        time_str = appt_dt.strftime("%I:%M %p")

        # Get signing URL for the client
        from db import get_client_document_signing_status
        doc_status = await get_client_document_signing_status(appt["client_id"])
        signing_url = None
        if doc_status["packages"]:
            for pkg in doc_status["packages"]:
                if pkg["pending"] > 0:
                    signing_url = f"{APP_BASE_URL}/sign/{pkg['package_id']}"
                    break

        if not signing_url:
            continue

        html = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #f59e0b;">Please Sign Your Documents</h2>
            <p>Hi {appt['client_name']},</p>
            <p>You have an appointment coming up on <strong>{date_str}</strong> at <strong>{time_str}</strong>, but you still have <strong>{unsigned_count} document{'s' if unsigned_count != 1 else ''}</strong> that need{'s' if unsigned_count == 1 else ''} to be signed.</p>
            <p>Please complete your documents before your session:</p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{signing_url}" style="display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Sign Documents Now</a>
            </div>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
            <p style="color: #aaa; font-size: 12px;">Sent by {practice_name}</p>
        </div>
        """

        text = f"""Hi {appt['client_name']},

You have an appointment on {date_str} at {time_str}, but {unsigned_count} document{'s' if unsigned_count != 1 else ''} still need{'s' if unsigned_count == 1 else ''} to be signed.

Sign now: {signing_url}

— {practice_name}"""

        try:
            send_email(
                to=appt["client_email"],
                subject=f"Please Sign Your Documents Before Your Appointment",
                html_body=html,
                text_body=text,
            )
            client_reminders += 1

            await log_audit_event(
                user_id=None,
                action="unsigned_docs_client_reminder",
                resource_type="appointment",
                resource_id=appt["id"],
                ip_address=_client_ip(request),
                user_agent="Cloud Scheduler",
                metadata={
                    "client_id": appt["client_id"],
                    "unsigned_doc_count": unsigned_count,
                    "client_email": appt["client_email"],
                },
            )
        except Exception as e:
            logger.error(
                "Failed to send unsigned docs reminder for appointment %s: %s",
                appt["id"], e,
            )

    return {
        "clinician_alerts": clinician_alerts,
        "client_reminders": client_reminders,
    }
