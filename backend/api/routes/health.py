"""Comprehensive health check endpoint for deployment verification.

POST /api/health — verifies all integrations:
  - Database connection (Cloud SQL)
  - Firebase Auth configuration
  - Google Calendar API access
  - Gmail API access
  - Google Drive API access
  - Speech-to-Text API access

Returns status for each check. No auth required — this is used during
initial deployment to verify everything is wired up correctly.

Does NOT expose any PHI or sensitive data.
"""
import logging
import os
import sys
import time

from fastapi import APIRouter

sys.path.insert(0, "../shared")

logger = logging.getLogger(__name__)

router = APIRouter()


async def _check_database() -> dict:
    """Test database connectivity."""
    try:
        from db import get_pool
        pool = await get_pool()
        row = await pool.fetchrow("SELECT 1 AS ok, version() AS version")
        return {
            "status": "ok",
            "message": "Connected to PostgreSQL",
            "version": row["version"].split(",")[0] if row else "unknown",
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _check_firebase() -> dict:
    """Test Firebase Admin SDK initialization."""
    try:
        import firebase_admin
        from firebase_admin import auth as firebase_auth

        # Check if app is initialized
        app = firebase_admin.get_app()
        project_id = app.project_id or os.getenv("GCP_PROJECT_ID", "unknown")

        # Try listing users (limit 1) to verify credentials work
        page = firebase_auth.list_users(max_results=1)
        user_count = len(page.users)

        return {
            "status": "ok",
            "message": f"Firebase Auth connected (project: {project_id})",
            "has_users": user_count > 0,
        }
    except ValueError:
        # Firebase not initialized — likely DEV_MODE
        dev_mode = os.getenv("DEV_MODE", "").lower() in ("1", "true", "yes")
        if dev_mode:
            return {
                "status": "warning",
                "message": "DEV_MODE enabled — Firebase SDK not initialized (JWT verification disabled)",
            }
        return {"status": "error", "message": "Firebase Admin SDK not initialized"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _check_calendar() -> dict:
    """Test Google Calendar API access via service account delegation."""
    try:
        from gcal import _get_credentials
        from googleapiclient.discovery import build
        import os

        sender = os.getenv("SENDER_EMAIL", "")
        if not sender:
            return {"status": "warning", "message": "SENDER_EMAIL not set — Calendar health check skipped"}
        creds = _get_credentials(sender)
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        # List calendars to verify access
        result = service.calendarList().list(maxResults=1).execute()
        return {
            "status": "ok",
            "message": "Calendar API accessible via domain-wide delegation",
        }
    except FileNotFoundError:
        return {"status": "error", "message": "Service account key file not found"}
    except Exception as e:
        msg = str(e)
        if "delegation" in msg.lower() or "subject" in msg.lower():
            return {"status": "error", "message": "Domain-wide delegation not configured for Calendar scope"}
        return {"status": "error", "message": msg[:200]}


def _check_gmail() -> dict:
    """Test Gmail API access via service account delegation."""
    try:
        from mailer import _get_gmail_service
        service = _get_gmail_service()
        # Get profile (doesn't send anything)
        profile = service.users().getProfile(userId="me").execute()
        return {
            "status": "ok",
            "message": f"Gmail API accessible (sender: {profile.get('emailAddress', 'unknown')})",
        }
    except FileNotFoundError:
        return {"status": "error", "message": "Service account key file not found"}
    except Exception as e:
        msg = str(e)
        if "delegation" in msg.lower() or "subject" in msg.lower():
            return {"status": "error", "message": "Domain-wide delegation not configured for Gmail scope"}
        return {"status": "error", "message": msg[:200]}


def _check_drive() -> dict:
    """Test Google Drive API access via service account delegation."""
    try:
        from gcal import _get_credentials
        from googleapiclient.discovery import build
        import os

        sender = os.getenv("SENDER_EMAIL", "")
        if not sender:
            return {"status": "warning", "message": "SENDER_EMAIL not set — Drive health check skipped"}
        creds = _get_credentials(sender)
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        # List files (limit 1) to verify access
        result = service.files().list(pageSize=1, fields="files(id,name)").execute()
        return {
            "status": "ok",
            "message": "Drive API accessible via domain-wide delegation",
        }
    except FileNotFoundError:
        return {"status": "error", "message": "Service account key file not found"}
    except Exception as e:
        msg = str(e)
        if "delegation" in msg.lower() or "subject" in msg.lower():
            return {"status": "error", "message": "Domain-wide delegation not configured for Drive scope"}
        return {"status": "error", "message": msg[:200]}


def _check_speech() -> dict:
    """Test Speech-to-Text API access."""
    try:
        from google.cloud.speech_v2 import SpeechClient
        from google.cloud.speech_v2.types import cloud_speech

        project_id = os.getenv("GCP_PROJECT_ID", "")
        if not project_id:
            return {"status": "warning", "message": "GCP_PROJECT_ID not set — cannot verify Speech API"}

        client = SpeechClient()
        # List recognizers to test API access (doesn't process any audio)
        parent = f"projects/{project_id}/locations/global"
        request = cloud_speech.ListRecognizersRequest(parent=parent)
        response = client.list_recognizers(request=request)
        return {
            "status": "ok",
            "message": f"Speech-to-Text V2 API accessible (project: {project_id})",
        }
    except Exception as e:
        msg = str(e)
        if "permission" in msg.lower() or "denied" in msg.lower():
            return {"status": "error", "message": "Speech-to-Text API not enabled or permission denied"}
        if "not found" in msg.lower():
            return {"status": "error", "message": "Speech-to-Text API not enabled for this project"}
        return {"status": "error", "message": msg[:200]}


async def _check_oauth_config() -> dict:
    """Check Google OAuth 2.0 configuration status."""
    try:
        client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
        client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
        encryption_key = os.getenv("OAUTH_TOKEN_ENCRYPTION_KEY", "")
        allow_fallback = os.getenv("ALLOW_SA_FALLBACK", "1").lower() in ("1", "true", "yes")

        if not client_id or not client_secret:
            if allow_fallback:
                return {
                    "status": "warning",
                    "message": "OAuth not configured — using SA delegation fallback",
                }
            return {
                "status": "error",
                "message": "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set",
            }

        if not encryption_key:
            return {
                "status": "error",
                "message": "OAUTH_TOKEN_ENCRYPTION_KEY not set — cannot store OAuth tokens",
            }

        # Count clinicians with OAuth connected
        from db import get_pool
        pool = await get_pool()
        row = await pool.fetchrow(
            "SELECT count(*) AS total, "
            "count(google_refresh_token_enc) AS connected "
            "FROM clinicians"
        )
        total = row["total"] if row else 0
        connected = row["connected"] if row else 0

        return {
            "status": "ok",
            "message": f"OAuth configured ({connected}/{total} clinicians connected)",
            "sa_fallback": allow_fallback,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)[:200]}


@router.post("/health")
async def health_check():
    """Comprehensive health check verifying all integrations.

    Returns status for each subsystem: database, firebase, calendar,
    gmail, drive, speech. Overall status is 'ok' only if all checks pass.
    """
    start = time.time()

    # Run all checks
    db_result = await _check_database()
    firebase_result = _check_firebase()
    calendar_result = _check_calendar()
    gmail_result = _check_gmail()
    drive_result = _check_drive()
    speech_result = _check_speech()
    oauth_result = await _check_oauth_config()

    checks = {
        "database": db_result,
        "firebase": firebase_result,
        "calendar": calendar_result,
        "gmail": gmail_result,
        "drive": drive_result,
        "speech_to_text": speech_result,
        "google_oauth": oauth_result,
    }

    # Determine overall status
    statuses = [c["status"] for c in checks.values()]
    if all(s == "ok" for s in statuses):
        overall = "ok"
    elif any(s == "error" for s in statuses):
        overall = "degraded"
    else:
        overall = "warning"

    elapsed = round((time.time() - start) * 1000)

    return {
        "status": overall,
        "checks": checks,
        "elapsed_ms": elapsed,
    }
