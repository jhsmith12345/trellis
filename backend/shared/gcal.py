"""Google Calendar + Drive API — OAuth 2.0 with SA delegation fallback.

Creates calendar events with Google Meet links and manages Drive files
(recordings). Uses per-clinician OAuth when available, falls back to
service account delegation when ALLOW_SA_FALLBACK=1.

Named gcal.py to avoid shadowing Python's built-in calendar module.

## Recording Configuration (Deployment Step)

Google Meet auto-recording is NOT controllable via the Calendar API.
It must be enabled at the **Google Workspace Admin** level:

  1. Google Admin Console → Apps → Google Workspace → Google Meet
  2. Meet video settings → Recording → "Allow recording"
  3. Under "Auto-recording", select "Record all meetings automatically"
     (or instruct clinician to start recording manually at each session)

The Calendar API `conferenceData` only creates the Meet link — it cannot
set recording preferences per-event. Auto-recording is an org-wide or
OU-wide Workspace Admin setting.

When recording is enabled, Meet saves the recording to the organizer's
Google Drive under "Meet Recordings" folder. The recording pipeline in
sessions.py polls Drive for new recordings and matches them to appointments.
"""
import io
import logging
import os
import re
import uuid

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

logger = logging.getLogger(__name__)

SA_KEY_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "sa-key.json")
SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
]

# SA key JSON can be provided as env var (base64-encoded) for Cloud Run
SA_KEY_JSON = os.getenv("SA_KEY_JSON", "")


def _get_credentials(user_email: str):
    """Build delegated credentials for API access on behalf of user_email.

    Legacy function kept for health checks and backward compatibility.
    New code should use google_creds.get_google_credentials().
    """
    if SA_KEY_JSON:
        import json
        import base64
        key_data = json.loads(base64.b64decode(SA_KEY_JSON))
        creds = service_account.Credentials.from_service_account_info(
            key_data, scopes=SCOPES
        )
    else:
        creds = service_account.Credentials.from_service_account_file(
            SA_KEY_PATH, scopes=SCOPES
        )
    return creds.with_subject(user_email)


async def _resolve_creds(clinician_email: str = "", clinician_uid: str | None = None):
    """Resolve credentials via OAuth or SA delegation."""
    from google_creds import get_google_credentials
    return await get_google_credentials(
        clinician_email=clinician_email,
        clinician_uid=clinician_uid,
        scopes=SCOPES,
    )


def _build_calendar_service(creds):
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _build_drive_service(creds):
    return build("drive", "v3", credentials=creds, cache_discovery=False)


async def create_calendar_event(
    summary: str,
    start_dt: str,
    end_dt: str,
    attendee_emails: list[str],
    description: str = "",
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> tuple[str, str]:
    """Create a Google Calendar event with a Meet link.

    Returns:
        (meet_link, event_id) tuple
    """
    creds = await _resolve_creds(clinician_email, clinician_uid)
    service = _build_calendar_service(creds)

    event_body = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": start_dt, "timeZone": "America/Los_Angeles"},
        "end": {"dateTime": end_dt, "timeZone": "America/Los_Angeles"},
        "attendees": [{"email": e} for e in attendee_emails],
        "conferenceData": {
            "createRequest": {
                "requestId": str(uuid.uuid4()),
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
    }

    event = service.events().insert(
        calendarId="primary",
        body=event_body,
        conferenceDataVersion=1,
        sendUpdates="all",
    ).execute()

    meet_link = ""
    if event.get("conferenceData", {}).get("entryPoints"):
        for ep in event["conferenceData"]["entryPoints"]:
            if ep.get("entryPointType") == "video":
                meet_link = ep["uri"]
                break

    event_id = event["id"]
    logger.info("Calendar event created: %s (meet=%s)", event_id, meet_link)
    return meet_link, event_id


async def update_calendar_event(
    event_id: str,
    attendee_emails: list[str] | None = None,
    summary: str | None = None,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> None:
    """Update an existing calendar event (e.g. add attendees to group events)."""
    creds = await _resolve_creds(clinician_email, clinician_uid)
    service = _build_calendar_service(creds)

    event = service.events().get(calendarId="primary", eventId=event_id).execute()

    if attendee_emails is not None:
        event["attendees"] = [{"email": e} for e in attendee_emails]
    if summary is not None:
        event["summary"] = summary

    service.events().update(
        calendarId="primary",
        eventId=event_id,
        body=event,
        sendUpdates="all",
    ).execute()

    logger.info("Calendar event updated: %s", event_id)


async def delete_calendar_event(
    event_id: str,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> None:
    """Delete a calendar event and notify attendees."""
    creds = await _resolve_creds(clinician_email, clinician_uid)
    service = _build_calendar_service(creds)

    service.events().delete(
        calendarId="primary",
        eventId=event_id,
        sendUpdates="all",
    ).execute()

    logger.info("Calendar event deleted: %s", event_id)


async def get_calendar_event(
    event_id: str,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> dict | None:
    """Fetch a Calendar event by ID.

    Returns the event resource dict, or None if not found.
    """
    creds = await _resolve_creds(clinician_email, clinician_uid)
    service = _build_calendar_service(creds)
    try:
        event = service.events().get(calendarId="primary", eventId=event_id).execute()
        return event
    except Exception as e:
        logger.error("Failed to get calendar event %s: %s", event_id, e)
        return None


async def strip_conference_data(
    event_id: str,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> bool:
    """Remove conferenceData from a Calendar event so the Meet link goes dead.

    Returns True if stripped successfully, False otherwise.
    """
    creds = await _resolve_creds(clinician_email, clinician_uid)
    service = _build_calendar_service(creds)
    try:
        event = service.events().get(calendarId="primary", eventId=event_id).execute()
        if "conferenceData" not in event:
            logger.info("Event %s has no conferenceData to strip", event_id)
            return True
        del event["conferenceData"]
        service.events().update(
            calendarId="primary",
            eventId=event_id,
            body=event,
            conferenceDataVersion=1,
        ).execute()
        logger.info("Stripped conferenceData from event %s", event_id)
        return True
    except Exception as e:
        logger.error("Failed to strip conferenceData from event %s: %s", event_id, e)
        return False


def extract_meet_code(meet_link: str) -> str | None:
    """Extract the meeting code from a Google Meet link.

    Example: "https://meet.google.com/abc-defg-hij" -> "abc-defg-hij"
    """
    if not meet_link:
        return None
    match = re.search(r"meet\.google\.com/([a-z\-]+)", meet_link)
    return match.group(1) if match else None


# ---------------------------------------------------------------------------
# Drive API helpers for session recordings
# ---------------------------------------------------------------------------

async def list_recent_recordings(
    max_results: int = 50,
    since_minutes: int = 180,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> list[dict]:
    """List recent video recordings in the clinician's Drive."""
    creds = await _resolve_creds(clinician_email, clinician_uid)
    service = _build_drive_service(creds)

    from datetime import datetime, timedelta, timezone
    since_dt = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
    since_str = since_dt.strftime("%Y-%m-%dT%H:%M:%S")

    query = (
        f"mimeType contains 'video/' "
        f"and createdTime > '{since_str}' "
        f"and trashed = false"
    )

    try:
        results = service.files().list(
            q=query,
            pageSize=max_results,
            fields="files(id, name, mimeType, createdTime, webViewLink, parents, properties)",
            orderBy="createdTime desc",
        ).execute()
        files = results.get("files", [])
        logger.info("Found %d recent recording(s) in Drive", len(files))
        return files
    except Exception as e:
        logger.error("Failed to list Drive recordings: %s", e)
        return []


async def get_recording_file(
    file_id: str,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> dict | None:
    """Get metadata for a specific Drive file."""
    creds = await _resolve_creds(clinician_email, clinician_uid)
    service = _build_drive_service(creds)
    try:
        return service.files().get(
            fileId=file_id,
            fields="id, name, mimeType, createdTime, webViewLink, parents, size, properties",
        ).execute()
    except Exception as e:
        logger.error("Failed to get Drive file %s: %s", file_id, e)
        return None


async def download_recording(
    file_id: str,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> tuple[bytes, str] | None:
    """Download a recording file from Drive.

    Returns (file_bytes, mime_type) or None on failure.
    """
    creds = await _resolve_creds(clinician_email, clinician_uid)
    service = _build_drive_service(creds)
    try:
        meta = service.files().get(fileId=file_id, fields="mimeType, size").execute()
        mime_type = meta.get("mimeType", "video/mp4")
        file_size = int(meta.get("size", 0))

        logger.info(
            "Downloading recording %s (%s, %d bytes)",
            file_id, mime_type, file_size,
        )

        request = service.files().get_media(fileId=file_id)
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)

        done = False
        while not done:
            _, done = downloader.next_chunk()

        buffer.seek(0)
        return buffer.read(), mime_type
    except Exception as e:
        logger.error("Failed to download recording %s: %s", file_id, e)
        return None


async def delete_drive_file(
    file_id: str,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> bool:
    """Delete a file from Drive (used for post-transcription cleanup).

    Returns True if deleted successfully, False otherwise.
    """
    creds = await _resolve_creds(clinician_email, clinician_uid)
    service = _build_drive_service(creds)
    try:
        service.files().delete(fileId=file_id).execute()
        logger.info("Deleted Drive file: %s", file_id)
        return True
    except Exception as e:
        logger.error("Failed to delete Drive file %s: %s", file_id, e)
        return False


async def _resolve_meet_code(
    calendar_event_id: str,
    meet_link: str | None = None,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> tuple[str | None, dict | None]:
    """Extract the Meet code for an event, returning (meet_code, event_dict)."""
    event = await get_calendar_event(calendar_event_id, clinician_email, clinician_uid)
    if not event:
        logger.warning("Calendar event %s not found for recording match", calendar_event_id)
        return None, None

    meet_code = None
    conference_data = event.get("conferenceData", {})
    for ep in conference_data.get("entryPoints", []):
        if ep.get("entryPointType") == "video":
            meet_code = extract_meet_code(ep.get("uri", ""))
            break

    if not meet_code and meet_link:
        meet_code = extract_meet_code(meet_link)

    return meet_code, event


def _match_recordings_by_meet_code(
    recordings: list[dict],
    meet_code: str,
    event_summary: str = "",
) -> list[dict]:
    """Filter a list of Drive recordings to those matching a Meet code or event summary."""
    matched = []
    code_normalized = meet_code.replace("-", "")

    for recording in recordings:
        name = recording.get("name", "").lower()
        if code_normalized in name.replace("-", "").replace(" ", ""):
            matched.append(recording)

    # Fallback: match by event summary if no code matches found
    if not matched and event_summary:
        summary_lower = event_summary.lower()[:30]
        for recording in recordings:
            name = recording.get("name", "").lower()
            if summary_lower in name:
                matched.append(recording)

    return matched


async def get_all_recordings_for_event(
    calendar_event_id: str,
    meet_link: str | None = None,
    search_minutes: int = 360,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> list[dict]:
    """Find ALL recordings matching a Calendar event's Meet code.

    Returns every recording in Drive whose filename matches the Meet code,
    sorted by creation time.
    """
    meet_code, event = await _resolve_meet_code(
        calendar_event_id, meet_link, clinician_email, clinician_uid,
    )
    if not meet_code:
        logger.warning("No Meet code found for event %s", calendar_event_id)
        return []

    recordings = await list_recent_recordings(
        max_results=100,
        since_minutes=search_minutes,
        clinician_email=clinician_email,
        clinician_uid=clinician_uid,
    )

    event_summary = (event or {}).get("summary", "")
    matched = _match_recordings_by_meet_code(recordings, meet_code, event_summary)

    # Sort by creation time ascending so concatenation is in order
    matched.sort(key=lambda r: r.get("createdTime", ""))

    logger.info(
        "Found %d recording(s) for event %s (meet code: %s)",
        len(matched), calendar_event_id, meet_code,
    )
    return matched


async def get_meet_recording_for_event(
    calendar_event_id: str,
    meet_link: str | None = None,
    search_minutes: int = 180,
    clinician_email: str = "",
    clinician_uid: str | None = None,
) -> dict | None:
    """Find a single recording matching a Calendar event (legacy helper)."""
    recordings = await get_all_recordings_for_event(
        calendar_event_id, meet_link, search_minutes, clinician_email, clinician_uid,
    )
    return recordings[0] if recordings else None
