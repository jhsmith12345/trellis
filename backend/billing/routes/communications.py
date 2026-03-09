"""Patient communication routes — statements, reminders, and confirmations."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import require_api_key
from config import CRON_SECRET
from db import (
    get_claim, get_eras_for_claim, get_payment, get_payments_for_claim,
    create_event, create_communication_record, get_communication_history,
    get_pool,
)
from integrations.email import email_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/communications", tags=["communications"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SendStatementRequest(BaseModel):
    claim_id: str
    patient_email: str
    patient_name: str = ""


class SendReminderRequest(BaseModel):
    claim_id: str | None = None
    payment_id: str | None = None
    patient_email: str
    patient_name: str = ""
    reminder_level: int = Field(ge=1, le=3, description="1=7 day, 2=30 day, 3=60 day")


class SendConfirmationRequest(BaseModel):
    payment_id: str
    patient_email: str
    patient_name: str = ""


class CommunicationResponse(BaseModel):
    success: bool
    communication_id: str = ""
    message: str = ""


class CommunicationHistoryItem(BaseModel):
    id: str
    comm_type: str
    recipient_email: str
    recipient_name: str | None = None
    subject: str | None = None
    claim_id: str | None = None
    payment_id: str | None = None
    status: str
    sent_at: str
    created_at: str


class CommunicationHistoryResponse(BaseModel):
    communications: list[CommunicationHistoryItem]
    count: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_practice_name(account: dict) -> str:
    """Extract practice name from account, falling back to a default."""
    settings = account.get("settings") or {}
    return settings.get("practice_name") or account.get("practice_name", "Your Provider")


def _format_amount(amount: float) -> str:
    """Format a dollar amount with two decimal places."""
    return f"{amount:,.2f}"


async def _get_payment_link_for_claim(claim_id: str, account_id: str) -> str | None:
    """Find an active (pending) payment link for a claim, if one exists."""
    payments = await get_payments_for_claim(claim_id, account_id)
    for p in payments:
        if p.get("status") == "pending" and p.get("payment_link_url"):
            return p["payment_link_url"]
    return None


def _serialize_communication(comm: dict) -> dict:
    """Convert DB record to API response."""
    return {
        "id": str(comm["id"]),
        "comm_type": comm["comm_type"],
        "recipient_email": comm["recipient_email"],
        "recipient_name": comm.get("recipient_name"),
        "subject": comm.get("subject"),
        "claim_id": str(comm["claim_id"]) if comm.get("claim_id") else None,
        "payment_id": str(comm["payment_id"]) if comm.get("payment_id") else None,
        "status": comm["status"],
        "sent_at": comm["sent_at"].isoformat() if comm.get("sent_at") else "",
        "created_at": comm["created_at"].isoformat(),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/send-statement", response_model=CommunicationResponse)
async def send_statement(body: SendStatementRequest, account: dict = Depends(require_api_key)):
    """Send a patient statement email with service summary and balance.

    Generates statement content from claim and ERA data. Includes a
    Stripe payment link if the patient responsibility is > 0 and Stripe
    is connected for the account.
    """
    account_id = str(account["id"])
    practice_name = _get_practice_name(account)

    # --- Load claim ---
    claim = await get_claim(body.claim_id, account_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    total_charge = float(claim.get("total_charge", 0))
    insurance_paid = float(claim.get("total_paid", 0))
    patient_responsibility = float(claim.get("patient_responsibility", 0))

    # Refine from ERA if available
    eras = await get_eras_for_claim(body.claim_id, account_id)
    if eras:
        latest = eras[0]
        insurance_paid = float(latest.get("payment_amount", insurance_paid))
        patient_responsibility = float(latest.get("patient_responsibility", patient_responsibility))

    adjustments = max(total_charge - insurance_paid - patient_responsibility, 0)

    # --- Payment link ---
    payment_link = await _get_payment_link_for_claim(body.claim_id, account_id)

    # --- Build template context ---
    service_date = ""
    claim_data = claim.get("claim_data") or {}
    if isinstance(claim_data, dict):
        service_date = claim_data.get("service_date", claim_data.get("date_of_service", ""))
    if not service_date:
        service_date = claim["created_at"].strftime("%m/%d/%Y") if claim.get("created_at") else "N/A"

    context = {
        "patient_name": body.patient_name or "Patient",
        "practice_name": practice_name,
        "service_date": service_date,
        "total_charges": _format_amount(total_charge),
        "insurance_paid": _format_amount(insurance_paid),
        "adjustments": _format_amount(adjustments),
        "patient_responsibility": _format_amount(patient_responsibility),
        "payment_link": payment_link or "",
    }

    sent = await email_client.send_template(body.patient_email, "patient_statement", context)

    status = "sent" if sent else "failed"
    comm = await create_communication_record(
        account_id=account_id,
        claim_id=body.claim_id,
        comm_type="statement",
        recipient_email=body.patient_email,
        recipient_name=body.patient_name,
        subject=f"Statement from {practice_name}",
        status=status,
        metadata={"patient_responsibility": patient_responsibility},
    )

    await create_event(
        account_id=account_id,
        event_type="statement_sent",
        resource_type="communication",
        resource_id=str(comm["id"]),
        data={
            "claim_id": body.claim_id,
            "patient_responsibility": patient_responsibility,
            "status": status,
        },
    )

    logger.info(
        "Statement %s for account %s, claim %s, amount=%.2f",
        status, account_id, body.claim_id, patient_responsibility,
    )

    return {
        "success": sent,
        "communication_id": str(comm["id"]),
        "message": f"Statement {status}" if sent else "Failed to send statement",
    }


@router.post("/send-reminder", response_model=CommunicationResponse)
async def send_reminder(body: SendReminderRequest, account: dict = Depends(require_api_key)):
    """Send a payment reminder email with escalating tone.

    Reminder levels:
      1 — Friendly reminder (7 days)
      2 — Past due notice (30 days)
      3 — Final notice (60 days)
    """
    account_id = str(account["id"])
    practice_name = _get_practice_name(account)

    if not body.claim_id and not body.payment_id:
        raise HTTPException(status_code=400, detail="Either claim_id or payment_id is required")

    # --- Resolve amount due ---
    amount_due = 0.0
    claim_id = body.claim_id

    if body.claim_id:
        claim = await get_claim(body.claim_id, account_id)
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")
        amount_due = float(claim.get("patient_responsibility", 0))
    elif body.payment_id:
        payment = await get_payment(body.payment_id, account_id)
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")
        amount_due = float(payment.get("amount", 0))
        claim_id = str(payment["claim_id"])

    if amount_due <= 0:
        raise HTTPException(status_code=400, detail="No outstanding balance found")

    # --- Payment link ---
    payment_link = ""
    if claim_id:
        payment_link = await _get_payment_link_for_claim(claim_id, account_id) or ""

    # --- Send ---
    template_name = f"payment_reminder_{body.reminder_level}"
    context = {
        "patient_name": body.patient_name or "Patient",
        "practice_name": practice_name,
        "amount_due": _format_amount(amount_due),
        "payment_link": payment_link,
    }

    sent = await email_client.send_template(body.patient_email, template_name, context)

    status = "sent" if sent else "failed"
    comm_type = f"reminder_{body.reminder_level}"
    comm = await create_communication_record(
        account_id=account_id,
        claim_id=claim_id,
        comm_type=comm_type,
        recipient_email=body.patient_email,
        recipient_name=body.patient_name,
        subject=f"Payment Reminder — {practice_name}",
        status=status,
        metadata={"amount_due": amount_due, "reminder_level": body.reminder_level},
    )

    await create_event(
        account_id=account_id,
        event_type=f"reminder_{body.reminder_level}_sent",
        resource_type="communication",
        resource_id=str(comm["id"]),
        data={
            "claim_id": claim_id,
            "amount_due": amount_due,
            "reminder_level": body.reminder_level,
            "status": status,
        },
    )

    logger.info(
        "Reminder level %d %s for account %s, claim %s, amount=%.2f",
        body.reminder_level, status, account_id, claim_id, amount_due,
    )

    return {
        "success": sent,
        "communication_id": str(comm["id"]),
        "message": f"Reminder level {body.reminder_level} {status}",
    }


@router.post("/send-confirmation", response_model=CommunicationResponse)
async def send_confirmation(body: SendConfirmationRequest, account: dict = Depends(require_api_key)):
    """Send a payment confirmation email.

    Typically triggered after a payment_completed webhook event.
    """
    account_id = str(account["id"])
    practice_name = _get_practice_name(account)

    payment = await get_payment(body.payment_id, account_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    amount_paid = float(payment["amount"])
    claim_id = str(payment["claim_id"])

    # Calculate remaining balance
    claim = await get_claim(claim_id, account_id)
    remaining = 0.0
    if claim:
        patient_resp = float(claim.get("patient_responsibility", 0))
        # Sum all completed payments for this claim
        all_payments = await get_payments_for_claim(claim_id, account_id)
        total_paid = sum(
            float(p["amount"]) for p in all_payments if p.get("status") == "completed"
        )
        remaining = max(patient_resp - total_paid, 0)

    payment_date = ""
    if payment.get("paid_at"):
        payment_date = payment["paid_at"].strftime("%m/%d/%Y")
    elif payment.get("updated_at"):
        payment_date = payment["updated_at"].strftime("%m/%d/%Y")

    context = {
        "patient_name": body.patient_name or "Patient",
        "practice_name": practice_name,
        "amount_paid": _format_amount(amount_paid),
        "payment_date": payment_date or "Today",
        "remaining_balance": _format_amount(remaining),
    }

    sent = await email_client.send_template(body.patient_email, "payment_confirmation", context)

    status = "sent" if sent else "failed"
    comm = await create_communication_record(
        account_id=account_id,
        claim_id=claim_id,
        payment_id=body.payment_id,
        comm_type="confirmation",
        recipient_email=body.patient_email,
        recipient_name=body.patient_name,
        subject=f"Payment Received — {practice_name}",
        status=status,
        metadata={"amount_paid": amount_paid, "remaining_balance": remaining},
    )

    await create_event(
        account_id=account_id,
        event_type="confirmation_sent",
        resource_type="communication",
        resource_id=str(comm["id"]),
        data={
            "payment_id": body.payment_id,
            "claim_id": claim_id,
            "amount_paid": amount_paid,
            "status": status,
        },
    )

    logger.info(
        "Confirmation %s for account %s, payment %s, amount=%.2f",
        status, account_id, body.payment_id, amount_paid,
    )

    return {
        "success": sent,
        "communication_id": str(comm["id"]),
        "message": f"Confirmation {status}",
    }


@router.get("/history", response_model=CommunicationHistoryResponse)
async def communication_history(
    claim_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    account: dict = Depends(require_api_key),
):
    """Return communication history for the account.

    Optionally filter by claim_id. Returns most recent first.
    """
    account_id = str(account["id"])
    comms = await get_communication_history(
        account_id=account_id,
        claim_id=claim_id,
        limit=limit,
        offset=offset,
    )
    return {
        "communications": [_serialize_communication(c) for c in comms],
        "count": len(comms),
    }


# ---------------------------------------------------------------------------
# Cron endpoint — automated reminder processing
# ---------------------------------------------------------------------------

class ProcessRemindersResponse(BaseModel):
    accounts_processed: int = 0
    total_communications: int = 0
    results: list[dict] = Field(default_factory=list)


@router.post("/process-reminders", response_model=ProcessRemindersResponse)
async def process_reminders(request: Request):
    """Process pending reminders for all active accounts.

    This is a cron endpoint — protected by X-Cron-Secret header,
    NOT by API key auth. Intended to be called by Cloud Scheduler.
    """
    cron_secret = request.headers.get("X-Cron-Secret", "")
    if not CRON_SECRET or cron_secret != CRON_SECRET:
        raise HTTPException(status_code=403, detail="Invalid cron secret")

    from scheduler import process_reminders_for_account

    import uuid as _uuid
    pool = await get_pool()

    # Get all active accounts that have payment reminders enabled
    rows = await pool.fetch(
        """
        SELECT id, settings FROM billing_accounts
        WHERE status = 'active'
        """
    )

    accounts_processed = 0
    total_communications = 0
    all_results: list[dict] = []

    for row in rows:
        account_id = str(row["id"])
        settings = row.get("settings") or {}

        # Respect account-level setting for payment reminders
        if settings.get("payment_reminders") is False:
            continue

        try:
            results = await process_reminders_for_account(account_id)
            accounts_processed += 1
            total_communications += len(results)
            for r in results:
                r["account_id"] = account_id
            all_results.extend(results)
        except Exception:
            logger.exception("Failed to process reminders for account %s", account_id)
            all_results.append({
                "account_id": account_id,
                "status": "error",
            })

    logger.info(
        "Reminder processing complete: %d accounts, %d communications",
        accounts_processed, total_communications,
    )

    return {
        "accounts_processed": accounts_processed,
        "total_communications": total_communications,
        "results": all_results,
    }
