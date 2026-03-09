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
  - GET  /api/superbills                     — list all superbills (with optional date range filter)
  - GET  /api/superbills/summary             — enhanced billing summary (A/R aging, collections, metrics)
  - GET  /api/superbills/filing-deadlines    — superbills at risk of missing filing deadlines
  - GET  /api/superbills/client/{client_id}  — list superbills for a client
  - GET  /api/superbills/{superbill_id}      — get superbill details
  - GET  /api/superbills/{superbill_id}/pdf  — download superbill PDF
  - PATCH /api/superbills/{superbill_id}     — update superbill claim fields
  - PATCH /api/superbills/{superbill_id}/status — update billing status (auto-sets date_submitted/date_paid)
  - PATCH /api/superbills/batch-status       — batch update billing status for multiple superbills
  - POST /api/superbills/{superbill_id}/email — email superbill to client
  - GET  /api/icd10/search                   — search ICD-10 codes
  - POST /api/clients/{client_id}/statement        — generate patient statement PDF
  - POST /api/clients/{client_id}/statement/email   — email patient statement to client
"""
import json
import logging
import os
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
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
    get_active_authorization,
    increment_auth_sessions_used,
    log_audit_event,
    get_practice_billing_settings,
    update_practice_billing_settings,
    get_practices_with_billing,
)
from billing_service import billing_client, BillingServiceError
from superbill_pdf import generate_superbill_pdf, CPT_DESCRIPTIONS
from cms1500_pdf import generate_cms1500_pdf, build_cms1500_data
from edi_837p import generate_837p, generate_837p_batch
from patient_statement_pdf import generate_patient_statement

logger = logging.getLogger(__name__)

router = APIRouter()

# Shared secret for cron endpoint authentication (same as scheduling.py)
CRON_SECRET = os.getenv("CRON_SECRET", "dev-cron-secret")


def _verify_cron_secret(x_cron_secret: str | None = Header(None, alias="X-Cron-Secret")) -> None:
    """Verify the shared secret for cron endpoints."""
    if x_cron_secret != CRON_SECRET:
        raise HTTPException(403, "Invalid cron secret")


# ---------------------------------------------------------------------------
# ICD-10 code data (loaded once on startup)
# ---------------------------------------------------------------------------

_ICD10_CODES: list[dict] = []


def _load_icd10_codes() -> list[dict]:
    """Load ICD-10 mental health codes from JSON data file."""
    global _ICD10_CODES
    if _ICD10_CODES:
        return _ICD10_CODES
    data_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "shared", "data", "icd10_mental_health.json"
    )
    data_path = os.path.normpath(data_path)
    try:
        with open(data_path, "r") as f:
            _ICD10_CODES = json.load(f)
        logger.info("Loaded %d ICD-10 codes from %s", len(_ICD10_CODES), data_path)
    except Exception as e:
        logger.error("Failed to load ICD-10 codes: %s", e)
        _ICD10_CODES = []
    return _ICD10_CODES


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


class EmailStatementRequest(BaseModel):
    recipient_email: str | None = None  # Override client email


class BatchEdi837Request(BaseModel):
    superbill_ids: list[str]


class UpdateSuperbillRequest(BaseModel):
    cpt_code: Optional[str] = None
    cpt_description: Optional[str] = None
    diagnosis_codes: Optional[list[dict]] = None
    fee: Optional[float] = None
    place_of_service: Optional[str] = None
    modifiers: Optional[list[str]] = None
    payer_id: Optional[str] = None
    auth_number: Optional[str] = None
    secondary_payer_name: Optional[str] = None
    secondary_payer_id: Optional[str] = None
    secondary_member_id: Optional[str] = None


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
    keys = r.keys()
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
        "billing_npi": r["billing_npi"] if "billing_npi" in keys else None,
        "auth_number": r["auth_number"] if "auth_number" in keys else None,
        "has_pdf": r["pdf_data"] is not None if "pdf_data" in keys else False,
        "date_submitted": r["date_submitted"].isoformat() if "date_submitted" in keys and r["date_submitted"] else None,
        "date_paid": r["date_paid"].isoformat() if "date_paid" in keys and r["date_paid"] else None,
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }


async def _build_claim_data_from_superbill(superbill: dict, practice_id: str | None = None) -> dict | None:
    """Build claim submission data from a superbill record.

    Uses build_cms1500_data() as the base and restructures for the billing
    service's ClaimSubmitRequest format.
    Returns None if required data is missing.
    """
    try:
        client = await get_client(superbill["client_id"])
        if not client:
            logger.warning("Cannot build claim data: client %s not found", superbill["client_id"])
            return None

        clinician = await get_clinician(superbill["clinician_id"])
        practice = await get_practice_profile(superbill["clinician_id"])
        practice_rec = None
        if practice_id:
            practice_rec = await get_practice(practice_id)

        # Build CMS-1500 data as foundation
        cms_data = build_cms1500_data(superbill, client, practice or {}, clinician or {})

        # Map to billing service ClaimSubmitRequest format
        dx_list = cms_data.get("box_21", [])
        diagnoses = []
        for dx in dx_list:
            code = dx.get("code", "")
            # Find description from superbill diagnosis_codes
            description = ""
            for sb_dx in (superbill.get("diagnosis_codes") or []):
                if isinstance(sb_dx, dict) and sb_dx.get("code") == code:
                    description = sb_dx.get("description", "")
                    break
            diagnoses.append({"code": code, "description": description})

        service_lines = []
        for line in cms_data.get("box_24", []):
            service_lines.append({
                "cpt_code": line.get("d_cpt", ""),
                "modifier": line.get("d_modifiers", ""),
                "units": int(line.get("g_units", "1")),
                "charge_amount": float(line.get("f_charges", "0")),
                "date_of_service": superbill.get("date_of_service", ""),
                "place_of_service": line.get("b_pos", "11"),
                "diagnosis_pointers": list(range(1, len(diagnoses) + 1)),
            })

        # Determine NPIs
        practice_npi = ""
        practice_tax_id = ""
        practice_name = ""
        practice_address = {}
        if practice_rec:
            practice_npi = practice_rec.get("npi", "")
            practice_tax_id = practice_rec.get("tax_id", "")
            practice_name = practice_rec.get("name", "")
            practice_address = {
                "address1": practice_rec.get("address_line1", ""),
                "city": practice_rec.get("city", ""),
                "state": practice_rec.get("state", ""),
                "postal_code": practice_rec.get("zip", ""),
            }
        elif practice:
            practice_npi = practice.get("npi", "")
            practice_tax_id = practice.get("tax_id", "")
            practice_name = practice.get("practice_name") or practice.get("clinician_name", "")
            practice_address = {
                "address1": practice.get("address_line1", ""),
                "city": practice.get("city", ""),
                "state": practice.get("state", ""),
                "postal_code": practice.get("zip", ""),
            }

        # Patient gender
        sex = (client.get("sex") or "").upper()
        gender = sex if sex in ("M", "F") else "U"

        claim_data = {
            "external_superbill_id": superbill["id"],
            "payer_name": client.get("payer_name", ""),
            "payer_id": client.get("payer_id", ""),
            "provider": {
                "npi": superbill.get("billing_npi") or practice_npi,
                "tax_id": practice_tax_id,
                "name": practice_name,
                "address": practice_address,
            },
            "patient": {
                "first_name": (client.get("full_name") or "").split()[0] if client.get("full_name") else "",
                "last_name": (client.get("full_name") or "").split()[-1] if client.get("full_name") else "",
                "date_of_birth": client.get("date_of_birth", ""),
                "gender": gender,
                "member_id": client.get("member_id", ""),
                "address": {
                    "address1": client.get("address_line1", ""),
                    "city": client.get("address_city", ""),
                    "state": client.get("address_state", ""),
                    "postal_code": client.get("address_zip", ""),
                },
            },
            "diagnoses": diagnoses,
            "service_lines": service_lines,
            "total_charge": float(superbill.get("fee") or 0),
            "authorization_number": superbill.get("auth_number"),
        }

        # Add rendering provider if different from billing provider
        if clinician and clinician.get("npi") and clinician["npi"] != claim_data["provider"]["npi"]:
            name_parts = (clinician.get("clinician_name") or "").split()
            claim_data["rendering_provider"] = {
                "npi": clinician["npi"],
                "first_name": name_parts[0] if name_parts else "",
                "last_name": name_parts[-1] if len(name_parts) > 1 else "",
            }

        return claim_data
    except Exception as e:
        logger.error("Failed to build claim data for superbill %s: %s", superbill.get("id"), e)
        return None


async def _auto_submit_to_billing(superbill: dict, practice_id: str | None) -> dict:
    """Attempt auto-submission to billing service. Returns info dict.

    Never raises — failures are logged silently and returned in the result.
    """
    result = {"auto_submitted": False, "billing_error": None}

    if not practice_id:
        return result

    try:
        connected = await billing_client.is_connected(practice_id)
        if not connected:
            return result

        settings = await billing_client.get_settings(practice_id)
        if not settings or not settings.get("billing_auto_submit"):
            return result

        claim_data = await _build_claim_data_from_superbill(superbill, practice_id)
        if not claim_data:
            result["billing_error"] = "Could not build claim data"
            logger.warning("Auto-submit skipped: could not build claim data for superbill %s", superbill["id"])
            return result

        api_key = settings["billing_api_key"]
        service_url = settings["billing_service_url"]
        resp = await billing_client.submit_claim(api_key, service_url, claim_data)

        if isinstance(resp, BillingServiceError):
            result["billing_error"] = resp.message
            logger.warning("Auto-submit failed for superbill %s: %s", superbill["id"], resp.message)
            return result

        # Success — update superbill status
        pool = await get_pool()
        await pool.execute(
            """
            UPDATE superbills
            SET status = 'submitted', date_submitted = now()
            WHERE id = $1::uuid
            """,
            superbill["id"],
        )
        result["auto_submitted"] = True
        result["billing_claim_id"] = resp.get("claim_id")
        logger.info(
            "Auto-submitted superbill %s to billing service (claim_id=%s)",
            superbill["id"], resp.get("claim_id"),
        )
    except Exception as e:
        result["billing_error"] = str(e)
        logger.warning("Auto-submit error for superbill %s: %s", superbill.get("id"), e)

    return result


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

    # Look up active authorization for this client/CPT code
    auth_number = None
    auth_warning = None
    try:
        active_auth = await get_active_authorization(client_id, cpt_code)
        if active_auth:
            auth_number = active_auth.get("auth_number")
            await increment_auth_sessions_used(active_auth["id"])
            logger.info(
                "Authorization %s: session used for note %s (sessions_used now incremented)",
                active_auth["id"], note_id,
            )
        elif insurance_payer:
            auth_warning = f"No active authorization found for client with payer {insurance_payer}"
            logger.warning("Superbill generation: %s (note=%s)", auth_warning, note_id)
    except Exception as e:
        logger.error("Authorization lookup failed for note %s: %s", note_id, e)

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
             status, pdf_data, billing_npi, auth_number)
        VALUES ($1, $2::uuid, $3::uuid, $4, $5::date, $6, $7, $8::jsonb, $9::numeric, 0, 'generated', $10, $11, $12)
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
        auth_number,
    )

    logger.info(
        "Superbill generated: %s (note=%s, cpt=%s, fee=%s, pdf=%s, auth=%s)",
        row["id"], note_id, cpt_code, fee, pdf_bytes is not None, auth_number,
    )

    result = _superbill_to_dict(row)
    if auth_warning:
        result["auth_warning"] = auth_warning

    # --- Auto-submit to billing service (silent, never blocks) ---
    auto_result = await _auto_submit_to_billing(result, practice_id)
    if auto_result.get("auto_submitted"):
        result["status"] = "submitted"
        result["auto_submitted"] = True
    elif auto_result.get("billing_error"):
        result["auto_submitted"] = False
        result["billing_auto_submit_error"] = auto_result["billing_error"]

    return result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/superbills/generate")
async def generate_superbill(
    body: GenerateSuperbillRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
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
    from_date: str | None = None,
    to_date: str | None = None,
    user: dict = Depends(require_practice_member("owner")),
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

    if from_date:
        conditions.append(f"s.date_of_service >= ${len(params) + 1}::date")
        params.append(from_date)

    if to_date:
        conditions.append(f"s.date_of_service <= ${len(params) + 1}::date")
        params.append(to_date)

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
    user: dict = Depends(require_practice_member("owner")),
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


@router.get("/superbills/summary")
async def get_superbills_summary(
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Enhanced billing summary with A/R aging, collections, and metrics. Clinician only."""
    pool = await get_pool()
    now = datetime.now(timezone.utc)

    # Scope: owners see all, non-owners see only their own
    owner_filter = ""
    params: list = []
    if not is_owner(user):
        owner_filter = " AND clinician_id = $1"
        params = [user["uid"]]

    # --- A/R aging buckets (only submitted/outstanding superbills) ---
    aging_query = f"""
        SELECT
            COALESCE(date_submitted, created_at) AS ref_date,
            COALESCE(fee, 0) AS fee_amount
        FROM superbills
        WHERE status IN ('submitted', 'outstanding')
        {owner_filter}
    """
    aging_rows = await pool.fetch(aging_query, *params)

    buckets = {
        "current": {"count": 0, "amount": 0.0},
        "31_60": {"count": 0, "amount": 0.0},
        "61_90": {"count": 0, "amount": 0.0},
        "over_90": {"count": 0, "amount": 0.0},
    }
    for row in aging_rows:
        ref = row["ref_date"]
        if ref.tzinfo is None:
            from datetime import timezone as _tz
            ref = ref.replace(tzinfo=_tz.utc)
        days = (now - ref).days
        amt = float(row["fee_amount"])
        if days <= 30:
            buckets["current"]["count"] += 1
            buckets["current"]["amount"] += amt
        elif days <= 60:
            buckets["31_60"]["count"] += 1
            buckets["31_60"]["amount"] += amt
        elif days <= 90:
            buckets["61_90"]["count"] += 1
            buckets["61_90"]["amount"] += amt
        else:
            buckets["over_90"]["count"] += 1
            buckets["over_90"]["amount"] += amt

    # Round amounts
    for b in buckets.values():
        b["amount"] = round(b["amount"], 2)

    # --- Monthly collections ---
    first_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if first_of_month.month == 1:
        first_of_prev_month = first_of_month.replace(year=first_of_month.year - 1, month=12)
    else:
        first_of_prev_month = first_of_month.replace(month=first_of_month.month - 1)

    param_offset = len(params)
    collections_query = f"""
        SELECT
            COALESCE(SUM(CASE WHEN date_paid >= ${param_offset + 1} THEN amount_paid ELSE 0 END), 0) AS current_month,
            COALESCE(SUM(CASE WHEN date_paid >= ${param_offset + 2} AND date_paid < ${param_offset + 1} THEN amount_paid ELSE 0 END), 0) AS prev_month
        FROM superbills
        WHERE status = 'paid'
        {owner_filter}
    """
    coll_params = params + [first_of_month, first_of_prev_month]
    coll_row = await pool.fetchrow(collections_query, *coll_params)

    # --- Average days to payment ---
    avg_query = f"""
        SELECT AVG(EXTRACT(EPOCH FROM (date_paid - date_submitted)) / 86400) AS avg_days
        FROM superbills
        WHERE status = 'paid' AND date_paid IS NOT NULL AND date_submitted IS NOT NULL
        {owner_filter}
    """
    avg_row = await pool.fetchrow(avg_query, *params)
    avg_days = round(float(avg_row["avg_days"]), 1) if avg_row and avg_row["avg_days"] else None

    # --- Claims this month ---
    claims_query = f"""
        SELECT COUNT(*) AS cnt
        FROM superbills
        WHERE created_at >= ${param_offset + 1}
        {owner_filter}
    """
    claims_row = await pool.fetchrow(claims_query, *(params + [first_of_month]))

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="billing_summary",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {
        "aging": buckets,
        "collections_current_month": round(float(coll_row["current_month"]), 2),
        "collections_prev_month": round(float(coll_row["prev_month"]), 2),
        "avg_days_to_payment": avg_days,
        "claims_this_month": claims_row["cnt"],
    }


@router.get("/superbills/filing-deadlines")
async def get_filing_deadlines(
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Return superbills at risk of missing payer filing deadlines.

    A superbill is 'at risk' when it is in 'generated' status and the
    filing deadline (date_of_service + client.filing_deadline_days) is
    within 30 days or already past.
    """
    pool = await get_pool()
    today = date.today()
    threshold = today + timedelta(days=30)

    rows = await pool.fetch(
        """
        SELECT
            s.id            AS superbill_id,
            s.client_id,
            s.date_of_service,
            s.cpt_code,
            s.fee,
            c.full_name     AS client_name,
            c.filing_deadline_days,
            (s.date_of_service + c.filing_deadline_days * INTERVAL '1 day')::date
                AS filing_deadline
        FROM superbills s
        JOIN clients c ON c.firebase_uid = s.client_id
        WHERE s.status = 'generated'
          AND s.date_of_service IS NOT NULL
          AND c.filing_deadline_days IS NOT NULL
          AND (s.date_of_service + c.filing_deadline_days * INTERVAL '1 day')::date <= $1
        ORDER BY (s.date_of_service + c.filing_deadline_days * INTERVAL '1 day')::date ASC
        """,
        threshold,
    )

    at_risk = []
    for r in rows:
        deadline = r["filing_deadline"]
        days_remaining = (deadline - today).days
        at_risk.append(
            {
                "superbill_id": r["superbill_id"],
                "client_name": r["client_name"],
                "client_id": r["client_id"],
                "date_of_service": r["date_of_service"].isoformat(),
                "filing_deadline": deadline.isoformat(),
                "days_remaining": days_remaining,
                "cpt_code": r["cpt_code"],
                "fee": float(r["fee"]) if r["fee"] is not None else None,
            }
        )

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="filing_deadlines",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {"at_risk": at_risk}


# ---------------------------------------------------------------------------
# Financial Reports
# ---------------------------------------------------------------------------

@router.get("/billing/reports")
async def get_financial_reports(
    request: Request,
    from_date: str | None = Query(None, description="Start date (YYYY-MM-DD)"),
    to_date: str | None = Query(None, description="End date (YYYY-MM-DD)"),
    user: dict = Depends(require_practice_member("owner")),
):
    """Comprehensive financial reports data for the reports dashboard.

    Returns collections by month, payer, CPT code, A/R aging, payer mix,
    denial rate, avg days to payment by payer, and YTD summary.
    Clinician only, audit logged.
    """
    pool = await get_pool()
    now = datetime.now(timezone.utc)

    # Parse date range (default: last 12 months)
    if to_date:
        try:
            end_dt = datetime.strptime(to_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "Invalid to_date format. Use YYYY-MM-DD.")
        # End of the specified day
        end_dt = end_dt.replace(hour=23, minute=59, second=59)
    else:
        end_dt = now

    if from_date:
        try:
            start_dt = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "Invalid from_date format. Use YYYY-MM-DD.")
    else:
        # Default: 12 months ago from start of current month
        start_dt = (now.replace(day=1) - timedelta(days=365)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Scope: owners see all, non-owners see only their own
    owner_filter = ""
    base_params: list = [start_dt, end_dt]
    if not is_owner(user):
        owner_filter = " AND s.clinician_id = $3"
        base_params.append(user["uid"])

    # --- 1) Collections by month ---
    collections_by_month_query = f"""
        SELECT
            EXTRACT(YEAR FROM s.date_of_service)::int AS year,
            EXTRACT(MONTH FROM s.date_of_service)::int AS month,
            COALESCE(SUM(COALESCE(s.fee, 0)), 0) AS billed,
            COALESCE(SUM(s.amount_paid), 0) AS collected,
            COALESCE(SUM(COALESCE(s.fee, 0) - s.amount_paid), 0) AS outstanding
        FROM superbills s
        WHERE s.date_of_service >= $1 AND s.date_of_service <= $2
        {owner_filter}
        GROUP BY year, month
        ORDER BY year, month
    """
    month_rows = await pool.fetch(collections_by_month_query, *base_params)
    collections_by_month = [
        {
            "year": r["year"],
            "month": r["month"],
            "billed": round(float(r["billed"]), 2),
            "collected": round(float(r["collected"]), 2),
            "outstanding": round(float(r["outstanding"]), 2),
        }
        for r in month_rows
    ]

    # --- 2) Collections by payer ---
    collections_by_payer_query = f"""
        SELECT
            COALESCE(c.payer_name, 'Self-Pay') AS payer_name,
            COALESCE(SUM(COALESCE(s.fee, 0)), 0) AS billed,
            COALESCE(SUM(s.amount_paid), 0) AS collected,
            COUNT(*) AS count
        FROM superbills s
        LEFT JOIN clients c ON c.firebase_uid = s.client_id
        WHERE s.date_of_service >= $1 AND s.date_of_service <= $2
        {owner_filter}
        GROUP BY payer_name
        ORDER BY collected DESC
    """
    payer_rows = await pool.fetch(collections_by_payer_query, *base_params)
    collections_by_payer = [
        {
            "payer_name": r["payer_name"] or "Self-Pay",
            "billed": round(float(r["billed"]), 2),
            "collected": round(float(r["collected"]), 2),
            "count": r["count"],
        }
        for r in payer_rows
    ]

    # --- 3) Collections by CPT code ---
    collections_by_cpt_query = f"""
        SELECT
            s.cpt_code,
            s.cpt_description,
            COUNT(*) AS count,
            COALESCE(SUM(COALESCE(s.fee, 0)), 0) AS billed,
            COALESCE(SUM(s.amount_paid), 0) AS collected
        FROM superbills s
        WHERE s.date_of_service >= $1 AND s.date_of_service <= $2
        {owner_filter}
        GROUP BY s.cpt_code, s.cpt_description
        ORDER BY collected DESC
    """
    cpt_rows = await pool.fetch(collections_by_cpt_query, *base_params)
    collections_by_cpt = [
        {
            "cpt_code": r["cpt_code"],
            "cpt_description": r["cpt_description"] or CPT_DESCRIPTIONS.get(r["cpt_code"], ""),
            "count": r["count"],
            "billed": round(float(r["billed"]), 2),
            "collected": round(float(r["collected"]), 2),
        }
        for r in cpt_rows
    ]

    # --- 4) A/R aging (outstanding/submitted only, within date range) ---
    aging_query = f"""
        SELECT
            COALESCE(s.date_submitted, s.created_at) AS ref_date,
            COALESCE(s.fee, 0) - s.amount_paid AS balance
        FROM superbills s
        WHERE s.status IN ('submitted', 'outstanding')
          AND s.date_of_service >= $1 AND s.date_of_service <= $2
        {owner_filter}
    """
    aging_rows = await pool.fetch(aging_query, *base_params)
    ar_aging = {
        "current": {"amount": 0.0, "count": 0},
        "days_31_60": {"amount": 0.0, "count": 0},
        "days_61_90": {"amount": 0.0, "count": 0},
        "days_90_plus": {"amount": 0.0, "count": 0},
    }
    for row in aging_rows:
        ref = row["ref_date"]
        if ref.tzinfo is None:
            ref = ref.replace(tzinfo=timezone.utc)
        days = (now - ref).days
        balance = float(row["balance"])
        if balance <= 0:
            continue
        if days <= 30:
            ar_aging["current"]["count"] += 1
            ar_aging["current"]["amount"] += balance
        elif days <= 60:
            ar_aging["days_31_60"]["count"] += 1
            ar_aging["days_31_60"]["amount"] += balance
        elif days <= 90:
            ar_aging["days_61_90"]["count"] += 1
            ar_aging["days_61_90"]["amount"] += balance
        else:
            ar_aging["days_90_plus"]["count"] += 1
            ar_aging["days_90_plus"]["amount"] += balance

    for b in ar_aging.values():
        b["amount"] = round(b["amount"], 2)

    # --- 5) Payer mix (% of billed by payer) ---
    total_billed_all = sum(p["billed"] for p in collections_by_payer)
    payer_mix = []
    for p in collections_by_payer:
        pct = round((p["billed"] / total_billed_all * 100) if total_billed_all > 0 else 0, 1)
        payer_mix.append({
            "payer_name": p["payer_name"],
            "percentage": pct,
            "count": p["count"],
        })

    # --- 6) Denial rate (from billing service ERA data if available) ---
    denial_query = f"""
        SELECT
            COUNT(*) AS total_claims,
            COUNT(*) FILTER (WHERE s.status = 'outstanding'
                AND s.date_submitted IS NOT NULL
                AND (COALESCE(s.date_submitted, s.created_at) + INTERVAL '45 days') < NOW()
            ) AS denied_claims
        FROM superbills s
        WHERE s.date_of_service >= $1 AND s.date_of_service <= $2
        {owner_filter}
    """
    denial_row = await pool.fetchrow(denial_query, *base_params)
    total_claims = denial_row["total_claims"] if denial_row else 0
    denied_claims = denial_row["denied_claims"] if denial_row else 0
    denial_rate = {
        "total_claims": total_claims,
        "denied_claims": denied_claims,
        "rate_percent": round((denied_claims / total_claims * 100) if total_claims > 0 else 0, 1),
    }

    # --- 7) Avg days to payment by payer ---
    avg_days_query = f"""
        SELECT
            COALESCE(c.payer_name, 'Self-Pay') AS payer_name,
            AVG(EXTRACT(EPOCH FROM (s.date_paid - s.date_submitted)) / 86400) AS avg_days
        FROM superbills s
        LEFT JOIN clients c ON c.firebase_uid = s.client_id
        WHERE s.status = 'paid'
          AND s.date_paid IS NOT NULL AND s.date_submitted IS NOT NULL
          AND s.date_of_service >= $1 AND s.date_of_service <= $2
        {owner_filter}
        GROUP BY payer_name
        ORDER BY avg_days ASC
    """
    avg_rows = await pool.fetch(avg_days_query, *base_params)
    avg_days_to_payment_by_payer = [
        {
            "payer_name": r["payer_name"] or "Self-Pay",
            "avg_days": round(float(r["avg_days"]), 1) if r["avg_days"] else 0,
        }
        for r in avg_rows
    ]

    # --- 8) YTD summary ---
    ytd_query = f"""
        SELECT
            COALESCE(SUM(COALESCE(s.fee, 0)), 0) AS total_billed,
            COALESCE(SUM(s.amount_paid), 0) AS total_collected,
            COALESCE(SUM(COALESCE(s.fee, 0) - s.amount_paid), 0) AS total_outstanding,
            COUNT(*) AS total_claims
        FROM superbills s
        WHERE s.date_of_service >= $1 AND s.date_of_service <= $2
        {owner_filter}
    """
    ytd_row = await pool.fetchrow(ytd_query, *base_params)
    total_billed = round(float(ytd_row["total_billed"]), 2) if ytd_row else 0
    total_collected = round(float(ytd_row["total_collected"]), 2) if ytd_row else 0
    total_outstanding = round(float(ytd_row["total_outstanding"]), 2) if ytd_row else 0
    claim_count = ytd_row["total_claims"] if ytd_row else 0
    ytd_summary = {
        "total_billed": total_billed,
        "total_collected": total_collected,
        "total_outstanding": total_outstanding,
        "total_claims": claim_count,
        "avg_per_claim": round(total_billed / claim_count, 2) if claim_count > 0 else 0,
    }

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="financial_reports",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"from_date": start_dt.isoformat(), "to_date": end_dt.isoformat()},
    )

    return {
        "collections_by_month": collections_by_month,
        "collections_by_payer": collections_by_payer,
        "collections_by_cpt": collections_by_cpt,
        "ar_aging": ar_aging,
        "payer_mix": payer_mix,
        "denial_rate": denial_rate,
        "avg_days_to_payment_by_payer": avg_days_to_payment_by_payer,
        "ytd_summary": ytd_summary,
        "date_range": {
            "from_date": start_dt.strftime("%Y-%m-%d"),
            "to_date": end_dt.strftime("%Y-%m-%d"),
        },
    }


@router.get("/superbills/{superbill_id}")
async def get_superbill(
    superbill_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
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
    user: dict = Depends(require_practice_member("owner")),
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


@router.get("/superbills/{superbill_id}/cms1500")
async def download_cms1500_pdf(
    superbill_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Download a CMS-1500 claim form PDF for a superbill. Clinician only."""
    pool = await get_pool()

    # Fetch superbill with all fields needed for CMS-1500
    row = await pool.fetchrow(
        "SELECT * FROM superbills WHERE id = $1::uuid", superbill_id
    )
    if not row:
        raise HTTPException(404, "Superbill not found")

    superbill = dict(row)
    # Normalise diagnosis_codes
    dx = superbill.get("diagnosis_codes")
    if isinstance(dx, str):
        superbill["diagnosis_codes"] = json.loads(dx)

    # Fetch client
    client_row = await get_client(superbill["client_id"])
    client = dict(client_row) if client_row else {}

    # Fetch practice and clinician
    practice = await get_practice_profile(superbill.get("clinician_id") or user["uid"])
    clinician_row = await get_clinician(superbill.get("clinician_id") or user["uid"])
    clinician = dict(clinician_row) if clinician_row else {}

    # Get stored signature
    signature = await get_stored_signature(superbill.get("clinician_id") or user["uid"])

    # Generate PDF
    try:
        pdf_bytes = generate_cms1500_pdf(
            superbill_data=superbill,
            client=client,
            practice=practice or {},
            clinician=clinician,
            signature_data=signature,
        )
    except Exception as e:
        logger.error("CMS-1500 PDF generation failed for superbill %s: %s", superbill_id, e)
        raise HTTPException(500, "Failed to generate CMS-1500 PDF")

    await log_audit_event(
        user_id=user["uid"],
        action="cms1500_pdf_downloaded",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    dos = row["date_of_service"]
    dos_str = dos.strftime("%Y%m%d") if hasattr(dos, "strftime") else str(dos)
    filename = f"cms1500_{dos_str}_{row['cpt_code']}_{superbill_id[:8]}.pdf"

    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/superbills/{superbill_id}/cms1500/data")
async def get_cms1500_data(
    superbill_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Return structured JSON of all CMS-1500 field values. Clinician only."""
    pool = await get_pool()

    row = await pool.fetchrow(
        "SELECT * FROM superbills WHERE id = $1::uuid", superbill_id
    )
    if not row:
        raise HTTPException(404, "Superbill not found")

    superbill = dict(row)
    dx = superbill.get("diagnosis_codes")
    if isinstance(dx, str):
        superbill["diagnosis_codes"] = json.loads(dx)

    client_row = await get_client(superbill["client_id"])
    client = dict(client_row) if client_row else {}

    practice = await get_practice_profile(superbill.get("clinician_id") or user["uid"])
    clinician_row = await get_clinician(superbill.get("clinician_id") or user["uid"])
    clinician = dict(clinician_row) if clinician_row else {}

    fields = build_cms1500_data(superbill, client, practice or {}, clinician)

    await log_audit_event(
        user_id=user["uid"],
        action="cms1500_data_viewed",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {"superbill_id": superbill_id, "cms1500_fields": fields}


@router.get("/superbills/{superbill_id}/edi837")
async def download_edi837(
    superbill_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Download an ANSI X12 837P EDI file for a single superbill. Clinician only."""
    pool = await get_pool()

    row = await pool.fetchrow(
        "SELECT * FROM superbills WHERE id = $1::uuid", superbill_id
    )
    if not row:
        raise HTTPException(404, "Superbill not found")

    superbill = dict(row)
    dx = superbill.get("diagnosis_codes")
    if isinstance(dx, str):
        superbill["diagnosis_codes"] = json.loads(dx)

    # Fetch client, practice, clinician
    client_row = await get_client(superbill["client_id"])
    client = dict(client_row) if client_row else {}

    practice = await get_practice_profile(superbill.get("clinician_id") or user["uid"])
    clinician_row = await get_clinician(superbill.get("clinician_id") or user["uid"])
    clinician = dict(clinician_row) if clinician_row else {}

    try:
        edi_content = generate_837p(
            superbill_data=superbill,
            client=client,
            practice=practice or {},
            clinician=clinician,
        )
    except Exception as e:
        logger.error("837P generation failed for superbill %s: %s", superbill_id, e)
        raise HTTPException(500, "Failed to generate 837P EDI file")

    await log_audit_event(
        user_id=user["uid"],
        action="edi837_downloaded",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    dos = row["date_of_service"]
    dos_str = dos.strftime("%Y%m%d") if hasattr(dos, "strftime") else str(dos)
    filename = f"837P_{dos_str}_{row['cpt_code']}_{superbill_id[:8]}.edi"

    return Response(
        content=edi_content.encode("utf-8"),
        media_type="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.post("/superbills/batch-edi837")
async def download_batch_edi837(
    body: BatchEdi837Request,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Download a combined ANSI X12 837P EDI file for multiple superbills. Clinician only."""
    if not body.superbill_ids:
        raise HTTPException(400, "No superbill IDs provided")

    if len(body.superbill_ids) > 100:
        raise HTTPException(400, "Maximum 100 superbills per batch")

    pool = await get_pool()
    claims = []

    for sb_id in body.superbill_ids:
        row = await pool.fetchrow(
            "SELECT * FROM superbills WHERE id = $1::uuid", sb_id
        )
        if not row:
            raise HTTPException(404, f"Superbill {sb_id} not found")

        superbill = dict(row)
        dx = superbill.get("diagnosis_codes")
        if isinstance(dx, str):
            superbill["diagnosis_codes"] = json.loads(dx)

        client_row = await get_client(superbill["client_id"])
        client = dict(client_row) if client_row else {}

        practice = await get_practice_profile(superbill.get("clinician_id") or user["uid"])
        clinician_row = await get_clinician(superbill.get("clinician_id") or user["uid"])
        clinician = dict(clinician_row) if clinician_row else {}

        claims.append({
            "superbill": superbill,
            "client": client,
            "practice": practice or {},
            "clinician": clinician,
        })

    try:
        edi_content = generate_837p_batch(claims)
    except Exception as e:
        logger.error("Batch 837P generation failed: %s", e)
        raise HTTPException(500, "Failed to generate batch 837P EDI file")

    await log_audit_event(
        user_id=user["uid"],
        action="edi837_batch_downloaded",
        resource_type="superbill",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "superbill_ids": body.superbill_ids,
            "count": len(body.superbill_ids),
        },
    )

    filename = f"837P_batch_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.edi"

    return Response(
        content=edi_content.encode("utf-8"),
        media_type="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.patch("/superbills/{superbill_id}/status")
async def update_superbill_status(
    superbill_id: str,
    body: UpdateStatusRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
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
    now = datetime.now(timezone.utc)
    sets = ["status = $1"]
    vals: list = [body.status]
    idx = 2

    if body.amount_paid is not None:
        sets.append(f"amount_paid = ${idx}::numeric")
        vals.append(body.amount_paid)
        idx += 1

    # Auto-set date_submitted when transitioning to 'submitted'
    if body.status == "submitted":
        sets.append(f"date_submitted = ${idx}")
        vals.append(now)
        idx += 1

    # Auto-set date_paid when transitioning to 'paid'
    if body.status == "paid":
        sets.append(f"date_paid = ${idx}")
        vals.append(now)
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


class BatchStatusRequest(BaseModel):
    superbill_ids: list[str]
    status: str  # 'generated', 'submitted', 'paid', 'outstanding'
    amount_paid: float | None = None


@router.patch("/superbills/batch-status")
async def batch_update_status(
    body: BatchStatusRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Update billing status for multiple superbills at once. Clinician only."""
    valid_statuses = {"generated", "submitted", "paid", "outstanding"}
    if body.status not in valid_statuses:
        raise HTTPException(400, f"Invalid status. Must be one of: {', '.join(valid_statuses)}")

    if not body.superbill_ids:
        raise HTTPException(400, "No superbill IDs provided")

    if len(body.superbill_ids) > 100:
        raise HTTPException(400, "Maximum 100 superbills per batch")

    pool = await get_pool()
    now = datetime.now(timezone.utc)
    updated_count = 0

    for sb_id in body.superbill_ids:
        existing = await pool.fetchrow(
            "SELECT id, status FROM superbills WHERE id = $1::uuid", sb_id
        )
        if not existing:
            continue

        sets = ["status = $1"]
        vals: list = [body.status]
        idx = 2

        if body.amount_paid is not None:
            sets.append(f"amount_paid = ${idx}::numeric")
            vals.append(body.amount_paid)
            idx += 1

        if body.status == "submitted":
            sets.append(f"date_submitted = ${idx}")
            vals.append(now)
            idx += 1

        if body.status == "paid":
            sets.append(f"date_paid = ${idx}")
            vals.append(now)
            idx += 1

        vals.append(sb_id)
        query = f"UPDATE superbills SET {', '.join(sets)} WHERE id = ${idx}::uuid"
        await pool.execute(query, *vals)
        updated_count += 1

        await log_audit_event(
            user_id=user["uid"],
            action="superbill_status_updated",
            resource_type="superbill",
            resource_id=sb_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            metadata={
                "old_status": existing["status"],
                "new_status": body.status,
                "batch": True,
            },
        )

    return {"status": "updated", "updated_count": updated_count}


@router.get("/icd10/search")
async def search_icd10(
    q: str = Query("", min_length=0),
    scope: str = Query("mental_health"),
    user: dict = Depends(require_practice_member()),
):
    """Search ICD-10 codes by code or description. Clinician only.

    Args:
        q: Search query (searches both code and description).
        scope: 'mental_health' (default) or 'all' — currently both use the same dataset.

    Returns top 20 matches.
    """
    codes = _load_icd10_codes()

    if not q or len(q) < 2:
        return {"results": [], "count": 0}

    query_lower = q.lower()
    matches = []
    for entry in codes:
        if query_lower in entry["code"].lower() or query_lower in entry["description"].lower():
            matches.append(entry)
            if len(matches) >= 20:
                break

    return {"results": matches, "count": len(matches), "query": q, "scope": scope}


@router.patch("/superbills/{superbill_id}")
async def update_superbill(
    superbill_id: str,
    body: UpdateSuperbillRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Update superbill claim fields before submission. Clinician only.

    Only allowed when status = 'generated'. After update, the superbill PDF
    is regenerated to reflect changes.
    """
    pool = await get_pool()

    # Fetch existing superbill
    existing = await pool.fetchrow(
        "SELECT * FROM superbills WHERE id = $1::uuid", superbill_id
    )
    if not existing:
        raise HTTPException(404, "Superbill not found")

    if existing["status"] != "generated":
        raise HTTPException(
            400,
            f"Cannot edit superbill with status '{existing['status']}'. Only 'generated' superbills can be edited.",
        )

    # Build dynamic UPDATE
    sets: list[str] = []
    vals: list = []
    idx = 1
    changes: dict = {}

    field_map = {
        "cpt_code": ("cpt_code", "text"),
        "cpt_description": ("cpt_description", "text"),
        "fee": ("fee", "numeric"),
        "place_of_service": ("place_of_service", "text"),
        "payer_id": ("payer_id", "text"),
        "auth_number": ("auth_number", "text"),
        "secondary_payer_name": ("secondary_payer_name", "text"),
        "secondary_payer_id": ("secondary_payer_id", "text"),
        "secondary_member_id": ("secondary_member_id", "text"),
    }

    for field_name, (col_name, col_type) in field_map.items():
        val = getattr(body, field_name)
        if val is not None:
            type_cast = f"::{col_type}" if col_type != "text" else ""
            sets.append(f"{col_name} = ${idx}{type_cast}")
            vals.append(val)
            changes[field_name] = val
            idx += 1

    if body.diagnosis_codes is not None:
        sets.append(f"diagnosis_codes = ${idx}::jsonb")
        vals.append(json.dumps(body.diagnosis_codes))
        changes["diagnosis_codes"] = body.diagnosis_codes
        idx += 1

    if body.modifiers is not None:
        sets.append(f"modifiers = ${idx}::jsonb")
        vals.append(json.dumps(body.modifiers))
        changes["modifiers"] = body.modifiers
        idx += 1

    if not sets:
        raise HTTPException(400, "No fields to update")

    vals.append(superbill_id)
    query = f"UPDATE superbills SET {', '.join(sets)} WHERE id = ${idx}::uuid RETURNING *"
    updated = await pool.fetchrow(query, *vals)

    # Regenerate the superbill PDF
    try:
        superbill_data = dict(updated)
        dx = superbill_data.get("diagnosis_codes")
        if isinstance(dx, str):
            superbill_data["diagnosis_codes"] = json.loads(dx)

        client = await get_client(superbill_data["client_id"])
        client_dict = dict(client) if client else {}

        client_name = client_dict.get("full_name") or client_dict.get("email") or "Unknown Client"
        client_dob = client_dict.get("date_of_birth")
        client_address = _format_client_address(client_dict) if client_dict else None
        client_phone = client_dict.get("phone")
        client_email = client_dict.get("email")
        insurance_payer = client_dict.get("payer_name")
        insurance_member_id = client_dict.get("member_id")
        insurance_group = client_dict.get("group_number")

        dos = superbill_data.get("date_of_service")
        dos_formatted = dos.strftime("%B %d, %Y") if hasattr(dos, "strftime") else str(dos)

        practice = await get_practice_profile(superbill_data["clinician_id"])
        signature_data = await get_stored_signature(superbill_data["clinician_id"])

        cpt_code = superbill_data.get("cpt_code", "90834")
        cpt_description = superbill_data.get("cpt_description") or CPT_DESCRIPTIONS.get(cpt_code, "Psychotherapy")
        fee = float(superbill_data["fee"]) if superbill_data.get("fee") is not None else None
        diagnosis_codes = superbill_data.get("diagnosis_codes") or []

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
            amount_paid=float(superbill_data.get("amount_paid") or 0),
            status=superbill_data["status"],
            practice=practice,
            rendering_clinician=None,
            signature_data=signature_data,
        )

        await pool.execute(
            "UPDATE superbills SET pdf_data = $1 WHERE id = $2::uuid",
            pdf_bytes,
            superbill_id,
        )
    except Exception as e:
        logger.error("Failed to regenerate superbill PDF after edit: %s", e)
        # Non-fatal — the data update still succeeded

    await log_audit_event(
        user_id=user["uid"],
        action="superbill_updated",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"changes": changes},
    )

    # Re-fetch to include updated pdf_data status
    final = await pool.fetchrow(
        """
        SELECT s.*, c.full_name AS client_name, c.id AS client_uuid
        FROM superbills s
        LEFT JOIN clients c ON c.firebase_uid = s.client_id
        WHERE s.id = $1::uuid
        """,
        superbill_id,
    )
    result = _superbill_to_dict(final)
    result["client_name"] = final["client_name"]
    result["client_uuid"] = str(final["client_uuid"]) if final["client_uuid"] else None

    return result


@router.post("/superbills/{superbill_id}/email")
async def email_superbill(
    superbill_id: str,
    body: EmailSuperbillRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
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
        await send_email_with_attachment(
            to=recipient,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            attachment_data=bytes(row["pdf_data"]),
            attachment_filename=f"superbill_{dos.strftime('%Y%m%d') if hasattr(dos, 'strftime') else dos}_{row['cpt_code']}.pdf",
            attachment_mime_type="application/pdf",
            clinician_uid=user["uid"],
        )
    except ImportError:
        # Fallback: send email without attachment (link to download)
        try:
            from mailer import send_email
            await send_email(
                to=recipient,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                clinician_uid=user["uid"],
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


# ---------------------------------------------------------------------------
# Patient Statement endpoints
# ---------------------------------------------------------------------------


async def _build_statement_pdf(
    client_id: str,
    user_uid: str,
    from_date: date | None,
    to_date: date | None,
) -> tuple[bytes, dict, list[dict]]:
    """Shared helper: fetch client + superbills and generate statement PDF.

    Returns (pdf_bytes, client_dict, superbills_list).
    """
    pool = await get_pool()

    # Fetch client
    client = await pool.fetchrow(
        """
        SELECT c.*, c.id::text AS uuid_id
        FROM clients c
        WHERE c.firebase_uid = $1
        """,
        client_id,
    )
    if not client:
        raise HTTPException(404, "Client not found")
    client = dict(client)

    # Fetch superbills for date range
    query = """
        SELECT s.id, s.date_of_service, s.cpt_code, s.cpt_description,
               s.fee, s.amount_paid, s.status
        FROM superbills s
        WHERE s.client_id = $1
    """
    params: list = [client_id]
    idx = 2

    if from_date:
        query += f" AND s.date_of_service >= ${idx}"
        params.append(from_date)
        idx += 1
    if to_date:
        query += f" AND s.date_of_service <= ${idx}"
        params.append(to_date)
        idx += 1

    query += " ORDER BY s.date_of_service ASC"
    rows = await pool.fetch(query, *params)
    superbills = [dict(r) for r in rows]

    # Get practice profile
    practice = await get_practice_profile(user_uid)

    # Generate PDF
    pdf_bytes = generate_patient_statement(
        client=client,
        superbills=superbills,
        practice=practice,
        from_date=from_date,
        to_date=to_date,
    )

    return pdf_bytes, client, superbills


@router.post("/clients/{client_id}/statement")
async def generate_statement(
    client_id: str,
    request: Request,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    user: dict = Depends(require_practice_member("owner")),
):
    """Generate a patient statement PDF for a client's date range.

    Returns the PDF as a downloadable attachment. Clinician only.
    """
    effective_to = to_date or date.today()

    pdf_bytes, client, superbills = await _build_statement_pdf(
        client_id=client_id,
        user_uid=user["uid"],
        from_date=from_date,
        to_date=effective_to,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="statement_generated",
        resource_type="statement",
        resource_id=client_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "client_id": client_id,
            "from_date": str(from_date) if from_date else None,
            "to_date": str(effective_to),
            "superbill_count": len(superbills),
        },
    )

    logger.info(
        "Statement generated for client %s (%d superbills)",
        client_id[:8],
        len(superbills),
    )

    client_name = (client.get("full_name") or "client").replace(" ", "_")
    filename = f"statement_{client_name}_{effective_to.strftime('%Y%m%d')}.pdf"

    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/clients/{client_id}/statement/email")
async def email_statement(
    client_id: str,
    body: EmailStatementRequest,
    request: Request,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    user: dict = Depends(require_practice_member("owner")),
):
    """Generate and email a patient statement PDF to the client. Clinician only."""
    effective_to = to_date or date.today()

    pdf_bytes, client, superbills = await _build_statement_pdf(
        client_id=client_id,
        user_uid=user["uid"],
        from_date=from_date,
        to_date=effective_to,
    )

    recipient = body.recipient_email or client.get("email")
    if not recipient:
        raise HTTPException(400, "No email address available for this client")

    # Get practice info for email branding
    practice = await get_practice_profile(user["uid"])
    practice_name = "Your Therapist"
    if practice:
        practice_name = (
            practice.get("practice_name")
            or practice.get("clinician_name")
            or "Your Therapist"
        )

    client_name = client.get("full_name") or "there"

    # Compute totals for email summary
    total_charges = sum(float(sb.get("fee") or 0) for sb in superbills)
    total_payments = sum(float(sb.get("amount_paid") or 0) for sb in superbills)
    balance_due = total_charges - total_payments

    period_str = ""
    if from_date:
        period_str = f"{from_date.strftime('%B %d, %Y')} - "
    else:
        period_str = "Through "
    period_str += effective_to.strftime("%B %d, %Y")

    subject = f"Patient Statement from {practice_name} - {period_str}"

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #1a1a1a; margin: 0;">{practice_name}</h2>
            <p style="color: #666; margin: 4px 0 0;">Patient Statement</p>
        </div>

        <div style="background: #f8f8f8; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <p style="color: #333; margin: 0 0 12px;">Hello {client_name},</p>
            <p style="color: #555; margin: 0 0 12px;">
                Please find your patient statement attached for the period: <strong>{period_str}</strong>.
            </p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr>
                    <td style="padding: 4px 0; color: #666;">Services:</td>
                    <td style="padding: 4px 0; color: #333; text-align: right;">{len(superbills)} session(s)</td>
                </tr>
                <tr>
                    <td style="padding: 4px 0; color: #666;">Total Charges:</td>
                    <td style="padding: 4px 0; color: #333; text-align: right;">${total_charges:,.2f}</td>
                </tr>
                <tr>
                    <td style="padding: 4px 0; color: #666;">Total Payments:</td>
                    <td style="padding: 4px 0; color: #333; text-align: right;">${total_payments:,.2f}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0 4px; color: #333; font-weight: 600; border-top: 1px solid #ddd;">Balance Due:</td>
                    <td style="padding: 8px 0 4px; color: #333; text-align: right; font-weight: 700; font-size: 16px; border-top: 1px solid #ddd;">${balance_due:,.2f}</td>
                </tr>
            </table>
            <p style="color: #555; margin: 12px 0 0; font-size: 14px;">
                Please see the attached PDF for a detailed breakdown of services.
                Contact our office if you have any questions.
            </p>
        </div>

        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 24px;">
            This email was sent by {practice_name} via Trellis.
        </p>
    </div>
    """

    text_body = (
        f"Patient Statement from {practice_name}\n\n"
        f"Hello {client_name},\n\n"
        f"Please find your patient statement for the period: {period_str}.\n\n"
        f"Services: {len(superbills)} session(s)\n"
        f"Total Charges: ${total_charges:,.2f}\n"
        f"Total Payments: ${total_payments:,.2f}\n"
        f"Balance Due: ${balance_due:,.2f}\n\n"
        f"Please see the attached PDF for a detailed breakdown.\n"
        f"Contact our office if you have any questions.\n"
    )

    # Send email with PDF attachment
    filename = f"statement_{effective_to.strftime('%Y%m%d')}.pdf"
    try:
        from mailer import send_email_with_attachment
        await send_email_with_attachment(
            to=recipient,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            attachment_data=bytes(pdf_bytes),
            attachment_filename=filename,
            attachment_mime_type="application/pdf",
            clinician_uid=user["uid"],
        )
    except ImportError:
        try:
            from mailer import send_email
            await send_email(
                to=recipient,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                clinician_uid=user["uid"],
            )
        except Exception as e:
            logger.error("Failed to send statement email: %s", e)
            raise HTTPException(502, f"Failed to send email: {type(e).__name__}")

    await log_audit_event(
        user_id=user["uid"],
        action="statement_emailed",
        resource_type="statement",
        resource_id=client_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "recipient": recipient,
            "client_id": client_id,
            "from_date": str(from_date) if from_date else None,
            "to_date": str(effective_to),
            "superbill_count": len(superbills),
            "balance_due": balance_due,
        },
    )

    logger.info("Statement emailed for client %s", client_id[:8])

    return {
        "status": "sent",
        "recipient": recipient,
        "client_id": client_id,
        "superbill_count": len(superbills),
        "balance_due": balance_due,
    }


# ---------------------------------------------------------------------------
# Billing Service Integration Endpoints
# ---------------------------------------------------------------------------


class BillingSettingsUpdateRequest(BaseModel):
    billing_api_key: Optional[str] = None
    billing_service_url: Optional[str] = None
    billing_auto_submit: Optional[bool] = None


@router.get("/billing/settings")
async def get_billing_settings(
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Get billing service settings for the current practice."""
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(400, "No practice associated with user")

    settings = await get_practice_billing_settings(practice_id)
    if not settings:
        return {
            "connected": False,
            "billing_service_url": "https://billing.trellis.health",
            "billing_auto_submit": False,
            "billing_last_poll_at": None,
        }

    result = {
        "connected": bool(settings.get("billing_api_key")),
        "billing_service_url": settings.get("billing_service_url", "https://billing.trellis.health"),
        "billing_auto_submit": settings.get("billing_auto_submit", False),
        "billing_last_poll_at": settings.get("billing_last_poll_at"),
        # Don't expose full API key — show masked version
        "api_key_preview": (settings["billing_api_key"][:8] + "...") if settings.get("billing_api_key") else None,
        "permissions": None,
    }

    # Fetch permissions from billing service if connected
    if result["connected"]:
        api_key = settings["billing_api_key"]
        service_url = result["billing_service_url"]
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{service_url.rstrip('/')}/billing/accounts/me",
                    headers={"X-API-Key": api_key},
                )
                if resp.status_code == 200:
                    account_data = resp.json()
                    result["permissions"] = account_data.get("permissions")
        except Exception:
            pass  # permissions unavailable — not a blocker

    return result


@router.put("/billing/settings")
async def update_billing_settings_endpoint(
    body: BillingSettingsUpdateRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Update billing service settings (connect/disconnect/configure)."""
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(400, "No practice associated with user")

    # Only owners can change billing settings
    if not is_owner(user):
        raise HTTPException(403, "Only practice owners can modify billing settings")

    fields = {}
    if body.billing_api_key is not None:
        fields["billing_api_key"] = body.billing_api_key or None  # empty string -> None (disconnect)
    if body.billing_service_url is not None:
        fields["billing_service_url"] = body.billing_service_url
    if body.billing_auto_submit is not None:
        fields["billing_auto_submit"] = body.billing_auto_submit

    updated = await update_practice_billing_settings(practice_id, **fields)

    await log_audit_event(
        user_id=user["uid"],
        action="billing_settings_updated",
        resource_type="practice",
        resource_id=practice_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "fields_updated": list(fields.keys()),
            "connected": bool(updated and updated.get("billing_api_key")),
        },
    )

    return {
        "connected": bool(updated and updated.get("billing_api_key")),
        "billing_service_url": updated.get("billing_service_url") if updated else None,
        "billing_auto_submit": updated.get("billing_auto_submit", False) if updated else False,
        "billing_last_poll_at": updated.get("billing_last_poll_at") if updated else None,
    }


@router.post("/superbills/{superbill_id}/submit")
async def submit_claim_to_billing(
    superbill_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Manually submit a superbill to the billing service as a claim.

    Only works for superbills in 'generated' status.
    """
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(400, "No practice associated with user")

    # Verify billing is connected
    connected = await billing_client.is_connected(practice_id)
    if not connected:
        raise HTTPException(400, "Billing service is not connected for this practice")

    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM superbills WHERE id = $1::uuid", superbill_id
    )
    if not row:
        raise HTTPException(404, "Superbill not found")

    superbill = _superbill_to_dict(row)
    if superbill["status"] != "generated":
        raise HTTPException(
            400,
            f"Superbill is in '{superbill['status']}' status. Only 'generated' superbills can be submitted.",
        )

    # Build claim data
    claim_data = await _build_claim_data_from_superbill(superbill, practice_id)
    if not claim_data:
        raise HTTPException(400, "Could not build claim data. Check that client and provider info is complete.")

    settings = await get_practice_billing_settings(practice_id)
    resp = await billing_client.submit_claim(
        settings["billing_api_key"],
        settings["billing_service_url"],
        claim_data,
    )

    if isinstance(resp, BillingServiceError):
        raise HTTPException(502, f"Billing service error: {resp.message}")

    # Update superbill status
    await pool.execute(
        """
        UPDATE superbills
        SET status = 'submitted', date_submitted = now()
        WHERE id = $1::uuid
        """,
        superbill_id,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="claim_submitted",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "billing_claim_id": resp.get("claim_id"),
            "billing_status": resp.get("status"),
        },
    )

    logger.info(
        "Claim submitted for superbill %s (billing_claim_id=%s)",
        superbill_id[:8], resp.get("claim_id"),
    )

    return {
        "status": "submitted",
        "superbill_id": superbill_id,
        "billing_claim_id": resp.get("claim_id"),
        "billing_status": resp.get("status"),
        "warnings": resp.get("warnings", []),
    }


class CreatePaymentLinkRequest(BaseModel):
    patient_email: Optional[str] = None  # Override client email for the payment link


@router.post("/superbills/{superbill_id}/payment-link")
async def create_payment_link(
    superbill_id: str,
    body: CreatePaymentLinkRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Generate a Stripe payment link for the patient balance on a superbill.

    Calls the billing service POST /payments/create-link endpoint.
    Only works when the billing service is connected and the superbill has
    patient responsibility > 0 (fee minus amount_paid).
    """
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(400, "No practice associated with user")

    connected = await billing_client.is_connected(practice_id)
    if not connected:
        raise HTTPException(400, "Billing service is not connected for this practice")

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

    fee = float(row["fee"]) if row["fee"] is not None else 0
    amount_paid = float(row["amount_paid"]) if row["amount_paid"] is not None else 0
    patient_responsibility = fee - amount_paid

    if patient_responsibility <= 0:
        raise HTTPException(400, "No patient balance remaining on this superbill")

    patient_email = body.patient_email or row["client_email"]
    if not patient_email:
        raise HTTPException(400, "No email address available for this patient")

    settings = await billing_client.get_settings(practice_id)
    if not settings:
        raise HTTPException(400, "Billing settings not found")

    payment_data = {
        "external_superbill_id": superbill_id,
        "amount": patient_responsibility,
        "patient_name": row["client_name"] or "Patient",
        "patient_email": patient_email,
        "description": f"Payment for service on {row['date_of_service'].isoformat() if row['date_of_service'] else 'N/A'} - {row['cpt_description'] or row['cpt_code']}",
    }

    resp = await billing_client.create_payment_link(
        settings["billing_api_key"],
        settings["billing_service_url"],
        payment_data,
    )

    if isinstance(resp, BillingServiceError):
        raise HTTPException(502, f"Billing service error: {resp.message}")

    await log_audit_event(
        user_id=user["uid"],
        action="payment_link_created",
        resource_type="superbill",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "amount": patient_responsibility,
            "patient_email": patient_email,
        },
    )

    logger.info(
        "Payment link created for superbill %s (amount=%.2f)",
        superbill_id[:8], patient_responsibility,
    )

    return {
        "payment_link_url": resp.get("url"),
        "amount": patient_responsibility,
        "expires_at": resp.get("expires_at"),
        "superbill_id": superbill_id,
    }


@router.get("/superbills/{superbill_id}/payments")
async def get_superbill_payments(
    superbill_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Get payment status for a superbill from the billing service.

    Returns payment status, amount paid by patient, payment date, and link status.
    Falls back to local superbill data if billing service is unavailable.
    """
    practice_id = user.get("practice_id")

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

    fee = float(row["fee"]) if row["fee"] is not None else 0
    amount_paid = float(row["amount_paid"]) if row["amount_paid"] is not None else 0
    patient_responsibility = fee - amount_paid

    result = {
        "superbill_id": superbill_id,
        "patient_responsibility": patient_responsibility,
        "amount_paid_by_patient": 0,
        "payment_status": "no_link",
        "payment_date": None,
        "link_url": None,
        "link_status": None,
    }

    if practice_id:
        try:
            connected = await billing_client.is_connected(practice_id)
            if connected:
                settings = await billing_client.get_settings(practice_id)
                if settings:
                    resp = await billing_client.get_payment_status(
                        settings["billing_api_key"],
                        settings["billing_service_url"],
                        superbill_id,
                    )
                    if not isinstance(resp, BillingServiceError):
                        result["payment_status"] = resp.get("status", "no_link")
                        result["amount_paid_by_patient"] = resp.get("amount_paid", 0)
                        result["payment_date"] = resp.get("payment_date")
                        result["link_url"] = resp.get("link_url")
                        result["link_status"] = resp.get("link_status")
        except Exception as e:
            logger.warning("Failed to get payment status from billing service: %s", e)

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="superbill_payments",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return result


@router.get("/billing/outstanding-balances")
async def get_outstanding_balances(
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Get all clients with outstanding patient balances.

    Returns a list of clients with their total balance, oldest unpaid date,
    and last payment information for the Outstanding Balances report.
    """
    pool = await get_pool()

    owner_filter = ""
    params: list = []
    if not is_owner(user):
        owner_filter = " AND s.clinician_id = $1"
        params = [user["uid"]]

    rows = await pool.fetch(
        f"""
        SELECT
            c.id AS client_uuid,
            c.firebase_uid AS client_id,
            c.full_name AS client_name,
            c.email AS client_email,
            COALESCE(SUM(s.fee), 0) AS total_billed,
            COALESCE(SUM(s.amount_paid), 0) AS total_paid,
            COALESCE(SUM(s.fee), 0) - COALESCE(SUM(s.amount_paid), 0) AS outstanding_balance,
            MIN(CASE WHEN (s.fee - s.amount_paid) > 0 THEN s.date_of_service END) AS oldest_unpaid_date,
            MAX(s.date_paid) AS last_payment_date,
            COUNT(s.id) AS total_superbills,
            COUNT(CASE WHEN (s.fee - s.amount_paid) > 0 THEN 1 END) AS unpaid_superbills
        FROM clients c
        INNER JOIN superbills s ON s.client_id = c.firebase_uid
        WHERE s.fee IS NOT NULL
        {owner_filter}
        GROUP BY c.id, c.firebase_uid, c.full_name, c.email
        HAVING COALESCE(SUM(s.fee), 0) - COALESCE(SUM(s.amount_paid), 0) > 0
        ORDER BY outstanding_balance DESC
        """,
        *params,
    )

    clients = []
    total_outstanding = 0.0
    for r in rows:
        balance = float(r["outstanding_balance"])
        total_outstanding += balance
        clients.append({
            "client_uuid": str(r["client_uuid"]),
            "client_id": r["client_id"],
            "client_name": r["client_name"] or "Unknown",
            "client_email": r["client_email"],
            "total_billed": float(r["total_billed"]),
            "total_paid": float(r["total_paid"]),
            "outstanding_balance": balance,
            "oldest_unpaid_date": r["oldest_unpaid_date"].isoformat() if r["oldest_unpaid_date"] else None,
            "last_payment_date": r["last_payment_date"].isoformat() if r["last_payment_date"] else None,
            "total_superbills": r["total_superbills"],
            "unpaid_superbills": r["unpaid_superbills"],
        })

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="outstanding_balances",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"client_count": len(clients), "total_outstanding": round(total_outstanding, 2)},
    )

    return {
        "clients": clients,
        "total_outstanding": round(total_outstanding, 2),
        "client_count": len(clients),
    }


@router.get("/superbills/{superbill_id}/era")
async def get_superbill_era(
    superbill_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Fetch ERA / payment posting details for a superbill from the billing service.

    Returns structured data: insurance paid, adjustments with plain-English
    descriptions, patient responsibility breakdown, and service line details.
    Returns 404 if billing service is not connected or no ERA data exists.
    """
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(404, "No practice associated with user")

    connected = await billing_client.is_connected(practice_id)
    if not connected:
        raise HTTPException(404, "Billing service is not connected")

    settings = await get_practice_billing_settings(practice_id)
    resp = await billing_client.get_era_for_superbill(
        settings["billing_api_key"],
        settings["billing_service_url"],
        superbill_id,
    )

    if isinstance(resp, BillingServiceError):
        if resp.status_code == 404:
            raise HTTPException(404, "No ERA data found for this superbill")
        raise HTTPException(502, f"Billing service error: {resp.message}")

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="era",
        resource_id=superbill_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"superbill_id": superbill_id},
    )

    return resp


@router.post("/clients/{client_id}/eligibility")
async def check_client_eligibility(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Check insurance eligibility for a client via the billing service."""
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(400, "No practice associated with user")

    connected = await billing_client.is_connected(practice_id)
    if not connected:
        raise HTTPException(400, "Billing service is not connected for this practice")

    client = await get_client(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    # Check required insurance fields
    if not client.get("member_id") or not client.get("payer_id"):
        raise HTTPException(
            400,
            "Client must have member_id and payer_id set to check eligibility.",
        )

    # Get practice/clinician info for NPI
    practice_profile = await get_practice_profile(user["uid"])
    provider_npi = ""
    provider_org = ""
    if practice_profile:
        provider_npi = practice_profile.get("npi", "")
        provider_org = practice_profile.get("practice_name") or practice_profile.get("clinician_name", "")

    # Build patient info for billing service
    sex = (client.get("sex") or "").upper()
    patient_gender = sex if sex in ("M", "F") else "M"  # Default M for eligibility

    patient_info = {
        "patient_first_name": (client.get("full_name") or "").split()[0] if client.get("full_name") else "",
        "patient_last_name": (client.get("full_name") or "").split()[-1] if client.get("full_name") else "",
        "patient_dob": client.get("date_of_birth", ""),
        "patient_gender": patient_gender,
        "member_id": client.get("member_id", ""),
        "payer_id": client.get("payer_id", ""),
        "payer_name": client.get("payer_name", ""),
        "provider_npi": provider_npi,
        "provider_organization_name": provider_org,
        "service_type_codes": ["30", "MH"],
    }

    settings = await get_practice_billing_settings(practice_id)
    resp = await billing_client.check_eligibility(
        settings["billing_api_key"],
        settings["billing_service_url"],
        patient_info,
    )

    if isinstance(resp, BillingServiceError):
        raise HTTPException(502, f"Billing service error: {resp.message}")

    await log_audit_event(
        user_id=user["uid"],
        action="eligibility_checked",
        resource_type="client",
        resource_id=client_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "payer_id": client.get("payer_id"),
            "payer_name": client.get("payer_name"),
            "active": resp.get("active"),
        },
    )

    return resp


# ---------------------------------------------------------------------------
# Denial Management Proxy Routes
# ---------------------------------------------------------------------------

class ResubmitDenialRequest(BaseModel):
    corrections: dict


@router.get("/billing/denials/analytics")
async def get_denial_analytics(
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Proxy to billing service denial analytics.

    Returns denial rate, breakdowns by category and payer, top reason codes,
    and monthly trend data.
    """
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(400, "No practice associated with user")

    connected = await billing_client.is_connected(practice_id)
    if not connected:
        raise HTTPException(400, "Billing service is not connected for this practice")

    settings = await get_practice_billing_settings(practice_id)
    resp = await billing_client.get_denial_analytics(
        settings["billing_api_key"],
        settings["billing_service_url"],
    )

    if isinstance(resp, BillingServiceError):
        raise HTTPException(502, f"Billing service error: {resp.message}")

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="denial_analytics",
        resource_id="all",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return resp


@router.get("/billing/denials/{claim_id}")
async def get_denial_detail(
    claim_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Proxy to billing service denial detail for a specific claim.

    Returns denial codes with descriptions, category, suggestions,
    resubmission eligibility, and related claim history.
    """
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(400, "No practice associated with user")

    connected = await billing_client.is_connected(practice_id)
    if not connected:
        raise HTTPException(400, "Billing service is not connected for this practice")

    settings = await get_practice_billing_settings(practice_id)
    resp = await billing_client.get_denial_detail(
        settings["billing_api_key"],
        settings["billing_service_url"],
        claim_id,
    )

    if isinstance(resp, BillingServiceError):
        if resp.status_code == 404:
            raise HTTPException(404, "Denied claim not found")
        raise HTTPException(502, f"Billing service error: {resp.message}")

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="denial",
        resource_id=claim_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return resp


@router.get("/billing/denials")
async def list_denials(
    request: Request,
    category: Optional[str] = Query(None, description="Filter by denial category"),
    payer: Optional[str] = Query(None, description="Filter by payer name"),
    user: dict = Depends(require_practice_member("owner")),
):
    """Proxy to billing service denied claims list.

    Returns denied claims enriched with categories, suggestions,
    and days since denial. Filterable by category and payer.
    """
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(400, "No practice associated with user")

    connected = await billing_client.is_connected(practice_id)
    if not connected:
        raise HTTPException(400, "Billing service is not connected for this practice")

    settings = await get_practice_billing_settings(practice_id)
    resp = await billing_client.get_denials(
        settings["billing_api_key"],
        settings["billing_service_url"],
        category=category,
        payer_name=payer,
    )

    if isinstance(resp, BillingServiceError):
        raise HTTPException(502, f"Billing service error: {resp.message}")

    await log_audit_event(
        user_id=user["uid"],
        action="listed",
        resource_type="denials",
        resource_id="all",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"category_filter": category, "payer_filter": payer},
    )

    return resp


@router.post("/billing/denials/{claim_id}/resubmit")
async def resubmit_denied_claim(
    claim_id: str,
    body: ResubmitDenialRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Correct and resubmit a denied claim via the billing service.

    Applies corrections and creates a new claim submission linked to
    the original denied claim.
    """
    practice_id = user.get("practice_id")
    if not practice_id:
        raise HTTPException(400, "No practice associated with user")

    connected = await billing_client.is_connected(practice_id)
    if not connected:
        raise HTTPException(400, "Billing service is not connected for this practice")

    settings = await get_practice_billing_settings(practice_id)
    resp = await billing_client.resubmit_denial(
        settings["billing_api_key"],
        settings["billing_service_url"],
        claim_id,
        body.corrections,
    )

    if isinstance(resp, BillingServiceError):
        if resp.status_code == 404:
            raise HTTPException(404, "Denied claim not found")
        if resp.status_code == 422:
            raise HTTPException(422, resp.message)
        raise HTTPException(502, f"Billing service error: {resp.message}")

    await log_audit_event(
        user_id=user["uid"],
        action="resubmitted",
        resource_type="denial",
        resource_id=claim_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "new_claim_id": resp.get("new_claim_id"),
            "corrections_applied": list(body.corrections.keys()),
        },
    )

    logger.info(
        "Denied claim %s resubmitted as %s by user %s",
        claim_id[:8],
        str(resp.get("new_claim_id", ""))[:8],
        user["uid"][:8],
    )

    return resp


@router.post("/billing/poll-updates")
async def cron_poll_billing_updates(
    request: Request,
    _: None = Depends(_verify_cron_secret),
):
    """Cron endpoint: poll billing service for updates across all connected practices.

    Protected by X-Cron-Secret header.

    For each connected practice:
      1. Polls billing service for events since last_poll_at
      2. Processes each event type (status changes, ERAs, payments)
      3. Updates superbill statuses accordingly
      4. Optionally runs pre-session eligibility checks
    """
    practices = await get_practices_with_billing()
    if not practices:
        return {"message": "No practices with billing service connected", "processed": 0}

    pool = await get_pool()
    total_events = 0
    practice_summaries = []

    for practice in practices:
        practice_id = practice["id"]
        api_key = practice["billing_api_key"]
        service_url = practice["billing_service_url"]
        since = practice["billing_last_poll_at"] or "2020-01-01T00:00:00Z"

        resp = await billing_client.poll_updates(api_key, service_url, since)

        if isinstance(resp, BillingServiceError):
            logger.warning(
                "Poll failed for practice %s: %s",
                practice_id[:8], resp.message,
            )
            practice_summaries.append({
                "practice_id": practice_id,
                "error": resp.message,
                "events_processed": 0,
            })
            continue

        events = resp.get("events", [])
        processed = 0

        for event in events:
            event_type = event.get("event_type", "")
            event_data = event.get("data", {})
            resource_id = event.get("resource_id")

            try:
                if event_type == "claim_status_changed":
                    # Find superbill by external_superbill_id from the claim
                    ext_id = event_data.get("external_superbill_id")
                    new_status = event_data.get("new_status", "")
                    if ext_id and new_status:
                        # Map billing service statuses to EHR superbill statuses
                        status_map = {
                            "submitted": "submitted",
                            "acknowledged": "submitted",
                            "adjudicated": "submitted",
                            "paid": "paid",
                            "denied": "outstanding",
                            "rejected": "outstanding",
                        }
                        ehr_status = status_map.get(new_status)
                        if ehr_status:
                            update_sql = "UPDATE superbills SET status = $1"
                            params = [ehr_status]
                            if ehr_status == "submitted" and not new_status == "submitted":
                                pass  # Already submitted
                            if ehr_status == "paid":
                                update_sql += ", date_paid = now()"
                            update_sql += " WHERE id = $2::uuid"
                            params.append(ext_id)
                            await pool.execute(update_sql, *params)

                elif event_type == "era_received":
                    ext_id = event_data.get("external_superbill_id")
                    payment_amount = event_data.get("payment_amount")
                    if ext_id and payment_amount is not None:
                        await pool.execute(
                            """
                            UPDATE superbills
                            SET amount_paid = amount_paid + $1::numeric
                            WHERE id = $2::uuid
                            """,
                            float(payment_amount),
                            ext_id,
                        )
                        await log_audit_event(
                            user_id="system",
                            action="era_payment_applied",
                            resource_type="superbill",
                            resource_id=ext_id,
                            ip_address="cron",
                            metadata={
                                "payment_amount": payment_amount,
                                "billing_event_id": event.get("id"),
                            },
                        )

                elif event_type == "payment_completed":
                    ext_id = event_data.get("external_superbill_id")
                    amount = event_data.get("amount")
                    if ext_id and amount is not None:
                        await pool.execute(
                            """
                            UPDATE superbills
                            SET amount_paid = amount_paid + $1::numeric
                            WHERE id = $2::uuid
                            """,
                            float(amount),
                            ext_id,
                        )

                processed += 1
            except Exception as e:
                logger.error(
                    "Error processing billing event %s for practice %s: %s",
                    event.get("id"), practice_id[:8], e,
                )

        # Update last poll timestamp
        last_event_at = resp.get("last_event_at")
        new_poll_at = last_event_at or datetime.now(timezone.utc).isoformat()
        await update_practice_billing_settings(
            practice_id, billing_last_poll_at=datetime.fromisoformat(new_poll_at)
        )

        total_events += processed
        practice_summaries.append({
            "practice_id": practice_id,
            "events_processed": processed,
            "total_events": len(events),
        })

    # --- Pre-session eligibility checks (configurable, off by default) ---
    pre_session_checked = 0
    if os.getenv("BILLING_PRE_SESSION_ELIGIBILITY", "").lower() in ("1", "true", "yes"):
        try:
            # Find appointments in the next 48 hours
            cutoff = datetime.now(timezone.utc) + timedelta(hours=48)
            rows = await pool.fetch(
                """
                SELECT a.id, a.client_id, a.start_time,
                       c.payer_id, c.member_id, c.full_name, c.date_of_birth, c.sex, c.payer_name,
                       cl.practice_id
                FROM appointments a
                JOIN clients c ON c.firebase_uid = a.client_id
                JOIN clinicians cl ON cl.firebase_uid = a.clinician_id
                WHERE a.start_time BETWEEN now() AND $1
                  AND a.status = 'scheduled'
                  AND c.payer_id IS NOT NULL
                  AND c.member_id IS NOT NULL
                  AND cl.practice_id IS NOT NULL
                """,
                cutoff,
            )

            for appt_row in rows:
                appt_practice_id = str(appt_row["practice_id"])
                # Check if practice has billing service
                practice_match = next(
                    (p for p in practices if p["id"] == appt_practice_id), None
                )
                if not practice_match:
                    continue

                sex = (appt_row["sex"] or "").upper()
                patient_info = {
                    "patient_first_name": (appt_row["full_name"] or "").split()[0] if appt_row["full_name"] else "",
                    "patient_last_name": (appt_row["full_name"] or "").split()[-1] if appt_row["full_name"] else "",
                    "patient_dob": appt_row["date_of_birth"].isoformat() if appt_row["date_of_birth"] else "",
                    "patient_gender": sex if sex in ("M", "F") else "M",
                    "member_id": appt_row["member_id"],
                    "payer_id": appt_row["payer_id"],
                    "payer_name": appt_row["payer_name"] or "",
                    "provider_npi": "",  # Will be filled by billing service
                    "service_type_codes": ["30", "MH"],
                }

                resp = await billing_client.check_eligibility(
                    practice_match["billing_api_key"],
                    practice_match["billing_service_url"],
                    patient_info,
                )

                if not isinstance(resp, BillingServiceError):
                    pre_session_checked += 1
                    logger.info(
                        "Pre-session eligibility check for appointment %s: active=%s",
                        str(appt_row["id"])[:8], resp.get("active"),
                    )

        except Exception as e:
            logger.error("Pre-session eligibility check error: %s", e)

    return {
        "message": "Polling complete",
        "practices_polled": len(practices),
        "total_events_processed": total_events,
        "pre_session_eligibility_checks": pre_session_checked,
        "details": practice_summaries,
    }
