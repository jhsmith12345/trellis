"""Google Calendar + Drive API via service account domain-wide delegation.

Creates calendar events with Google Meet links and manages Drive files
(recordings). Same delegation pattern as mailer.py.
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
CALENDAR_USER = os.getenv("SENDER_EMAIL", "noreply@example.com")
SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
]

# SA key JSON can be provided as env var (base64-encoded) for Cloud Run
SA_KEY_JSON = os.getenv("SA_KEY_JSON", "")


def _get_credentials():
    """Build delegated credentials for API access."""
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
    return creds.with_subject(CALENDAR_USER)


def _get_calendar_service():
    """Build Calendar API service with delegated credentials."""
    return build("calendar", "v3", credentials=_get_credentials(), cache_discovery=False)


def _get_drive_service():
    """Build Drive API service with delegated credentials."""
    return build("drive", "v3", credentials=_get_credentials(), cache_discovery=False)


def create_calendar_event(
    summary: str,
    start_dt: str,
    end_dt: str,
    attendee_emails: list[str],
    description: str = "",
) -> tuple[str, str]:
    """Create a Google Calendar event with a Meet link.

    Args:
        summary: Event title
        start_dt: ISO 8601 datetime string for start
        end_dt: ISO 8601 datetime string for end
        attendee_emails: List of attendee email addresses
        description: Optional event description

    Returns:
        (meet_link, event_id) tuple
    """
    service = _get_calendar_service()

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


def update_calendar_event(
    event_id: str,
    attendee_emails: list[str] | None = None,
    summary: str | None = None,
) -> None:
    """Update an existing calendar event (e.g. add attendees to group events).

    Args:
        event_id: Google Calendar event ID
        attendee_emails: New full list of attendee emails (replaces existing)
        summary: New event title
    """
    service = _get_calendar_service()

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


def delete_calendar_event(event_id: str) -> None:
    """Delete a calendar event and notify attendees.

    Args:
        event_id: Google Calendar event ID
    """
    service = _get_calendar_service()

    service.events().delete(
        calendarId="primary",
        eventId=event_id,
        sendUpdates="all",
    ).execute()

    logger.info("Calendar event deleted: %s", event_id)


def get_calendar_event(event_id: str) -> dict | None:
    """Fetch a Calendar event by ID.

    Returns the event resource dict, or None if not found.
    Useful for matching recordings to appointments via event metadata.
    """
    service = _get_calendar_service()
    try:
        event = service.events().get(calendarId="primary", eventId=event_id).execute()
        return event
    except Exception as e:
        logger.error("Failed to get calendar event %s: %s", event_id, e)
        return None


def strip_conference_data(event_id: str) -> bool:
    """Remove conferenceData from a Calendar event so the Meet link goes dead.

    Used after session completion or no-show to prevent clients from
    rejoining old Meet links.

    Returns True if stripped successfully, False otherwise.
    """
    service = _get_calendar_service()
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

def list_recent_recordings(
    max_results: int = 50,
    since_minutes: int = 180,
) -> list[dict]:
    """List recent video recordings in the clinician's Drive.

    Looks for files in the "Meet Recordings" folder or any video files
    created recently. Google Meet saves recordings as .mp4 files in the
    organizer's Drive under "Meet Recordings".

    Args:
        max_results: Maximum number of files to return.
        since_minutes: Only return files created within this many minutes.

    Returns:
        List of dicts with id, name, mimeType, createdTime, webViewLink.
    """
    service = _get_drive_service()

    from datetime import datetime, timedelta, timezone
    since_dt = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
    since_str = since_dt.strftime("%Y-%m-%dT%H:%M:%S")

    # Search for video files created recently
    # Meet recordings are typically stored as video/mp4
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


def get_recording_file(file_id: str) -> dict | None:
    """Get metadata for a specific Drive file.

    Returns file resource dict or None if not found.
    """
    service = _get_drive_service()
    try:
        return service.files().get(
            fileId=file_id,
            fields="id, name, mimeType, createdTime, webViewLink, parents, size, properties",
        ).execute()
    except Exception as e:
        logger.error("Failed to get Drive file %s: %s", file_id, e)
        return None


def download_recording(file_id: str) -> tuple[bytes, str] | None:
    """Download a recording file from Drive.

    Returns (file_bytes, mime_type) or None on failure.
    """
    service = _get_drive_service()
    try:
        # Get file metadata first for mime type
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


def delete_drive_file(file_id: str) -> bool:
    """Delete a file from Drive (used for post-transcription cleanup).

    Returns True if deleted successfully, False otherwise.
    """
    service = _get_drive_service()
    try:
        service.files().delete(fileId=file_id).execute()
        logger.info("Deleted Drive file: %s", file_id)
        return True
    except Exception as e:
        logger.error("Failed to delete Drive file %s: %s", file_id, e)
        return False


def _resolve_meet_code(
    calendar_event_id: str,
    meet_link: str | None = None,
) -> tuple[str | None, dict | None]:
    """Extract the Meet code for an event, returning (meet_code, event_dict)."""
    event = get_calendar_event(calendar_event_id)
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


def get_all_recordings_for_event(
    calendar_event_id: str,
    meet_link: str | None = None,
    search_minutes: int = 360,
) -> list[dict]:
    """Find ALL recordings matching a Calendar event's Meet code.

    Returns every recording in Drive whose filename matches the Meet code,
    sorted by creation time. This captures disconnection/rejoin scenarios
    where a single session produces multiple recording fragments.

    Args:
        calendar_event_id: Google Calendar event ID
        meet_link: Optional Meet link for code-based matching
        search_minutes: How far back to search for recordings in Drive

    Returns:
        List of Drive file resource dicts, sorted by createdTime ascending.
        Empty list if no matches found.
    """
    meet_code, event = _resolve_meet_code(calendar_event_id, meet_link)
    if not meet_code:
        logger.warning("No Meet code found for event %s", calendar_event_id)
        return []

    recordings = list_recent_recordings(
        max_results=100,
        since_minutes=search_minutes,
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


def get_meet_recording_for_event(
    calendar_event_id: str,
    meet_link: str | None = None,
    search_minutes: int = 180,
) -> dict | None:
    """Find a single recording matching a Calendar event (legacy helper).

    For new code, prefer get_all_recordings_for_event() which returns all
    fragments for clustering. This returns only the first match.
    """
    recordings = get_all_recordings_for_event(
        calendar_event_id, meet_link, search_minutes,
    )
    return recordings[0] if recordings else None
