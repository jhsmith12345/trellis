"""Insurance credentialing management endpoints.

Tracks payer enrollment status, credential documents with AI extraction,
activity timelines, and generates follow-up messages and CAQH profile text.

HIPAA Access Control:
  - All endpoints require clinician role
  - All reads and writes logged to audit_events

Endpoints:
  - POST   /api/credentialing/payers                       — create payer enrollment
  - GET    /api/credentialing/payers                       — list payer enrollments
  - GET    /api/credentialing/payers/{payer_id}            — get single payer with timeline
  - PUT    /api/credentialing/payers/{payer_id}            — update payer
  - PATCH  /api/credentialing/payers/{payer_id}/status     — update status (auto-creates timeline event)
  - DELETE /api/credentialing/payers/{payer_id}            — delete payer
  - GET    /api/credentialing/alerts                       — dashboard alerts
  - POST   /api/credentialing/documents                    — upload document with AI extraction
  - GET    /api/credentialing/documents                    — list documents
  - GET    /api/credentialing/documents/{doc_id}           — get document metadata
  - GET    /api/credentialing/documents/{doc_id}/download  — download document file
  - DELETE /api/credentialing/documents/{doc_id}           — delete document
  - POST   /api/credentialing/payers/{payer_id}/timeline   — add timeline event
  - GET    /api/credentialing/payers/{payer_id}/timeline   — list timeline events
  - POST   /api/credentialing/payers/{payer_id}/draft-followup — AI draft follow-up
  - POST   /api/credentialing/generate-caqh               — AI generate CAQH profile text
"""
import base64
import logging
import os
import re
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from auth import require_role, require_practice_member

sys.path.insert(0, "../shared")
from db import (
    create_credentialing_payer,
    get_credentialing_payer,
    list_credentialing_payers,
    update_credentialing_payer,
    delete_credentialing_payer,
    get_expiring_credentials,
    get_stale_applications,
    create_credentialing_document,
    get_credentialing_document,
    get_credentialing_document_file,
    list_credentialing_documents,
    update_credentialing_document,
    delete_credentialing_document,
    create_credentialing_timeline_event,
    list_credentialing_timeline_events,
    log_audit_event,
    get_practice_profile,
)
from credential_extractor import extract_credential_document
from followup_drafter import draft_followup_message
from caqh_generator import generate_caqh_profile_text

logger = logging.getLogger(__name__)
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "your-gcp-project")

router = APIRouter()

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class CreatePayerRequest(BaseModel):
    payer_name: str
    payer_id: str | None = None
    status: str | None = None
    provider_relations_phone: str | None = None
    provider_relations_email: str | None = None
    provider_relations_fax: str | None = None
    portal_url: str | None = None
    effective_date: str | None = None
    expiration_date: str | None = None
    recredential_reminder_days: int | None = None
    required_documents: list | None = None
    contracted_rates: dict | None = None
    notes: str | None = None


class UpdatePayerRequest(BaseModel):
    payer_name: str | None = None
    payer_id: str | None = None
    provider_relations_phone: str | None = None
    provider_relations_email: str | None = None
    provider_relations_fax: str | None = None
    portal_url: str | None = None
    effective_date: str | None = None
    expiration_date: str | None = None
    recredential_reminder_days: int | None = None
    required_documents: list | None = None
    contracted_rates: dict | None = None
    notes: str | None = None
    denial_reason: str | None = None


class UpdateStatusRequest(BaseModel):
    status: str
    denial_reason: str | None = None


class UploadDocumentRequest(BaseModel):
    document_type: str
    file_name: str
    mime_type: str
    file_b64: str
    payer_id: str | None = None
    notes: str | None = None


class AddTimelineEventRequest(BaseModel):
    event_type: str
    description: str
    metadata: dict | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _b64_decode(data: str) -> bytes:
    """Strip optional data URI prefix and decode base64."""
    match = re.match(r"^data:[^;]+;base64,", data)
    if match:
        data = data[match.end():]
    return base64.b64decode(data)


# ---------------------------------------------------------------------------
# Payer Endpoints
# ---------------------------------------------------------------------------

@router.post("/credentialing/payers")
async def create_payer(
    body: CreatePayerRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Create a new payer enrollment record."""
    practice = await get_practice_profile(user["uid"])
    if not practice:
        raise HTTPException(400, "Practice profile required")

    kwargs = body.model_dump(exclude_none=True)
    payer_name = kwargs.pop("payer_name")

    payer = await create_credentialing_payer(
        practice_id=practice["id"],
        clinician_id=user["uid"],
        payer_name=payer_name,
        **kwargs,
    )

    # Auto-create timeline event
    await create_credentialing_timeline_event(
        payer_id=payer["id"],
        event_type="status_change",
        description=f"Enrollment record created for {payer_name}",
        created_by=user["uid"],
    )

    await log_audit_event(
        user_id=user["uid"],
        action="credentialing_payer_created",
        resource_type="credentialing_payer",
        resource_id=payer["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"payer_name": payer_name},
    )

    return payer


@router.get("/credentialing/payers")
async def list_payers(
    request: Request,
    status: str | None = None,
    user: dict = Depends(require_practice_member("owner")),
):
    """List all payer enrollments for the clinician's practice."""
    practice = await get_practice_profile(user["uid"])
    if not practice:
        return {"payers": [], "count": 0}

    payers = await list_credentialing_payers(
        practice_id=practice["id"],
        clinician_id=user["uid"],
        status=status,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="credentialing_payers",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"count": len(payers), "status_filter": status},
    )

    return {"payers": payers, "count": len(payers)}


@router.get("/credentialing/alerts")
async def get_alerts(
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Get credentialing alerts: expiring credentials + stale applications."""
    practice = await get_practice_profile(user["uid"])
    if not practice:
        return {"expiring": [], "stale": []}

    expiring = await get_expiring_credentials(practice["id"])
    stale = await get_stale_applications(practice["id"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="credentialing_alerts",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"expiring_count": len(expiring), "stale_count": len(stale)},
    )

    return {"expiring": expiring, "stale": stale}


@router.get("/credentialing/payers/{payer_id}")
async def get_payer(
    payer_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Get a single payer enrollment with timeline events."""
    payer = await get_credentialing_payer(payer_id)
    if not payer:
        raise HTTPException(404, "Payer enrollment not found")

    timeline = await list_credentialing_timeline_events(payer_id)
    documents = await list_credentialing_documents(
        practice_id=payer["practice_id"], payer_id=payer_id,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="credentialing_payer",
        resource_id=payer_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {**payer, "timeline": timeline, "documents": documents}


@router.put("/credentialing/payers/{payer_id}")
async def update_payer(
    payer_id: str,
    body: UpdatePayerRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Update a payer enrollment record."""
    existing = await get_credentialing_payer(payer_id)
    if not existing:
        raise HTTPException(404, "Payer enrollment not found")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        return existing

    payer = await update_credentialing_payer(payer_id, **updates)

    await log_audit_event(
        user_id=user["uid"],
        action="credentialing_payer_updated",
        resource_type="credentialing_payer",
        resource_id=payer_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"updated_fields": list(updates.keys())},
    )

    return payer


@router.patch("/credentialing/payers/{payer_id}/status")
async def update_payer_status(
    payer_id: str,
    body: UpdateStatusRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Update payer enrollment status with automatic date/timeline tracking."""
    valid_statuses = ("not_started", "gathering_docs", "application_submitted", "pending", "credentialed", "denied")
    if body.status not in valid_statuses:
        raise HTTPException(400, f"Invalid status. Must be one of: {', '.join(valid_statuses)}")

    existing = await get_credentialing_payer(payer_id)
    if not existing:
        raise HTTPException(404, "Payer enrollment not found")

    old_status = existing["status"]
    updates: dict = {"status": body.status}

    # Auto-set date fields based on status transition
    if body.status == "application_submitted" and old_status != "application_submitted":
        updates["application_submitted_at"] = "now()"
    elif body.status == "credentialed":
        updates["credentialed_at"] = "now()"
    elif body.status == "denied":
        updates["denied_at"] = "now()"
        if body.denial_reason:
            updates["denial_reason"] = body.denial_reason

    # Handle timestamptz 'now()' — need to set via raw SQL workaround
    # Instead, use Python datetime
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    for key in ("application_submitted_at", "credentialed_at", "denied_at"):
        if key in updates and updates[key] == "now()":
            updates[key] = now

    payer = await update_credentialing_payer(payer_id, **updates)

    # Auto-create timeline event for status change
    timeline_event_type = "status_change"
    if body.status == "denied":
        timeline_event_type = "denial_received"
    elif body.status == "credentialed":
        timeline_event_type = "approval_received"
    elif body.status == "application_submitted":
        timeline_event_type = "application_sent"

    description = f"Status changed from {old_status} to {body.status}"
    if body.denial_reason:
        description += f": {body.denial_reason}"

    await create_credentialing_timeline_event(
        payer_id=payer_id,
        event_type=timeline_event_type,
        description=description,
        created_by=user["uid"],
        metadata={"old_status": old_status, "new_status": body.status},
    )

    await log_audit_event(
        user_id=user["uid"],
        action="credentialing_status_changed",
        resource_type="credentialing_payer",
        resource_id=payer_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"old_status": old_status, "new_status": body.status},
    )

    return payer


@router.delete("/credentialing/payers/{payer_id}")
async def delete_payer(
    payer_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Delete a payer enrollment record."""
    existing = await get_credentialing_payer(payer_id)
    if not existing:
        raise HTTPException(404, "Payer enrollment not found")

    deleted = await delete_credentialing_payer(payer_id)
    if not deleted:
        raise HTTPException(500, "Failed to delete payer enrollment")

    await log_audit_event(
        user_id=user["uid"],
        action="credentialing_payer_deleted",
        resource_type="credentialing_payer",
        resource_id=payer_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"payer_name": existing["payer_name"]},
    )

    return {"status": "deleted", "id": payer_id}


# ---------------------------------------------------------------------------
# Document Endpoints
# ---------------------------------------------------------------------------

@router.post("/credentialing/documents")
async def upload_document(
    body: UploadDocumentRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Upload a credential document with AI extraction."""
    practice = await get_practice_profile(user["uid"])
    if not practice:
        raise HTTPException(400, "Practice profile required")

    # Decode and validate file size
    file_bytes = _b64_decode(body.file_b64)
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large. Maximum {MAX_FILE_SIZE // (1024*1024)}MB.")

    # AI extraction
    extracted_data = {}
    try:
        extracted_data = await extract_credential_document(
            file_b64=body.file_b64,
            mime_type=body.mime_type,
            document_type=body.document_type,
            project_id=GCP_PROJECT_ID,
        )
    except Exception:
        logger.exception("AI extraction failed, continuing without extracted data")

    # Extract key fields from AI output
    kwargs: dict = {"extracted_data": extracted_data, "notes": body.notes}
    if extracted_data.get("expiration_date"):
        kwargs["expiration_date"] = extracted_data["expiration_date"]
    if extracted_data.get("issue_date"):
        kwargs["issue_date"] = extracted_data["issue_date"]
    if extracted_data.get("issuing_authority") or extracted_data.get("carrier_name") or extracted_data.get("board_name"):
        kwargs["issuing_authority"] = (
            extracted_data.get("issuing_authority")
            or extracted_data.get("carrier_name")
            or extracted_data.get("board_name")
        )
    doc_number = (
        extracted_data.get("document_number")
        or extracted_data.get("license_number")
        or extracted_data.get("policy_number")
        or extracted_data.get("dea_number")
    )
    if doc_number:
        kwargs["document_number"] = doc_number

    doc = await create_credentialing_document(
        practice_id=practice["id"],
        clinician_id=user["uid"],
        document_type=body.document_type,
        file_name=body.file_name,
        mime_type=body.mime_type,
        file_data=file_bytes,
        payer_id=body.payer_id,
        **kwargs,
    )

    # If linked to a payer, create timeline event
    if body.payer_id:
        await create_credentialing_timeline_event(
            payer_id=body.payer_id,
            event_type="document_uploaded",
            description=f"Uploaded {body.document_type}: {body.file_name}",
            created_by=user["uid"],
        )

    await log_audit_event(
        user_id=user["uid"],
        action="credentialing_document_uploaded",
        resource_type="credentialing_document",
        resource_id=doc["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"document_type": body.document_type, "has_extraction": bool(extracted_data)},
    )

    return doc


@router.get("/credentialing/documents")
async def list_documents(
    request: Request,
    payer_id: str | None = None,
    document_type: str | None = None,
    user: dict = Depends(require_practice_member("owner")),
):
    """List credential documents."""
    practice = await get_practice_profile(user["uid"])
    if not practice:
        return {"documents": [], "count": 0}

    docs = await list_credentialing_documents(
        practice_id=practice["id"],
        clinician_id=user["uid"],
        payer_id=payer_id,
        document_type=document_type,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="credentialing_documents",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"count": len(docs)},
    )

    return {"documents": docs, "count": len(docs)}


@router.get("/credentialing/documents/{doc_id}")
async def get_document(
    doc_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Get a credential document metadata."""
    doc = await get_credentialing_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="credentialing_document",
        resource_id=doc_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return doc


@router.get("/credentialing/documents/{doc_id}/download")
async def download_document(
    doc_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Download a credential document file."""
    doc = await get_credentialing_document_file(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    if not doc.get("file_data_b64"):
        raise HTTPException(404, "Document file not found")

    await log_audit_event(
        user_id=user["uid"],
        action="downloaded",
        resource_type="credentialing_document",
        resource_id=doc_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    file_bytes = base64.b64decode(doc["file_data_b64"])
    return Response(
        content=file_bytes,
        media_type=doc["mime_type"],
        headers={"Content-Disposition": f'attachment; filename="{doc["file_name"]}"'},
    )


@router.delete("/credentialing/documents/{doc_id}")
async def delete_document_endpoint(
    doc_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Delete a credential document."""
    existing = await get_credentialing_document(doc_id)
    if not existing:
        raise HTTPException(404, "Document not found")

    deleted = await delete_credentialing_document(doc_id)
    if not deleted:
        raise HTTPException(500, "Failed to delete document")

    await log_audit_event(
        user_id=user["uid"],
        action="credentialing_document_deleted",
        resource_type="credentialing_document",
        resource_id=doc_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"document_type": existing["document_type"]},
    )

    return {"status": "deleted", "id": doc_id}


# ---------------------------------------------------------------------------
# Timeline Endpoints
# ---------------------------------------------------------------------------

@router.post("/credentialing/payers/{payer_id}/timeline")
async def add_timeline_event(
    payer_id: str,
    body: AddTimelineEventRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Add a manual timeline event to a payer enrollment."""
    payer = await get_credentialing_payer(payer_id)
    if not payer:
        raise HTTPException(404, "Payer enrollment not found")

    event = await create_credentialing_timeline_event(
        payer_id=payer_id,
        event_type=body.event_type,
        description=body.description,
        created_by=user["uid"],
        metadata=body.metadata,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="credentialing_timeline_event_created",
        resource_type="credentialing_timeline_event",
        resource_id=event["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"payer_id": payer_id, "event_type": body.event_type},
    )

    return event


@router.get("/credentialing/payers/{payer_id}/timeline")
async def get_timeline(
    payer_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Get timeline events for a payer enrollment."""
    payer = await get_credentialing_payer(payer_id)
    if not payer:
        raise HTTPException(404, "Payer enrollment not found")

    events = await list_credentialing_timeline_events(payer_id)

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="credentialing_timeline",
        resource_id=payer_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"count": len(events)},
    )

    return {"events": events, "count": len(events)}


# ---------------------------------------------------------------------------
# AI Endpoints
# ---------------------------------------------------------------------------

@router.post("/credentialing/payers/{payer_id}/draft-followup")
async def draft_followup(
    payer_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """AI-generate a follow-up message for a pending application."""
    payer = await get_credentialing_payer(payer_id)
    if not payer:
        raise HTTPException(404, "Payer enrollment not found")

    practice = await get_practice_profile(user["uid"])
    if not practice:
        raise HTTPException(400, "Practice profile required")

    timeline = await list_credentialing_timeline_events(payer_id)
    result = await draft_followup_message(payer, timeline, practice)

    await log_audit_event(
        user_id=user["uid"],
        action="credentialing_followup_drafted",
        resource_type="credentialing_payer",
        resource_id=payer_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return result


@router.post("/credentialing/generate-caqh")
async def generate_caqh(
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """AI-generate CAQH profile text from existing practice data."""
    practice = await get_practice_profile(user["uid"])
    if not practice:
        raise HTTPException(400, "Practice profile required")

    # Get all credential documents for context
    docs = await list_credentialing_documents(
        practice_id=practice["id"], clinician_id=user["uid"],
    )

    result = await generate_caqh_profile_text(practice, docs)

    await log_audit_event(
        user_id=user["uid"],
        action="credentialing_caqh_generated",
        resource_type="credentialing",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return result
