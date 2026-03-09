"""Google OAuth 2.0 routes for per-clinician account connection.

Endpoints:
  GET  /api/google/connect    — returns Google consent URL
  GET  /api/google/callback   — handles OAuth callback from Google
  POST /api/google/disconnect — revokes token and clears from DB
  GET  /api/google/status     — returns connection status
"""
import hashlib
import hmac
import json
import logging
import os
import sys
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import RedirectResponse

from auth import get_current_user, require_role

sys.path.insert(0, "../shared")
from db import (
    store_clinician_oauth,
    clear_clinician_oauth,
    get_clinician_oauth,
    log_audit_event,
    get_clinician,
)
from token_encryption import encrypt_token

logger = logging.getLogger(__name__)

router = APIRouter()

# OAuth configuration
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
GOOGLE_OAUTH_REDIRECT_URI = os.getenv(
    "GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8080/api/google/callback"
)
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")

# HMAC key for state parameter (derived from client secret for simplicity)
_STATE_SECRET = (GOOGLE_OAUTH_CLIENT_SECRET or "dev-state-secret").encode()

OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.send",
    "openid",
    "email",
]


def _sign_state(uid: str) -> str:
    """Create HMAC-signed state parameter for CSRF protection."""
    ts = str(int(time.time()))
    payload = json.dumps({"uid": uid, "ts": ts})
    sig = hmac.new(_STATE_SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}|{sig}"


def _verify_state(state: str) -> dict | None:
    """Verify and parse the state parameter. Returns payload dict or None."""
    try:
        payload_str, sig = state.rsplit("|", 1)
        expected_sig = hmac.new(_STATE_SECRET, payload_str.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        payload = json.loads(payload_str)
        # Reject states older than 10 minutes
        ts = int(payload.get("ts", 0))
        if abs(time.time() - ts) > 600:
            return None
        return payload
    except Exception:
        return None


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.get("/google/connect")
async def google_connect(
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Return the Google OAuth consent URL for the current clinician."""
    if not GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(500, "Google OAuth not configured (GOOGLE_OAUTH_CLIENT_ID missing)")

    state = _sign_state(user["uid"])
    scopes_str = " ".join(OAUTH_SCOPES)

    auth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={GOOGLE_OAUTH_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_OAUTH_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope={scopes_str}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={state}"
    )

    await log_audit_event(
        user_id=user["uid"],
        action="google_oauth_initiated",
        resource_type="clinician",
        resource_id=user["uid"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {"url": auth_url}


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
):
    """Handle the OAuth callback from Google. Exchanges code for tokens."""
    # Verify state
    payload = _verify_state(state)
    if not payload:
        raise HTTPException(400, "Invalid or expired OAuth state parameter")

    clinician_uid = payload["uid"]

    # Verify clinician exists
    clinician = await get_clinician(clinician_uid)
    if not clinician:
        raise HTTPException(400, "Clinician not found")

    # Exchange authorization code for tokens
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": GOOGLE_OAUTH_REDIRECT_URI,
            },
        )

    if token_response.status_code != 200:
        logger.error("Token exchange failed: %s", token_response.text)
        raise HTTPException(400, "Failed to exchange authorization code")

    token_data = token_response.json()
    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            400,
            "No refresh token received. This may happen if you've already connected. "
            "Please disconnect first, then reconnect."
        )

    # Get the user's email from the ID token or userinfo
    google_email = ""
    id_token_str = token_data.get("id_token")
    if id_token_str:
        # Decode JWT payload (no verification needed — we trust Google's response)
        import base64
        parts = id_token_str.split(".")
        if len(parts) >= 2:
            padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
            try:
                id_payload = json.loads(base64.urlsafe_b64decode(padded))
                google_email = id_payload.get("email", "")
            except Exception:
                pass

    if not google_email:
        # Fallback: use userinfo endpoint
        async with httpx.AsyncClient() as client:
            userinfo = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {token_data['access_token']}"},
            )
            if userinfo.status_code == 200:
                google_email = userinfo.json().get("email", "")

    # Encrypt and store the refresh token
    encrypted = encrypt_token(refresh_token)
    granted_scopes = token_data.get("scope", "").split()

    await store_clinician_oauth(
        firebase_uid=clinician_uid,
        encrypted_token=encrypted,
        google_email=google_email,
        scopes=granted_scopes,
    )

    await log_audit_event(
        user_id=clinician_uid,
        action="google_oauth_connected",
        resource_type="clinician",
        resource_id=clinician_uid,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"google_email": google_email},
    )

    logger.info("Google OAuth connected for clinician (email stored)")

    # Redirect to frontend settings page
    redirect_url = f"{FRONTEND_BASE_URL}/settings?tab=profile&google=connected"
    return RedirectResponse(url=redirect_url, status_code=302)


@router.post("/google/disconnect")
async def google_disconnect(
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Revoke Google OAuth token and clear from database."""
    oauth_data = await get_clinician_oauth(user["uid"])
    if not oauth_data or not oauth_data.get("google_refresh_token_enc"):
        raise HTTPException(400, "Google account not connected")

    # Try to revoke the token with Google
    from token_encryption import decrypt_token
    try:
        refresh_token = decrypt_token(oauth_data["google_refresh_token_enc"])
        async with httpx.AsyncClient() as client:
            revoke_resp = await client.post(
                "https://oauth2.googleapis.com/revoke",
                params={"token": refresh_token},
            )
            if revoke_resp.status_code != 200:
                logger.warning("Token revocation returned %d (may already be revoked)", revoke_resp.status_code)
    except Exception as e:
        logger.warning("Failed to revoke Google token: %s (clearing anyway)", e)

    # Clear from DB regardless
    await clear_clinician_oauth(user["uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="google_oauth_disconnected",
        resource_type="clinician",
        resource_id=user["uid"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {"status": "disconnected"}


@router.get("/google/status")
async def google_status(
    user: dict = Depends(require_role("clinician")),
):
    """Return the current Google OAuth connection status."""
    oauth_data = await get_clinician_oauth(user["uid"])
    if not oauth_data or not oauth_data.get("google_refresh_token_enc"):
        return {
            "connected": False,
            "google_email": None,
            "scopes": [],
            "connected_at": None,
        }

    return {
        "connected": True,
        "google_email": oauth_data.get("google_email"),
        "scopes": oauth_data.get("google_scopes") or [],
        "connected_at": oauth_data["google_connected_at"].isoformat() if oauth_data.get("google_connected_at") else None,
    }
