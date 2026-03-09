"""Public signup route — no API key required.

Handles the landing page signup flow:
  1. Accepts BAA signature + plan selection
  2. Creates billing_account with hashed API key
  3. If messaging plan selected, creates Stripe Checkout Session for $3/mo subscription
  4. Returns the raw API key (shown once) and optional checkout redirect URL
"""
import hashlib
import logging
import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field

from config import STRIPE_SECRET_KEY
from db import create_account_with_baa

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["signup"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SignupRequest(BaseModel):
    practice_name: str = Field(..., min_length=1, max_length=200)
    signer_name: str = Field(..., min_length=1, max_length=200)
    signer_title: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    plans: list[str] = Field(..., min_length=1)


class SignupResponse(BaseModel):
    account_id: str
    api_key: str | None = None          # raw key, shown once (None if Stripe redirect)
    api_key_prefix: str
    checkout_url: str | None = None     # Stripe Checkout URL for messaging subscription
    permissions: dict


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_api_key() -> tuple[str, str, str]:
    """Generate a raw API key, its SHA-256 hash, and display prefix."""
    raw = f"trls_{secrets.token_urlsafe(32)}"
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    prefix = raw[:12] + "..."
    return raw, hashed, prefix


async def _create_stripe_checkout(email: str, account_id: str, api_key: str, plans: list[str]) -> str | None:
    """Create a Stripe Checkout Session for the messaging subscription.

    Returns the checkout URL, or None if Stripe is not configured.
    """
    if not STRIPE_SECRET_KEY:
        logger.info("STUB: would create Stripe Checkout for messaging subscription")
        return None

    try:
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY

        # Build line items
        line_items = []

        # Messaging = $3/month subscription
        if "messaging" in plans:
            line_items.append({
                "price_data": {
                    "currency": "usd",
                    "product_data": {
                        "name": "Trellis Text Messaging",
                        "description": "HIPAA-compliant SMS for appointment reminders, intake, and billing notifications",
                    },
                    "unit_amount": 300,  # $3.00
                    "recurring": {"interval": "month"},
                },
                "quantity": 1,
            })

        if not line_items:
            # Billing-only plan: no subscription needed
            return None

        session = stripe.checkout.Session.create(
            mode="subscription",
            customer_email=email,
            line_items=line_items,
            success_url=f"https://trellis.health/signup?api_key={api_key}&plans={','.join(plans)}",
            cancel_url="https://trellis.health/signup",
            metadata={
                "trellis_account_id": account_id,
                "plans": ",".join(plans),
            },
        )
        return session.url

    except Exception as exc:
        logger.error("Stripe Checkout creation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider error. Please try again.")


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/signup", response_model=SignupResponse)
async def signup(body: SignupRequest):
    """Public signup: sign BAA, select plans, get API key.

    For messaging plan: returns a Stripe Checkout URL. The raw API key is
    passed as a query param in the Stripe success_url so the landing page
    can display it after payment completes.

    For billing-only: returns the API key directly (no upfront payment).
    """
    # Validate plans
    valid_plans = {"messaging", "billing"}
    for plan in body.plans:
        if plan not in valid_plans:
            raise HTTPException(status_code=422, detail=f"Invalid plan: {plan}")

    # Generate API key
    raw_key, key_hash, key_prefix = _generate_api_key()

    # Build permissions
    permissions = {plan: True for plan in body.plans}

    # Create account
    account = await create_account_with_baa(
        practice_name=body.practice_name,
        api_key_hash=key_hash,
        api_key_prefix=key_prefix,
        permissions=permissions,
        signer_name=body.signer_name,
        signer_title=body.signer_title,
        signer_email=body.email,
    )

    account_id = str(account["id"])

    # Create Stripe Checkout if messaging is selected
    checkout_url = await _create_stripe_checkout(body.email, account_id, raw_key, body.plans)

    return SignupResponse(
        account_id=account_id,
        api_key=raw_key if not checkout_url else None,
        api_key_prefix=key_prefix,
        checkout_url=checkout_url,
        permissions=permissions,
    )
