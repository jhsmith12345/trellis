"""Firebase Auth middleware with role-based access control.

Access control model:
  - Clinicians can access all records (no row-level filtering).
  - Clients can only access their own records (scoped by firebase_uid).

Key dependencies:
  - get_current_user: basic JWT verification, returns decoded token dict
  - require_role(*roles): restricts endpoint to specific roles
  - get_current_user_with_role: resolves role and attaches it to user dict
  - require_owner_or_clinician(resource_type): factory that checks resource ownership
"""
import json
import base64
import logging
import os
from functools import wraps

from fastapi import HTTPException, Request, Depends

logger = logging.getLogger(__name__)

# WARNING: DEV_MODE skips token signature verification. Tokens are decoded but
# NOT verified. This MUST be disabled (unset) in production — any forged JWT
# with a valid structure would be accepted.
DEV_MODE = os.getenv("DEV_MODE", "").lower() in ("1", "true", "yes")

if DEV_MODE:
    logger.warning(
        "DEV_MODE is ON — Firebase token verification is DISABLED. "
        "Do NOT use this in production."
    )

# Initialize Firebase Admin SDK in production
if not DEV_MODE:
    import firebase_admin
    from firebase_admin import auth as firebase_auth, credentials

    if not firebase_admin._apps:
        cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_path:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app()


def _decode_jwt_payload(token: str) -> dict:
    """Decode a JWT payload without verification (dev only)."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT format")
    payload = parts[1]
    # Add padding
    payload += "=" * (4 - len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


async def get_current_user(request: Request) -> dict:
    """Verify Firebase ID token from Authorization header.

    Returns the decoded token dict with uid, email, etc.
    In DEV_MODE, decodes the JWT without signature verification.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")

    token = auth_header.removeprefix("Bearer ")

    if DEV_MODE:
        try:
            decoded = _decode_jwt_payload(token)
            logger.info("DEV_MODE: accepted token for uid=%s", decoded.get("user_id"))
            return {"uid": decoded.get("user_id", ""), "email": decoded.get("email", ""), **decoded}
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token format")

    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return decoded


def require_role(*allowed_roles: str):
    """Dependency factory that checks the user's stored role.

    Usage:
        @router.get("/admin-only")
        async def admin_endpoint(user: dict = Depends(require_role("clinician"))):
            ...
    """
    import sys
    sys.path.insert(0, "../shared")
    from db import get_user_role

    async def _check_role(request: Request) -> dict:
        user = await get_current_user(request)
        role = await get_user_role(user["uid"])

        if role is None:
            # No user record yet — allow through but mark as unregistered
            user["role"] = None
            return user

        if role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Required role: {', '.join(allowed_roles)}",
            )

        user["role"] = role
        return user

    return _check_role


async def get_current_user_with_role(request: Request) -> dict:
    """Resolve the current user AND attach their stored role.

    Unlike require_role(), this does NOT reject any role — it simply
    enriches the user dict with user["role"] (or None if unregistered).
    Use this when the endpoint is open to both roles but needs to branch
    on role for access-scoping logic.
    """
    import sys
    sys.path.insert(0, "../shared")
    from db import get_user_role

    user = await get_current_user(request)
    role = await get_user_role(user["uid"])
    user["role"] = role
    return user


def is_clinician(user: dict) -> bool:
    """Return True if the user has the clinician role."""
    return user.get("role") == "clinician"


def enforce_client_owns_resource(user: dict, resource_client_id: str | None) -> None:
    """Raise 403 if a client user tries to access a resource they don't own.

    Clinicians pass through unconditionally.
    If resource_client_id is None the resource doesn't exist (caller should 404 first).
    """
    if is_clinician(user):
        return
    if resource_client_id is None or user["uid"] != resource_client_id:
        raise HTTPException(
            status_code=403,
            detail="Access denied — you can only access your own records.",
        )


# ---------------------------------------------------------------------------
# Group practice auth helpers
# ---------------------------------------------------------------------------

async def get_clinician_record(firebase_uid: str) -> dict | None:
    """Fetch the clinician record from the clinicians table."""
    import sys
    sys.path.insert(0, "../shared")
    from db import get_clinician

    return await get_clinician(firebase_uid)


def require_practice_member(*allowed_practice_roles: str):
    """Dependency factory that verifies the user is an active clinician in a practice.

    Enriches user dict with user["clinician"] and user["practice_id"].
    Optionally restricts by practice_role (e.g., owner-only endpoints).

    Usage:
        @router.get("/team")
        async def team(user: dict = Depends(require_practice_member("owner"))):
            ...
    """
    import sys
    sys.path.insert(0, "../shared")
    from db import get_user_role, get_clinician

    async def _check_practice_member(request: Request) -> dict:
        user = await get_current_user(request)
        role = await get_user_role(user["uid"])

        if role != "clinician":
            raise HTTPException(
                status_code=403,
                detail="Access denied. Required role: clinician",
            )
        user["role"] = role

        clinician = await get_clinician(user["uid"])
        if not clinician:
            raise HTTPException(
                status_code=403,
                detail="No clinician record found. Complete practice setup first.",
            )

        if clinician["status"] != "active":
            raise HTTPException(
                status_code=403,
                detail="Clinician account is not active.",
            )

        if allowed_practice_roles and clinician["practice_role"] not in allowed_practice_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Required practice role: {', '.join(allowed_practice_roles)}",
            )

        user["clinician"] = clinician
        user["practice_id"] = clinician["practice_id"]
        return user

    return _check_practice_member


def is_owner(user: dict) -> bool:
    """Return True if the user is a practice owner."""
    clinician = user.get("clinician")
    if not clinician:
        return False
    return clinician.get("practice_role") == "owner"


async def enforce_clinician_owns_client(user: dict, client_firebase_uid: str) -> None:
    """Raise 403 if a non-owner clinician tries to access another clinician's client.

    Owners pass through unconditionally.
    Non-owners must have clients.primary_clinician_id == user["uid"].
    """
    if is_owner(user):
        return

    import sys
    sys.path.insert(0, "../shared")
    from db import get_client

    client = await get_client(client_firebase_uid)
    if not client:
        return  # Let caller handle 404

    if client.get("primary_clinician_id") and client["primary_clinician_id"] != user["uid"]:
        raise HTTPException(
            status_code=403,
            detail="Access denied — this client is assigned to another clinician.",
        )
