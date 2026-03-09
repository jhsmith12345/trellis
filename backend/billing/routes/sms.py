"""SMS messaging routes for the billing service.

EHR installations call these endpoints to send text reminders via
the centralized Telnyx account. Gated by the same API key auth
as all other billing endpoints.
"""
import hashlib
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_api_key
from db import create_sms_record, get_sms_usage, create_event
from integrations.telnyx_sms import send_sms, is_configured

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sms", tags=["sms"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SendSMSRequest(BaseModel):
    to: str = Field(description="E.164 phone number (e.g. +15551234567)")
    message: str = Field(max_length=320, description="SMS body text")
    message_type: str = Field(
        default="appointment_reminder",
        description="Type: appointment_reminder, reconfirmation, unsigned_docs",
    )
    appointment_id: str | None = Field(default=None, description="Optional appointment reference")


class SendSMSResponse(BaseModel):
    success: bool
    sms_id: str = ""
    message: str = ""


class SMSUsageResponse(BaseModel):
    messages_sent: int
    messages_this_month: int
    messages_failed: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/send", response_model=SendSMSResponse)
async def send_sms_endpoint(body: SendSMSRequest, account: dict = Depends(require_api_key)):
    """Send an SMS message via the centralized Telnyx account.

    The EHR's reminder cron calls this endpoint when a client has
    sms_opt_in=true and the practice has sms_enabled=true.
    """
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail="SMS service not configured (Telnyx credentials missing)",
        )

    account_id = str(account["id"])

    # Hash the phone number for logging (never store raw numbers in billing DB)
    phone_hash = hashlib.sha256(body.to.encode()).hexdigest()[:16]

    # Send via Telnyx
    result = await send_sms(to=body.to, text=body.message)

    # Record in DB
    status = "sent" if result["success"] else "failed"
    sms_record = await create_sms_record(
        account_id=account_id,
        phone_hash=phone_hash,
        message_type=body.message_type,
        status=status,
        telnyx_message_id=result.get("message_id"),
        error=result.get("error"),
    )

    # Event log
    await create_event(
        account_id=account_id,
        event_type="sms_sent" if result["success"] else "sms_failed",
        resource_type="sms",
        resource_id=str(sms_record["id"]),
        data={
            "message_type": body.message_type,
            "phone_hash": phone_hash,
            "appointment_id": body.appointment_id,
            "status": status,
        },
    )

    if not result["success"]:
        logger.warning(
            "SMS send failed for account %s, type=%s, error=%s",
            account_id, body.message_type, result.get("error", "unknown"),
        )
        return {
            "success": False,
            "sms_id": str(sms_record["id"]),
            "message": f"SMS failed: {result.get('error', 'unknown')}",
        }

    logger.info(
        "SMS sent for account %s, type=%s, telnyx_id=%s",
        account_id, body.message_type, result.get("message_id"),
    )
    return {
        "success": True,
        "sms_id": str(sms_record["id"]),
        "message": "SMS sent successfully",
    }


@router.get("/usage", response_model=SMSUsageResponse)
async def sms_usage(account: dict = Depends(require_api_key)):
    """Return SMS usage stats for the account."""
    account_id = str(account["id"])
    usage = await get_sms_usage(account_id)
    return usage
