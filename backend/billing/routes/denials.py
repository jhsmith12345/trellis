"""Denial management routes — list, detail, resubmit, and analytics."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import require_api_key
from db import (
    get_claim, get_denied_claims, get_denial_analytics,
    update_claim_status, update_claim_denial_fields,
    create_claim, create_event,
)
from denial_engine import (
    categorize_denial, suggest_corrections, can_auto_resubmit,
    prepare_resubmission, serialize_denial_category, serialize_suggestion,
    CARC_DESCRIPTIONS,
)
from integrations.stedi import stedi_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/denials", tags=["denials"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class DenialSuggestionModel(BaseModel):
    action: str
    description: str
    auto_fixable: bool
    priority: str


class DenialCategoryModel(BaseModel):
    category: str
    label: str
    description: str
    is_appealable: bool
    typical_resolution: str
    matched_codes: list[str] = Field(default_factory=list)


class DenialCodeDetail(BaseModel):
    reason_code: str
    description: str
    group_code: str = ""


class DenialListItem(BaseModel):
    claim_id: str
    external_superbill_id: str
    payer_name: str
    payer_id: str
    total_charge: float
    total_paid: float
    denial_category: DenialCategoryModel | None = None
    denial_codes: list[DenialCodeDetail] = Field(default_factory=list)
    suggestions: list[DenialSuggestionModel] = Field(default_factory=list)
    days_since_denial: int = 0
    can_auto_resubmit: bool = False
    resubmission_count: int = 0
    denied_at: str | None = None
    created_at: str


class DenialListResponse(BaseModel):
    denials: list[DenialListItem]
    count: int
    total_denied_amount: float = 0


class DenialDetailResponse(BaseModel):
    claim_id: str
    external_superbill_id: str
    payer_name: str
    payer_id: str
    total_charge: float
    total_paid: float
    patient_responsibility: float
    status: str
    denial_category: DenialCategoryModel | None = None
    denial_codes: list[DenialCodeDetail] = Field(default_factory=list)
    suggestions: list[DenialSuggestionModel] = Field(default_factory=list)
    can_auto_resubmit: bool = False
    resubmission_count: int = 0
    original_claim_id: str | None = None
    related_claims: list[dict] = Field(default_factory=list)
    status_history: list[dict] = Field(default_factory=list)
    denied_at: str | None = None
    created_at: str
    updated_at: str


class ResubmitRequest(BaseModel):
    corrections: dict = Field(..., description="Field overrides to correct the claim (supports dot notation for nested fields)")
    is_replacement: bool = Field(True, description="Submit as replacement (frequency code 7) vs new claim")


class ResubmitResponse(BaseModel):
    new_claim_id: str
    status: str
    stedi_claim_id: str | None = None
    warnings: list[str] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)


class DenialCategoryAnalytic(BaseModel):
    category: str
    label: str
    count: int
    percentage: float


class DenialPayerAnalytic(BaseModel):
    payer_name: str
    count: int
    percentage: float


class DenialCodeAnalytic(BaseModel):
    reason_code: str
    description: str
    count: int


class DenialTrendPoint(BaseModel):
    month: str
    count: int


class DenialAnalyticsResponse(BaseModel):
    total_claims: int
    total_denied: int
    denial_rate: float
    total_denied_amount: float
    average_days_to_resolve: float | None = None
    by_category: list[DenialCategoryAnalytic] = Field(default_factory=list)
    by_payer: list[DenialPayerAnalytic] = Field(default_factory=list)
    top_reason_codes: list[DenialCodeAnalytic] = Field(default_factory=list)
    trend: list[DenialTrendPoint] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_denial_codes(claim: dict) -> tuple[list[dict], list[str], list[str]]:
    """Extract denial code details, CARC codes, and group codes from a claim."""
    denial_codes_raw = claim.get("denial_codes") or []
    code_details = []
    carc_codes = []
    group_codes = []

    for dc in denial_codes_raw:
        if isinstance(dc, dict):
            rc = str(dc.get("reason_code", ""))
            gc = str(dc.get("group_code", ""))
            desc = dc.get("description") or CARC_DESCRIPTIONS.get(rc, f"Reason code {rc}")
            code_details.append({"reason_code": rc, "description": desc, "group_code": gc})
            if rc:
                carc_codes.append(rc)
            if gc:
                group_codes.append(gc)

    return code_details, carc_codes, group_codes


def _compute_days_since(dt: datetime | None) -> int:
    """Compute days between a datetime and now."""
    if not dt:
        return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    return max(0, delta.days)


def _serialize_denial_list_item(claim: dict) -> dict:
    """Serialize a denied claim for the list endpoint."""
    code_details, carc_codes, group_codes = _extract_denial_codes(claim)

    # Use stored category/suggestions if available, otherwise compute
    stored_category = claim.get("denial_category")
    stored_suggestions = claim.get("denial_suggestions")

    if stored_category and isinstance(stored_category, dict):
        category_data = stored_category
    elif carc_codes:
        dc = categorize_denial(carc_codes, group_codes)
        category_data = serialize_denial_category(dc)
    else:
        category_data = None

    if stored_suggestions and isinstance(stored_suggestions, list):
        suggestions_data = stored_suggestions
    elif carc_codes:
        cat_name = category_data["category"] if category_data else "other"
        suggs = suggest_corrections(cat_name, carc_codes, claim.get("claim_data") or {})
        suggestions_data = [serialize_suggestion(s) for s in suggs]
    else:
        suggestions_data = []

    # Determine denied_at from status_history
    denied_at = claim.get("adjudicated_at")
    days_since = _compute_days_since(denied_at)

    # Check auto-resubmit eligibility
    cat_name = category_data["category"] if category_data else "other"
    auto_resubmit = can_auto_resubmit(cat_name, claim.get("claim_data") or {})

    return {
        "claim_id": str(claim["id"]),
        "external_superbill_id": claim.get("external_superbill_id", ""),
        "payer_name": claim.get("payer_name", ""),
        "payer_id": claim.get("payer_id", ""),
        "total_charge": float(claim.get("total_charge") or 0),
        "total_paid": float(claim.get("total_paid") or 0),
        "denial_category": category_data,
        "denial_codes": code_details,
        "suggestions": suggestions_data,
        "days_since_denial": days_since,
        "can_auto_resubmit": auto_resubmit,
        "resubmission_count": claim.get("resubmission_count") or 0,
        "denied_at": denied_at.isoformat() if denied_at else None,
        "created_at": claim["created_at"].isoformat(),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/analytics", response_model=DenialAnalyticsResponse)
async def denial_analytics(account: dict = Depends(require_api_key)):
    """Return denial analytics for the account.

    Includes denial rate, breakdowns by category and payer, top reason codes,
    and monthly trend data.
    """
    account_id = str(account["id"])
    analytics = await get_denial_analytics(account_id)
    return analytics


@router.get("/{claim_id}", response_model=DenialDetailResponse)
async def get_denial_detail(claim_id: str, account: dict = Depends(require_api_key)):
    """Return detailed denial information for a specific claim.

    Includes denial codes with descriptions, category, suggestions,
    resubmission eligibility, and related claim history.
    """
    account_id = str(account["id"])
    claim = await get_claim(claim_id, account_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    if claim.get("status") != "denied":
        raise HTTPException(status_code=400, detail="Claim is not in denied status")

    code_details, carc_codes, group_codes = _extract_denial_codes(claim)

    # Category
    stored_category = claim.get("denial_category")
    if stored_category and isinstance(stored_category, dict):
        category_data = stored_category
    elif carc_codes:
        dc = categorize_denial(carc_codes, group_codes)
        category_data = serialize_denial_category(dc)
    else:
        category_data = None

    # Suggestions
    stored_suggestions = claim.get("denial_suggestions")
    if stored_suggestions and isinstance(stored_suggestions, list):
        suggestions_data = stored_suggestions
    elif carc_codes:
        cat_name = category_data["category"] if category_data else "other"
        suggs = suggest_corrections(cat_name, carc_codes, claim.get("claim_data") or {})
        suggestions_data = [serialize_suggestion(s) for s in suggs]
    else:
        suggestions_data = []

    # Auto-resubmit
    cat_name = category_data["category"] if category_data else "other"
    auto_resubmit = can_auto_resubmit(cat_name, claim.get("claim_data") or {})

    # Related claims (same external_superbill_id — previous submissions)
    related = await _get_related_claims(account_id, claim)

    denied_at = claim.get("adjudicated_at")

    return {
        "claim_id": str(claim["id"]),
        "external_superbill_id": claim.get("external_superbill_id", ""),
        "payer_name": claim.get("payer_name", ""),
        "payer_id": claim.get("payer_id", ""),
        "total_charge": float(claim.get("total_charge") or 0),
        "total_paid": float(claim.get("total_paid") or 0),
        "patient_responsibility": float(claim.get("patient_responsibility") or 0),
        "status": claim["status"],
        "denial_category": category_data,
        "denial_codes": code_details,
        "suggestions": suggestions_data,
        "can_auto_resubmit": auto_resubmit,
        "resubmission_count": claim.get("resubmission_count") or 0,
        "original_claim_id": str(claim["original_claim_id"]) if claim.get("original_claim_id") else None,
        "related_claims": related,
        "status_history": claim.get("status_history") or [],
        "denied_at": denied_at.isoformat() if denied_at else None,
        "created_at": claim["created_at"].isoformat(),
        "updated_at": claim["updated_at"].isoformat(),
    }


@router.get("", response_model=DenialListResponse)
async def list_denials(
    category: str | None = Query(None, description="Filter by denial category"),
    payer_name: str | None = Query(None, description="Filter by payer name"),
    sort_by: str = Query("denied_at", description="Sort field: denied_at, payer_name, category"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    account: dict = Depends(require_api_key),
):
    """List all denied claims for the account.

    Enriched with denial category, suggestions, and days since denial.
    Sortable and filterable by category and payer.
    """
    account_id = str(account["id"])

    filters = {}
    if category:
        filters["denial_category"] = category
    if payer_name:
        filters["payer_name"] = payer_name

    claims = await get_denied_claims(
        account_id=account_id,
        filters=filters,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )

    items = [_serialize_denial_list_item(c) for c in claims]
    total_denied_amount = sum(
        float(c.get("total_charge") or 0) - float(c.get("total_paid") or 0)
        for c in claims
    )

    return {
        "denials": items,
        "count": len(items),
        "total_denied_amount": round(total_denied_amount, 2),
    }


@router.post("/{claim_id}/resubmit", response_model=ResubmitResponse)
async def resubmit_denied_claim(
    claim_id: str,
    body: ResubmitRequest,
    account: dict = Depends(require_api_key),
):
    """Correct and resubmit a denied claim.

    Applies corrections to the original claim data, creates a new claim record
    linked to the original, and submits via Stedi.
    """
    account_id = str(account["id"])

    # Fetch the denied claim
    claim = await get_claim(claim_id, account_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.get("status") != "denied":
        raise HTTPException(status_code=400, detail="Only denied claims can be resubmitted")

    original_claim_data = claim.get("claim_data") or {}
    if not original_claim_data:
        raise HTTPException(status_code=400, detail="Original claim data not available for resubmission")

    # Prepare corrected claim data
    original_ref = claim.get("stedi_claim_id") or str(claim["id"])
    corrected_data = prepare_resubmission(
        claim_data=original_claim_data,
        corrections=body.corrections,
        is_replacement=body.is_replacement,
        original_reference=original_ref,
    )

    # Validate corrected claim
    validation = stedi_client.validate_claim(corrected_data)
    if not validation.is_valid:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Corrected claim validation failed",
                "errors": validation.errors,
                "warnings": validation.warnings,
            },
        )

    # Create new claim record linked to original
    resubmission_count = (claim.get("resubmission_count") or 0) + 1
    new_claim = await create_claim(
        account_id=account_id,
        external_superbill_id=claim["external_superbill_id"],
        claim_data=corrected_data,
        payer_name=claim["payer_name"],
        payer_id=claim["payer_id"],
        total_charge=float(claim["total_charge"]),
    )
    new_claim_id = str(new_claim["id"])

    # Update the new claim with linkage to original
    await update_claim_denial_fields(
        claim_id=new_claim_id,
        account_id=account_id,
        original_claim_id=claim_id,
        resubmission_count=resubmission_count,
    )

    # Also update original claim's resubmission count
    await update_claim_denial_fields(
        claim_id=claim_id,
        account_id=account_id,
        resubmission_count=resubmission_count,
    )

    # Submit to Stedi
    stedi_resp = await stedi_client.submit_claim(corrected_data)

    if stedi_resp.success:
        await update_claim_status(
            claim_id=new_claim_id,
            account_id=account_id,
            status="submitted",
            details=f"Resubmission of denied claim {claim_id}",
            stedi_claim_id=stedi_resp.claim_id,
        )
        await create_event(
            account_id=account_id,
            event_type="claim_resubmitted",
            resource_type="claim",
            resource_id=new_claim_id,
            data={
                "original_claim_id": claim_id,
                "stedi_claim_id": stedi_resp.claim_id,
                "corrections": body.corrections,
                "is_replacement": body.is_replacement,
                "resubmission_count": resubmission_count,
            },
        )
        logger.info(
            "Denied claim %s resubmitted as %s (stedi_id=%s)",
            claim_id, new_claim_id, stedi_resp.claim_id,
        )
        return ResubmitResponse(
            new_claim_id=new_claim_id,
            status="submitted",
            stedi_claim_id=stedi_resp.claim_id,
            warnings=validation.warnings + stedi_resp.warnings,
        )
    else:
        await update_claim_status(
            claim_id=new_claim_id,
            account_id=account_id,
            status="rejected",
            details=f"Resubmission rejected: {stedi_resp.errors}",
        )
        await create_event(
            account_id=account_id,
            event_type="claim_resubmitted",
            resource_type="claim",
            resource_id=new_claim_id,
            data={
                "original_claim_id": claim_id,
                "status": "rejected",
                "errors": stedi_resp.errors,
            },
        )
        logger.warning("Resubmission of claim %s rejected: %s", claim_id, stedi_resp.errors)
        return ResubmitResponse(
            new_claim_id=new_claim_id,
            status="rejected",
            warnings=validation.warnings,
            errors=stedi_resp.errors,
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_related_claims(account_id: str, claim: dict) -> list[dict]:
    """Find related claims (same external_superbill_id or linked via original_claim_id)."""
    from db import get_pool
    import uuid as _uuid

    pool = await get_pool()
    claim_id = claim["id"]
    superbill_id = claim.get("external_superbill_id")

    rows = await pool.fetch(
        """
        SELECT id, status, stedi_claim_id, total_charge, total_paid,
               created_at, resubmission_count, original_claim_id
        FROM billing_claims
        WHERE account_id = $1
          AND id != $2
          AND (external_superbill_id = $3 OR original_claim_id = $2)
        ORDER BY created_at DESC
        LIMIT 20
        """,
        _uuid.UUID(account_id), claim_id, superbill_id,
    )

    return [
        {
            "claim_id": str(r["id"]),
            "status": r["status"],
            "stedi_claim_id": r.get("stedi_claim_id"),
            "total_charge": float(r.get("total_charge") or 0),
            "total_paid": float(r.get("total_paid") or 0),
            "created_at": r["created_at"].isoformat(),
            "resubmission_count": r.get("resubmission_count") or 0,
            "is_original": str(r.get("original_claim_id") or "") == "",
        }
        for r in rows
    ]
