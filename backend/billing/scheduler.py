"""Automated reminder scheduling logic for patient communications.

Determines which claims need statements or reminders based on
communication history and elapsed time, then sends the appropriate
messages via the billing email client.
"""
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta

from db import (
    get_pool, get_communication_history, get_last_communication,
    get_payments_for_claim, create_communication_record, create_event,
)
from integrations.email import email_client

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Reminder timing thresholds (days since previous communication)
# ---------------------------------------------------------------------------

# Days after statement before sending reminder 1
REMINDER_1_AFTER_DAYS = 7
# Days after reminder 1 before sending reminder 2 (30 days total from statement)
REMINDER_2_AFTER_DAYS = 23
# Days after reminder 2 before sending reminder 3 (60 days total from statement)
REMINDER_3_AFTER_DAYS = 30


@dataclass
class PendingReminder:
    """A reminder that is due to be sent."""
    account_id: str
    claim_id: str
    patient_email: str
    patient_name: str
    amount_due: float
    reminder_level: int  # 0 = initial statement, 1/2/3 = reminder levels
    practice_name: str
    payment_link: str = ""


async def get_pending_reminders(account_id: str) -> list[PendingReminder]:
    """Determine which claims need a statement or reminder.

    Logic:
      - Find claims with patient_responsibility > 0 and no completed payment.
      - For each, check communication history to decide next action:
        - No statement sent yet → level 0 (send statement)
        - Statement sent >7 days ago, no reminder_1 → level 1
        - reminder_1 sent >23 days ago (30 total) → level 2
        - reminder_2 sent >30 days ago (60 total) → level 3
      - Skip if reminder_3 already sent (collection cycle complete).

    Returns:
        List of PendingReminder objects.
    """
    import uuid as _uuid
    pool = await get_pool()
    now = datetime.now(timezone.utc)

    # Get account info for practice name
    account_row = await pool.fetchrow(
        "SELECT * FROM billing_accounts WHERE id = $1",
        _uuid.UUID(account_id),
    )
    if not account_row:
        return []

    account = dict(account_row)
    settings = account.get("settings") or {}
    practice_name = settings.get("practice_name") or account.get("practice_name", "Your Provider")

    # Find claims with outstanding patient responsibility
    rows = await pool.fetch(
        """
        SELECT c.id, c.patient_responsibility, c.claim_data, c.created_at
        FROM billing_claims c
        WHERE c.account_id = $1
          AND c.patient_responsibility > 0
          AND c.status NOT IN ('paid', 'voided', 'denied')
        ORDER BY c.created_at ASC
        """,
        _uuid.UUID(account_id),
    )

    pending: list[PendingReminder] = []

    for row in rows:
        claim_id = str(row["id"])
        patient_resp = float(row["patient_responsibility"])

        # Check if fully paid by completed payments
        payments = await get_payments_for_claim(claim_id, account_id)
        completed_total = sum(
            float(p["amount"]) for p in payments if p.get("status") == "completed"
        )
        if completed_total >= patient_resp:
            continue  # Fully paid

        amount_due = patient_resp - completed_total

        # Extract patient info from claim_data
        claim_data = row.get("claim_data") or {}
        patient_email = ""
        patient_name = ""
        if isinstance(claim_data, dict):
            patient_email = claim_data.get("patient_email", "")
            patient_name = claim_data.get("patient_name", "")

        if not patient_email:
            continue  # Can't send without email

        # Find existing payment link
        payment_link = ""
        for p in payments:
            if p.get("status") == "pending" and p.get("payment_link_url"):
                payment_link = p["payment_link_url"]
                break

        # Check communication history for this claim
        last_statement = await get_last_communication(claim_id, "statement")
        last_r1 = await get_last_communication(claim_id, "reminder_1")
        last_r2 = await get_last_communication(claim_id, "reminder_2")
        last_r3 = await get_last_communication(claim_id, "reminder_3")

        # Already completed the reminder cycle
        if last_r3:
            continue

        reminder_level: int | None = None

        if not last_statement:
            reminder_level = 0  # Send initial statement
        elif last_r2:
            # Check if reminder_3 is due
            r2_sent = last_r2["sent_at"]
            if isinstance(r2_sent, str):
                r2_sent = datetime.fromisoformat(r2_sent)
            if now - r2_sent >= timedelta(days=REMINDER_3_AFTER_DAYS):
                reminder_level = 3
        elif last_r1:
            # Check if reminder_2 is due
            r1_sent = last_r1["sent_at"]
            if isinstance(r1_sent, str):
                r1_sent = datetime.fromisoformat(r1_sent)
            if now - r1_sent >= timedelta(days=REMINDER_2_AFTER_DAYS):
                reminder_level = 2
        else:
            # Statement was sent; check if reminder_1 is due
            stmt_sent = last_statement["sent_at"]
            if isinstance(stmt_sent, str):
                stmt_sent = datetime.fromisoformat(stmt_sent)
            if now - stmt_sent >= timedelta(days=REMINDER_1_AFTER_DAYS):
                reminder_level = 1

        if reminder_level is not None:
            pending.append(PendingReminder(
                account_id=account_id,
                claim_id=claim_id,
                patient_email=patient_email,
                patient_name=patient_name,
                amount_due=amount_due,
                reminder_level=reminder_level,
                practice_name=practice_name,
                payment_link=payment_link,
            ))

    return pending


async def process_reminders_for_account(account_id: str) -> list[dict]:
    """Process all pending reminders for a single account.

    Returns a list of results (one per communication sent/attempted).
    """
    pending = await get_pending_reminders(account_id)
    results = []

    for reminder in pending:
        try:
            if reminder.reminder_level == 0:
                result = await _send_scheduled_statement(reminder)
            else:
                result = await _send_scheduled_reminder(reminder)
            results.append(result)
        except Exception:
            logger.exception(
                "Failed to process reminder for claim %s, level %d",
                reminder.claim_id, reminder.reminder_level,
            )
            results.append({
                "claim_id": reminder.claim_id,
                "reminder_level": reminder.reminder_level,
                "status": "error",
            })

    return results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _format_amount(amount: float) -> str:
    return f"{amount:,.2f}"


async def _send_scheduled_statement(reminder: PendingReminder) -> dict:
    """Send an initial statement via the scheduler."""
    from db import get_claim, get_eras_for_claim

    claim = await get_claim(reminder.claim_id, reminder.account_id)
    total_charge = float(claim.get("total_charge", 0)) if claim else 0
    insurance_paid = float(claim.get("total_paid", 0)) if claim else 0
    adjustments = max(total_charge - insurance_paid - reminder.amount_due, 0)

    service_date = ""
    claim_data = (claim or {}).get("claim_data") or {}
    if isinstance(claim_data, dict):
        service_date = claim_data.get("service_date", claim_data.get("date_of_service", ""))
    if not service_date and claim and claim.get("created_at"):
        service_date = claim["created_at"].strftime("%m/%d/%Y")

    context = {
        "patient_name": reminder.patient_name or "Patient",
        "practice_name": reminder.practice_name,
        "service_date": service_date or "N/A",
        "total_charges": _format_amount(total_charge),
        "insurance_paid": _format_amount(insurance_paid),
        "adjustments": _format_amount(adjustments),
        "patient_responsibility": _format_amount(reminder.amount_due),
        "payment_link": reminder.payment_link,
    }

    sent = await email_client.send_template(reminder.patient_email, "patient_statement", context)
    status = "sent" if sent else "failed"

    comm = await create_communication_record(
        account_id=reminder.account_id,
        claim_id=reminder.claim_id,
        comm_type="statement",
        recipient_email=reminder.patient_email,
        recipient_name=reminder.patient_name,
        subject=f"Statement from {reminder.practice_name}",
        status=status,
        metadata={"amount_due": reminder.amount_due, "automated": True},
    )

    await create_event(
        account_id=reminder.account_id,
        event_type="statement_sent",
        resource_type="communication",
        resource_id=str(comm["id"]),
        data={
            "claim_id": reminder.claim_id,
            "amount_due": reminder.amount_due,
            "automated": True,
            "status": status,
        },
    )

    return {
        "claim_id": reminder.claim_id,
        "reminder_level": 0,
        "comm_type": "statement",
        "status": status,
        "communication_id": str(comm["id"]),
    }


async def _send_scheduled_reminder(reminder: PendingReminder) -> dict:
    """Send a reminder (level 1/2/3) via the scheduler."""
    template_name = f"payment_reminder_{reminder.reminder_level}"
    context = {
        "patient_name": reminder.patient_name or "Patient",
        "practice_name": reminder.practice_name,
        "amount_due": _format_amount(reminder.amount_due),
        "payment_link": reminder.payment_link,
    }

    sent = await email_client.send_template(reminder.patient_email, template_name, context)
    status = "sent" if sent else "failed"

    comm_type = f"reminder_{reminder.reminder_level}"
    comm = await create_communication_record(
        account_id=reminder.account_id,
        claim_id=reminder.claim_id,
        comm_type=comm_type,
        recipient_email=reminder.patient_email,
        recipient_name=reminder.patient_name,
        subject=f"Payment Reminder — {reminder.practice_name}",
        status=status,
        metadata={
            "amount_due": reminder.amount_due,
            "reminder_level": reminder.reminder_level,
            "automated": True,
        },
    )

    await create_event(
        account_id=reminder.account_id,
        event_type=f"reminder_{reminder.reminder_level}_sent",
        resource_type="communication",
        resource_id=str(comm["id"]),
        data={
            "claim_id": reminder.claim_id,
            "amount_due": reminder.amount_due,
            "reminder_level": reminder.reminder_level,
            "automated": True,
            "status": status,
        },
    )

    return {
        "claim_id": reminder.claim_id,
        "reminder_level": reminder.reminder_level,
        "comm_type": comm_type,
        "status": status,
        "communication_id": str(comm["id"]),
    }
