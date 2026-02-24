"""Firebase JWT verification for WebSocket relay.

Validates Firebase ID tokens using firebase-admin SDK.
In DEV_MODE, tokens are decoded without signature verification.
"""
import json
import base64
import logging
import os

from config import DEV_MODE

logger = logging.getLogger(__name__)

if DEV_MODE:
    logger.warning(
        "DEV_MODE is ON — Firebase token verification is DISABLED in relay. "
        "Do NOT use this in production."
    )
else:
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


def verify_token(token: str) -> dict:
    """Verify a Firebase ID token and return the decoded claims.

    Returns dict with at least 'uid' and 'email' keys.
    Raises ValueError if the token is invalid.
    """
    if DEV_MODE:
        try:
            decoded = _decode_jwt_payload(token)
            uid = decoded.get("user_id") or decoded.get("sub", "")
            logger.info("DEV_MODE: accepted token for uid=%s", uid)
            return {"uid": uid, "email": decoded.get("email", "")}
        except Exception as e:
            raise ValueError(f"Invalid token format: {e}")

    try:
        decoded = firebase_auth.verify_id_token(token)
        return {"uid": decoded["uid"], "email": decoded.get("email", "")}
    except Exception as e:
        raise ValueError(f"Invalid or expired token: {e}")
