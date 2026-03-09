"""Stripe Connect client for patient payment links, account management, and webhooks.

Two modes of operation:
  - **stub** (default): Returns realistic mock responses. Active when STRIPE_SECRET_KEY is empty.
  - **live**: Calls the real Stripe API via the stripe Python SDK. Active when STRIPE_SECRET_KEY is set.

All public methods are async-safe and can be called from FastAPI route handlers.
"""
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta

from config import STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PLATFORM_FEE_PERCENT

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ConnectedAccountResult:
    """Result of creating a Stripe Connect Express account."""
    success: bool = True
    account_id: str = ""
    onboarding_url: str = ""
    charges_enabled: bool = False
    payouts_enabled: bool = False
    errors: list[dict] = field(default_factory=list)


@dataclass
class PaymentLinkResult:
    """Result of creating a Stripe Checkout Session for patient payment."""
    success: bool = True
    session_id: str = ""
    payment_link_url: str = ""
    expires_at: str = ""
    errors: list[dict] = field(default_factory=list)


@dataclass
class PaymentStatusResult:
    """Result of checking a Checkout Session / payment status."""
    success: bool = True
    status: str = ""           # pending, completed, expired
    amount_paid: float = 0.0
    paid_at: str = ""
    payment_intent_id: str = ""
    errors: list[dict] = field(default_factory=list)


@dataclass
class WebhookEvent:
    """Parsed Stripe webhook event."""
    success: bool = True
    event_type: str = ""       # e.g. checkout.session.completed
    event_id: str = ""
    data: dict = field(default_factory=dict)
    errors: list[dict] = field(default_factory=list)


# Legacy aliases kept for backward compatibility with existing route code
PaymentLinkResponse = PaymentLinkResult
PaymentStatus = PaymentStatusResult
AccountResponse = ConnectedAccountResult


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class StripeConnectClient:
    """Client for Stripe Connect payment operations.

    Operates in two modes:
      - **stub** (STRIPE_SECRET_KEY is empty): returns realistic mock data
      - **live** (STRIPE_SECRET_KEY is set): calls the Stripe API via stripe SDK
    """

    def __init__(self):
        self.secret_key = STRIPE_SECRET_KEY
        self.webhook_secret = STRIPE_WEBHOOK_SECRET
        self._mode = "live" if self.secret_key else "stub"
        self._stripe = None
        if self.is_live:
            try:
                import stripe
                stripe.api_key = self.secret_key
                self._stripe = stripe
            except ImportError:
                logger.error("stripe package not installed — falling back to stub mode")
                self._mode = "stub"
        logger.info("StripeConnectClient initialized in %s mode", self._mode)

    @property
    def is_live(self) -> bool:
        return self._mode == "live"

    # -----------------------------------------------------------------------
    # Connected account creation
    # -----------------------------------------------------------------------

    async def create_connected_account(self, practice_info: dict) -> ConnectedAccountResult:
        """Create a Stripe Connect Express account for a practice.

        Args:
            practice_info: Keys — practice_name, email, business_type (default "individual").

        Returns:
            ConnectedAccountResult with account_id and onboarding_url.
        """
        if self.is_live:
            return await self._create_connected_account_live(practice_info)
        return await self._create_connected_account_stub(practice_info)

    async def _create_connected_account_live(self, practice_info: dict) -> ConnectedAccountResult:
        """Create a real Stripe Connect Express account."""
        stripe = self._stripe
        try:
            account = stripe.Account.create(
                type="express",
                country="US",
                email=practice_info.get("email", ""),
                business_type=practice_info.get("business_type", "individual"),
                business_profile={
                    "name": practice_info.get("practice_name", ""),
                    "mcc": "8049",  # Podiatrists / Chiropodists — closest to behavioral health
                    "url": practice_info.get("website", ""),
                },
                capabilities={
                    "card_payments": {"requested": True},
                    "transfers": {"requested": True},
                },
            )

            # Create account link for onboarding
            account_link = stripe.AccountLink.create(
                account=account.id,
                refresh_url=practice_info.get("refresh_url", "https://app.trellis.dev/billing/onboarding/refresh"),
                return_url=practice_info.get("return_url", "https://app.trellis.dev/billing/onboarding/complete"),
                type="account_onboarding",
            )

            return ConnectedAccountResult(
                success=True,
                account_id=account.id,
                onboarding_url=account_link.url,
                charges_enabled=account.charges_enabled,
                payouts_enabled=account.payouts_enabled,
            )
        except Exception as exc:
            logger.error("Stripe account creation error: %s", exc)
            return ConnectedAccountResult(
                success=False,
                errors=[{"message": f"Stripe error: {exc}"}],
            )

    async def _create_connected_account_stub(self, practice_info: dict) -> ConnectedAccountResult:
        """Return a realistic mock connected account response."""
        logger.info("STUB: creating connected account for practice")
        acct_id = f"acct_{uuid.uuid4().hex[:16]}"
        return ConnectedAccountResult(
            success=True,
            account_id=acct_id,
            onboarding_url=f"https://connect.stripe.com/setup/s/{uuid.uuid4().hex[:16]}",
            charges_enabled=False,
            payouts_enabled=False,
        )

    # -----------------------------------------------------------------------
    # Payment link creation (Checkout Session)
    # -----------------------------------------------------------------------

    async def create_payment_link(
        self,
        amount: float,
        patient_email: str,
        patient_name: str = "",
        line_items: list[dict] | None = None,
        connected_account_id: str = "",
        platform_fee_percent: float | None = None,
    ) -> PaymentLinkResult:
        """Create a Stripe Checkout Session for patient payment.

        Args:
            amount: Total amount in dollars.
            patient_email: Patient email for receipt / pre-fill.
            patient_name: Patient name for display.
            line_items: Itemized charges [{description, amount, date_of_service}].
            connected_account_id: Practice's Stripe Connect account.
            platform_fee_percent: Override default platform fee.

        Returns:
            PaymentLinkResult with checkout URL and session ID.
        """
        if self.is_live:
            return await self._create_payment_link_live(
                amount, patient_email, patient_name, line_items or [],
                connected_account_id, platform_fee_percent,
            )
        return await self._create_payment_link_stub(
            amount, patient_email, patient_name, line_items or [],
            connected_account_id, platform_fee_percent,
        )

    async def _create_payment_link_live(
        self,
        amount: float,
        patient_email: str,
        patient_name: str,
        line_items: list[dict],
        connected_account_id: str,
        platform_fee_percent: float | None,
    ) -> PaymentLinkResult:
        """Create a real Stripe Checkout Session."""
        stripe = self._stripe
        fee_pct = platform_fee_percent if platform_fee_percent is not None else PLATFORM_FEE_PERCENT
        amount_cents = int(round(amount * 100))
        application_fee_cents = int(round(amount * fee_pct))  # fee_pct is e.g. 2.9

        # Build line items for Checkout
        checkout_line_items = []
        if line_items:
            for item in line_items:
                item_amount_cents = int(round(float(item.get("amount", 0)) * 100))
                desc = item.get("description", "Healthcare service")
                dos = item.get("date_of_service", "")
                if dos:
                    desc = f"{desc} ({dos})"
                checkout_line_items.append({
                    "price_data": {
                        "currency": "usd",
                        "product_data": {"name": desc},
                        "unit_amount": item_amount_cents,
                    },
                    "quantity": 1,
                })
        else:
            # Single line item for full amount
            checkout_line_items.append({
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": "Patient balance due"},
                    "unit_amount": amount_cents,
                },
                "quantity": 1,
            })

        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                customer_email=patient_email,
                line_items=checkout_line_items,
                payment_intent_data={
                    "application_fee_amount": application_fee_cents,
                    "transfer_data": {
                        "destination": connected_account_id,
                    },
                },
                success_url="https://app.trellis.dev/billing/payment/success?session_id={CHECKOUT_SESSION_ID}",
                cancel_url="https://app.trellis.dev/billing/payment/cancel",
                expires_at=int((datetime.now(timezone.utc) + timedelta(hours=24)).timestamp()),
            )

            expires_at_iso = datetime.fromtimestamp(session.expires_at, tz=timezone.utc).isoformat()

            return PaymentLinkResult(
                success=True,
                session_id=session.id,
                payment_link_url=session.url,
                expires_at=expires_at_iso,
            )
        except Exception as exc:
            logger.error("Stripe Checkout Session creation error: %s", exc)
            return PaymentLinkResult(
                success=False,
                errors=[{"message": f"Stripe error: {exc}"}],
            )

    async def _create_payment_link_stub(
        self,
        amount: float,
        patient_email: str,
        patient_name: str,
        line_items: list[dict],
        connected_account_id: str,
        platform_fee_percent: float | None,
    ) -> PaymentLinkResult:
        """Return a realistic mock payment link response."""
        logger.info("STUB: creating payment link for amount=%.2f", amount)
        session_id = f"cs_{uuid.uuid4().hex[:24]}"
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

        return PaymentLinkResult(
            success=True,
            session_id=session_id,
            payment_link_url=f"https://checkout.stripe.com/c/pay/{session_id}",
            expires_at=expires_at,
        )

    # -----------------------------------------------------------------------
    # Payment status
    # -----------------------------------------------------------------------

    async def get_payment_status(self, session_id: str) -> PaymentStatusResult:
        """Check the status of a Stripe Checkout Session.

        Args:
            session_id: Stripe Checkout Session ID (cs_xxx).

        Returns:
            PaymentStatusResult with status, amount_paid, paid_at.
        """
        if self.is_live:
            return await self._get_payment_status_live(session_id)
        return await self._get_payment_status_stub(session_id)

    async def _get_payment_status_live(self, session_id: str) -> PaymentStatusResult:
        """Retrieve real Checkout Session from Stripe."""
        stripe = self._stripe
        try:
            session = stripe.checkout.Session.retrieve(session_id)

            # Map Stripe session status to our status
            if session.payment_status == "paid":
                status = "completed"
            elif session.status == "expired":
                status = "expired"
            else:
                status = "pending"

            paid_at = ""
            amount_paid = 0.0
            payment_intent_id = ""

            if status == "completed":
                amount_paid = session.amount_total / 100.0 if session.amount_total else 0.0
                payment_intent_id = session.payment_intent or ""
                # Retrieve payment intent for precise timestamp
                if payment_intent_id:
                    try:
                        pi = stripe.PaymentIntent.retrieve(payment_intent_id)
                        if pi.status == "succeeded" and hasattr(pi, "created"):
                            paid_at = datetime.fromtimestamp(pi.created, tz=timezone.utc).isoformat()
                    except Exception:
                        paid_at = datetime.now(timezone.utc).isoformat()

            return PaymentStatusResult(
                success=True,
                status=status,
                amount_paid=amount_paid,
                paid_at=paid_at,
                payment_intent_id=payment_intent_id,
            )
        except Exception as exc:
            logger.error("Stripe payment status error: %s", exc)
            return PaymentStatusResult(
                success=False,
                errors=[{"message": f"Stripe error: {exc}"}],
            )

    async def _get_payment_status_stub(self, session_id: str) -> PaymentStatusResult:
        """Return a realistic mock payment status."""
        logger.info("STUB: checking payment status for %s", session_id)
        return PaymentStatusResult(
            success=True,
            status="pending",
            amount_paid=0.0,
            paid_at="",
            payment_intent_id="",
        )

    # -----------------------------------------------------------------------
    # Webhook processing
    # -----------------------------------------------------------------------

    async def process_webhook_event(self, payload: bytes, signature: str) -> WebhookEvent:
        """Parse and verify a Stripe webhook event.

        In live mode: verifies the webhook signature using STRIPE_WEBHOOK_SECRET.
        In stub mode: parses JSON without signature verification.

        Args:
            payload: Raw request body bytes.
            signature: Stripe-Signature header value.

        Returns:
            WebhookEvent with parsed event type and data.
        """
        if self.is_live:
            return await self._process_webhook_live(payload, signature)
        return await self._process_webhook_stub(payload, signature)

    async def _process_webhook_live(self, payload: bytes, signature: str) -> WebhookEvent:
        """Verify signature and parse a real Stripe webhook event."""
        stripe = self._stripe
        try:
            event = stripe.Webhook.construct_event(
                payload, signature, self.webhook_secret,
            )
            return WebhookEvent(
                success=True,
                event_type=event["type"],
                event_id=event["id"],
                data=event["data"]["object"],
            )
        except stripe.error.SignatureVerificationError as exc:
            logger.warning("Stripe webhook signature verification failed: %s", exc)
            return WebhookEvent(
                success=False,
                errors=[{"message": "Invalid webhook signature"}],
            )
        except Exception as exc:
            logger.error("Stripe webhook processing error: %s", exc)
            return WebhookEvent(
                success=False,
                errors=[{"message": f"Webhook processing error: {exc}"}],
            )

    async def _process_webhook_stub(self, payload: bytes, signature: str) -> WebhookEvent:
        """Parse webhook payload without signature verification (stub mode)."""
        import json
        try:
            event = json.loads(payload)
            return WebhookEvent(
                success=True,
                event_type=event.get("type", ""),
                event_id=event.get("id", f"evt_{uuid.uuid4().hex[:16]}"),
                data=event.get("data", {}).get("object", event.get("data", {})),
            )
        except (json.JSONDecodeError, KeyError) as exc:
            logger.error("STUB: failed to parse webhook payload: %s", exc)
            return WebhookEvent(
                success=False,
                errors=[{"message": f"Failed to parse webhook payload: {exc}"}],
            )


# Module-level singleton
stripe_client = StripeConnectClient()
