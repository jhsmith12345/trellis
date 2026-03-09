"""Authorization tracking endpoints for insurance prior authorizations.

Module 1F: Authorization Tracking — CRUD for authorizations, integration
with superbill generation, and dashboard warnings for expiring/low-session
authorizations.

HIPAA Access Control:
  - All endpoints require clinician role (require_role("clinician"))
  - All reads and writes logged to audit_events

Endpoints:
  - POST /api/authorizations                    — create authorization
  - GET  /api/authorizations/warnings           — expiring + low session auths
  - GET  /api/authorizations/client/{client_id} — list all auths for a client
  - GET  /api/authorizations/{auth_id}          — get single auth
  - PUT  /api/authorizations/{auth_id}          — update auth
  - DELETE /api/authorizations/{auth_id}        — delete auth
"""
import logging
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import require_role, require_practice_member

sys.path.insert(0, "../shared")
from db import (
    get_pool,
    create_authorization,
    get_authorization,
    get_client_authorizations,
    update_authorization,
    delete_authorization,
    get_expiring_authorizations,
    get_low_session_authorizations,
    log_audit_event,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class CreateAuthorizationRequest(BaseModel):
    client_id: str
    payer_name: str
    auth_number: str | None = None
    authorized_sessions: int | None = None
    cpt_codes: list[str] | None = None
    diagnosis_codes: list[str] | None = None
    start_date: str
    end_date: str
    notes: str | None = None


class UpdateAuthorizationRequest(BaseModel):
    payer_name: str | None = None
    auth_number: str | None = None
    authorized_sessions: int | None = None
    cpt_codes: list[str] | None = None
    diagnosis_codes: list[str] | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: str | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/authorizations")
async def create_auth(
    body: CreateAuthorizationRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Create a new authorization. Clinician only."""
    auth = await create_authorization(
        client_id=body.client_id,
        clinician_id=user["uid"],
        payer_name=body.payer_name,
        auth_number=body.auth_number,
        authorized_sessions=body.authorized_sessions,
        cpt_codes=body.cpt_codes,
        diagnosis_codes=body.diagnosis_codes,
        start_date=body.start_date,
        end_date=body.end_date,
        notes=body.notes,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="authorization_created",
        resource_type="authorization",
        resource_id=auth["id"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "client_id": body.client_id,
            "payer_name": body.payer_name,
            "authorized_sessions": body.authorized_sessions,
        },
    )

    return auth


@router.get("/authorizations/warnings")
async def get_auth_warnings(
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Get all authorization warnings: expiring soon + low sessions remaining."""
    expiring = await get_expiring_authorizations(days=14)
    low_sessions = await get_low_session_authorizations(remaining=3)

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="authorization_warnings",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "expiring_count": len(expiring),
            "low_session_count": len(low_sessions),
        },
    )

    return {
        "expiring": expiring,
        "low_sessions": low_sessions,
    }


@router.get("/authorizations/client/{client_id}")
async def list_client_authorizations(
    client_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """List all authorizations for a client. Clinician only."""
    auths = await get_client_authorizations(client_id)

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="client_authorizations",
        resource_id=client_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"count": len(auths)},
    )

    return {"authorizations": auths, "count": len(auths)}


@router.get("/authorizations/{auth_id}")
async def get_auth(
    auth_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Get a single authorization. Clinician only."""
    auth = await get_authorization(auth_id)
    if not auth:
        raise HTTPException(404, "Authorization not found")

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="authorization",
        resource_id=auth_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return auth


@router.put("/authorizations/{auth_id}")
async def update_auth(
    auth_id: str,
    body: UpdateAuthorizationRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Update an authorization. Clinician only. Only active/pending auths can be updated."""
    existing = await get_authorization(auth_id)
    if not existing:
        raise HTTPException(404, "Authorization not found")

    if existing["status"] not in ("active", "pending"):
        raise HTTPException(400, "Only active or pending authorizations can be updated")

    # Validate status if provided
    if body.status and body.status not in ("active", "expired", "exhausted", "pending"):
        raise HTTPException(400, "Invalid status")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        return existing

    auth = await update_authorization(auth_id, **updates)

    await log_audit_event(
        user_id=user["uid"],
        action="authorization_updated",
        resource_type="authorization",
        resource_id=auth_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"updated_fields": list(updates.keys())},
    )

    return auth


@router.delete("/authorizations/{auth_id}")
async def delete_auth(
    auth_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Delete an authorization. Clinician only."""
    existing = await get_authorization(auth_id)
    if not existing:
        raise HTTPException(404, "Authorization not found")

    deleted = await delete_authorization(auth_id)
    if not deleted:
        raise HTTPException(500, "Failed to delete authorization")

    await log_audit_event(
        user_id=user["uid"],
        action="authorization_deleted",
        resource_type="authorization",
        resource_id=auth_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "client_id": existing["client_id"],
            "payer_name": existing["payer_name"],
        },
    )

    return {"status": "deleted", "id": auth_id}
