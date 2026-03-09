"""Eligibility verification routes (270/271 transactions).

Provides a POST endpoint that checks patient insurance eligibility via Stedi's
270/271 API (or returns rich stub data when STEDI_API_KEY is not configured).
Results are cached for the current calendar day to avoid redundant API calls.
"""
import hashlib
import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_api_key
from db import create_event
from integrations.stedi import stedi_client, EligibilityResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/eligibility", tags=["eligibility"])

# ---------------------------------------------------------------------------
# In-memory daily cache: cache_key -> (date_str, EligibilityResult)
# Simple dict-based cache scoped to the current date. Cleared implicitly when
# the date rolls over (stale entries ignored on lookup).
# ---------------------------------------------------------------------------
_eligibility_cache: dict[str, tuple[str, EligibilityResult]] = {}


def _make_cache_key(member_id: str, payer_id: str) -> str:
    """Build a deterministic cache key from member + payer."""
    raw = f"{member_id}:{payer_id}".lower()
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _get_cached(cache_key: str) -> EligibilityResult | None:
    """Return a cached result if it exists and was created today."""
    entry = _eligibility_cache.get(cache_key)
    if entry is None:
        return None
    cached_date, result = entry
    if cached_date == date.today().isoformat():
        return result
    # Stale entry — remove it
    _eligibility_cache.pop(cache_key, None)
    return None


def _set_cached(cache_key: str, result: EligibilityResult) -> None:
    _eligibility_cache[cache_key] = (date.today().isoformat(), result)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class EligibilityCheckRequest(BaseModel):
    """Request body for eligibility verification."""
    patient_first_name: str
    patient_last_name: str
    patient_dob: str = Field(..., description="Date of birth (YYYY-MM-DD)")
    patient_gender: str = Field(..., pattern="^[MF]$", description="M or F")
    member_id: str
    payer_id: str
    payer_name: str = ""
    provider_npi: str
    provider_organization_name: str = ""
    service_type_codes: list[str] = Field(default=["30", "MH"])


class DeductibleDetail(BaseModel):
    total: float | None = None
    remaining: float | None = None


class DeductibleInfo(BaseModel):
    individual: DeductibleDetail = Field(default_factory=DeductibleDetail)
    family: DeductibleDetail = Field(default_factory=DeductibleDetail)


class CopayInfo(BaseModel):
    amount: float | None = None
    in_network: float | None = None
    out_of_network: float | None = None


class CoinsuranceInfo(BaseModel):
    in_network_percent: float | None = None
    out_of_network_percent: float | None = None


class OopMaxInfo(BaseModel):
    individual: DeductibleDetail = Field(default_factory=DeductibleDetail)
    family: DeductibleDetail = Field(default_factory=DeductibleDetail)


class SessionLimitsInfo(BaseModel):
    allowed: int | None = None
    used: int | None = None
    remaining: int | None = None


class CarveOutPayerInfo(BaseModel):
    name: str = ""
    id: str = ""


class EligibilityResultResponse(BaseModel):
    """Full parsed eligibility result returned to the caller."""
    active: bool
    plan_name: str = ""
    plan_group: str = ""
    copay: CopayInfo = Field(default_factory=CopayInfo)
    deductible: DeductibleInfo = Field(default_factory=DeductibleInfo)
    coinsurance: CoinsuranceInfo = Field(default_factory=CoinsuranceInfo)
    out_of_pocket_max: OopMaxInfo = Field(default_factory=OopMaxInfo)
    session_limits: SessionLimitsInfo | None = None
    prior_auth_required: bool | None = None
    mental_health_specific: bool = False
    carve_out_payer: CarveOutPayerInfo | None = None
    effective_date: str = ""
    termination_date: str = ""
    errors: list[dict] = Field(default_factory=list)
    cached: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _result_to_response(result: EligibilityResult, *, cached: bool = False) -> EligibilityResultResponse:
    """Map an EligibilityResult dataclass to the Pydantic response model."""

    def _deductible_detail(d: dict | None) -> DeductibleDetail:
        if not d:
            return DeductibleDetail()
        return DeductibleDetail(total=d.get("total"), remaining=d.get("remaining"))

    copay_dict = result.copay or {}
    coinsurance_dict = result.coinsurance or {}
    deductible_dict = result.deductible or {}
    oop_dict = result.out_of_pocket_max or {}
    session_dict = result.session_limits or {}

    session_limits = None
    if session_dict:
        session_limits = SessionLimitsInfo(
            allowed=session_dict.get("allowed"),
            used=session_dict.get("used"),
            remaining=session_dict.get("remaining"),
        )

    carve_out = None
    if result.carve_out_payer:
        carve_out = CarveOutPayerInfo(
            name=result.carve_out_payer.get("name", ""),
            id=result.carve_out_payer.get("id", ""),
        )

    return EligibilityResultResponse(
        active=result.active,
        plan_name=result.plan_name,
        plan_group=result.plan_group,
        copay=CopayInfo(
            amount=copay_dict.get("amount"),
            in_network=copay_dict.get("in_network"),
            out_of_network=copay_dict.get("out_of_network"),
        ),
        deductible=DeductibleInfo(
            individual=_deductible_detail(deductible_dict.get("individual")),
            family=_deductible_detail(deductible_dict.get("family")),
        ),
        coinsurance=CoinsuranceInfo(
            in_network_percent=coinsurance_dict.get("in_network_percent"),
            out_of_network_percent=coinsurance_dict.get("out_of_network_percent"),
        ),
        out_of_pocket_max=OopMaxInfo(
            individual=_deductible_detail(oop_dict.get("individual")),
            family=_deductible_detail(oop_dict.get("family")),
        ),
        session_limits=session_limits,
        prior_auth_required=result.prior_auth_required,
        mental_health_specific=result.mental_health_specific,
        carve_out_payer=carve_out,
        effective_date=result.effective_date,
        termination_date=result.termination_date,
        errors=result.errors,
        cached=cached,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/verify", response_model=EligibilityResultResponse)
async def verify_eligibility(
    body: EligibilityCheckRequest,
    account: dict = Depends(require_api_key),
):
    """Check patient insurance eligibility via 270/271 transaction.

    Results are cached per member_id + payer_id for the current calendar day.
    Subsequent calls with the same member/payer on the same day return the
    cached result without hitting Stedi again.
    """
    account_id = str(account["id"])

    # --- Check cache ---
    cache_key = _make_cache_key(body.member_id, body.payer_id)
    cached_result = _get_cached(cache_key)
    if cached_result is not None:
        logger.info(
            "Eligibility cache hit for member=%s payer=%s",
            body.member_id, body.payer_id,
        )
        return _result_to_response(cached_result, cached=True)

    # --- Build patient_info dict for StediClient ---
    patient_info = {
        "member_id": body.member_id,
        "first_name": body.patient_first_name,
        "last_name": body.patient_last_name,
        "date_of_birth": body.patient_dob,
        "gender": body.patient_gender,
        "payer_id": body.payer_id,
        "provider_npi": body.provider_npi,
        "provider_organization_name": body.provider_organization_name,
        "service_type_codes": body.service_type_codes,
    }

    result = await stedi_client.check_eligibility(patient_info)

    # --- Cache the result ---
    _set_cached(cache_key, result)

    # --- Log billing event ---
    await create_event(
        account_id=account_id,
        event_type="eligibility_checked",
        resource_type="eligibility",
        resource_id=account_id,
        data={
            "payer_id": body.payer_id,
            "payer_name": body.payer_name,
            "member_id": body.member_id,
            "active": result.active,
            "plan_name": result.plan_name,
            "prior_auth_required": result.prior_auth_required,
            "cached": False,
        },
    )

    logger.info(
        "Eligibility check for account %s: active=%s plan=%s",
        account_id, result.active, result.plan_name,
    )

    return _result_to_response(result, cached=False)
