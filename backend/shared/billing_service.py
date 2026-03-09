"""HTTP client for communicating with the Trellis Billing Service.

The EHR makes outbound HTTPS calls to the billing service for:
  - Claim submission (POST /claims/submit)
  - Eligibility verification (POST /eligibility/verify)
  - Polling for updates (GET /claims/updates)

All methods handle errors gracefully — the billing service being unavailable
must NEVER crash or block the EHR. Failures are logged and surfaced as return
values, not exceptions.
"""
import logging
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

# Timeout configuration: connect 5s, read 30s (claim submission can be slow)
_TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)


class BillingServiceError:
    """Lightweight error container returned instead of raising."""

    def __init__(self, message: str, status_code: int | None = None):
        self.message = message
        self.status_code = status_code

    def __repr__(self):
        return f"BillingServiceError({self.message!r}, status={self.status_code})"


class BillingServiceClient:
    """Async HTTP client for the Trellis Billing Service."""

    def __init__(self):
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=_TIMEOUT)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------
    # Practice-level helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def is_connected(practice_id: str) -> bool:
        """Check if a practice has billing service configured."""
        from db import get_practice_billing_settings
        settings = await get_practice_billing_settings(practice_id)
        if not settings:
            return False
        return bool(settings.get("billing_api_key") and settings.get("billing_service_url"))

    @staticmethod
    async def get_settings(practice_id: str) -> dict | None:
        """Get billing service settings for a practice."""
        from db import get_practice_billing_settings
        return await get_practice_billing_settings(practice_id)

    # ------------------------------------------------------------------
    # Billing Service API calls
    # ------------------------------------------------------------------

    async def submit_claim(
        self, api_key: str, service_url: str, claim_data: dict
    ) -> dict | BillingServiceError:
        """POST to billing service /claims/submit.

        Returns the parsed response dict on success, or BillingServiceError on failure.
        """
        url = f"{service_url.rstrip('/')}/claims/submit"
        try:
            client = await self._get_client()
            resp = await client.post(
                url,
                json=claim_data,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if resp.status_code == 422:
                body = resp.json()
                return BillingServiceError(
                    message=f"Claim validation failed: {body.get('detail', 'Unknown')}",
                    status_code=422,
                )
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on claim submit: %s", url)
            return BillingServiceError("Billing service timeout", status_code=None)
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on claim submit: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on claim submit: %s", e)
            return BillingServiceError(f"Connection error: {e}")

    async def check_eligibility(
        self, api_key: str, service_url: str, patient_info: dict
    ) -> dict | BillingServiceError:
        """POST to billing service /eligibility/verify.

        Returns parsed eligibility result on success, or BillingServiceError.
        """
        url = f"{service_url.rstrip('/')}/eligibility/verify"
        try:
            client = await self._get_client()
            resp = await client.post(
                url,
                json=patient_info,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on eligibility check: %s", url)
            return BillingServiceError("Billing service timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on eligibility: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on eligibility: %s", e)
            return BillingServiceError(f"Connection error: {e}")

    async def get_era_for_superbill(
        self, api_key: str, service_url: str, superbill_id: str
    ) -> dict | BillingServiceError:
        """GET from billing service /era/superbill/{superbill_id}.

        Fetches ERA/payment posting data for a superbill by looking up
        the claim via external_superbill_id and returning associated ERAs.
        Returns the ERA detail dict on success, or BillingServiceError.
        """
        url = f"{service_url.rstrip('/')}/era/superbill/{superbill_id}"
        try:
            client = await self._get_client()
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if resp.status_code == 404:
                return BillingServiceError("No ERA data found", status_code=404)
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on ERA fetch: %s", url)
            return BillingServiceError("Billing service timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on ERA fetch: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on ERA fetch: %s", e)
            return BillingServiceError(f"Connection error: {e}")

    async def create_payment_link(
        self, api_key: str, service_url: str, payment_data: dict
    ) -> dict | BillingServiceError:
        """POST to billing service /payments/create-link.

        Creates a Stripe payment link for patient balance collection.
        Returns {"url": str, "amount": float, "expires_at": str} on success,
        or BillingServiceError on failure.
        """
        url = f"{service_url.rstrip('/')}/payments/create-link"
        try:
            client = await self._get_client()
            resp = await client.post(
                url,
                json=payment_data,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on create payment link: %s", url)
            return BillingServiceError("Billing service timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on create payment link: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on create payment link: %s", e)
            return BillingServiceError(f"Connection error: {e}")

    async def get_payment_status(
        self, api_key: str, service_url: str, superbill_id: str
    ) -> dict | BillingServiceError:
        """GET from billing service /payments/status/{superbill_id}.

        Returns payment status info for a superbill. If no payment link exists,
        the billing service returns 404, which we convert to a no_link status.
        Returns {"status": str, "amount_paid": float, "payment_date": str|None,
                 "link_url": str|None, "link_status": str|None} on success.
        """
        url = f"{service_url.rstrip('/')}/payments/status/{superbill_id}"
        try:
            client = await self._get_client()
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if resp.status_code == 404:
                return {"status": "no_link", "amount_paid": 0, "payment_date": None}
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on payment status: %s", url)
            return BillingServiceError("Billing service timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on payment status: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on payment status: %s", e)
            return BillingServiceError(f"Connection error: {e}")

    async def get_denials(
        self, api_key: str, service_url: str,
        category: str | None = None, payer_name: str | None = None,
    ) -> dict | BillingServiceError:
        """GET from billing service /denials.

        Returns denied claims with categories and suggestions.
        """
        url = f"{service_url.rstrip('/')}/denials"
        params: dict[str, str] = {}
        if category:
            params["category"] = category
        if payer_name:
            params["payer_name"] = payer_name
        try:
            client = await self._get_client()
            resp = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on get denials: %s", url)
            return BillingServiceError("Billing service timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on get denials: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on get denials: %s", e)
            return BillingServiceError(f"Connection error: {e}")

    async def get_denial_detail(
        self, api_key: str, service_url: str, claim_id: str,
    ) -> dict | BillingServiceError:
        """GET from billing service /denials/{claim_id}.

        Returns detailed denial info for a specific claim.
        """
        url = f"{service_url.rstrip('/')}/denials/{claim_id}"
        try:
            client = await self._get_client()
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if resp.status_code == 404:
                return BillingServiceError("Denied claim not found", status_code=404)
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on denial detail: %s", url)
            return BillingServiceError("Billing service timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on denial detail: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on denial detail: %s", e)
            return BillingServiceError(f"Connection error: {e}")

    async def resubmit_denial(
        self, api_key: str, service_url: str, claim_id: str, corrections: dict,
    ) -> dict | BillingServiceError:
        """POST to billing service /denials/{claim_id}/resubmit.

        Corrects and resubmits a denied claim.
        """
        url = f"{service_url.rstrip('/')}/denials/{claim_id}/resubmit"
        try:
            client = await self._get_client()
            resp = await client.post(
                url,
                json={"corrections": corrections},
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if resp.status_code == 404:
                return BillingServiceError("Denied claim not found", status_code=404)
            if resp.status_code == 422:
                body = resp.json()
                return BillingServiceError(
                    message=f"Resubmission validation failed: {body.get('detail', 'Unknown')}",
                    status_code=422,
                )
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on denial resubmit: %s", url)
            return BillingServiceError("Billing service timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on denial resubmit: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on denial resubmit: %s", e)
            return BillingServiceError(f"Connection error: {e}")

    async def get_denial_analytics(
        self, api_key: str, service_url: str,
    ) -> dict | BillingServiceError:
        """GET from billing service /denials/analytics.

        Returns denial analytics (rates, categories, trends).
        """
        url = f"{service_url.rstrip('/')}/denials/analytics"
        try:
            client = await self._get_client()
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on denial analytics: %s", url)
            return BillingServiceError("Billing service timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on denial analytics: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on denial analytics: %s", e)
            return BillingServiceError(f"Connection error: {e}")

    async def poll_updates(
        self, api_key: str, service_url: str, since: str
    ) -> dict | BillingServiceError:
        """GET from billing service /claims/updates?since=<iso_timestamp>.

        Returns {"events": [...], "count": N, "last_event_at": ...} on success.
        """
        url = f"{service_url.rstrip('/')}/claims/updates"
        try:
            client = await self._get_client()
            resp = await client.get(
                url,
                params={"since": since},
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            logger.warning("Billing service timeout on poll updates: %s", url)
            return BillingServiceError("Billing service timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Billing service HTTP error on poll: %s %s",
                e.response.status_code, e.response.text[:200],
            )
            return BillingServiceError(
                f"Billing service returned {e.response.status_code}",
                status_code=e.response.status_code,
            )
        except Exception as e:
            logger.warning("Billing service connection error on poll: %s", e)
            return BillingServiceError(f"Connection error: {e}")


# Module-level singleton
billing_client = BillingServiceClient()
