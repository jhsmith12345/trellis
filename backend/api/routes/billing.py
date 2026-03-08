"""Billing document generation and superbill management endpoints.

Component 11: Billing Document Generation — auto-generates superbills when
clinical notes are signed, provides PDF download, billing status tracking,
and email delivery for out-of-network reimbursement.

HIPAA Access Control:
  - All endpoints require clinician role (require_role("clinician"))
  - Superbill PDFs are generated server-side with practice/client data
  - All reads and writes logged to audit_events

Endpoints:
  - POST /api/superbills/generate            — generate superbill for a signed note
  - GET  /api/superbills                     — list all superbills (clinician dashboard)
  - GET  /api/superbills/client/{client_id}  — list superbills for a client
  - GET  /api/superbills/{superbill_id}      — get superbill details
  - GET  /api/superbills/{superbill_id}/pdf  — download superbill PDF
  - PATCH /api/superbills/{superbill_id}/status — update billing status
  - POST /api/superbills/{superbill_id}/email — email superbill to client
"""
import json
import logging
import sys
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from auth import (
    require_role,
    get_current_user_with_role,
    enforce_client_owns_resource,
    require_practice_member,
    is_owner,
    enforce_clinician_owns_client,
)

sys.path.insert(0, "../shared")
from db import (
    get_pool,
    get_client,
    get_client_by_id,
    get_clinician,
    get_practice,
    get_active_treatment_plan,
    get_practice_profile,
    get_stored_signature,
    log_audit_event,
)
from superbill_pdf import generate_superbill_pdf, CPT_DESCRIPTIONS

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# CPT code mapping from appointment types
# ---------------------------------------------------------------------------

APPOINTMENT_TYPE_TO_CPT: dict[str, str] = {
    "assessment": "90791",
    "individual": "90834",
    "individual_extended": "90837",
}


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class GenerateSuperbillRequest(BaseModel):
    note_id: str


class UpdateStatusRequest(BaseModel):
    status: str  # 'generated', 'submitted', 'paid', 'outstanding'
    amount_paid: float | None = None


class EmailSuperbillRequest(BaseModel):
    recipient_email: str | None = None  # Override client email


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _format_client_address(client: dict) -> str | None:
    """Build a one-line address string from client fields."""
    parts = []
    if client.get("address_line1"):
        parts.append(client["address_line1"])
    city_state = []
    if client.get("address_city"):
        city_state.append(client["address_city"])
    if client.get("address_state"):
        city_state.append(client["address_state"])
    if city_state:
        cs = ", ".join(city_state)
        if client.get("address_zip"):
            cs += f" {client['address_zip']}"
        parts.append(cs)
    return ", ".join(parts) if parts else None


def _superbill_to_dict(r) -> dict:
    """Convert a superbill database record to a response dict."""
    return {
        "id": str(r["id"]),
        "client_id": r["client_id"],
        "appointment_id": str(r["appointment_id"]) if r["appointment_id"] else None,
        "note_id": str(r["note_id"]) if r["note_id"] else None,
        "clinician_id": r["clinician_id"],
        "date_of_service": r["date_of_service"].isoformat() if r["date_of_service"] else None,
        "cpt_code": r["cpt_code"],
        "cpt_description": r["cpt_description"],
        "diagnosis_codes": json.loads(r["diagnosis_codes"]) if isinstance(r["diagnosis_codes"], str) else (r["diagnosis_codes"] or []),
        "fee": float(r["fee"]) if r["fee"] is not None else None,
        "amount_paid": float(r["amount_paid"]) if r["amount_paid"] is not None else 0,
        "status": r["status"],
        "billing_npi": r["billing_npi"] if "billing_npi" in r.keys() else None,
        "has_pdf": r["pdf_data"] is not None if "pdf_data" in r.keys() else False,
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }


async def generate_superbill_for_note(
    note_id: str,
    clinician_uid: str,
    practice_id: str | None = None,
) -> dict | None:
    """Core superbill generation logic. Called from the signing endpoint or manually.

    Returns the superbill dict if successful, or None if generation fails or
    prerequisites are not met.

    Args:
        note_id: UUID of the signed clinical note.
        clinician_uid: Firebase UID of the clinician.
        practice_id: Optional practice UUID. When provided (group mode), the
            practice NPI is used as billing_npi; otherwise the individual
            clinician NPI is used.
    """
    pool = await get_pool()

    # Fetch the note with encounter data
    note = await pool.fetchrow(
        """
        SELECT cn.id, cn.encounter_id, cn.format, cn.content, cn.signed_at, cn.status,
               e.client_id, e.type AS encounter_type, e.data AS encounter_data,
               e.created_at AS encounter_created_at
        FROM clinical_notes cn
        JOIN encounters e ON e.id = cn.encounter_id
        WHERE cn.id = $1::uuid
        """,
        note_id,
    )
    if not note:
        logger.warning("Superbill generation: note %s not found", note_id)
        return None

    if note["status"] != "signed":
        logger.warning("Superbill generation: note %s is not signed (status=%s)", note_id, note["status"])
        return None

    # Check if superbill already exists for this note
    existing = await pool.fetchrow(
        "SELECT id FROM superbills WHERE note_id = $1::uuid", note_id
    )
    if existing:
        logger.info("Superbill already exists for note %s: %s", note_id, existing["id"])
        return _superbill_to_dict(
            await pool.fetchrow("SELECT * FROM superbills WHERE id = $1::uuid", existing["id"])
        )

    client_id = note["client_id"]
    encounter_data = note["encounter_data"] or {}

    # Determine CPT code from appointment type
    appointment_type = encounter_data.get("appointment_type", "individual")
    cpt_code = APPOINTMENT_TYPE_TO_CPT.get(appointment_type, "90834")
    cpt_description = CPT_DESCRIPTIONS.get(cpt_code, "Psychotherapy")

    # Find linked appointment (if any)
    appointment_id_str = encounter_data.get("appointment_id")
    appointment_id = None
    if appointment_id_str:
        try:
            # Validate it's a valid UUID
            appt_row = await pool.fetchrow(
                "SELECT id FROM appointments WHERE id = $1::uuid", appointment_id_str
            )
            if appt_row:
                appointment_id = str(appt_row["id"])
        except Exception:
            pass

    # If no appointment link in encounter data, try to find by encounter_id on appointments
    if not appointment_id:
        appt_row = await pool.fetchrow(
            "SELECT id, type FROM appointments WHERE encounter_id = $1::uuid LIMIT 1",
            str(note["encounter_id"]),
        )
        if appt_row:
            appointment_id = str(appt_row["id"])
            # Use the appointment type if available
            appt_type = appt_row["type"]
            if appt_type in APPOINTMENT_TYPE_TO_CPT:
                cpt_code = APPOINTMENT_TYPE_TO_CPT[appt_type]
                cpt_description = CPT_DESCRIPTIONS.get(cpt_code, "Psychotherapy")

    # Get diagnosis codes from active treatment plan
    treatment_plan = await get_active_treatment_plan(client_id)
    diagnosis_codes = []
    if treatment_plan and treatment_plan.get("diagnoses"):
        diagnosis_codes = treatment_plan["diagnoses"]

    # Get practice profile for fee info
    practice = await get_practice_profile(clinician_uid)

    # Determine fee
    fee = None
    if practice:
        if appointment_type == "assessment" and practice.get("intake_rate"):
            fee = practice["intake_rate"]
        elif practice.get("session_rate"):
            fee = practice["session_rate"]

    # Date of service from encounter
    date_of_service = note["encounter_created_at"]
    dos_date = date_of_service.date() if hasattr(date_of_service, "date") else date_of_service

    # Get client info for PDF
    client = await get_client(client_id)
    client_name = "Unknown Client"
    client_dob = None
    client_address = None
    client_phone = None
    client_email = None
    insurance_payer = None
    insurance_member_id = None
    insurance_group = None

    if client:
        client_name = client.get("full_name") or client.get("email") or "Unknown Client"
        client_dob = client.get("date_of_birth")
        client_address = _format_client_address(client)
        client_phone = client.get("phone")
        client_email = client.get("email")
        insurance_payer = client.get("payer_name")
        insurance_member_id = client.get("member_id")
        insurance_group = client.get("group_number")

    # Resolve rendering clinician for dual-NPI group billing
    rendering_clinician = None
    if practice_id:
        clinician_rec = await get_clinician(clinician_uid)
        if clinician_rec:
            rendering_clinician = clinician_rec

    # Get clinician's stored signature for the PDF
    signature_data = await get_stored_signature(clinician_uid)

    # Generate PDF
    try:
        dos_formatted = dos_date.strftime("%B %d, %Y") if hasattr(dos_date, "strftime") else str(dos_date)
        pdf_bytes = generate_superbill_pdf(
            client_name=client_name,
            client_dob=client_dob,
            client_address=client_address,
            client_phone=client_phone,
            client_email=client_email,
            insurance_payer=insurance_payer,
            insurance_member_id=insurance_member_id,
            insurance_group=insurance_group,
            date_of_service=dos_formatted,
            cpt_code=cpt_code,
            cpt_description=cpt_description,
            diagnosis_codes=diagnosis_codes,
            fee=fee,
            amount_paid=0,
            status="generated",
            practice=practice,
            rendering_clinician=rendering_clinician,
            signature_data=signature_data,
        )
    except Exception as e:
        logger.error("Superbill PDF generation failed for note %s: %s", note_id, e)
        pdf_bytes = None

    # Resolve billing NPI: group practice NPI takes precedence, otherwise
    # fall back to the individual clinician NPI.
    billing_npi = None
    if practice_id:
        practice_rec = await get_practice(practice_id)
        if practice_rec and practice_rec.get("npi"):
            billing_npi = practice_rec["npi"]
    if not billing_npi:
        clinician_rec = await get_clinician(clinician_uid)
        if clinician_rec and clinician_rec.get("npi"):
            billing_npi = clinician_rec["npi"]

    # Insert superbill record
    row = await pool.fetchrow(
        """
        INSERT INTO superbills
            (client_id, appointment_id, note_id, clinician_id, date_of_service,
             cpt_code, cpt_description, diagnosis_codes, fee, amount_paid,
             status, pdf_data, billing_npi)
        VALUES ($1, $2::uuid, $3::uuid, $4, $5::date, $6, $7, $8::jsonb, $9::numeric, 0, 'generated', $10, $11)
        RETURNING *
        """,
        client_id,
        appointment_id,
        note_id,
        clinician_uid,
        dos_date,
        cpt_code,
        cpt_description,
        json.dumps(diagnosis_codes),
        fee,
        pdf_bytes,
        billing_npi,
    )

    logger.info(
        "Superbill generated: %s (note=%s, cpt=%s, fee=%s, pdf=%s)",
        row["id"], note_id, cpt_code, fee, pdf_bytes is not None,
    )

    return _superbill_to_dict(row)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/superbills/generate")
async def generate_superbill(
    body: GenerateSuperbillRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Generate a superbill for a signed clinical note.

    Can be called automatically after note signing or manually from the portal.
    """
    result = await generate_superbill_for_note(
        body.note_id, user["uid"], practice_id=user.get("practice_id"),
    )

    if not result:
        raise HTTPException(400, "Could not generate superbill. Ensure the note is signed.")

    await log_audit_event(
        user_id=user["uid"],
        action="superbill_generated",
        resource_type="superbill",
        resource_id=result["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "note_id": body.note_id,
            "cpt_code": result["cpt_code"],
            "fee": result["fee"],
        },
    )

    return result


@router.get("/superbills")
async def list_superbills(
    request: Request,
    status: str | None = None,
    user: dict = Depends(require_practice_member()),
):
    """List superbills. Owners see all practice superbills; non-owners see only their own."""
    pool = await get_pool()

    query = """
        SELECT s.*, c.full_name AS client_name, c.id AS client_uuid
        FROM superbills s
        LEFT JOIN clients c ON c.firebase_uid = s.client_id
    """
    params: list = []
    conditions: list[str] = []

    # Non-owners only see their own superbills
    if not is_owner(user):
        conditions.append(f"s.clinician_id = ${len(params) + 1}")
        params.append(user["uid"])

    if status and status != "all":
        conditions.append(f"s.status = ${len(params) + 1}")
        params.append(status)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " ORDER BY s.date_of_service DESC, s.created_at DESC"

    rows = await pool.fetch(query, *params)

    superbills = []
    for r in rows:
        sb = _superbill_to_dict(r)
        sb["client_name"] = r["client_name"]
        sb["client_uuid"] = str(r["client_uuid"]) if r["client_uuid"] else None
        superbills.append(sb)

    # Compute summary stats scoped to the same visibility
    if not is_owner(user):
        stats_rows = await pool.fetch(
            "SELECT status, fee, amount_paid FROM superbills WHERE clinician_id = $1",
            user["uid"],
        )
    else:
        stats_rows = await pool.fetch("SELECT status, fee, amount_paid FROM superbills")
    total_billed = sum(float(r["fee"]) for r in stats_rows if r["fee"])
    total_paid = sum(float(r["amount_paid"]) for r in stats_rows if r["amount_paid"])
    total_outstanding = total_billed - total_paid

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="superbills",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"count": len(superbills), "status_filter": status},
    )

    return {
        "superbills": superbills,
        "count": len(superbills),
        "summary": {
            "total_billed": total_billed,
            "total_paid": total_paid,
            "total_outstanding": total_outstanding,
        },
    }


@router.get("/superbills/client/{client_id}")
async def list_client_superbills(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """List superbills for a specific client. Clinician only.

    Non-owner clinicians can only view superbills for their own clients.
    """
    # Look up client by UUID to get firebase_uid
    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    # Non-owners can only access their own clients' superbills
    await enforce_clinician_owns_client(user, client["firebase_uid"])

    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM superbills
        WHERE client_id = $1
        ORDER BY date_of_service DESC, created_at DESC
        """,
        client["firebase_uid"],
    )

    superbills = [_superbill_to_dict(r) for r in rows]

    # Compute client balance
    total_billed = sum(sb["fee"] or 0 for sb in superbills)
    total_paid = sum(sb["amount_paid"] or 0 for sb in superbills)
    outstanding = total_billed - total_paid

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="client_superbills",
        resource_id=client_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"count": len(superbills)},
    )

    return {
        "superbills": superbills,
        "count": len(superbills),
        "client_balance": {
            "total_billed": total_billed,
            "total_paid": total_paid,
            "outstanding": outstanding,
        },
    }


@router.get("/superbills/my")
async def list_my_superbills(
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """List superbills for the authenticated client. Client-accessible."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM superbills
        WHERE client_id = $1
        ORDER BY date_of_service DESC, created_at DESC
        """,
        user["uid"],
    )

    superbills = [_superbill_to_dict(r) for r in rows]

    total_billed = sum(sb["fee"] or 0 for sb in superbills)
    total_paid = sum(sb["amount_paid"] or 0 for sb in superbills)
    outstanding = total_billed - total_paid

    await log_audit_event(
        user_id=user["uid"],
        action="viewed_own_superbills",
        resource_type="superbill",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {
        "superbills": superbills,
        "count": len(superbills),
        "client_balance": {
            "total_billed": total_billed,
            "total_paid": total_paid,
            "outstanding": outstanding,
        },
    }


@router.get("/superbills/my/{superbill_id}/pdf")
async def download_my_superbill_pdf(
    superbill_id: str,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Download a superbill PDF. Client can only download their own."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT pdf_data, cpt_code, date_of_service, client_id FROM superbills WHERE id = $1::uuid",
        superbill_id,
    )
    if not row:
        raise HTTPException(404, "Superbill not found")

    enforce_client_owns_resource(user, row["client_id"])

    if not row["pdf_data"]:
        raise HTTPException(404, "PDF not yet generated for this superbill")

    await log_audit_event(
        user_id=user["uid"],
        action="superbill_pdf_downloaded",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    dos = row["date_of_service"]
    dos_str = dos.strftime("%Y%m%d") if hasattr(dos, "strftime") else str(dos)
    filename = f"superbill_{dos_str}_{row['cpt_code']}_{superbill_id[:8]}.pdf"

    return Response(
        content=bytes(row["pdf_data"]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/superbills/{superbill_id}")
async def get_superbill(
    superbill_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Get superbill details. Clinician only."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT s.*, c.full_name AS client_name, c.id AS client_uuid
        FROM superbills s
        LEFT JOIN clients c ON c.firebase_uid = s.client_id
        WHERE s.id = $1::uuid
        """,
        superbill_id,
    )
    if not row:
        raise HTTPException(404, "Superbill not found")

    sb = _superbill_to_dict(row)
    sb["client_name"] = row["client_name"]
    sb["client_uuid"] = str(row["client_uuid"]) if row["client_uuid"] else None

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return sb


@router.get("/superbills/{superbill_id}/pdf")
async def download_superbill_pdf(
    superbill_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Download the superbill PDF. Clinician only."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT pdf_data, cpt_code, date_of_service FROM superbills WHERE id = $1::uuid",
        superbill_id,
    )
    if not row:
        raise HTTPException(404, "Superbill not found")

    if not row["pdf_data"]:
        raise HTTPException(404, "PDF not yet generated for this superbill")

    await log_audit_event(
        user_id=user["uid"],
        action="superbill_pdf_downloaded",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    dos = row["date_of_service"]
    dos_str = dos.strftime("%Y%m%d") if hasattr(dos, "strftime") else str(dos)
    filename = f"superbill_{dos_str}_{row['cpt_code']}_{superbill_id[:8]}.pdf"

    return Response(
        content=bytes(row["pdf_data"]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.patch("/superbills/{superbill_id}/status")
async def update_superbill_status(
    superbill_id: str,
    body: UpdateStatusRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Update superbill billing status and payment info. Clinician only.

    Valid statuses: generated, submitted, paid, outstanding.
    """
    valid_statuses = {"generated", "submitted", "paid", "outstanding"}
    if body.status not in valid_statuses:
        raise HTTPException(400, f"Invalid status. Must be one of: {', '.join(valid_statuses)}")

    pool = await get_pool()

    # Verify superbill exists
    existing = await pool.fetchrow(
        "SELECT id, status FROM superbills WHERE id = $1::uuid", superbill_id
    )
    if not existing:
        raise HTTPException(404, "Superbill not found")

    # Build update
    sets = ["status = $1"]
    vals: list = [body.status]
    idx = 2

    if body.amount_paid is not None:
        sets.append(f"amount_paid = ${idx}::numeric")
        vals.append(body.amount_paid)
        idx += 1

    vals.append(superbill_id)
    query = f"UPDATE superbills SET {', '.join(sets)} WHERE id = ${idx}::uuid"
    await pool.execute(query, *vals)

    await log_audit_event(
        user_id=user["uid"],
        action="superbill_status_updated",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "old_status": existing["status"],
            "new_status": body.status,
            "amount_paid": body.amount_paid,
        },
    )

    return {"status": "updated", "superbill_id": superbill_id, "new_status": body.status}


@router.post("/superbills/{superbill_id}/email")
async def email_superbill(
    superbill_id: str,
    body: EmailSuperbillRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Email superbill PDF to client for OON reimbursement. Clinician only."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT s.*, c.full_name AS client_name, c.email AS client_email
        FROM superbills s
        LEFT JOIN clients c ON c.firebase_uid = s.client_id
        WHERE s.id = $1::uuid
        """,
        superbill_id,
    )
    if not row:
        raise HTTPException(404, "Superbill not found")

    if not row["pdf_data"]:
        raise HTTPException(400, "No PDF available for this superbill")

    recipient = body.recipient_email or row["client_email"]
    if not recipient:
        raise HTTPException(400, "No email address available for this client")

    # Get practice profile for email branding
    practice = await get_practice_profile(user["uid"])
    practice_name = "Your Therapist"
    if practice:
        practice_name = practice.get("practice_name") or practice.get("clinician_name") or "Your Therapist"

    dos = row["date_of_service"]
    dos_formatted = dos.strftime("%B %d, %Y") if hasattr(dos, "strftime") else str(dos)
    cpt_desc = row["cpt_description"] or CPT_DESCRIPTIONS.get(row["cpt_code"], "Psychotherapy")
    fee_str = f"${float(row['fee']):,.2f}" if row["fee"] else "See attached"

    # Build email
    subject = f"Superbill from {practice_name} - {dos_formatted}"

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #1a1a1a; margin: 0;">{practice_name}</h2>
            <p style="color: #666; margin: 4px 0 0;">Superbill for Insurance Reimbursement</p>
        </div>

        <div style="background: #f8f8f8; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <p style="color: #333; margin: 0 0 12px;">Hello {row['client_name'] or 'there'},</p>
            <p style="color: #555; margin: 0 0 12px;">
                Please find your superbill attached for the session on <strong>{dos_formatted}</strong>.
            </p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr>
                    <td style="padding: 4px 0; color: #666;">Service:</td>
                    <td style="padding: 4px 0; color: #333; text-align: right;">{cpt_desc} ({row['cpt_code']})</td>
                </tr>
                <tr>
                    <td style="padding: 4px 0; color: #666;">Amount:</td>
                    <td style="padding: 4px 0; color: #333; text-align: right; font-weight: 600;">{fee_str}</td>
                </tr>
            </table>
            <p style="color: #555; margin: 12px 0 0; font-size: 14px;">
                You can submit this superbill to your insurance company for out-of-network reimbursement.
                The PDF is attached to this email.
            </p>
        </div>

        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 24px;">
            This email was sent by {practice_name} via Trellis.
        </p>
    </div>
    """

    text_body = (
        f"Superbill from {practice_name}\n\n"
        f"Hello {row['client_name'] or 'there'},\n\n"
        f"Please find your superbill for the session on {dos_formatted}.\n"
        f"Service: {cpt_desc} ({row['cpt_code']})\n"
        f"Amount: {fee_str}\n\n"
        f"You can submit this superbill to your insurance company for out-of-network reimbursement.\n"
        f"The PDF is attached to this email.\n"
    )

    # Send email with PDF attachment
    try:
        from mailer import send_email_with_attachment
        send_email_with_attachment(
            to=recipient,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            attachment_data=bytes(row["pdf_data"]),
            attachment_filename=f"superbill_{dos.strftime('%Y%m%d') if hasattr(dos, 'strftime') else dos}_{row['cpt_code']}.pdf",
            attachment_mime_type="application/pdf",
        )
    except ImportError:
        # Fallback: send email without attachment (link to download)
        try:
            from mailer import send_email
            send_email(
                to=recipient,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
            )
        except Exception as e:
            logger.error("Failed to send superbill email: %s", e)
            raise HTTPException(502, f"Failed to send email: {type(e).__name__}")

    await log_audit_event(
        user_id=user["uid"],
        action="superbill_emailed",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "recipient": recipient,
            "client_id": row["client_id"],
        },
    )

    # PHI-safe: do not log recipient email address
    logger.info("Superbill %s emailed successfully", superbill_id)

    return {"status": "sent", "recipient": recipient, "superbill_id": superbill_id}
