"""ERA (835 remittance) routes — parsing, querying, and processing."""
import logging
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_api_key, require_permission
from db import (
    get_era, get_eras_for_claim, create_era,
    get_claim, update_claim_status, update_claim_adjudication,
    update_claim_denial_fields, create_event,
)
from denial_engine import (
    categorize_denial, suggest_corrections,
    serialize_denial_category, serialize_suggestion,
)
from integrations.stedi import stedi_client, CARC_DESCRIPTIONS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/era", tags=["era"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class ERAAdjustmentModel(BaseModel):
    group_code: str = ""
    reason_code: str = ""
    amount: float = 0
    description: str = ""


class ERAServiceLineModel(BaseModel):
    cpt_code: str = ""
    charged_amount: float = 0
    allowed_amount: float = 0
    paid_amount: float = 0
    adjustments: list[ERAAdjustmentModel] = Field(default_factory=list)


class ERAClaimPaymentModel(BaseModel):
    patient_name: str = ""
    member_id: str = ""
    claim_id: str = ""
    charged_amount: float = 0
    paid_amount: float = 0
    patient_responsibility: float = 0
    adjustments: list[ERAAdjustmentModel] = Field(default_factory=list)
    service_lines: list[ERAServiceLineModel] = Field(default_factory=list)
    is_denied: bool = False
    denial_reason: str = ""


class ERADetailResponse(BaseModel):
    id: str
    account_id: str
    claim_id: str
    stedi_era_id: str | None = None
    check_number: str | None = None
    payer_name: str | None = None
    payment_amount: float
    adjustment_amount: float
    patient_responsibility: float
    adjustment_reasons: list[ERAAdjustmentModel] = Field(default_factory=list)
    claim_payments: list[ERAClaimPaymentModel] = Field(default_factory=list)
    processed_at: str | None = None
    created_at: str


class ERAListResponse(BaseModel):
    eras: list[ERADetailResponse]
    count: int


class ERAProcessRequest(BaseModel):
    era_data: dict = Field(..., description="Stedi ERA/835 JSON payload")
    stedi_era_id: str | None = None


class ERAProcessClaimSummary(BaseModel):
    claim_id: str
    external_superbill_id: str = ""
    paid_amount: float = 0
    patient_responsibility: float = 0
    status: str = ""
    is_denied: bool = False
    denial_reason: str = ""
    payment_link_flagged: bool = False


class ERAProcessResponse(BaseModel):
    era_id: str
    check_number: str = ""
    payer_name: str = ""
    total_payment_amount: float = 0
    claims_processed: list[ERAProcessClaimSummary] = Field(default_factory=list)
    claims_unmatched: int = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_era(era: dict) -> dict:
    """Convert DB record to API response."""
    # Parse ERA data to extract claim payments if available
    claim_payments = []
    era_data = era.get("era_data") or {}
    if era_data:
        try:
            parsed = stedi_client.parse_era(era_data)
            claim_payments = [
                {
                    "patient_name": cp.patient_name,
                    "member_id": cp.member_id,
                    "claim_id": cp.claim_id,
                    "charged_amount": cp.charged_amount,
                    "paid_amount": cp.paid_amount,
                    "patient_responsibility": cp.patient_responsibility,
                    "adjustments": [
                        {"group_code": a.group_code, "reason_code": a.reason_code,
                         "amount": a.amount, "description": a.description}
                        for a in cp.adjustments
                    ],
                    "service_lines": [
                        {
                            "cpt_code": sl.cpt_code,
                            "charged_amount": sl.charged_amount,
                            "allowed_amount": sl.allowed_amount,
                            "paid_amount": sl.paid_amount,
                            "adjustments": [
                                {"group_code": a.group_code, "reason_code": a.reason_code,
                                 "amount": a.amount, "description": a.description}
                                for a in sl.adjustments
                            ],
                        }
                        for sl in cp.service_lines
                    ],
                    "is_denied": cp.is_denied,
                    "denial_reason": cp.denial_reason,
                }
                for cp in parsed.claim_payments
            ]
        except Exception:
            logger.warning("Failed to re-parse ERA data for era_id=%s", era.get("id"))

    # Ensure adjustment_reasons have descriptions
    adj_reasons = era.get("adjustment_reasons") or []
    enriched_reasons = []
    for ar in adj_reasons:
        if isinstance(ar, dict):
            code = str(ar.get("code", ar.get("reason_code", "")))
            enriched_reasons.append({
                "group_code": ar.get("group", ar.get("group_code", "")),
                "reason_code": code,
                "amount": float(ar.get("amount", 0)),
                "description": ar.get("description") or CARC_DESCRIPTIONS.get(code, f"Reason code {code}"),
            })

    return {
        "id": str(era["id"]),
        "account_id": str(era["account_id"]),
        "claim_id": str(era["claim_id"]),
        "stedi_era_id": era.get("stedi_era_id"),
        "check_number": era.get("check_number"),
        "payer_name": era.get("payer_name"),
        "payment_amount": float(era["payment_amount"]),
        "adjustment_amount": float(era["adjustment_amount"]),
        "patient_responsibility": float(era["patient_responsibility"]),
        "adjustment_reasons": enriched_reasons,
        "claim_payments": claim_payments,
        "processed_at": era["processed_at"].isoformat() if era.get("processed_at") else None,
        "created_at": era["created_at"].isoformat(),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/{era_id}", response_model=ERADetailResponse)
async def get_era_detail(era_id: str, account: dict = Depends(require_permission("billing"))):
    """Return parsed ERA details including adjustment codes with plain-English descriptions."""
    era = await get_era(era_id, str(account["id"]))
    if not era:
        raise HTTPException(status_code=404, detail="ERA not found")
    return _serialize_era(era)


@router.get("/claim/{claim_id}", response_model=ERAListResponse)
async def get_eras_for_claim_endpoint(claim_id: str, account: dict = Depends(require_permission("billing"))):
    """Return all ERAs for a claim."""
    eras = await get_eras_for_claim(claim_id, str(account["id"]))
    return {
        "eras": [_serialize_era(e) for e in eras],
        "count": len(eras),
    }


@router.get("/superbill/{superbill_id}", response_model=ERAListResponse)
async def get_eras_for_superbill_endpoint(superbill_id: str, account: dict = Depends(require_permission("billing"))):
    """Return all ERAs for a superbill by looking up the claim via external_superbill_id."""
    account_id = str(account["id"])
    claim = await _find_claim_by_superbill_id(account_id, superbill_id)
    if not claim:
        raise HTTPException(status_code=404, detail="No claim found for this superbill")
    eras = await get_eras_for_claim(str(claim["id"]), account_id)
    if not eras:
        raise HTTPException(status_code=404, detail="No ERA data found for this superbill")
    return {
        "eras": [_serialize_era(e) for e in eras],
        "count": len(eras),
    }


@router.post("/process", response_model=ERAProcessResponse)
async def process_era(body: ERAProcessRequest, account: dict = Depends(require_permission("billing"))):
    """Process an incoming ERA/835.

    Called when a new ERA arrives (from polling Stedi or webhook simulation).
    Flow:
      1. Parse the ERA data via Stedi client
      2. For each claim payment, match to existing billing_claims by patient_control_number
      3. Create billing_eras record
      4. Update billing_claims: total_paid, patient_responsibility, status
      5. Log billing_event (era_received)
      6. If patient responsibility > 0 and Stripe is connected: flag for payment link
      7. Return processing summary
    """
    account_id = str(account["id"])

    # --- Step 1: Parse ERA ---
    parsed = stedi_client.parse_era(body.era_data)
    if not parsed.success:
        raise HTTPException(status_code=422, detail="ERA contains no claim payment data")

    claims_processed: list[dict] = []
    claims_unmatched = 0

    # Check if account has Stripe connected
    stripe_connected = bool(account.get("stripe_connect_account_id"))

    # --- Step 2–6: Process each claim payment ---
    for cp in parsed.claim_payments:
        # Try to match to an existing claim by external_superbill_id
        # The claim_id from ERA maps to our patientControlNumber / external_superbill_id
        claim = None
        if cp.claim_id:
            claim = await _find_claim_by_superbill_id(account_id, cp.claim_id)

        if not claim:
            logger.warning(
                "ERA claim_id=%s could not be matched to a billing_claim",
                cp.claim_id,
            )
            claims_unmatched += 1
            continue

        claim_id = str(claim["id"])

        # Determine new status
        if cp.is_denied:
            new_status = "denied"
        else:
            new_status = "adjudicated"

        # Build adjustment reasons list for storage
        adj_reasons = [
            {
                "group_code": a.group_code,
                "reason_code": a.reason_code,
                "amount": a.amount,
                "description": a.description,
            }
            for a in cp.adjustments
        ]

        # Total adjustment = charged - paid - patient responsibility
        adjustment_amount = cp.charged_amount - cp.paid_amount - cp.patient_responsibility

        # --- Step 3: Create ERA record ---
        era_record = await create_era(
            account_id=account_id,
            claim_id=claim_id,
            era_data=body.era_data,
            payment_amount=cp.paid_amount,
            adjustment_amount=adjustment_amount,
            patient_responsibility=cp.patient_responsibility,
            adjustment_reasons=adj_reasons,
            check_number=parsed.check_number,
            payer_name=parsed.payer_name,
            stedi_era_id=body.stedi_era_id,
        )
        era_id = str(era_record["id"])

        # --- Step 4: Update claim ---
        denial_codes = None
        if cp.is_denied:
            denial_codes = [
                {"reason_code": a.reason_code, "description": a.description}
                for a in cp.adjustments
                if a.reason_code in _get_denial_codes()
            ]

        await update_claim_status(
            claim_id=claim_id,
            account_id=account_id,
            status=new_status,
            details=f"ERA received — paid ${cp.paid_amount:.2f}, patient responsibility ${cp.patient_responsibility:.2f}",
        )

        await update_claim_adjudication(
            claim_id=claim_id,
            account_id=account_id,
            total_paid=cp.paid_amount,
            patient_responsibility=cp.patient_responsibility,
            denial_codes=denial_codes,
        )

        # --- Step 4b: Categorize denial and store suggestions ---
        denial_category_data = None
        denial_suggestions_data = None
        if cp.is_denied:
            carc_codes = [a.reason_code for a in cp.adjustments if a.reason_code]
            group_codes = [a.group_code for a in cp.adjustments if a.group_code]
            if carc_codes:
                dc = categorize_denial(carc_codes, group_codes)
                denial_category_data = serialize_denial_category(dc)
                claim_data = claim.get("claim_data") or {}
                suggs = suggest_corrections(dc.category, carc_codes, claim_data)
                denial_suggestions_data = [serialize_suggestion(s) for s in suggs]

                await update_claim_denial_fields(
                    claim_id=claim_id,
                    account_id=account_id,
                    denial_category=denial_category_data,
                    denial_suggestions=denial_suggestions_data,
                )

                logger.info(
                    "Claim %s denied — category=%s, codes=%s",
                    claim_id, dc.category, carc_codes,
                )

        # --- Step 5: Log event ---
        event_data = {
            "claim_id": claim_id,
            "check_number": parsed.check_number,
            "paid_amount": cp.paid_amount,
            "patient_responsibility": cp.patient_responsibility,
            "payer_name": parsed.payer_name,
            "is_denied": cp.is_denied,
        }
        await create_event(
            account_id=account_id,
            event_type="era_received",
            resource_type="era",
            resource_id=era_id,
            data=event_data,
        )

        # Log separate denial event with category and suggestions
        if cp.is_denied and denial_category_data:
            await create_event(
                account_id=account_id,
                event_type="claim_denied",
                resource_type="claim",
                resource_id=claim_id,
                data={
                    "era_id": era_id,
                    "denial_category": denial_category_data.get("category"),
                    "denial_codes": [a.reason_code for a in cp.adjustments if a.reason_code],
                    "suggestion_count": len(denial_suggestions_data or []),
                    "is_appealable": denial_category_data.get("is_appealable", False),
                },
            )

        # --- Step 6: Flag for payment link if applicable ---
        payment_link_flagged = False
        if cp.patient_responsibility > 0 and stripe_connected and not cp.is_denied:
            payment_link_flagged = True
            await create_event(
                account_id=account_id,
                event_type="patient_payment_due",
                resource_type="claim",
                resource_id=claim_id,
                data={
                    "amount": cp.patient_responsibility,
                    "era_id": era_id,
                    "patient_name": cp.patient_name,
                },
            )

        claims_processed.append({
            "claim_id": claim_id,
            "external_superbill_id": claim.get("external_superbill_id", ""),
            "paid_amount": cp.paid_amount,
            "patient_responsibility": cp.patient_responsibility,
            "status": new_status,
            "is_denied": cp.is_denied,
            "denial_reason": cp.denial_reason,
            "payment_link_flagged": payment_link_flagged,
        })

    logger.info(
        "ERA processed for account %s: %d claims matched, %d unmatched",
        account_id, len(claims_processed), claims_unmatched,
    )

    return {
        "era_id": era_id if claims_processed else "",
        "check_number": parsed.check_number,
        "payer_name": parsed.payer_name,
        "total_payment_amount": parsed.total_payment_amount,
        "claims_processed": claims_processed,
        "claims_unmatched": claims_unmatched,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _find_claim_by_superbill_id(account_id: str, superbill_id: str) -> dict | None:
    """Look up a claim by external_superbill_id for ERA matching."""
    from db import get_pool
    import uuid as _uuid
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT * FROM billing_claims
        WHERE account_id = $1 AND external_superbill_id = $2
        ORDER BY created_at DESC
        LIMIT 1
        """,
        _uuid.UUID(account_id), superbill_id,
    )
    return dict(row) if row else None


def _get_denial_codes() -> set:
    """Return the set of denial-indicating CARC reason codes."""
    return {
        "5", "9", "29", "31", "34", "35", "39", "40", "49", "50", "51",
        "96", "109", "119", "150", "167", "170", "171", "197", "198", "204",
        "246", "247",
    }
