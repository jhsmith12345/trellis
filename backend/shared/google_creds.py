"""Credential resolution for Google API access.

Resolution order:
1. Per-clinician OAuth 2.0 (refresh token stored in DB)
2. Service account delegation fallback (if ALLOW_SA_FALLBACK=1)

This module is the single source of truth for obtaining Google credentials
throughout the backend. Both gcal.py and mailer.py call into this.
"""
import json
import base64
import logging
import os

from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

logger = logging.getLogger(__name__)

# SA config (fallback)
SA_KEY_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "sa-key.json")
SA_KEY_JSON = os.getenv("SA_KEY_JSON", "")
ALLOW_SA_FALLBACK = os.getenv("ALLOW_SA_FALLBACK", "1").lower() in ("1", "true", "yes")

# OAuth config
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
TOKEN_URI = "https://oauth2.googleapis.com/token"


class GoogleNotConnectedError(Exception):
    """Clinician has not connected their Google account via OAuth."""
    pass


class GoogleTokenRevokedError(Exception):
    """Clinician's OAuth refresh token has been revoked or expired."""
    pass


def _get_sa_credentials(scopes: list[str], subject_email: str) -> service_account.Credentials:
    """Build SA delegated credentials (legacy path)."""
    if SA_KEY_JSON:
        key_data = json.loads(base64.b64decode(SA_KEY_JSON))
        creds = service_account.Credentials.from_service_account_info(key_data, scopes=scopes)
    else:
        creds = service_account.Credentials.from_service_account_file(SA_KEY_PATH, scopes=scopes)
    return creds.with_subject(subject_email)


def _build_oauth_credentials(refresh_token: str, scopes: list[str]) -> Credentials:
    """Build OAuth2 credentials from a refresh token."""
    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri=TOKEN_URI,
        client_id=GOOGLE_OAUTH_CLIENT_ID,
        client_secret=GOOGLE_OAUTH_CLIENT_SECRET,
        scopes=scopes,
    )
    # Force an immediate refresh to get an access token
    try:
        creds.refresh(Request())
    except Exception as e:
        error_str = str(e).lower()
        if "invalid_grant" in error_str or "token has been" in error_str:
            raise GoogleTokenRevokedError(
                "Google OAuth token has been revoked. Please reconnect your Google account."
            ) from e
        raise
    return creds


async def get_google_credentials(
    clinician_email: str = "",
    clinician_uid: str | None = None,
    scopes: list[str] | None = None,
) -> Credentials | service_account.Credentials:
    """Resolve Google credentials for a clinician.

    Tries OAuth first (if clinician has connected), then SA delegation fallback.

    Args:
        clinician_email: Clinician's email (used for SA delegation fallback)
        clinician_uid: Clinician's Firebase UID (preferred for OAuth lookup)
        scopes: OAuth scopes needed

    Returns:
        Google credentials object (either OAuth or SA-delegated)

    Raises:
        GoogleNotConnectedError: No OAuth token and SA fallback disabled
        GoogleTokenRevokedError: OAuth token was revoked by the user
    """
    if scopes is None:
        scopes = [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/gmail.send",
        ]

    # Try OAuth first
    oauth_data = None
    if clinician_uid:
        from db import get_clinician_oauth
        oauth_data = await get_clinician_oauth(clinician_uid)
    elif clinician_email:
        from db import get_clinician_oauth_by_email
        oauth_data = await get_clinician_oauth_by_email(clinician_email)

    if oauth_data and oauth_data.get("google_refresh_token_enc"):
        from token_encryption import decrypt_token
        try:
            refresh_token = decrypt_token(oauth_data["google_refresh_token_enc"])
        except Exception:
            # Token decryption failed — clear it and fall through to SA
            logger.error("Failed to decrypt OAuth token for clinician, clearing stored token")
            if clinician_uid:
                from db import clear_clinician_oauth
                await clear_clinician_oauth(clinician_uid)
            raise GoogleTokenRevokedError("Stored OAuth token could not be decrypted")

        try:
            return _build_oauth_credentials(refresh_token, scopes)
        except GoogleTokenRevokedError:
            # Clear the revoked token from DB
            if clinician_uid:
                from db import clear_clinician_oauth
                await clear_clinician_oauth(clinician_uid)
            raise

    # Fall back to SA delegation
    subject = clinician_email
    if not subject and oauth_data:
        subject = oauth_data.get("google_email", "")
    if not subject and clinician_uid:
        from db import get_clinician
        clinician = await get_clinician(clinician_uid)
        if clinician:
            subject = clinician.get("email", "")

    if subject and ALLOW_SA_FALLBACK:
        logger.debug("Using SA delegation fallback for clinician")
        return _get_sa_credentials(scopes, subject)

    raise GoogleNotConnectedError(
        "Google account not connected. Please connect your Google account in Settings."
    )
