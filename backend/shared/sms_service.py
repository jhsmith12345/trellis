"""HTTP client for sending SMS reminders.

Sends text reminders via an external SMS endpoint. Graceful no-op if
SMS isn't configured or enabled.
"""
import logging

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)

_client: httpx.AsyncClient | None = None


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=_TIMEOUT)
    return _client


async def close():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


async def send_sms_reminder(
    api_key: str,
    service_url: str,
    to: str,
    message: str,
    message_type: str = "appointment_reminder",
    appointment_id: str | None = None,
) -> bool:
    """Send an SMS via the billing service.

    Returns True if sent successfully, False otherwise.
    Never raises — failures are logged and swallowed.
    """
    url = f"{service_url.rstrip('/')}/sms/send"
    try:
        client = await _get_client()
        resp = await client.post(
            url,
            json={
                "to": to,
                "message": message,
                "message_type": message_type,
                "appointment_id": appointment_id,
            },
            headers={"X-API-Key": api_key},
        )
        if resp.status_code == 503:
            logger.debug("SMS service not configured on billing server")
            return False
        resp.raise_for_status()
        data = resp.json()
        return data.get("success", False)
    except httpx.TimeoutException:
        logger.warning("SMS service timeout: %s", url)
        return False
    except httpx.HTTPStatusError as e:
        logger.warning("SMS service HTTP error: %s", e.response.status_code)
        return False
    except Exception as e:
        logger.warning("SMS service error: %s", e)
        return False
