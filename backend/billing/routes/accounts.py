"""Account management and health check routes."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_api_key
from db import update_account_settings
from integrations.stedi import stedi_client
from integrations.stripe_connect import stripe_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["accounts"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AccountSettings(BaseModel):
    auto_submit: bool = False
    payment_reminders: bool = True
    reminder_days: list[int] = Field(default_factory=lambda: [7, 14, 30])


class AccountResponse(BaseModel):
    id: str
    practice_name: str
    api_key_prefix: str | None = None
    stripe_connect_account_id: str | None = None
    stripe_onboarding_complete: bool = False
    settings: dict = Field(default_factory=dict)
    status: str
    created_at: str
    updated_at: str


class UpdateSettingsRequest(BaseModel):
    settings: AccountSettings


class HealthCheckResponse(BaseModel):
    status: str
    database: str
    stedi: str
    stripe: str


def _serialize_account(account: dict) -> dict:
    """Convert DB record to API response (omits sensitive fields like api_key hash)."""
    return {
        "id": str(account["id"]),
        "practice_name": account["practice_name"],
        "api_key_prefix": account.get("api_key_prefix"),
        "stripe_connect_account_id": account.get("stripe_connect_account_id"),
        "stripe_onboarding_complete": account.get("stripe_onboarding_complete", False),
        "settings": account.get("settings") or {},
        "status": account["status"],
        "created_at": account["created_at"].isoformat(),
        "updated_at": account["updated_at"].isoformat(),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/me", response_model=AccountResponse)
async def get_my_account(account: dict = Depends(require_api_key)):
    """Return account info and settings for the authenticated account."""
    return _serialize_account(account)


@router.put("/me/settings", response_model=AccountResponse)
async def update_my_settings(body: UpdateSettingsRequest, account: dict = Depends(require_api_key)):
    """Update account settings (auto_submit toggle, payment reminders, etc.)."""
    account_id = str(account["id"])
    updated = await update_account_settings(account_id, body.settings.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="Account not found")
    logger.info("Settings updated for account %s", account_id)
    return _serialize_account(updated)


@router.get("/me/health", response_model=HealthCheckResponse)
async def health_check(account: dict = Depends(require_api_key)):
    """Connection health check: DB reachable, Stedi reachable, Stripe connected."""
    # Database is reachable if we got this far (auth hit the DB)
    db_status = "ok"

    # Check Stedi connectivity (stubbed — just checks if API key is configured)
    stedi_status = "configured" if stedi_client.api_key else "not_configured"

    # Check Stripe connectivity
    stripe_connected = account.get("stripe_onboarding_complete", False)
    if stripe_connected:
        stripe_status = "connected"
    elif account.get("stripe_connect_account_id"):
        stripe_status = "onboarding_incomplete"
    else:
        stripe_status = "not_configured"

    overall = "ok" if db_status == "ok" else "degraded"

    return HealthCheckResponse(
        status=overall,
        database=db_status,
        stedi=stedi_status,
        stripe=stripe_status,
    )
