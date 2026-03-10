"""Patient payment routes (Stripe Connect) — payment links, status, and webhooks."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from auth import require_api_key, require_permission
from config import PLATFORM_FEE_PERCENT
from db import (
    create_payment, get_payment, get_payments_for_claim,
    update_payment_status, create_event, get_claim,
    get_eras_for_claim, get_pool,
)
from integrations.stripe_connect import stripe_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class LineItem(BaseModel):
    description: str
    amount: float
    date_of_service: str = ""


class CreatePaymentLinkRequest(BaseModel):
    claim_id: str
    patient_email: str
    patient_name: str = ""
    line_items: list[LineItem] = Field(default_factory=list)
    platform_fee_percent: float | None = None


class PaymentResponse(BaseModel):
    id: str
    account_id: str
    claim_id: str
    stripe_payment_intent_id: str | None = None
    stripe_checkout_session_id: str | None = None
    amount: float
    platform_fee: float
    status: str
    patient_email: str
    payment_link_url: str = ""
    expires_at: str = ""
    paid_at: str | None = None
    created_at: str
    updated_at: str


class PaymentListResponse(BaseModel):
    payments: list[PaymentResponse]
    count: int


def _serialize_payment(payment: dict) -> dict:
    """Convert DB record to API response."""
    return {
        "id": str(payment["id"]),
        "account_id": str(payment["account_id"]),
        "claim_id": str(payment["claim_id"]),
        "stripe_payment_intent_id": payment.get("stripe_payment_intent_id"),
        "stripe_checkout_session_id": payment.get("stripe_checkout_session_id"),
        "amount": float(payment["amount"]),
        "platform_fee": float(payment["platform_fee"]),
        "status": payment["status"],
        "patient_email": payment["patient_email"],
        "payment_link_url": payment.get("payment_link_url") or "",
        "expires_at": payment.get("expires_at", ""),
        "paid_at": payment["paid_at"].isoformat() if payment.get("paid_at") else None,
        "created_at": payment["created_at"].isoformat(),
        "updated_at": payment["updated_at"].isoformat(),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/create-link", response_model=PaymentResponse)
async def create_payment_link(body: CreatePaymentLinkRequest, account: dict = Depends(require_permission("billing"))):
    """Create a Stripe payment link for a patient balance.

    If line_items are not provided, auto-derives them from the ERA
    patient responsibility for the given claim.
    """
    account_id = str(account["id"])
    connected_account_id = account.get("stripe_connect_account_id")

    if not connected_account_id:
        raise HTTPException(
            status_code=400,
            detail="Stripe Connect account not configured. Complete Stripe onboarding first.",
        )

    # --- Resolve amount and line items ---
    line_items = [item.model_dump() for item in body.line_items] if body.line_items else []
    amount = 0.0

    if line_items:
        # Use provided line items; sum amounts
        amount = sum(float(item.get("amount", 0)) for item in line_items)
    else:
        # Auto-derive from ERA data for this claim
        claim = await get_claim(body.claim_id, account_id)
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")

        eras = await get_eras_for_claim(body.claim_id, account_id)
        if eras:
            # Use the most recent ERA
            latest_era = eras[0]  # ordered by created_at DESC
            amount = float(latest_era.get("patient_responsibility", 0))
            if amount <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="No patient responsibility found on ERA for this claim",
                )
            # Build line item from ERA
            payer = latest_era.get("payer_name", "Insurance")
            line_items = [{
                "description": f"Patient responsibility after {payer} payment",
                "amount": amount,
                "date_of_service": "",
            }]
        else:
            # Fall back to claim patient_responsibility if no ERA
            amount = float(claim.get("patient_responsibility", 0))
            if amount <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="No patient responsibility found — submit line_items manually or wait for ERA processing",
                )
            line_items = [{
                "description": "Patient balance due",
                "amount": amount,
                "date_of_service": "",
            }]

    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than 0")

    fee_pct = body.platform_fee_percent or PLATFORM_FEE_PERCENT
    platform_fee = round(amount * fee_pct / 100, 2)

    # --- Create Stripe checkout session ---
    stripe_resp = await stripe_client.create_payment_link(
        amount=amount,
        patient_email=body.patient_email,
        patient_name=body.patient_name,
        line_items=line_items,
        connected_account_id=connected_account_id,
        platform_fee_percent=fee_pct,
    )

    if not stripe_resp.success:
        raise HTTPException(
            status_code=502,
            detail=stripe_resp.errors[0].get("message", "Failed to create Stripe payment link")
            if stripe_resp.errors else "Failed to create Stripe payment link",
        )

    # --- Create payment record ---
    payment = await create_payment(
        account_id=account_id,
        claim_id=body.claim_id,
        amount=amount,
        platform_fee=platform_fee,
        patient_email=body.patient_email,
        payment_link_url=stripe_resp.payment_link_url,
        stripe_checkout_session_id=stripe_resp.session_id,
    )

    await create_event(
        account_id=account_id,
        event_type="payment_link_created",
        resource_type="payment",
        resource_id=str(payment["id"]),
        data={
            "amount": amount,
            "claim_id": body.claim_id,
            "patient_email": body.patient_email,
            "expires_at": stripe_resp.expires_at,
        },
    )

    logger.info("Payment link created for account %s, claim %s, amount=%.2f", account_id, body.claim_id, amount)

    result = _serialize_payment(payment)
    result["expires_at"] = stripe_resp.expires_at
    return result


@router.get("/{payment_id}", response_model=PaymentResponse)
async def get_payment_detail(payment_id: str, account: dict = Depends(require_permission("billing"))):
    """Return payment status."""
    payment = await get_payment(payment_id, str(account["id"]))
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return _serialize_payment(payment)


@router.get("/claim/{claim_id}", response_model=PaymentListResponse)
async def get_payments_for_claim_endpoint(claim_id: str, account: dict = Depends(require_permission("billing"))):
    """Return all payments for a claim."""
    payments = await get_payments_for_claim(claim_id, str(account["id"]))
    return {
        "payments": [_serialize_payment(p) for p in payments],
        "count": len(payments),
    }


# ---------------------------------------------------------------------------
# Stripe Webhook (NOT behind API key auth — uses Stripe signature)
# ---------------------------------------------------------------------------

@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Receive Stripe webhook events.

    This endpoint does NOT require X-API-Key authentication.
    Instead, it uses Stripe's webhook signature verification.

    Handles:
      - checkout.session.completed: Update payment or activate subscription
      - payment_intent.succeeded: Additional confirmation
      - customer.subscription.deleted: Revoke messaging permission
      - customer.subscription.updated: Handle cancellation via update
      - invoice.payment_failed: Log warning (Stripe retries automatically)
    """
    payload = await request.body()
    signature = request.headers.get("Stripe-Signature", "")

    event = await stripe_client.process_webhook_event(payload, signature)

    if not event.success:
        logger.warning("Webhook verification failed: %s", event.errors)
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    logger.info("Stripe webhook received: type=%s id=%s", event.event_type, event.event_id)

    if event.event_type == "checkout.session.completed":
        session_data = event.data
        if session_data.get("mode") == "subscription":
            await _handle_subscription_checkout_completed(session_data)
        else:
            await _handle_checkout_completed(session_data)
    elif event.event_type == "payment_intent.succeeded":
        await _handle_payment_intent_succeeded(event.data)
    elif event.event_type == "customer.subscription.deleted":
        await _handle_subscription_deleted(event.data)
    elif event.event_type == "customer.subscription.updated":
        sub_data = event.data
        if sub_data.get("cancel_at_period_end") or sub_data.get("status") == "canceled":
            await _handle_subscription_deleted(sub_data)
    elif event.event_type == "invoice.payment_failed":
        await _handle_invoice_payment_failed(event.data)
    else:
        logger.info("Unhandled webhook event type: %s", event.event_type)

    return Response(status_code=200)


# ---------------------------------------------------------------------------
# Webhook handlers
# ---------------------------------------------------------------------------

async def _handle_checkout_completed(session_data: dict):
    """Handle checkout.session.completed — mark payment as completed.

    Looks up the payment by stripe_checkout_session_id, updates status,
    and optionally updates the claim if fully paid.
    """
    session_id = session_data.get("id", "")
    payment_intent_id = session_data.get("payment_intent", "")

    if not session_id:
        logger.warning("checkout.session.completed missing session id")
        return

    # Look up payment by checkout session ID
    payment = await _find_payment_by_session_id(session_id)
    if not payment:
        logger.warning("No payment found for session_id=%s", session_id)
        return

    payment_id = str(payment["id"])
    account_id = str(payment["account_id"])
    claim_id = str(payment["claim_id"])

    # Update payment status
    updated_payment = await update_payment_status(
        payment_id=payment_id,
        account_id=account_id,
        status="completed",
        stripe_payment_intent_id=payment_intent_id,
    )

    # Log event
    await create_event(
        account_id=account_id,
        event_type="payment_completed",
        resource_type="payment",
        resource_id=payment_id,
        data={
            "amount": float(payment["amount"]),
            "claim_id": claim_id,
            "stripe_payment_intent_id": payment_intent_id,
        },
    )

    # Check if claim is now fully paid (insurance + patient payments cover total)
    from db import get_claim, update_claim_status
    claim = await get_claim(claim_id, account_id)
    if claim:
        total_charge = float(claim.get("total_charge", 0))
        insurance_paid = float(claim.get("total_paid", 0))
        patient_paid = float(payment["amount"])
        if insurance_paid + patient_paid >= total_charge:
            await update_claim_status(
                claim_id=claim_id,
                account_id=account_id,
                status="paid",
                details=f"Fully paid — insurance ${insurance_paid:.2f} + patient ${patient_paid:.2f}",
            )
            await create_event(
                account_id=account_id,
                event_type="claim_fully_paid",
                resource_type="claim",
                resource_id=claim_id,
                data={
                    "total_charge": total_charge,
                    "insurance_paid": insurance_paid,
                    "patient_paid": patient_paid,
                },
            )

    logger.info("Payment %s completed for claim %s", payment_id, claim_id)


async def _handle_payment_intent_succeeded(pi_data: dict):
    """Handle payment_intent.succeeded — log for completeness.

    The primary handling happens in checkout.session.completed.
    This provides a secondary confirmation.
    """
    pi_id = pi_data.get("id", "")
    logger.info("Payment intent succeeded: %s", pi_id)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _handle_subscription_checkout_completed(session_data: dict):
    """Handle checkout.session.completed with mode=subscription.

    Activates the messaging permission and stores the subscription ID
    on the billing account.
    """
    account_id = (session_data.get("metadata") or {}).get("trellis_account_id")
    subscription_id = session_data.get("subscription")

    if not account_id:
        logger.warning("Subscription checkout missing trellis_account_id in metadata")
        return

    if not subscription_id:
        logger.warning("Subscription checkout missing subscription ID")
        return

    pool = await get_pool()
    await pool.execute(
        """UPDATE billing_accounts
           SET stripe_subscription_id = $1,
               permissions = permissions || '{"messaging": true}'::jsonb,
               updated_at = now()
           WHERE id = $2""",
        subscription_id, account_id,
    )

    await create_event(
        account_id=account_id,
        event_type="subscription_activated",
        resource_type="billing_account",
        resource_id=account_id,
        data={"subscription_id": subscription_id},
    )
    logger.info("Subscription %s activated for account %s", subscription_id, account_id)


async def _handle_subscription_deleted(subscription_data: dict):
    """Handle customer.subscription.deleted — revoke messaging permission."""
    subscription_id = subscription_data.get("id", "")
    if not subscription_id:
        logger.warning("subscription.deleted missing subscription id")
        return

    account = await _find_account_by_subscription_id(subscription_id)
    if not account:
        logger.warning("No account found for subscription_id=%s", subscription_id)
        return

    account_id = str(account["id"])
    pool = await get_pool()
    await pool.execute(
        """UPDATE billing_accounts
           SET permissions = jsonb_set(permissions, '{messaging}', 'false'),
               updated_at = now()
           WHERE stripe_subscription_id = $1""",
        subscription_id,
    )

    await create_event(
        account_id=account_id,
        event_type="subscription_cancelled",
        resource_type="billing_account",
        resource_id=account_id,
        data={"subscription_id": subscription_id},
    )
    logger.info("Subscription %s cancelled, messaging revoked for account %s", subscription_id, account_id)


async def _handle_invoice_payment_failed(invoice_data: dict):
    """Handle invoice.payment_failed — log warning only.

    Stripe automatically retries failed payments, so we do NOT revoke
    permissions here. Just log for visibility.
    """
    subscription_id = invoice_data.get("subscription", "")
    attempt_count = invoice_data.get("attempt_count", 0)
    logger.warning(
        "Invoice payment failed for subscription %s (attempt %s)",
        subscription_id, attempt_count,
    )

    if subscription_id:
        account = await _find_account_by_subscription_id(subscription_id)
        if account:
            await create_event(
                account_id=str(account["id"]),
                event_type="payment_failed",
                resource_type="billing_account",
                resource_id=str(account["id"]),
                data={
                    "subscription_id": subscription_id,
                    "attempt_count": attempt_count,
                },
            )


async def _find_account_by_subscription_id(subscription_id: str) -> dict | None:
    """Look up a billing account by stripe_subscription_id."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM billing_accounts WHERE stripe_subscription_id = $1",
        subscription_id,
    )
    return dict(row) if row else None


async def _find_payment_by_session_id(session_id: str) -> dict | None:
    """Look up a payment by stripe_checkout_session_id."""
    from db import get_pool
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM billing_payments WHERE stripe_checkout_session_id = $1",
        session_id,
    )
    return dict(row) if row else None
