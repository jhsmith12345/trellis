"""Treatment plan generation, editing, signing, and versioning endpoints.

Component 10: Treatment Plan Generation — AI-generated treatment plans
from intake assessments, with clinician review/edit/sign workflow,
versioning, and PDF export.

HIPAA Access Control:
  - All endpoints require active practice membership (require_practice_member())
  - Non-owner clinicians can only access their own clients' plans
  - Practice owners can access all plans across the practice
  - Signed plans are immutable — content_hash (SHA-256) locks content
  - Version history is preserved; superseded plans are never deleted
  - All reads and writes logged to audit_events

Endpoints:
  - POST /api/treatment-plans/generate          — AI generate from assessment
  - POST /api/treatment-plans/update/{plan_id}  — AI update from new sessions
  - GET  /api/treatment-plans/{plan_id}         — get a single treatment plan
  - PUT  /api/treatment-plans/{plan_id}         — update plan content (draft only)
  - POST /api/treatment-plans/{plan_id}/sign    — sign and lock a plan
  - GET  /api/treatment-plans/{plan_id}/pdf     — download signed plan PDF
  - GET  /api/treatment-plans/client/{client_id}/versions — version history
  - GET  /api/treatment-plans/due-for-review    — plans approaching review date
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
    get_treatment_plan,
    get_active_treatment_plan,
    create_treatment_plan,
    update_treatment_plan as db_update_treatment_plan,
    get_treatment_plan_versions,
    supersede_treatment_plan,
    sign_treatment_plan,
    get_treatment_plans_due_for_review,
    get_client,
    get_client_by_id,
    get_client_notes,
    get_client_encounters,
    get_stored_signature,
    upsert_stored_signature,
    get_practice_profile,
    log_audit_event,
)
from treatment_plan_generator import generate_treatment_plan, update_treatment_plan as ai_update_plan
from treatment_plan_pdf import generate_treatment_plan_pdf

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class GeneratePlanRequest(BaseModel):
    client_id: str  # firebase_uid of the client
    encounter_id: str | None = None  # specific encounter to generate from


class UpdatePlanRequest(BaseModel):
    diagnoses: list | None = None
    goals: list | None = None
    presenting_problems: str | None = None
    review_date: str | None = None
    status: str | None = None  # 'draft', 'review'


class SignPlanRequest(BaseModel):
    signature_data: str  # base64 PNG data URL of the signature


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _compute_content_hash(plan: dict) -> str:
    """Compute SHA-256 hash of treatment plan content for integrity verification."""
    canonical = json.dumps({
        "diagnoses": plan.get("diagnoses", []),
        "goals": plan.get("goals", []),
        "presenting_problems": plan.get("presenting_problems", ""),
    }, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _get_assessment_note(client_id: str) -> dict | None:
    """Get the latest signed (or any) intake assessment note for a client."""
    pool = await get_pool()
    # Try signed first, then any status
    r = await pool.fetchrow(
        """
        SELECT cn.id, cn.format, cn.content, cn.status, cn.created_at,
               e.transcript, e.data, e.duration_sec, e.created_at AS encounter_created_at
        FROM clinical_notes cn
        JOIN encounters e ON e.id = cn.encounter_id
        WHERE e.client_id = $1
          AND cn.format = 'narrative'
        ORDER BY
            CASE cn.status WHEN 'signed' THEN 0 WHEN 'amended' THEN 1 ELSE 2 END,
            cn.created_at DESC
        LIMIT 1
        """,
        client_id,
    )
    if not r:
        return None
    return {
        "id": str(r["id"]),
        "format": r["format"],
        "content": r["content"],
        "status": r["status"],
        "transcript": r["transcript"],
        "encounter_data": r["data"],
        "encounter_created_at": r["encounter_created_at"].isoformat(),
        "created_at": r["created_at"].isoformat(),
    }


async def _get_notes_since(client_id: str, since: str) -> list[dict]:
    """Get clinical notes created after a given timestamp."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT cn.id, cn.format, cn.content, cn.status, cn.created_at
        FROM clinical_notes cn
        JOIN encounters e ON e.id = cn.encounter_id
        WHERE e.client_id = $1
          AND cn.created_at > $2::timestamptz
        ORDER BY cn.created_at ASC
        """,
        client_id,
        since,
    )
    return [
        {
            "id": str(r["id"]),
            "format": r["format"],
            "content": r["content"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


async def _get_encounters_since(client_id: str, since: str) -> list[dict]:
    """Get encounters with transcripts created after a given timestamp."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, type, source, transcript, data, created_at
        FROM encounters
        WHERE client_id = $1
          AND created_at > $2::timestamptz
          AND transcript IS NOT NULL
          AND transcript != ''
        ORDER BY created_at ASC
        """,
        client_id,
        since,
    )
    return [
        {
            "id": str(r["id"]),
            "type": r["type"],
            "source": r["source"],
            "transcript": r["transcript"],
            "data": r["data"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/treatment-plans/generate")
async def generate_plan(
    body: GeneratePlanRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Generate an AI treatment plan from a client's intake assessment.

    Creates a new draft treatment plan using the intake assessment note
    and encounter transcript. If a treatment plan already exists, it
    creates a new version.
    """
    # Verify clinician can access this client
    await enforce_clinician_owns_client(user, body.client_id)

    # Get assessment note
    assessment = await _get_assessment_note(body.client_id)
    if not assessment:
        raise HTTPException(
            400,
            "No intake assessment note found for this client. "
            "Generate and sign an intake assessment note first."
        )

    # Get client info
    client_name = "the client"
    client = await get_client(body.client_id)
    if client:
        client_name = client.get("preferred_name") or (
            client.get("full_name") or "the client"
        ).split()[0]

    # Check for existing active plan
    existing_plan = await get_active_treatment_plan(body.client_id)
    previous_version_id = None
    if existing_plan:
        previous_version_id = existing_plan["id"]
        # Supersede the existing plan
        await supersede_treatment_plan(existing_plan["id"])

    # Generate via AI
    try:
        assessment_content = assessment["content"]
        if isinstance(assessment_content, str):
            try:
                assessment_content = json.loads(assessment_content)
            except (json.JSONDecodeError, TypeError):
                pass

        result = await generate_treatment_plan(
            assessment_content=assessment_content,
            transcript=assessment.get("transcript", ""),
            client_name=client_name,
            assessment_date=assessment.get("encounter_created_at", ""),
        )
    except Exception as e:
        logger.error("Treatment plan generation failed for %s: %s", body.client_id, e)
        raise HTTPException(502, f"Treatment plan generation failed: {type(e).__name__}")

    # Create the treatment plan record
    plan_id = await create_treatment_plan(
        client_id=body.client_id,
        diagnoses=result["diagnoses"],
        goals=result["goals"],
        presenting_problems=result.get("presenting_problems"),
        review_date=result.get("review_date"),
        source_encounter_id=body.encounter_id,
        previous_version_id=previous_version_id,
        clinician_id=user["uid"],
    )

    await log_audit_event(
        user_id=user["uid"],
        action="treatment_plan_generated",
        resource_type="treatment_plan",
        resource_id=plan_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "client_id": body.client_id,
            "from_assessment": assessment["id"],
            "previous_version_id": previous_version_id,
        },
    )

    logger.info("Treatment plan generated: %s for client %s", plan_id, body.client_id)

    plan = await get_treatment_plan(plan_id)
    return {
        "plan_id": plan_id,
        "status": "draft",
        "action": "generated",
        "plan": plan,
    }


@router.post("/treatment-plans/update/{plan_id}")
async def ai_update_treatment_plan(
    plan_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """AI-update a treatment plan based on new encounters and notes.

    Creates a new version with updated diagnoses, goals, and objectives
    incorporating data from all sessions since the plan was last updated.
    The previous version is preserved (superseded).
    """
    current_plan = await get_treatment_plan(plan_id)
    if not current_plan:
        raise HTTPException(404, "Treatment plan not found")

    client_id = current_plan["client_id"]

    # Verify clinician can access this client
    await enforce_clinician_owns_client(user, client_id)

    # Get client info
    client_name = "the client"
    client = await get_client(client_id)
    if client:
        client_name = client.get("preferred_name") or (
            client.get("full_name") or "the client"
        ).split()[0]

    # Get notes and encounters since this plan was created
    since = current_plan["created_at"]
    recent_notes = await _get_notes_since(client_id, since)
    recent_encounters = await _get_encounters_since(client_id, since)

    if not recent_notes and not recent_encounters:
        raise HTTPException(
            400,
            "No new clinical data since this plan was created. "
            "There must be new notes or encounters to update the plan."
        )

    # Supersede the current plan
    await supersede_treatment_plan(plan_id)

    # AI update
    try:
        result = await ai_update_plan(
            current_plan=current_plan,
            recent_notes=recent_notes,
            recent_transcripts=recent_encounters,
            client_name=client_name,
            original_plan_date=current_plan["created_at"],
        )
    except Exception as e:
        logger.error("Treatment plan update failed for %s: %s", plan_id, e)
        # Revert superseded status on failure
        await db_update_treatment_plan(plan_id, status=current_plan["status"])
        raise HTTPException(502, f"Treatment plan update failed: {type(e).__name__}")

    # Create the new version
    new_plan_id = await create_treatment_plan(
        client_id=client_id,
        diagnoses=result["diagnoses"],
        goals=result["goals"],
        presenting_problems=result.get("presenting_problems"),
        review_date=result.get("review_date"),
        previous_version_id=plan_id,
        clinician_id=user["uid"],
    )

    await log_audit_event(
        user_id=user["uid"],
        action="treatment_plan_updated",
        resource_type="treatment_plan",
        resource_id=new_plan_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "client_id": client_id,
            "previous_plan_id": plan_id,
            "notes_considered": len(recent_notes),
            "encounters_considered": len(recent_encounters),
        },
    )

    logger.info("Treatment plan updated: %s -> %s", plan_id, new_plan_id)

    plan = await get_treatment_plan(new_plan_id)
    return {
        "plan_id": new_plan_id,
        "status": "draft",
        "action": "updated",
        "previous_plan_id": plan_id,
        "plan": plan,
    }


@router.get("/treatment-plans/due-for-review")
async def list_plans_due_for_review(
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Get treatment plans with review dates approaching (within 14 days).

    Used by the dashboard to show a "Treatment Plans Due for Review" indicator.
    Owners see all plans; non-owners see only their own clients' plans.
    """
    plans = await get_treatment_plans_due_for_review(
        days_ahead=14,
        clinician_uid=user["uid"],
        is_owner=is_owner(user),
    )

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="treatment_plans_review_queue",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {"plans": plans, "count": len(plans)}


@router.get("/treatment-plans/signing/signature")
async def get_signing_signature(
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Get the clinician's stored signature for reuse during plan signing."""
    sig = await get_stored_signature(user["uid"])
    return {"signature": sig}


@router.get("/treatment-plans/{plan_id}")
async def get_plan_detail(
    plan_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Get a single treatment plan with full details.

    Returns the plan content, client info, and version metadata.
    """
    plan = await get_treatment_plan(plan_id)
    if not plan:
        raise HTTPException(404, "Treatment plan not found")

    # Verify clinician can access this client
    await enforce_clinician_owns_client(user, plan["client_id"])

    # Get client info
    client = await get_client(plan["client_id"])
    client_info = None
    client_uuid = None
    if client:
        client_info = {
            "firebase_uid": client["firebase_uid"],
            "full_name": client.get("full_name"),
            "preferred_name": client.get("preferred_name"),
            "email": client.get("email"),
            "date_of_birth": client.get("date_of_birth"),
        }
        pool = await get_pool()
        client_row = await pool.fetchrow(
            "SELECT id FROM clients WHERE firebase_uid = $1",
            plan["client_id"],
        )
        client_uuid = str(client_row["id"]) if client_row else None

    # Get version history summary
    versions = await get_treatment_plan_versions(plan["client_id"])
    version_summary = [
        {
            "id": v["id"],
            "version": v["version"],
            "status": v["status"],
            "created_at": v["created_at"],
            "signed_at": v.get("signed_at"),
        }
        for v in versions
    ]

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="treatment_plan",
        resource_id=plan_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {
        **plan,
        "client": client_info,
        "client_uuid": client_uuid,
        "versions": version_summary,
        "has_pdf": plan["status"] in ("signed",),
    }


@router.put("/treatment-plans/{plan_id}")
async def update_plan(
    plan_id: str,
    body: UpdatePlanRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Update a treatment plan's content or status.

    Only draft and review plans can be edited. Signed plans are immutable.
    """
    plan = await get_treatment_plan(plan_id)
    if not plan:
        raise HTTPException(404, "Treatment plan not found")

    # Verify clinician can access this client
    await enforce_clinician_owns_client(user, plan["client_id"])

    if plan["status"] in ("signed", "superseded"):
        raise HTTPException(
            400,
            f"Cannot edit a plan in '{plan['status']}' status. "
            "Create a new version instead."
        )

    # Validate status transition
    if body.status:
        valid_transitions = {
            "draft": ["review"],
            "review": ["draft"],
        }
        allowed = valid_transitions.get(plan["status"], [])
        if body.status not in allowed:
            raise HTTPException(
                400,
                f"Cannot transition from '{plan['status']}' to '{body.status}'. "
                f"Allowed transitions: {allowed}",
            )

    kwargs = {}
    if body.diagnoses is not None:
        kwargs["diagnoses"] = body.diagnoses
    if body.goals is not None:
        kwargs["goals"] = body.goals
    if body.presenting_problems is not None:
        kwargs["presenting_problems"] = body.presenting_problems
    if body.review_date is not None:
        kwargs["review_date"] = body.review_date
    if body.status is not None:
        kwargs["status"] = body.status

    if kwargs:
        await db_update_treatment_plan(plan_id, **kwargs)

    await log_audit_event(
        user_id=user["uid"],
        action="updated",
        resource_type="treatment_plan",
        resource_id=plan_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "fields_updated": list(kwargs.keys()),
            "status_change": body.status,
        },
    )

    return {"status": "updated", "plan_id": plan_id}


@router.post("/treatment-plans/{plan_id}/sign")
async def sign_plan(
    plan_id: str,
    body: SignPlanRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Sign and lock a treatment plan.

    Steps:
    1. Validate the plan is in draft or review status
    2. Compute SHA-256 content hash
    3. Store signature, update status to 'signed'
    4. Generate PDF
    5. Log audit event
    """
    plan = await get_treatment_plan(plan_id)
    if not plan:
        raise HTTPException(404, "Treatment plan not found")

    # Verify clinician can access this client
    await enforce_clinician_owns_client(user, plan["client_id"])

    if plan["status"] not in ("draft", "review"):
        raise HTTPException(
            400,
            f"Cannot sign a plan in '{plan['status']}' status. "
            "Only draft or review plans can be signed."
        )

    # Compute content hash
    content_hash = _compute_content_hash(plan)

    # Get signed by info
    signed_by = user.get("email", user["uid"])
    now = datetime.now(timezone.utc)
    signed_at_iso = now.isoformat()

    # Store/update the clinician's signature for reuse
    await upsert_stored_signature(user["uid"], body.signature_data)

    # Get client info for PDF
    client = await get_client(plan["client_id"])
    client_name = "Unknown Client"
    client_dob = None
    if client:
        client_name = client.get("full_name") or client.get("preferred_name") or client.get("email") or "Unknown Client"
        client_dob = client.get("date_of_birth")

    # Get practice profile for PDF header
    practice = await get_practice_profile(user["uid"])

    # Format plan date
    plan_date = plan.get("created_at", "")
    try:
        plan_dt = datetime.fromisoformat(plan_date)
        plan_date_formatted = plan_dt.strftime("%B %d, %Y")
    except Exception:
        plan_date_formatted = plan_date

    # Generate PDF
    try:
        pdf_bytes = generate_treatment_plan_pdf(
            diagnoses=plan.get("diagnoses") or [],
            goals=plan.get("goals") or [],
            presenting_problems=plan.get("presenting_problems") or "",
            review_date=plan.get("review_date"),
            version=plan.get("version", 1),
            client_name=client_name,
            client_dob=client_dob,
            plan_date=plan_date_formatted,
            signed_by=signed_by,
            signed_at=signed_at_iso,
            content_hash=content_hash,
            signature_data=body.signature_data,
            practice=practice,
        )
    except Exception as e:
        logger.error("PDF generation failed for treatment plan %s: %s", plan_id, e)
        pdf_bytes = None

    # Sign the plan in the database
    await sign_treatment_plan(
        plan_id=plan_id,
        signed_by=signed_by,
        signed_at=signed_at_iso,
        content_hash=content_hash,
        signature_data=body.signature_data,
        pdf_data=pdf_bytes,
    )

    # Log HIPAA audit event for signing
    await log_audit_event(
        user_id=user["uid"],
        action="treatment_plan_signed",
        resource_type="treatment_plan",
        resource_id=plan_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "content_hash": content_hash,
            "client_id": plan["client_id"],
            "version": plan.get("version"),
            "pdf_generated": pdf_bytes is not None,
        },
    )

    logger.info(
        "Treatment plan signed: %s (version=%d, hash=%s, pdf=%s)",
        plan_id, plan.get("version", 0), content_hash[:16], pdf_bytes is not None,
    )

    return {
        "status": "signed",
        "plan_id": plan_id,
        "signed_by": signed_by,
        "signed_at": signed_at_iso,
        "content_hash": content_hash,
        "pdf_generated": pdf_bytes is not None,
    }


@router.get("/treatment-plans/{plan_id}/pdf")
async def download_plan_pdf(
    plan_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Download the PDF of a signed treatment plan."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT pdf_data, status, version, client_id FROM treatment_plans WHERE id = $1::uuid",
        plan_id,
    )
    if not row:
        raise HTTPException(404, "Treatment plan not found")

    # Verify clinician can access this client
    await enforce_clinician_owns_client(user, row["client_id"])

    if row["status"] != "signed":
        raise HTTPException(400, "PDF is only available for signed treatment plans")

    if not row["pdf_data"]:
        raise HTTPException(404, "PDF not yet generated for this plan")

    await log_audit_event(
        user_id=user["uid"],
        action="treatment_plan_pdf_downloaded",
        resource_type="treatment_plan",
        resource_id=plan_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    filename = f"treatment_plan_{plan_id[:8]}_v{row['version']}.pdf"
    return Response(
        content=bytes(row["pdf_data"]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/treatment-plans/client/{client_id}/versions")
async def list_plan_versions(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Get all treatment plan versions for a client.

    Returns version history with version number, status, dates, and
    whether each is the current active version.
    """
    client = await get_client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    # Verify clinician can access this client
    await enforce_clinician_owns_client(user, client["firebase_uid"])

    versions = await get_treatment_plan_versions(client["firebase_uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="treatment_plan_versions",
        resource_id=client_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {"versions": versions, "count": len(versions)}
