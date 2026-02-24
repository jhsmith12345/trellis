"""HTTP client for relay -> API service calls.

The relay service makes HTTP calls to the API service (localhost:8080) for:
- Fetching practice profile (insurance list, rates, clinician info)
- Fetching available appointment slots
- Booking appointments
"""
import logging
from datetime import datetime, timedelta

import httpx

from config import API_BASE_URL

logger = logging.getLogger(__name__)

# Timeout for API calls (seconds)
_TIMEOUT = 15.0


async def get_practice_profile(token: str | None = None, clinician_uid: str | None = None) -> dict | None:
    """Fetch the practice profile from the API service.

    Args:
        token: Bearer token for authentication (client's token, forwarded)
        clinician_uid: Optional clinician UID to get a specific clinician's merged profile

    Returns the practice profile dict or None if not found/error.
    """
    try:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        params = {}
        if clinician_uid:
            params["clinician_uid"] = clinician_uid

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{API_BASE_URL}/api/practice-profile",
                headers=headers,
                params=params,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("exists"):
                    return data
            logger.warning("Practice profile not found or error: %s", resp.status_code)
            return None
    except Exception as e:
        logger.error("Failed to fetch practice profile: %s: %s", type(e).__name__, e)
        return None


async def get_available_slots(
    clinician_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
    token: str | None = None,
) -> list[dict]:
    """Fetch available appointment slots from the scheduling API.

    Args:
        clinician_id: The clinician's Firebase UID
        start_date: ISO date string for range start (defaults to today)
        end_date: ISO date string for range end (defaults to 14 days out)
        token: Bearer token for authentication

    Returns:
        List of slot dicts with 'start' and 'end' ISO datetime strings.
    """
    if not start_date:
        start_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    if not end_date:
        end_date = (datetime.now() + timedelta(days=14)).replace(
            hour=23, minute=59, second=59
        ).isoformat()

    try:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{API_BASE_URL}/api/appointments/slots",
                params={
                    "clinician_id": clinician_id,
                    "start": start_date,
                    "end": end_date,
                    "type": "assessment",
                },
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("slots", [])
            logger.warning("Failed to fetch slots: %s %s", resp.status_code, resp.text)
            return []
    except Exception as e:
        logger.error("Failed to fetch available slots: %s: %s", type(e).__name__, e)
        return []


async def book_appointment(
    client_id: str,
    client_email: str,
    client_name: str,
    clinician_id: str,
    clinician_email: str,
    scheduled_at: str,
    duration_minutes: int = 60,
    token: str | None = None,
) -> dict | None:
    """Book an appointment via the scheduling API.

    Args:
        client_id: Client's Firebase UID
        client_email: Client's email
        client_name: Client's display name
        clinician_id: Clinician's Firebase UID
        clinician_email: Clinician's email
        scheduled_at: ISO datetime for appointment start
        duration_minutes: Appointment duration (default 60 for intake assessment)
        token: Bearer token for authentication

    Returns:
        Dict with appointment details (id, scheduled_at, meet_link) or None on error.
    """
    try:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        body = {
            "client_id": client_id,
            "client_email": client_email,
            "client_name": client_name,
            "clinician_id": clinician_id,
            "clinician_email": clinician_email,
            "type": "assessment",
            "scheduled_at": scheduled_at,
            "duration_minutes": duration_minutes,
        }

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{API_BASE_URL}/api/appointments",
                json=body,
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                appointments = data.get("appointments", [])
                if appointments:
                    return appointments[0]
            logger.warning("Failed to book appointment: %s %s", resp.status_code, resp.text)
            return None
    except Exception as e:
        logger.error("Failed to book appointment: %s: %s", type(e).__name__, e)
        return None
