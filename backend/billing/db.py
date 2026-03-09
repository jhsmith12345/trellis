"""Billing service database layer using asyncpg.

Standalone database module — does NOT import from backend/shared/.
Provides connection pool management and all billing-specific CRUD operations.
"""
import json as _json
import logging
import uuid
from datetime import datetime, timezone

import asyncpg

from config import DATABASE_URL

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def _init_connection(conn):
    """Set up JSONB codec so asyncpg returns Python dicts for JSONB columns."""
    await conn.set_type_codec(
        'jsonb',
        encoder=_json.dumps,
        decoder=_json.loads,
        schema='pg_catalog',
    )
    await conn.set_type_codec(
        'json',
        encoder=_json.dumps,
        decoder=_json.loads,
        schema='pg_catalog',
    )


async def get_pool() -> asyncpg.Pool:
    """Get or create the connection pool."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL, min_size=2, max_size=10, init=_init_connection
        )
        logger.info("Billing database pool created")
    return _pool


async def close_pool():
    """Close the connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("Billing database pool closed")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# billing_accounts
# ---------------------------------------------------------------------------

async def get_account_by_api_key(api_key_hash: str) -> dict | None:
    """Look up an account by hashed API key."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM billing_accounts WHERE api_key = $1",
        api_key_hash,
    )
    return dict(row) if row else None


async def get_account(account_id: str) -> dict | None:
    """Fetch an account by ID."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM billing_accounts WHERE id = $1",
        uuid.UUID(account_id),
    )
    return dict(row) if row else None


async def create_account(
    practice_name: str,
    api_key_hash: str,
    api_key_prefix: str,
) -> dict:
    """Create a new billing account."""
    pool = await get_pool()
    account_id = uuid.uuid4()
    now = _now()
    row = await pool.fetchrow(
        """
        INSERT INTO billing_accounts (id, practice_name, api_key, api_key_prefix, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'active', $5, $5)
        RETURNING *
        """,
        account_id, practice_name, api_key_hash, api_key_prefix, now,
    )
    return dict(row)


async def update_account_settings(account_id: str, settings: dict) -> dict | None:
    """Update account settings JSONB."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE billing_accounts SET settings = $1, updated_at = $2
        WHERE id = $3 RETURNING *
        """,
        settings, _now(), uuid.UUID(account_id),
    )
    return dict(row) if row else None


async def update_account_stripe(
    account_id: str, stripe_connect_account_id: str, onboarding_complete: bool
) -> dict | None:
    """Update Stripe Connect details on an account."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE billing_accounts
        SET stripe_connect_account_id = $1, stripe_onboarding_complete = $2, updated_at = $3
        WHERE id = $4 RETURNING *
        """,
        stripe_connect_account_id, onboarding_complete, _now(), uuid.UUID(account_id),
    )
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# billing_claims
# ---------------------------------------------------------------------------

async def create_claim(
    account_id: str,
    external_superbill_id: str,
    claim_data: dict,
    payer_name: str,
    payer_id: str,
    total_charge: float,
) -> dict:
    """Create a new claim record."""
    pool = await get_pool()
    claim_id = uuid.uuid4()
    now = _now()
    status_history = [{"status": "pending", "timestamp": now.isoformat(), "details": "Claim created"}]
    row = await pool.fetchrow(
        """
        INSERT INTO billing_claims
            (id, account_id, external_superbill_id, claim_data, status, status_history,
             payer_name, payer_id, total_charge, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $9)
        RETURNING *
        """,
        claim_id, uuid.UUID(account_id), external_superbill_id, claim_data,
        status_history, payer_name, payer_id, total_charge, now,
    )
    return dict(row)


async def get_claim(claim_id: str, account_id: str) -> dict | None:
    """Fetch a claim by ID, scoped to account."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM billing_claims WHERE id = $1 AND account_id = $2",
        uuid.UUID(claim_id), uuid.UUID(account_id),
    )
    return dict(row) if row else None


async def update_claim_status(
    claim_id: str, account_id: str, status: str, details: str = "",
    stedi_claim_id: str | None = None,
) -> dict | None:
    """Update claim status and append to status_history."""
    pool = await get_pool()
    now = _now()
    entry = {"status": status, "timestamp": now.isoformat(), "details": details}
    row = await pool.fetchrow(
        """
        UPDATE billing_claims
        SET status = $1,
            status_history = status_history || $2::jsonb,
            stedi_claim_id = COALESCE($3, stedi_claim_id),
            submitted_at = CASE WHEN $1 = 'submitted' THEN $4 ELSE submitted_at END,
            adjudicated_at = CASE WHEN $1 IN ('adjudicated', 'paid', 'denied') THEN $4 ELSE adjudicated_at END,
            updated_at = $4
        WHERE id = $5 AND account_id = $6
        RETURNING *
        """,
        status, [entry], stedi_claim_id, now,
        uuid.UUID(claim_id), uuid.UUID(account_id),
    )
    return dict(row) if row else None


async def update_claim_adjudication(
    claim_id: str,
    account_id: str,
    total_paid: float,
    patient_responsibility: float,
    denial_codes: list | None = None,
) -> dict | None:
    """Update claim with adjudication amounts."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE billing_claims
        SET total_paid = $1, patient_responsibility = $2, denial_codes = $3, updated_at = $4
        WHERE id = $5 AND account_id = $6
        RETURNING *
        """,
        total_paid, patient_responsibility, denial_codes, _now(),
        uuid.UUID(claim_id), uuid.UUID(account_id),
    )
    return dict(row) if row else None


async def update_claim_denial_fields(
    claim_id: str,
    account_id: str,
    denial_category: dict | None = None,
    denial_suggestions: list | None = None,
    original_claim_id: str | None = None,
    resubmission_count: int | None = None,
) -> dict | None:
    """Update denial-specific fields on a claim."""
    pool = await get_pool()
    now = _now()

    # Build SET clauses dynamically to only update provided fields
    sets = ["updated_at = $1"]
    params: list = [now]
    idx = 2

    if denial_category is not None:
        sets.append(f"denial_category = ${idx}")
        params.append(_json.dumps(denial_category) if isinstance(denial_category, dict) else denial_category)
        idx += 1

    if denial_suggestions is not None:
        sets.append(f"denial_suggestions = ${idx}")
        params.append(_json.dumps(denial_suggestions) if isinstance(denial_suggestions, list) else denial_suggestions)
        idx += 1

    if original_claim_id is not None:
        sets.append(f"original_claim_id = ${idx}")
        params.append(uuid.UUID(original_claim_id))
        idx += 1

    if resubmission_count is not None:
        sets.append(f"resubmission_count = ${idx}")
        params.append(resubmission_count)
        idx += 1

    params.append(uuid.UUID(claim_id))
    params.append(uuid.UUID(account_id))

    query = f"""
        UPDATE billing_claims
        SET {', '.join(sets)}
        WHERE id = ${idx} AND account_id = ${idx + 1}
        RETURNING *
    """

    row = await pool.fetchrow(query, *params)
    return dict(row) if row else None


async def get_denied_claims(
    account_id: str,
    filters: dict | None = None,
    sort_by: str = "denied_at",
    sort_order: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Fetch denied claims for an account with optional filters and sorting."""
    pool = await get_pool()
    filters = filters or {}

    where_clauses = ["account_id = $1", "status = 'denied'"]
    params: list = [uuid.UUID(account_id)]
    idx = 2

    if "denial_category" in filters:
        where_clauses.append(f"denial_category->>'category' = ${idx}")
        params.append(filters["denial_category"])
        idx += 1

    if "payer_name" in filters:
        where_clauses.append(f"payer_name ILIKE ${idx}")
        params.append(f"%{filters['payer_name']}%")
        idx += 1

    # Map sort_by to actual columns
    sort_map = {
        "denied_at": "adjudicated_at",
        "payer_name": "payer_name",
        "category": "denial_category->>'category'",
        "total_charge": "total_charge",
        "created_at": "created_at",
    }
    sort_col = sort_map.get(sort_by, "adjudicated_at")
    order = "DESC" if sort_order.lower() == "desc" else "ASC"

    query = f"""
        SELECT * FROM billing_claims
        WHERE {' AND '.join(where_clauses)}
        ORDER BY {sort_col} {order} NULLS LAST
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    rows = await pool.fetch(query, *params)
    return [dict(r) for r in rows]


async def get_denial_analytics(account_id: str) -> dict:
    """Compute denial analytics for an account.

    Returns denial rate, breakdowns by category/payer, top codes, and trend.
    """
    pool = await get_pool()
    aid = uuid.UUID(account_id)

    # Total claims and denied claims
    totals = await pool.fetchrow(
        """
        SELECT
            COUNT(*) AS total_claims,
            COUNT(*) FILTER (WHERE status = 'denied') AS total_denied,
            COALESCE(SUM(total_charge) FILTER (WHERE status = 'denied'), 0) AS total_denied_amount
        FROM billing_claims
        WHERE account_id = $1
        """,
        aid,
    )
    total_claims = totals["total_claims"] or 0
    total_denied = totals["total_denied"] or 0
    total_denied_amount = float(totals["total_denied_amount"] or 0)
    denial_rate = round((total_denied / total_claims * 100) if total_claims > 0 else 0, 2)

    # Average days to resolve (denied claims that have been resubmitted and resolved)
    avg_resolve = await pool.fetchval(
        """
        SELECT AVG(EXTRACT(EPOCH FROM (updated_at - adjudicated_at)) / 86400)
        FROM billing_claims
        WHERE account_id = $1 AND status = 'denied' AND adjudicated_at IS NOT NULL
        """,
        aid,
    )
    average_days_to_resolve = round(float(avg_resolve), 1) if avg_resolve else None

    # By category
    cat_rows = await pool.fetch(
        """
        SELECT denial_category->>'category' AS cat, COUNT(*) AS cnt
        FROM billing_claims
        WHERE account_id = $1 AND status = 'denied' AND denial_category IS NOT NULL
        GROUP BY denial_category->>'category'
        ORDER BY cnt DESC
        """,
        aid,
    )

    # Import category metadata for labels
    from denial_engine import _CATEGORY_METADATA
    by_category = []
    for r in cat_rows:
        cat_name = r["cat"] or "other"
        meta = _CATEGORY_METADATA.get(cat_name, {})
        by_category.append({
            "category": cat_name,
            "label": meta.get("label", cat_name),
            "count": r["cnt"],
            "percentage": round((r["cnt"] / total_denied * 100) if total_denied > 0 else 0, 2),
        })

    # By payer
    payer_rows = await pool.fetch(
        """
        SELECT payer_name, COUNT(*) AS cnt
        FROM billing_claims
        WHERE account_id = $1 AND status = 'denied'
        GROUP BY payer_name
        ORDER BY cnt DESC
        LIMIT 20
        """,
        aid,
    )
    by_payer = [
        {
            "payer_name": r["payer_name"] or "Unknown",
            "count": r["cnt"],
            "percentage": round((r["cnt"] / total_denied * 100) if total_denied > 0 else 0, 2),
        }
        for r in payer_rows
    ]

    # Top reason codes — extract from denial_codes JSONB array
    code_rows = await pool.fetch(
        """
        SELECT elem->>'reason_code' AS reason_code, COUNT(*) AS cnt
        FROM billing_claims,
             jsonb_array_elements(denial_codes) AS elem
        WHERE account_id = $1 AND status = 'denied' AND denial_codes IS NOT NULL
        GROUP BY elem->>'reason_code'
        ORDER BY cnt DESC
        LIMIT 15
        """,
        aid,
    )

    from integrations.stedi import CARC_DESCRIPTIONS as _carc
    top_reason_codes = [
        {
            "reason_code": r["reason_code"],
            "description": _carc.get(str(r["reason_code"]), f"Reason code {r['reason_code']}"),
            "count": r["cnt"],
        }
        for r in code_rows
    ]

    # Monthly trend (last 12 months)
    trend_rows = await pool.fetch(
        """
        SELECT TO_CHAR(DATE_TRUNC('month', adjudicated_at), 'YYYY-MM') AS month,
               COUNT(*) AS cnt
        FROM billing_claims
        WHERE account_id = $1 AND status = 'denied' AND adjudicated_at IS NOT NULL
          AND adjudicated_at >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', adjudicated_at)
        ORDER BY DATE_TRUNC('month', adjudicated_at) ASC
        """,
        aid,
    )
    trend = [{"month": r["month"], "count": r["cnt"]} for r in trend_rows]

    return {
        "total_claims": total_claims,
        "total_denied": total_denied,
        "denial_rate": denial_rate,
        "total_denied_amount": round(total_denied_amount, 2),
        "average_days_to_resolve": average_days_to_resolve,
        "by_category": by_category,
        "by_payer": by_payer,
        "top_reason_codes": top_reason_codes,
        "trend": trend,
    }


# ---------------------------------------------------------------------------
# billing_eras
# ---------------------------------------------------------------------------

async def create_era(
    account_id: str,
    claim_id: str,
    era_data: dict,
    payment_amount: float,
    adjustment_amount: float,
    patient_responsibility: float,
    adjustment_reasons: list | None = None,
    check_number: str | None = None,
    payer_name: str | None = None,
    stedi_era_id: str | None = None,
) -> dict:
    """Create an ERA record."""
    pool = await get_pool()
    era_id = uuid.uuid4()
    now = _now()
    row = await pool.fetchrow(
        """
        INSERT INTO billing_eras
            (id, account_id, claim_id, stedi_era_id, era_data, payment_amount,
             adjustment_amount, patient_responsibility, adjustment_reasons,
             check_number, payer_name, processed_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
        RETURNING *
        """,
        era_id, uuid.UUID(account_id), uuid.UUID(claim_id), stedi_era_id,
        era_data, payment_amount, adjustment_amount, patient_responsibility,
        adjustment_reasons, check_number, payer_name, now,
    )
    return dict(row)


async def get_era(era_id: str, account_id: str) -> dict | None:
    """Fetch an ERA by ID, scoped to account."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM billing_eras WHERE id = $1 AND account_id = $2",
        uuid.UUID(era_id), uuid.UUID(account_id),
    )
    return dict(row) if row else None


async def get_eras_for_claim(claim_id: str, account_id: str) -> list[dict]:
    """Fetch all ERAs for a claim."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM billing_eras WHERE claim_id = $1 AND account_id = $2 ORDER BY created_at DESC",
        uuid.UUID(claim_id), uuid.UUID(account_id),
    )
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# billing_payments
# ---------------------------------------------------------------------------

async def create_payment(
    account_id: str,
    claim_id: str,
    amount: float,
    platform_fee: float,
    patient_email: str,
    payment_link_url: str,
    stripe_checkout_session_id: str | None = None,
) -> dict:
    """Create a payment record."""
    pool = await get_pool()
    payment_id = uuid.uuid4()
    now = _now()
    row = await pool.fetchrow(
        """
        INSERT INTO billing_payments
            (id, account_id, claim_id, amount, platform_fee, status, patient_email,
             payment_link_url, stripe_checkout_session_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $9)
        RETURNING *
        """,
        payment_id, uuid.UUID(account_id), uuid.UUID(claim_id), amount,
        platform_fee, patient_email, payment_link_url,
        stripe_checkout_session_id, now,
    )
    return dict(row)


async def get_payment(payment_id: str, account_id: str) -> dict | None:
    """Fetch a payment by ID, scoped to account."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM billing_payments WHERE id = $1 AND account_id = $2",
        uuid.UUID(payment_id), uuid.UUID(account_id),
    )
    return dict(row) if row else None


async def get_payments_for_claim(claim_id: str, account_id: str) -> list[dict]:
    """Fetch all payments for a claim."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM billing_payments WHERE claim_id = $1 AND account_id = $2 ORDER BY created_at DESC",
        uuid.UUID(claim_id), uuid.UUID(account_id),
    )
    return [dict(r) for r in rows]


async def update_payment_status(
    payment_id: str, account_id: str, status: str,
    stripe_payment_intent_id: str | None = None,
) -> dict | None:
    """Update payment status."""
    pool = await get_pool()
    now = _now()
    row = await pool.fetchrow(
        """
        UPDATE billing_payments
        SET status = $1,
            stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
            paid_at = CASE WHEN $1 = 'completed' THEN $3 ELSE paid_at END,
            updated_at = $3
        WHERE id = $4 AND account_id = $5
        RETURNING *
        """,
        status, stripe_payment_intent_id, now,
        uuid.UUID(payment_id), uuid.UUID(account_id),
    )
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# billing_communications
# ---------------------------------------------------------------------------

async def create_communication_record(
    account_id: str,
    claim_id: str | None,
    comm_type: str,
    recipient_email: str,
    recipient_name: str = "",
    subject: str = "",
    status: str = "sent",
    payment_id: str | None = None,
    metadata: dict | None = None,
) -> dict:
    """Create a communication record."""
    pool = await get_pool()
    comm_id = uuid.uuid4()
    now = _now()
    row = await pool.fetchrow(
        """
        INSERT INTO billing_communications
            (id, account_id, claim_id, payment_id, comm_type, recipient_email,
             recipient_name, subject, status, metadata, sent_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
        RETURNING *
        """,
        comm_id,
        uuid.UUID(account_id),
        uuid.UUID(claim_id) if claim_id else None,
        uuid.UUID(payment_id) if payment_id else None,
        comm_type,
        recipient_email,
        recipient_name,
        subject,
        status,
        metadata or {},
        now,
    )
    return dict(row)


async def get_communication_history(
    account_id: str,
    claim_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Fetch communication history for an account, optionally filtered by claim."""
    pool = await get_pool()
    if claim_id:
        rows = await pool.fetch(
            """
            SELECT * FROM billing_communications
            WHERE account_id = $1 AND claim_id = $2
            ORDER BY sent_at DESC
            LIMIT $3 OFFSET $4
            """,
            uuid.UUID(account_id), uuid.UUID(claim_id), limit, offset,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT * FROM billing_communications
            WHERE account_id = $1
            ORDER BY sent_at DESC
            LIMIT $2 OFFSET $3
            """,
            uuid.UUID(account_id), limit, offset,
        )
    return [dict(r) for r in rows]


async def get_last_communication(claim_id: str, comm_type: str) -> dict | None:
    """Get the most recent communication of a given type for a claim.

    Used by the reminder scheduler to determine timing.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT * FROM billing_communications
        WHERE claim_id = $1 AND comm_type = $2 AND status = 'sent'
        ORDER BY sent_at DESC
        LIMIT 1
        """,
        uuid.UUID(claim_id), comm_type,
    )
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# billing_events (append-only)
# ---------------------------------------------------------------------------

async def create_event(
    account_id: str,
    event_type: str,
    resource_type: str,
    resource_id: str,
    data: dict | None = None,
) -> dict:
    """Append an event to the billing event log."""
    pool = await get_pool()
    event_id = uuid.uuid4()
    row = await pool.fetchrow(
        """
        INSERT INTO billing_events (id, account_id, event_type, resource_type, resource_id, data, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        """,
        event_id, uuid.UUID(account_id), event_type, resource_type,
        uuid.UUID(resource_id), data or {}, _now(),
    )
    return dict(row)


async def get_updates_since(account_id: str, since: datetime) -> list[dict]:
    """Return all billing events for an account since a given timestamp.

    Used by EHR installations to poll for updates (claim status changes,
    ERA receipts, payment completions, etc.).
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM billing_events
        WHERE account_id = $1 AND created_at > $2
        ORDER BY created_at ASC
        """,
        uuid.UUID(account_id), since,
    )
    return [dict(r) for r in rows]
