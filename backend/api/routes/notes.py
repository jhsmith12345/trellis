"""Clinical note generation, signing, and management endpoints.

Component 8: AI Note Generation — generates clinical notes from session
transcripts using Gemini 2.5 Flash. Supports biopsychosocial assessments
(90791), SOAP progress notes (90834/90837), and DAP progress notes.

Component 9: Note Signing + Locking — sign notes with stored signature,
generate PDF, lock signed notes, amendment workflow, audit logging.

HIPAA Access Control:
  - All endpoints require clinician role (require_role("clinician"))
  - Signed notes are immutable — content_hash (SHA-256) locks content
  - Amendments create new records; originals are never modified
  - All reads and writes logged to audit_events

Endpoints:
  - POST /api/notes/generate             — generate a note from an encounter
  - GET  /api/notes/{note_id}            — get a single note with encounter data
  - PUT  /api/notes/{note_id}            — update note content (draft only)
  - GET  /api/notes/unsigned              — list unsigned notes
  - POST /api/notes/{note_id}/sign        — sign and lock a note
  - GET  /api/notes/{note_id}/pdf         — download signed note PDF
  - POST /api/notes/{note_id}/amend       — create an amendment of a signed note
  - GET  /api/notes/{note_id}/amendments  — list amendments for a note
  - GET  /api/notes/{note_id}/signature   — get stored signature for signing
"""
import hashlib
import json
import logging
import sys
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from auth import require_role, require_practice_member, is_owner, enforce_clinician_owns_client

sys.path.insert(0, "../shared")
from db import (
    get_pool,
    get_appointment,
    get_active_treatment_plan,
    get_client,
    get_client_by_id,
    get_unsigned_notes,
    get_stored_signature,
    upsert_stored_signature,
    get_practice_profile,
    log_audit_event,
    create_encounter,
)
from note_generator import generate_note, regenerate_note, generate_note_from_dictation
from note_pdf import generate_note_pdf
from treatment_plan_generator import generate_treatment_plan as ai_generate_plan
from db import create_treatment_plan, supersede_treatment_plan
from superbill_pdf import CPT_DESCRIPTIONS

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class GenerateNoteRequest(BaseModel):
    encounter_id: str
    note_format: str | None = None  # 'SOAP', 'DAP', or None (auto)
    feedback: str | None = None  # For regeneration with clinician feedback


class UpdateNoteRequest(BaseModel):
    content: dict | None = None
    status: str | None = None  # 'draft', 'review'


class SignNoteRequest(BaseModel):
    signature_data: str  # base64 PNG data URL of the signature


class AmendNoteRequest(BaseModel):
    content: dict  # Initial content for the amendment (copied from original)
    reason: str | None = None  # Optional reason for amendment


class CreateManualNoteRequest(BaseModel):
    client_id: str
    format: str = "SOAP"  # 'SOAP', 'DAP', or 'narrative'
    appointment_id: str | None = None


class GenerateFromDictationRequest(BaseModel):
    client_id: str
    dictation: str  # Freeform text from voice dictation or typed input
    format: str = "SOAP"  # 'SOAP', 'DAP', or 'narrative'
    session_date: str | None = None  # ISO date string
    duration_minutes: int | None = None
    appointment_id: str | None = None


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _compute_content_hash(content: dict) -> str:
    """Compute SHA-256 hash of note content for integrity verification."""
    canonical = json.dumps(content, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _get_encounter(encounter_id: str) -> dict | None:
    """Fetch a full encounter record by ID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        """
        SELECT id, client_id, clinician_id, type, source, transcript,
               data, duration_sec, status, created_at, updated_at
        FROM encounters
        WHERE id = $1::uuid
        """,
        encounter_id,
    )
    if not r:
        return None
    return {
        "id": str(r["id"]),
        "client_id": r["client_id"],
        "clinician_id": r["clinician_id"],
        "type": r["type"],
        "source": r["source"],
        "transcript": r["transcript"],
        "data": r["data"],
        "duration_sec": r["duration_sec"],
        "status": r["status"],
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }


async def _get_note(note_id: str) -> dict | None:
    """Fetch a clinical note by ID with encounter and signing details."""
    pool = await get_pool()
    r = await pool.fetchrow(
        """
        SELECT cn.id, cn.encounter_id, cn.format, cn.content, cn.flags,
               cn.signed_by, cn.signed_at, cn.status, cn.content_hash,
               cn.amendment_of, cn.signature_data,
               cn.created_at, cn.updated_at,
               e.client_id, e.type AS encounter_type, e.source AS encounter_source,
               e.transcript, e.data AS encounter_data, e.duration_sec,
               e.created_at AS encounter_created_at
        FROM clinical_notes cn
        JOIN encounters e ON e.id = cn.encounter_id
        WHERE cn.id = $1::uuid
        """,
        note_id,
    )
    if not r:
        return None
    return {
        "id": str(r["id"]),
        "encounter_id": str(r["encounter_id"]),
        "format": r["format"],
        "content": r["content"],
        "flags": r["flags"],
        "signed_by": r["signed_by"],
        "signed_at": r["signed_at"].isoformat() if r["signed_at"] else None,
        "status": r["status"],
        "content_hash": r["content_hash"],
        "amendment_of": str(r["amendment_of"]) if r["amendment_of"] else None,
        "signature_data": r["signature_data"],
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
        "client_id": r["client_id"],
        "encounter_type": r["encounter_type"],
        "encounter_source": r["encounter_source"],
        "transcript": r["transcript"],
        "encounter_data": r["encounter_data"],
        "duration_sec": r["duration_sec"],
        "encounter_created_at": r["encounter_created_at"].isoformat(),
    }


async def _create_clinical_note(
    encounter_id: str,
    note_format: str,
    content: dict,
    amendment_of: str | None = None,
    clinician_id: str | None = None,
) -> str:
    """Insert a clinical note and return its UUID."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO clinical_notes (encounter_id, format, content, status, amendment_of, clinician_id)
        VALUES ($1::uuid, $2, $3::jsonb, 'draft', $4::uuid, $5)
        RETURNING id
        """,
        encounter_id,
        note_format,
        json.dumps(content),
        amendment_of,
        clinician_id,
    )
    return str(row["id"])


async def _update_clinical_note(
    note_id: str,
    content: dict | None = None,
    status: str | None = None,
) -> None:
    """Update a clinical note's content and/or status."""
    pool = await get_pool()
    sets = []
    vals = []
    idx = 1

    if content is not None:
        sets.append(f"content = ${idx}::jsonb")
        vals.append(json.dumps(content))
        idx += 1
    if status is not None:
        sets.append(f"status = ${idx}")
        vals.append(status)
        idx += 1

    if not sets:
        return

    vals.append(note_id)
    query = f"UPDATE clinical_notes SET {', '.join(sets)} WHERE id = ${idx}::uuid"
    await pool.execute(query, *vals)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/notes/unsigned")
async def list_unsigned_notes(
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Get all unsigned (draft/review) clinical notes. Clinician only.

    Used by the dashboard unsigned notes queue widget.
    Owners see all; non-owners see only their own.
    """
    notes = await get_unsigned_notes(
        clinician_uid=user["uid"],
        is_owner=is_owner(user),
    )

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="unsigned_notes",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {"notes": notes, "count": len(notes)}


@router.post("/notes/create-manual")
async def create_manual_note(
    body: CreateManualNoteRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Create a blank clinical note for manual writing (no-recording fallback).

    Creates a placeholder encounter (type=clinical, source=clinician) with an
    empty transcript, then creates a blank note in the chosen format.
    Useful when recording fails or the clinician wants to write from memory.
    """
    # Build blank content sections based on format
    if body.format == "SOAP":
        content = {
            "subjective": "",
            "objective": "",
            "assessment": "",
            "plan": "",
        }
    elif body.format == "DAP":
        content = {
            "data": "",
            "assessment": "",
            "plan": "",
        }
    else:
        content = {"narrative": ""}

    encounter_id = await create_encounter(
        client_id=body.client_id,
        encounter_type="clinical",
        source="clinician",
        clinician_id=user["uid"],
        transcript="",
        data={"appointment_id": body.appointment_id, "manual": True} if body.appointment_id else {"manual": True},
        status="complete",
    )

    note_id = await _create_clinical_note(
        encounter_id=encounter_id,
        note_format=body.format,
        content=content,
        clinician_id=user["uid"],
    )

    # Link encounter to appointment if provided
    if body.appointment_id:
        pool = await get_pool()
        await pool.execute(
            "UPDATE appointments SET encounter_id = $1::uuid WHERE id = $2::uuid",
            encounter_id,
            body.appointment_id,
        )

    await log_audit_event(
        user_id=user["uid"],
        action="manual_note_created",
        resource_type="clinical_note",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "encounter_id": encounter_id,
            "client_id": body.client_id,
            "format": body.format,
            "appointment_id": body.appointment_id,
        },
    )

    return {"note_id": note_id, "encounter_id": encounter_id}


@router.post("/notes/generate-from-dictation")
async def generate_note_from_dictation_endpoint(
    body: GenerateFromDictationRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Generate a structured clinical note from freeform dictation using Gemini.

    Takes freeform text (from voice dictation or typed input), creates a
    placeholder encounter, sends the dictation to Gemini to generate a
    structured note, and returns the note_id for editing.
    """
    if not body.dictation or not body.dictation.strip():
        raise HTTPException(status_code=400, detail="Dictation text is required.")

    if body.format not in ("SOAP", "DAP", "narrative"):
        raise HTTPException(status_code=400, detail="Format must be SOAP, DAP, or narrative.")

    # Resolve client name for the prompt
    client = await get_client(body.client_id)
    client_name = "the client"
    if client:
        client_name = client.get("preferred_name") or (client.get("full_name") or "the client").split()[0]

    # Get active treatment plan for context
    treatment_plan = await get_active_treatment_plan(body.client_id)

    # Duration
    duration_sec = (body.duration_minutes * 60) if body.duration_minutes else None

    # Create encounter with dictation as transcript
    encounter_data = {"manual": True, "dictation": True}
    if body.appointment_id:
        encounter_data["appointment_id"] = body.appointment_id

    encounter_id = await create_encounter(
        client_id=body.client_id,
        encounter_type="clinical",
        source="clinician",
        clinician_id=user["uid"],
        transcript=body.dictation,
        data=encounter_data,
        status="complete",
        duration_sec=duration_sec,
    )

    # Generate structured note from dictation via Gemini
    try:
        result = await generate_note_from_dictation(
            dictation=body.dictation,
            note_format=body.format,
            client_name=client_name,
            session_date=body.session_date or "",
            duration_sec=duration_sec,
            treatment_plan=treatment_plan,
        )
        content = result["content"]
        chosen_format = result["format"]
    except Exception as e:
        logger.error("Dictation note generation failed: %s", e)
        # Fallback: create blank note so clinician can still edit manually
        if body.format == "SOAP":
            content = {"subjective": "", "objective": "", "assessment": "", "plan": ""}
        elif body.format == "DAP":
            content = {"data": "", "assessment": "", "plan": ""}
        else:
            content = {
                "identifying_information": "", "presenting_problem": "",
                "history_of_present_illness": "", "psychiatric_history": "",
                "substance_use_history": "", "medical_history": "",
                "family_history": "", "social_developmental_history": "",
                "mental_status_examination": "", "diagnostic_impressions": "",
                "risk_assessment": "", "treatment_recommendations": "",
                "clinical_summary": "",
            }
        chosen_format = body.format

    note_id = await _create_clinical_note(
        encounter_id=encounter_id,
        note_format=chosen_format,
        content=content,
        clinician_id=user["uid"],
    )

    # Link to appointment if provided
    if body.appointment_id:
        pool = await get_pool()
        await pool.execute(
            "UPDATE appointments SET encounter_id = $1::uuid WHERE id = $2::uuid",
            encounter_id,
            body.appointment_id,
        )

    await log_audit_event(
        user_id=user["uid"],
        action="dictation_note_generated",
        resource_type="clinical_note",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "encounter_id": encounter_id,
            "client_id": body.client_id,
            "format": chosen_format,
            "dictation_length": len(body.dictation),
            "appointment_id": body.appointment_id,
        },
    )

    return {
        "note_id": note_id,
        "encounter_id": encounter_id,
        "format": chosen_format,
        "content": content,
    }


@router.post("/notes/generate")
async def generate_clinical_note(
    body: GenerateNoteRequest,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Generate an AI clinical note from an encounter transcript.

    Takes an encounter_id, determines the appropriate note format based on
    the linked appointment type, generates the note via Gemini, and stores
    it as a draft in clinical_notes.

    Supports regeneration with clinician feedback via the feedback field.
    """
    # Fetch the encounter
    encounter = await _get_encounter(body.encounter_id)
    if not encounter:
        raise HTTPException(404, "Encounter not found")

    transcript = encounter.get("transcript", "")
    if not transcript:
        raise HTTPException(400, "Encounter has no transcript to generate a note from")

    # Determine appointment type from encounter data
    encounter_data = encounter.get("data") or {}
    appointment_type = encounter_data.get("appointment_type", "individual")

    # Get client info for the prompt
    client_name = "the client"
    client = await get_client(encounter["client_id"])
    if client:
        client_name = client.get("preferred_name") or (client.get("full_name") or "the client").split()[0]

    # Get treatment plan for context
    treatment_plan = await get_active_treatment_plan(encounter["client_id"])

    # Session date from encounter
    session_date = encounter.get("created_at", "")

    # Check for existing note (for regeneration)
    pool = await get_pool()
    existing = await pool.fetchrow(
        "SELECT id, status FROM clinical_notes WHERE encounter_id = $1::uuid ORDER BY created_at DESC LIMIT 1",
        body.encounter_id,
    )

    if existing and existing["status"] in ("signed", "amended"):
        raise HTTPException(400, "Cannot regenerate a signed note. Create an amendment instead.")

    # Generate the note
    try:
        if body.feedback and existing:
            result = await regenerate_note(
                transcript=transcript,
                appointment_type=appointment_type,
                note_format=body.note_format or ("SOAP" if appointment_type != "assessment" else "narrative"),
                client_name=client_name,
                session_date=session_date,
                duration_sec=encounter.get("duration_sec"),
                treatment_plan=treatment_plan,
                feedback=body.feedback,
            )
        else:
            result = await generate_note(
                transcript=transcript,
                appointment_type=appointment_type,
                note_format=body.note_format,
                client_name=client_name,
                session_date=session_date,
                duration_sec=encounter.get("duration_sec"),
                treatment_plan=treatment_plan,
            )
    except Exception as e:
        logger.error("Note generation failed for encounter %s: %s", body.encounter_id, e)
        raise HTTPException(502, f"Note generation failed: {type(e).__name__}")

    note_format = result["format"]
    content = result["content"]

    # If regenerating, update existing draft; otherwise create new
    if existing and existing["status"] == "draft":
        note_id = str(existing["id"])
        await _update_clinical_note(note_id, content=content)
        action = "regenerated"
    else:
        note_id = await _create_clinical_note(
            encounter_id=body.encounter_id,
            note_format=note_format,
            content=content,
            clinician_id=user["uid"],
        )
        action = "generated"

    await log_audit_event(
        user_id=user["uid"],
        action=f"note_{action}",
        resource_type="clinical_note",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "encounter_id": body.encounter_id,
            "note_format": note_format,
            "appointment_type": appointment_type,
        },
    )

    logger.info(
        "Note %s: %s (format=%s, encounter=%s)",
        action, note_id, note_format, body.encounter_id,
    )

    return {
        "note_id": note_id,
        "format": note_format,
        "content": content,
        "status": "draft",
        "action": action,
    }


# ---------------------------------------------------------------------------
# C9: Stored Signature (for signing UI)
# NOTE: This must be defined BEFORE /notes/{note_id} to avoid route conflict.
# ---------------------------------------------------------------------------

@router.get("/notes/signing/signature")
async def get_signing_signature(
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Get the clinician's stored signature for reuse during note signing.

    Returns the signature PNG data URL if one exists, or null.
    """
    sig = await get_stored_signature(user["uid"])
    return {"signature": sig}


@router.get("/notes/{note_id}")
async def get_note_detail(
    note_id: str,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Get a single clinical note with its source encounter data.

    Returns the full note content, encounter transcript, and metadata.
    Used by the note editor page.
    """
    note = await _get_note(note_id)
    if not note:
        raise HTTPException(404, "Note not found")

    # Get client info for display
    client = await get_client(note["client_id"])
    client_info = None
    if client:
        client_info = {
            "firebase_uid": client["firebase_uid"],
            "full_name": client.get("full_name"),
            "preferred_name": client.get("preferred_name"),
            "email": client.get("email"),
            "date_of_birth": client.get("date_of_birth"),
        }

    # Find the client UUID for linking
    pool = await get_pool()
    client_row = await pool.fetchrow(
        "SELECT id FROM clients WHERE firebase_uid = $1",
        note["client_id"],
    )
    client_uuid = str(client_row["id"]) if client_row else None

    # Get amendments if this is a signed note
    amendments = []
    amendment_rows = await pool.fetch(
        """
        SELECT id, status, signed_at, signed_by, created_at
        FROM clinical_notes
        WHERE amendment_of = $1::uuid
        ORDER BY created_at ASC
        """,
        note_id,
    )
    for a in amendment_rows:
        amendments.append({
            "id": str(a["id"]),
            "status": a["status"],
            "signed_at": a["signed_at"].isoformat() if a["signed_at"] else None,
            "signed_by": a["signed_by"],
            "created_at": a["created_at"].isoformat(),
        })

    # If this is an amendment, get the original note id
    original_note_id = note.get("amendment_of")

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="clinical_note",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {
        **note,
        "client": client_info,
        "client_uuid": client_uuid,
        "amendments": amendments,
        "has_pdf": note["status"] in ("signed", "amended"),
    }


@router.put("/notes/{note_id}")
async def update_note(
    note_id: str,
    body: UpdateNoteRequest,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Update a clinical note's content or status.

    Only draft and review notes can be edited. Signed notes are immutable.
    """
    note = await _get_note(note_id)
    if not note:
        raise HTTPException(404, "Note not found")

    if note["status"] in ("signed", "amended"):
        raise HTTPException(400, "Cannot edit a signed note. Create an amendment instead.")

    # Validate status transition
    if body.status:
        valid_transitions = {
            "draft": ["review"],
            "review": ["draft"],  # Can go back to draft
        }
        allowed = valid_transitions.get(note["status"], [])
        if body.status not in allowed:
            raise HTTPException(
                400,
                f"Cannot transition from '{note['status']}' to '{body.status}'. "
                f"Allowed transitions: {allowed}",
            )

    await _update_clinical_note(
        note_id=note_id,
        content=body.content,
        status=body.status,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="updated",
        resource_type="clinical_note",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "content_updated": body.content is not None,
            "status_change": body.status,
        },
    )

    return {"status": "updated", "note_id": note_id}


# ---------------------------------------------------------------------------
# C9: Sign Note
# ---------------------------------------------------------------------------

@router.post("/notes/{note_id}/sign")
async def sign_note(
    note_id: str,
    body: SignNoteRequest,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Sign and lock a clinical note.

    Steps:
    1. Validate the note is in draft or review status
    2. Save any final content
    3. Compute SHA-256 content hash
    4. Store signature, update status to 'signed'
    5. Generate PDF
    6. Log audit event
    7. Fire billing trigger placeholder
    """
    note = await _get_note(note_id)
    if not note:
        raise HTTPException(404, "Note not found")

    if note["status"] not in ("draft", "review"):
        raise HTTPException(400, f"Cannot sign a note in '{note['status']}' status. Only draft or review notes can be signed.")

    # Compute content hash
    content = note["content"]
    if isinstance(content, str):
        content = json.loads(content)
    content_hash = _compute_content_hash(content)

    # Get the clinician's display info for signed_by
    signed_by = user.get("email", user["uid"])

    # Timestamp
    now = datetime.now(timezone.utc)
    signed_at_iso = now.isoformat()

    # Store/update the clinician's signature for reuse
    await upsert_stored_signature(user["uid"], body.signature_data)

    # Get client info for PDF
    client = await get_client(note["client_id"])
    client_name = "Unknown Client"
    client_dob = None
    if client:
        client_name = client.get("full_name") or client.get("preferred_name") or client.get("email") or "Unknown Client"
        client_dob = client.get("date_of_birth")

    # Get practice profile for PDF header
    practice = await get_practice_profile(user["uid"])

    # Format session date
    session_date = note.get("encounter_created_at", "")
    try:
        session_dt = datetime.fromisoformat(session_date)
        session_date_formatted = session_dt.strftime("%B %d, %Y")
    except Exception:
        session_date_formatted = session_date

    # Generate PDF
    try:
        pdf_bytes = generate_note_pdf(
            note_format=note["format"],
            content=content,
            client_name=client_name,
            client_dob=client_dob,
            session_date=session_date_formatted,
            signed_by=signed_by,
            signed_at=signed_at_iso,
            content_hash=content_hash,
            signature_data=body.signature_data,
            practice=practice,
        )
    except Exception as e:
        logger.error("PDF generation failed for note %s: %s", note_id, e)
        # Sign the note even if PDF fails -- we can regenerate the PDF later
        pdf_bytes = None

    # Update the note in the database
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE clinical_notes
        SET status = 'signed',
            signed_by = $1,
            signed_at = $2::timestamptz,
            content_hash = $3,
            signature_data = $4,
            pdf_data = $5
        WHERE id = $6::uuid
        """,
        signed_by,
        now,
        content_hash,
        body.signature_data,
        pdf_bytes,
        note_id,
    )

    # Log HIPAA audit event for signing
    await log_audit_event(
        user_id=user["uid"],
        action="note_signed",
        resource_type="clinical_note",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "content_hash": content_hash,
            "note_format": note["format"],
            "client_id": note["client_id"],
            "encounter_id": note["encounter_id"],
            "pdf_generated": pdf_bytes is not None,
        },
    )

    # Billing trigger: log that this signed note is ready for superbill generation (C11)
    await log_audit_event(
        user_id=user["uid"],
        action="billing_trigger",
        resource_type="clinical_note",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "trigger": "note_signed",
            "note_format": note["format"],
            "client_id": note["client_id"],
            "encounter_id": note["encounter_id"],
            "content_hash": content_hash,
            "awaiting": "superbill_generation",
        },
    )

    logger.info(
        "Note signed: %s (format=%s, hash=%s, pdf=%s)",
        note_id, note["format"], content_hash[:16], pdf_bytes is not None,
    )

    # C11: Auto-generate superbill when note is signed
    superbill_id = None
    try:
        from routes.billing import generate_superbill_for_note
        superbill_result = await generate_superbill_for_note(note_id, user["uid"])
        if superbill_result:
            superbill_id = superbill_result["id"]
            await log_audit_event(
                user_id=user["uid"],
                action="superbill_auto_generated",
                resource_type="superbill",
                resource_id=superbill_id,
                ip_address=_client_ip(request),
                user_agent=request.headers.get("user-agent"),
                metadata={
                    "trigger": "note_signed",
                    "note_id": note_id,
                    "client_id": note["client_id"],
                    "cpt_code": superbill_result.get("cpt_code"),
                },
            )
            logger.info(
                "Superbill auto-generated: %s (triggered by note signing %s)",
                superbill_id, note_id,
            )
    except Exception as e:
        logger.error(
            "Auto superbill generation failed for note %s: %s: %s",
            note_id, type(e).__name__, e,
        )
        # Don't fail the note signing if superbill generation fails

    # C10: Auto-generate treatment plan when intake assessment (narrative/90791) is signed
    treatment_plan_id = None
    if note["format"] == "narrative":
        try:
            # Check if client already has an active treatment plan
            existing_plan = await get_active_treatment_plan(note["client_id"])

            client_name_for_plan = "the client"
            if client:
                client_name_for_plan = client.get("preferred_name") or (
                    client.get("full_name") or "the client"
                ).split()[0]

            assessment_content = content
            result = await ai_generate_plan(
                assessment_content=assessment_content,
                transcript=note.get("transcript", ""),
                client_name=client_name_for_plan,
                assessment_date=note.get("encounter_created_at", ""),
            )

            previous_version_id = None
            if existing_plan:
                previous_version_id = existing_plan["id"]
                await supersede_treatment_plan(existing_plan["id"])

            treatment_plan_id = await create_treatment_plan(
                client_id=note["client_id"],
                diagnoses=result["diagnoses"],
                goals=result["goals"],
                presenting_problems=result.get("presenting_problems"),
                review_date=result.get("review_date"),
                source_encounter_id=note["encounter_id"],
                previous_version_id=previous_version_id,
                clinician_id=user["uid"],
            )

            await log_audit_event(
                user_id=user["uid"],
                action="treatment_plan_auto_generated",
                resource_type="treatment_plan",
                resource_id=treatment_plan_id,
                ip_address=_client_ip(request),
                user_agent=request.headers.get("user-agent"),
                metadata={
                    "trigger": "assessment_note_signed",
                    "note_id": note_id,
                    "client_id": note["client_id"],
                },
            )

            logger.info(
                "Treatment plan auto-generated: %s (triggered by assessment note %s)",
                treatment_plan_id, note_id,
            )
        except Exception as e:
            logger.error(
                "Auto treatment plan generation failed for note %s: %s: %s",
                note_id, type(e).__name__, e,
            )
            # Don't fail the note signing if treatment plan generation fails

    return {
        "status": "signed",
        "note_id": note_id,
        "signed_by": signed_by,
        "signed_at": signed_at_iso,
        "content_hash": content_hash,
        "pdf_generated": pdf_bytes is not None,
        "treatment_plan_generated": treatment_plan_id is not None,
        "treatment_plan_id": treatment_plan_id,
        "superbill_generated": superbill_id is not None,
        "superbill_id": superbill_id,
    }


# ---------------------------------------------------------------------------
# C9: Download Signed Note PDF
# ---------------------------------------------------------------------------

@router.get("/notes/{note_id}/pdf")
async def download_note_pdf(
    note_id: str,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Download the PDF of a signed clinical note.

    Returns the PDF as a binary download.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT pdf_data, status, format FROM clinical_notes WHERE id = $1::uuid",
        note_id,
    )
    if not row:
        raise HTTPException(404, "Note not found")

    if row["status"] not in ("signed", "amended"):
        raise HTTPException(400, "PDF is only available for signed notes")

    if not row["pdf_data"]:
        raise HTTPException(404, "PDF not yet generated for this note")

    await log_audit_event(
        user_id=user["uid"],
        action="note_pdf_downloaded",
        resource_type="clinical_note",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    filename = f"clinical_note_{note_id[:8]}_{row['format']}.pdf"
    return Response(
        content=bytes(row["pdf_data"]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# ---------------------------------------------------------------------------
# C9: Amendment Workflow
# ---------------------------------------------------------------------------

@router.post("/notes/{note_id}/amend")
async def create_amendment(
    note_id: str,
    body: AmendNoteRequest,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Create an amendment for a signed clinical note.

    An amendment creates a NEW clinical_notes record with amendment_of
    pointing to the original. The original note remains unchanged.
    The amendment starts as a draft and has its own sign cycle.
    """
    original = await _get_note(note_id)
    if not original:
        raise HTTPException(404, "Original note not found")

    if original["status"] not in ("signed", "amended"):
        raise HTTPException(400, "Can only amend a signed note")

    # Create the amendment note
    amendment_id = await _create_clinical_note(
        encounter_id=original["encounter_id"],
        note_format=original["format"],
        content=body.content,
        amendment_of=note_id,
    )

    # Update original note status to 'amended'
    pool = await get_pool()
    await pool.execute(
        "UPDATE clinical_notes SET status = 'amended' WHERE id = $1::uuid",
        note_id,
    )

    # Log audit event
    await log_audit_event(
        user_id=user["uid"],
        action="note_amendment_created",
        resource_type="clinical_note",
        resource_id=amendment_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "original_note_id": note_id,
            "reason": body.reason,
            "client_id": original["client_id"],
        },
    )

    logger.info(
        "Amendment created: %s (of original %s)",
        amendment_id, note_id,
    )

    return {
        "status": "amendment_created",
        "amendment_id": amendment_id,
        "original_note_id": note_id,
    }


@router.get("/notes/{note_id}/amendments")
async def list_amendments(
    note_id: str,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """List all amendments for a given note."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, format, content, status, signed_by, signed_at,
               content_hash, created_at, updated_at
        FROM clinical_notes
        WHERE amendment_of = $1::uuid
        ORDER BY created_at ASC
        """,
        note_id,
    )

    amendments = [
        {
            "id": str(r["id"]),
            "format": r["format"],
            "content": r["content"],
            "status": r["status"],
            "signed_by": r["signed_by"],
            "signed_at": r["signed_at"].isoformat() if r["signed_at"] else None,
            "content_hash": r["content_hash"],
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }
        for r in rows
    ]

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="note_amendments",
        resource_id=note_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"count": len(amendments)},
    )

    return {"amendments": amendments, "count": len(amendments)}


