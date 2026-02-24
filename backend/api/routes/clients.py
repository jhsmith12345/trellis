"""Client profile, insurance card extraction, and discharge endpoints.

HIPAA Access Control:
  - GET /clients           — clinician-only (require_role)
  - GET /clients/me        — authenticated user, returns own profile only
  - PUT /clients/me        — authenticated user, updates own profile only
  - POST /clients/insurance-card — authenticated user, own data only
  - POST /clients/insurance — authenticated user, own data only
  - GET /clients/{id}      — clinician-only (require_role)
  - GET /clients/{id}/*    — clinician-only (require_role)
  - POST /clients/{id}/discharge — clinician-only (require_role)

All endpoints log to audit_events for HIPAA compliance.
Client endpoints scope queries to the authenticated user's firebase_uid.
"""
import base64
import json
import logging
import sys
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from config import PROJECT_ID, REGION

from auth import (
    get_current_user,
    require_role,
    require_practice_member,
    is_owner,
    enforce_clinician_owns_client,
)

sys.path.insert(0, "../shared")
from db import (
    get_pool,
    get_client,
    get_all_clients,
    upsert_client,
    update_client,
    update_client_insurance,
    get_client_by_id,
    get_client_encounters,
    get_client_notes,
    get_active_treatment_plan,
    get_client_appointments,
    get_client_document_signing_status,
    get_future_appointments,
    get_client_recurrence_ids,
    discharge_client,
    get_client_full_encounters,
    get_client_full_notes,
    get_unsigned_notes_for_client,
    update_appointment_status,
    cancel_recurring_series,
    create_encounter,
    log_audit_event,
)
from vision import extract_insurance_card
from gcal import delete_calendar_event
from discharge_generator import generate_discharge_summary

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB in bytes


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ProfileUpdate(BaseModel):
    full_name: str | None = None
    preferred_name: str | None = None
    pronouns: str | None = None
    date_of_birth: str | None = None
    phone: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_zip: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relationship: str | None = None


class InsuranceCardUpload(BaseModel):
    front: str  # base64-encoded image
    back: str | None = None  # optional back of card
    mime_type: str


class InsuranceSave(BaseModel):
    payer_name: str | None = None
    member_id: str | None = None
    group_number: str | None = None
    plan_name: str | None = None
    plan_type: str | None = None
    subscriber_name: str | None = None
    rx_bin: str | None = None
    rx_pcn: str | None = None
    rx_group: str | None = None
    payer_phone: str | None = None
    effective_date: str | None = None
    copay_info: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/clients")
async def list_clients(
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """List all clients with summary info. Clinician only.

    Owners see all practice clients; non-owners see only assigned clients.
    """
    clients = await get_all_clients(
        clinician_uid=user["uid"],
        is_owner=is_owner(user),
    )

    await log_audit_event(
        user_id=user["uid"],
        action="listed",
        resource_type="clients",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return {"clients": clients}


@router.get("/clients/me")
async def get_my_profile(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Get the current client's profile. Returns {exists: false} if no record."""
    profile = await get_client(user["uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="client_profile",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    if not profile:
        return {"exists": False}
    return {**profile, "exists": True}


@router.put("/clients/me")
async def update_my_profile(
    payload: ProfileUpdate,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Upsert the current client's demographics/contact info."""
    fields = {k: v for k, v in payload.model_dump().items() if v is not None}

    await upsert_client(
        firebase_uid=user["uid"],
        email=user.get("email", ""),
        **fields,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="updated",
        resource_type="client_profile",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={"fields": list(fields.keys())},
    )

    return {"status": "updated"}


@router.post("/clients/insurance-card")
async def extract_card(
    payload: InsuranceCardUpload,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Upload insurance card image(s) for AI extraction. Does NOT save — returns extracted data."""
    # Validate MIME type
    if payload.mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type. Allowed: {', '.join(ALLOWED_MIME_TYPES)}",
        )

    # Validate size (base64 is ~4/3 the size of the original)
    front_size = len(payload.front) * 3 // 4
    if front_size > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="Front image exceeds 10MB limit")
    if payload.back:
        back_size = len(payload.back) * 3 // 4
        if back_size > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=400, detail="Back image exceeds 10MB limit")

    await log_audit_event(
        user_id=user["uid"],
        action="uploaded_insurance_card",
        resource_type="client_profile",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    try:
        extraction = await extract_insurance_card(
            front_b64=payload.front,
            mime_type=payload.mime_type,
            project_id=PROJECT_ID,
            region=REGION,
            back_b64=payload.back,
        )
    except Exception as e:
        logger.error("Insurance card extraction failed: %s: %s", type(e).__name__, e)
        raise HTTPException(
            status_code=502,
            detail="We couldn't read your insurance card. Please try again or enter your information manually.",
        )

    return {"extraction": extraction}


@router.post("/clients/insurance")
async def save_insurance(
    payload: InsuranceSave,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Save confirmed insurance data to the client profile."""
    insurance_data = payload.model_dump()

    # Ensure client record exists
    await upsert_client(firebase_uid=user["uid"], email=user.get("email", ""))

    await update_client_insurance(
        firebase_uid=user["uid"],
        insurance_data=insurance_data,
        payer_name=payload.payer_name,
        member_id=payload.member_id,
        group_number=payload.group_number,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="saved_insurance",
        resource_type="client_profile",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={"payer_name": payload.payer_name},
    )

    return {"status": "saved"}


# ---------------------------------------------------------------------------
# Client Detail View (Clinician-only)
# ---------------------------------------------------------------------------

@router.get("/clients/{client_id}")
async def get_client_detail(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Get full client profile by UUID. Clinician only."""
    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    await enforce_clinician_owns_client(user, client.get("firebase_uid", ""))

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="client_detail",
        resource_id=client_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return client


@router.patch("/clients/{client_id}/assign")
async def assign_client_clinician(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Assign a client to a clinician. Owner only."""
    body = await request.json()
    clinician_id = body.get("clinician_id")
    if not clinician_id:
        raise HTTPException(400, "clinician_id is required")

    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    await update_client(client["firebase_uid"], primary_clinician_id=clinician_id)

    await log_audit_event(
        user_id=user["uid"],
        action="assigned_clinician",
        resource_type="client",
        resource_id=client_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={"clinician_id": clinician_id},
    )

    return {"status": "assigned", "clinician_id": clinician_id}


@router.get("/clients/{client_id}/encounters")
async def list_client_encounters(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """List encounters for a client. Clinician only."""
    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    await enforce_clinician_owns_client(user, client.get("firebase_uid", ""))

    encounters = await get_client_encounters(client["firebase_uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="client_encounters",
        resource_id=client_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return {"encounters": encounters}


@router.get("/clients/{client_id}/notes")
async def list_client_notes(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """List clinical notes for a client. Clinician only."""
    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    await enforce_clinician_owns_client(user, client.get("firebase_uid", ""))

    notes = await get_client_notes(client["firebase_uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="client_notes",
        resource_id=client_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return {"notes": notes}


@router.get("/clients/{client_id}/treatment-plan")
async def get_client_treatment_plan(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Get the active treatment plan for a client. Clinician only."""
    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    await enforce_clinician_owns_client(user, client.get("firebase_uid", ""))

    plan = await get_active_treatment_plan(client["firebase_uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="client_treatment_plan",
        resource_id=client_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    if not plan:
        return {"exists": False}
    return {**plan, "exists": True}


@router.get("/clients/{client_id}/appointments")
async def list_client_appointments(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """List all appointments for a client. Clinician only."""
    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    await enforce_clinician_owns_client(user, client.get("firebase_uid", ""))

    appointments = await get_client_appointments(client["firebase_uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="client_appointments",
        resource_id=client_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return {"appointments": appointments}


# Note: /notes/unsigned endpoint moved to routes/notes.py (Component 8)


# ---------------------------------------------------------------------------
# Discharge Workflow (Component 13)
# ---------------------------------------------------------------------------

class DischargeRequest(BaseModel):
    reason: str | None = None  # Optional discharge reason from clinician


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.get("/clients/{client_id}/discharge-status")
async def get_discharge_status(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Check if a client can be discharged and report any outstanding items.

    Returns:
      - can_discharge: bool
      - unsigned_notes: list of unsigned note summaries
      - future_appointments: count of future scheduled appointments
      - client_status: current client status
    """
    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    firebase_uid = client["firebase_uid"]

    await enforce_clinician_owns_client(user, firebase_uid)

    # Check for unsigned notes
    unsigned_notes = await get_unsigned_notes_for_client(firebase_uid)

    # Check for future appointments
    future_appts = await get_future_appointments(firebase_uid)

    # Check for recurring series
    recurrence_ids = await get_client_recurrence_ids(firebase_uid)

    # Get treatment plan status
    treatment_plan = await get_active_treatment_plan(firebase_uid)

    # Count completed sessions
    all_appts = await get_client_appointments(firebase_uid)
    completed_sessions = sum(
        1 for a in all_appts if a.get("status") == "completed"
    )

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="discharge_status",
        resource_id=client_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {
        "can_discharge": client["status"] != "discharged",
        "client_status": client["status"],
        "unsigned_notes": unsigned_notes,
        "unsigned_note_count": len(unsigned_notes),
        "future_appointment_count": len(future_appts),
        "recurring_series_count": len(recurrence_ids),
        "has_treatment_plan": treatment_plan is not None,
        "completed_sessions": completed_sessions,
    }


@router.post("/clients/{client_id}/discharge")
async def initiate_discharge(
    client_id: str,
    body: DischargeRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Initiate the discharge workflow for a client. Clinician only.

    Multi-step process:
    1. Cancel all future scheduled appointments (delete Calendar events)
    2. End any recurring appointment series
    3. Generate AI discharge summary from full treatment history
    4. Create discharge encounter + clinical note (format='discharge', status='draft')
    5. Update client status to 'discharged'
    6. Audit log all actions

    The discharge note is created as a draft that goes through the
    standard review/sign flow (Component 9). The clinician can review,
    edit, and sign the discharge summary like any other clinical note.
    """
    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    await enforce_clinician_owns_client(user, client.get("firebase_uid", ""))

    if client["status"] == "discharged":
        raise HTTPException(400, "Client is already discharged")

    firebase_uid = client["firebase_uid"]
    discharge_date = datetime.now(timezone.utc).isoformat()

    # --- Step 1: Cancel all future appointments ---
    future_appts = await get_future_appointments(firebase_uid)
    cancelled_count = 0

    for appt in future_appts:
        # Delete Calendar event
        if appt.get("calendar_event_id"):
            try:
                delete_calendar_event(appt["calendar_event_id"])
            except Exception as e:
                logger.error(
                    "Failed to delete calendar event %s during discharge: %s",
                    appt["calendar_event_id"], e,
                )

        # Cancel the appointment
        await update_appointment_status(
            appt["id"], "cancelled", "Client discharged"
        )
        cancelled_count += 1

        await log_audit_event(
            user_id=user["uid"],
            action="cancelled",
            resource_type="appointment",
            resource_id=appt["id"],
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            metadata={"reason": "discharge", "client_id": client_id},
        )

    # --- Step 2: End any recurring series ---
    recurrence_ids = await get_client_recurrence_ids(firebase_uid)
    for rec_id in recurrence_ids:
        series_count = await cancel_recurring_series(rec_id)
        await log_audit_event(
            user_id=user["uid"],
            action="series_ended",
            resource_type="appointment",
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            metadata={
                "recurrence_id": rec_id,
                "cancelled_count": series_count,
                "reason": "discharge",
            },
        )

    # --- Step 3: Generate AI discharge summary ---
    # Gather full treatment history
    all_encounters = await get_client_full_encounters(firebase_uid)
    all_notes = await get_client_full_notes(firebase_uid)
    all_appts = await get_client_appointments(firebase_uid)
    treatment_plan = await get_active_treatment_plan(firebase_uid)

    # Determine treatment start date (earliest encounter or appointment)
    treatment_start = ""
    if all_encounters:
        treatment_start = all_encounters[0].get("created_at", "")
    elif all_appts:
        sorted_appts = sorted(all_appts, key=lambda a: a.get("scheduled_at", ""))
        if sorted_appts:
            treatment_start = sorted_appts[0].get("scheduled_at", "")

    # Count completed sessions
    completed_sessions = sum(
        1 for a in all_appts if a.get("status") == "completed"
    )

    # Client name for the prompt
    client_name = (
        client.get("preferred_name")
        or (client.get("full_name") or "the client").split()[0]
    )

    try:
        summary_result = await generate_discharge_summary(
            client_name=client_name,
            treatment_start_date=treatment_start,
            discharge_date=discharge_date,
            total_sessions=completed_sessions,
            treatment_plan=treatment_plan,
            clinical_notes=all_notes,
            encounters=all_encounters,
            appointments=all_appts,
        )
    except Exception as e:
        logger.error(
            "Discharge summary generation failed for client %s: %s",
            client_id, e,
        )
        # Create a placeholder if AI generation fails
        summary_result = {
            "format": "discharge",
            "content": {
                "reason_for_treatment": "AI generation failed. Please complete manually.",
                "course_of_treatment": "",
                "progress_toward_goals": "",
                "diagnoses_at_discharge": "",
                "discharge_recommendations": "",
                "medications_at_discharge": "",
                "risk_assessment": "",
                "clinical_summary": "",
            },
        }

    # --- Step 4: Create discharge encounter + clinical note ---
    encounter_id = await create_encounter(
        client_id=firebase_uid,
        encounter_type="clinical",
        source="clinician",
        clinician_id=user["uid"],
        transcript="",
        data={
            "discharge": True,
            "discharge_reason": body.reason,
            "discharged_by": user["uid"],
            "appointment_type": "discharge",
        },
        status="complete",
    )

    # Create the clinical note as draft
    pool = await get_pool()
    note_row = await pool.fetchrow(
        """
        INSERT INTO clinical_notes (encounter_id, format, content, status, clinician_id)
        VALUES ($1::uuid, 'discharge', $2::jsonb, 'draft', $3)
        RETURNING id
        """,
        encounter_id,
        json.dumps(summary_result["content"]),
        user["uid"],
    )
    note_id = str(note_row["id"])

    await log_audit_event(
        user_id=user["uid"],
        action="discharge_summary_generated",
        resource_type="clinical_note",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "client_id": client_id,
            "encounter_id": encounter_id,
            "ai_generated": True,
        },
    )

    # --- Step 5: Update client status to discharged ---
    await discharge_client(firebase_uid)

    await log_audit_event(
        user_id=user["uid"],
        action="discharged",
        resource_type="client",
        resource_id=client_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "reason": body.reason,
            "cancelled_appointments": cancelled_count,
            "ended_series": len(recurrence_ids),
            "note_id": note_id,
            "encounter_id": encounter_id,
            "completed_sessions": completed_sessions,
        },
    )

    logger.info(
        "Client %s discharged: cancelled %d appointments, ended %d series, "
        "discharge note %s created",
        client_id, cancelled_count, len(recurrence_ids), note_id,
    )

    return {
        "status": "discharged",
        "note_id": note_id,
        "encounter_id": encounter_id,
        "cancelled_appointments": cancelled_count,
        "ended_series": len(recurrence_ids),
        "completed_sessions": completed_sessions,
    }
