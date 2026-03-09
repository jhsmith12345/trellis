"""Telnyx SMS integration for the billing service.

Sends SMS messages via the Telnyx Messaging API. Uses httpx instead of
the Telnyx SDK to keep dependencies minimal.
"""
import logging

import httpx

from config import TELNYX_API_KEY, TELNYX_FROM_NUMBER

logger = logging.getLogger(__name__)

_TELNYX_MSG_URL = "https://api.telnyx.com/v2/messages"

_client: httpx.AsyncClient | None = None


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=10.0))
    return _client


async def close():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


def is_configured() -> bool:
    """Check if Telnyx SMS credentials are present."""
    return bool(TELNYX_API_KEY and TELNYX_FROM_NUMBER)


async def send_sms(to: str, text: str) -> dict:
    """Send an SMS message via Telnyx.

    Args:
        to: E.164 phone number (e.g. +15551234567).
        text: Message body (160 chars recommended for single segment).

    Returns:
        Dict with 'success', 'message_id', and 'error' keys.
    """
    if not is_configured():
        return {"success": False, "message_id": None, "error": "Telnyx not configured"}

    client = await _get_client()
    try:
        resp = await client.post(
            _TELNYX_MSG_URL,
            json={
                "from": TELNYX_FROM_NUMBER,
                "to": to,
                "text": text,
            },
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
        msg_id = data.get("id")
        logger.info("SMS sent successfully, telnyx_id=%s", msg_id)
        return {"success": True, "message_id": msg_id, "error": None}
    except httpx.HTTPStatusError as e:
        error_msg = e.response.text[:200] if e.response else str(e)
        logger.warning("Telnyx SMS HTTP error: %s", error_msg)
        return {"success": False, "message_id": None, "error": error_msg}
    except Exception as e:
        logger.warning("Telnyx SMS error: %s", e)
        return {"success": False, "message_id": None, "error": str(e)}
