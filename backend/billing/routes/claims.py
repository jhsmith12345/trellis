"""Claim submission and status tracking routes."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_api_key
from db import create_claim, get_claim, update_claim_status, get_updates_since, create_event
from integrations.stedi import stedi_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/claims", tags=["claims"])

# Threshold (seconds) before we re-check Stedi for fresh status
_STATUS_REFRESH_THRESHOLD = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AddressInfo(BaseModel):
    address1: str = ""
    address2: str = ""
    city: str = ""
    state: str = ""
    postal_code: str = ""


class ProviderInfo(BaseModel):
    npi: str
    tax_id: str
    name: str
    address: dict = Field(default_factory=dict)


class PatientInfo(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: str = Field(..., description="ISO date YYYY-MM-DD")
    gender: str = Field(..., description="M, F, or U")
    member_id: str
    address: dict = Field(default_factory=dict)


class DiagnosisCode(BaseModel):
    code: str = Field(..., description="ICD-10 code, e.g. F41.1")
    description: str = ""


class ServiceLine(BaseModel):
    cpt_code: str = Field(..., description="5-digit CPT code")
    modifier: str = ""
    units: int = 1
    charge_amount: float
    date_of_service: str = Field(..., description="ISO date YYYY-MM-DD")
    place_of_service: str = "11"
    diagnosis_pointers: list[int] = Field(default_factory=lambda: [1])


class RenderingProviderInfo(BaseModel):
    """Optional rendering provider when different from billing provider."""
    npi: str
    first_name: str = ""
    last_name: str = ""


class ClaimSubmitRequest(BaseModel):
    external_superbill_id: str
    payer_name: str
    payer_id: str
    provider: ProviderInfo
    patient: PatientInfo
    diagnoses: list[DiagnosisCode]
    service_lines: list[ServiceLine]
    total_charge: float
    authorization_number: str | None = None
    rendering_provider: RenderingProviderInfo | None = None


class ClaimSubmitResponse(BaseModel):
    """Response returned after claim submission attempt."""
    claim_id: str
    status: str
    stedi_claim_id: str | None = None
    warnings: list[str] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)


class ClaimStatusEntry(BaseModel):
    status: str
    timestamp: str
    details: str = ""


class ClaimStatusResponse(BaseModel):
    """Full claim status with history and financial details."""
    id: str
    account_id: str
    external_superbill_id: str
    status: str
    status_history: list[ClaimStatusEntry] = Field(default_factory=list)
    stedi_claim_id: str | None = None
    payer_name: str
    payer_id: str
    total_charge: float
    total_paid: float = 0
    patient_responsibility: float = 0
    denial_codes: list | None = None
    submitted_at: str | None = None
    adjudicated_at: str | None = None
    created_at: str
    updated_at: str


class EventResponse(BaseModel):
    id: str
    account_id: str
    event_type: str
    resource_type: str
    resource_id: str
    data: dict = Field(default_factory=dict)
    created_at: str


class ClaimUpdatesResponse(BaseModel):
    """Polling response with billing events since a given timestamp."""
    events: list[EventResponse]
    count: int
    last_event_at: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_claim(claim: dict) -> dict:
    """Convert DB record to API response, serializing datetimes."""
    return {
        "id": str(claim["id"]),
        "account_id": str(claim["account_id"]),
        "external_superbill_id": claim["external_superbill_id"],
        "status": claim["status"],
        "status_history": claim.get("status_history") or [],
        "stedi_claim_id": claim.get("stedi_claim_id"),
        "payer_name": claim["payer_name"],
        "payer_id": claim["payer_id"],
        "total_charge": float(claim["total_charge"]),
        "total_paid": float(claim.get("total_paid") or 0),
        "patient_responsibility": float(claim.get("patient_responsibility") or 0),
        "denial_codes": claim.get("denial_codes"),
        "submitted_at": claim["submitted_at"].isoformat() if claim.get("submitted_at") else None,
        "adjudicated_at": claim["adjudicated_at"].isoformat() if claim.get("adjudicated_at") else None,
        "created_at": claim["created_at"].isoformat(),
        "updated_at": claim["updated_at"].isoformat(),
    }


def _serialize_event(event: dict) -> dict:
    return {
        "id": str(event["id"]),
        "account_id": str(event["account_id"]),
        "event_type": event["event_type"],
        "resource_type": event["resource_type"],
        "resource_id": str(event["resource_id"]),
        "data": event.get("data") or {},
        "created_at": event["created_at"].isoformat(),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/submit", response_model=ClaimSubmitResponse)
async def submit_claim(body: ClaimSubmitRequest, account: dict = Depends(require_api_key)):
    """Accept claim data from EHR, validate, submit to Stedi, track in DB.

    Flow:
      1. Validate claim data locally
      2. If invalid -> 422 with validation errors
      3. Create billing_claims record (status=pending)
      4. Submit to Stedi
      5. Update claim record with result
      6. Log billing_event
      7. Return claim ID, status, warnings
    """
    account_id = str(account["id"])

    # Build claim data snapshot
    claim_data = body.model_dump()

    # --- Step 1: Local validation ---
    validation = stedi_client.validate_claim(claim_data)
    if not validation.is_valid:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Claim validation failed",
                "errors": validation.errors,
                "warnings": validation.warnings,
            },
        )

    # --- Step 2: Create pending claim record ---
    claim = await create_claim(
        account_id=account_id,
        external_superbill_id=body.external_superbill_id,
        claim_data=claim_data,
        payer_name=body.payer_name,
        payer_id=body.payer_id,
        total_charge=body.total_charge,
    )
    claim_id = str(claim["id"])

    # --- Step 3: Submit to Stedi ---
    stedi_resp = await stedi_client.submit_claim(claim_data)

    if stedi_resp.success:
        claim = await update_claim_status(
            claim_id=claim_id,
            account_id=account_id,
            status="submitted",
            details="Submitted to Stedi",
            stedi_claim_id=stedi_resp.claim_id,
        )
        await create_event(
            account_id=account_id,
            event_type="claim_submitted",
            resource_type="claim",
            resource_id=claim_id,
            data={
                "stedi_claim_id": stedi_resp.claim_id,
                "tracking_id": stedi_resp.tracking_id,
                "payer_id": body.payer_id,
            },
        )
        logger.info(
            "Claim %s submitted to Stedi (stedi_id=%s)",
            claim_id, stedi_resp.claim_id,
        )

        return ClaimSubmitResponse(
            claim_id=claim_id,
            status="submitted",
            stedi_claim_id=stedi_resp.claim_id,
            warnings=validation.warnings + stedi_resp.warnings,
        )
    else:
        claim = await update_claim_status(
            claim_id=claim_id,
            account_id=account_id,
            status="rejected",
            details=f"Stedi rejected: {stedi_resp.errors}",
        )
        await create_event(
            account_id=account_id,
            event_type="claim_status_changed",
            resource_type="claim",
            resource_id=claim_id,
            data={"status": "rejected", "errors": stedi_resp.errors},
        )
        logger.warning("Claim %s rejected by Stedi: %s", claim_id, stedi_resp.errors)

        return ClaimSubmitResponse(
            claim_id=claim_id,
            status="rejected",
            warnings=validation.warnings,
            errors=stedi_resp.errors,
        )


@router.get("/{claim_id}/status", response_model=ClaimStatusResponse)
async def get_claim_status(claim_id: str, account: dict = Depends(require_api_key)):
    """Return claim status and history.

    If the claim has a stedi_claim_id and hasn't been checked in the last
    5 minutes, refreshes the status from Stedi before returning.
    """
    account_id = str(account["id"])
    claim = await get_claim(claim_id, account_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    # Optionally refresh from Stedi if stale
    stedi_id = claim.get("stedi_claim_id")
    current_status = claim.get("status", "")
    terminal_statuses = {"paid", "denied", "cancelled"}

    if stedi_id and current_status not in terminal_statuses:
        updated_at = claim.get("updated_at")
        now = datetime.now(timezone.utc)
        if updated_at:
            # Ensure updated_at is tz-aware for comparison
            if updated_at.tzinfo is None:
                from datetime import timezone as tz
                updated_at = updated_at.replace(tzinfo=tz.utc)
            seconds_since = (now - updated_at).total_seconds()
        else:
            seconds_since = _STATUS_REFRESH_THRESHOLD + 1

        if seconds_since >= _STATUS_REFRESH_THRESHOLD:
            logger.info(
                "Refreshing Stedi status for claim %s (stale by %ds)",
                claim_id, int(seconds_since),
            )
            status_result = await stedi_client.get_claim_status(stedi_id)
            if status_result.success and status_result.status != current_status:
                claim = await update_claim_status(
                    claim_id=claim_id,
                    account_id=account_id,
                    status=status_result.status,
                    details=status_result.details,
                )
                await create_event(
                    account_id=account_id,
                    event_type="claim_status_changed",
                    resource_type="claim",
                    resource_id=claim_id,
                    data={
                        "previous_status": current_status,
                        "new_status": status_result.status,
                        "details": status_result.details,
                    },
                )

    return _serialize_claim(claim)


@router.get("/updates", response_model=ClaimUpdatesResponse)
async def get_claim_updates(since: str, account: dict = Depends(require_api_key)):
    """Polling endpoint: return all billing events since a given timestamp.

    Query parameter ``since`` should be an ISO 8601 timestamp.
    Returns claim status changes, ERA receipts, payment completions, etc.
    """
    try:
        since_dt = datetime.fromisoformat(since)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ISO timestamp for 'since' parameter")

    events = await get_updates_since(str(account["id"]), since_dt)
    serialized = [_serialize_event(e) for e in events]

    last_event_at = None
    if serialized:
        last_event_at = serialized[-1]["created_at"]

    return {
        "events": serialized,
        "count": len(serialized),
        "last_event_at": last_event_at,
    }
