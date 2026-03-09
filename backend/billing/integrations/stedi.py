"""Stedi API client for claim submission, ERA processing, and eligibility checks.

Two modes of operation:
  - **stub** (default): Returns realistic mock responses. Active when STEDI_API_KEY is empty.
  - **live**: Calls the real Stedi Healthcare API. Active when STEDI_API_KEY is set.

All public methods are async and safe to call from FastAPI route handlers.
"""
import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from config import STEDI_API_KEY

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Stedi API endpoints
# ---------------------------------------------------------------------------
_STEDI_BASE = "https://healthcare.us.stedi.com/2024-04-01"
_CLAIMS_URL = f"{_STEDI_BASE}/change/medicalnetwork/professionalclaims/v3"
_CLAIM_STATUS_URL = f"{_STEDI_BASE}/change/medicalnetwork/claimstatus/v3"
_ELIGIBILITY_URL = f"{_STEDI_BASE}/change/medicalnetwork/eligibility/v3"

# ---------------------------------------------------------------------------
# Valid Place of Service codes (most common for behavioral health)
# ---------------------------------------------------------------------------
_VALID_POS_CODES = {
    "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12",
    "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23",
    "24", "25", "26", "31", "32", "33", "34", "41", "42", "49", "50",
    "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61",
    "62", "65", "71", "72", "81", "99",
}


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ClaimSubmissionResult:
    """Result of submitting a claim to Stedi."""
    claim_id: str | None = None
    tracking_id: str | None = None
    status: str = ""
    errors: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    raw_response: dict = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return self.status in ("submitted", "accepted") and not self.errors


@dataclass
class ClaimStatusResult:
    """Result of a claim status inquiry."""
    status: str = ""
    last_updated: str = ""
    details: str = ""
    raw_response: dict = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return bool(self.status)


@dataclass
class ValidationResult:
    """Result of local claim validation before submission."""
    is_valid: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class EligibilityResponse:
    """Legacy eligibility response — kept for backward compatibility."""
    success: bool
    active: bool = False
    plan_name: str = ""
    member_id: str = ""
    copay: float | None = None
    coinsurance: float | None = None
    deductible_remaining: float | None = None
    out_of_pocket_remaining: float | None = None
    mental_health_coverage: dict = field(default_factory=dict)
    errors: list[dict] = field(default_factory=list)
    raw: dict = field(default_factory=dict)


@dataclass
class EligibilityResult:
    """Comprehensive parsed eligibility (270/271) response."""
    active: bool = False
    plan_name: str = ""
    plan_group: str = ""
    copay: dict = field(default_factory=dict)          # {amount, in_network, out_of_network}
    deductible: dict = field(default_factory=dict)      # {individual: {total, remaining}, family: {total, remaining}}
    coinsurance: dict = field(default_factory=dict)     # {in_network_percent, out_of_network_percent}
    out_of_pocket_max: dict = field(default_factory=dict)  # {individual: {total, remaining}, family: {total, remaining}}
    session_limits: dict = field(default_factory=dict)  # {allowed, used, remaining}
    prior_auth_required: bool | None = None             # None = unknown ("U")
    mental_health_specific: bool = False                # True if benefits are MH-specific vs general medical
    carve_out_payer: dict | None = None                 # {name, id} if MH carved out
    effective_date: str = ""
    termination_date: str = ""
    errors: list[dict] = field(default_factory=list)
    raw_response: dict = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return self.active and not self.errors


# Legacy aliases for backward compatibility
@dataclass
class StediResponse:
    success: bool
    claim_id: str | None = None
    tracking_id: str | None = None
    errors: list[dict] = field(default_factory=list)
    raw: dict = field(default_factory=dict)


@dataclass
class StatusResponse:
    success: bool
    status: str = ""
    details: str = ""
    last_updated: str = ""
    raw: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

_CPT_RE = re.compile(r"^\d{5}$")
_ICD10_RE = re.compile(r"^[A-Z]\d{2,}(\.\d{1,4})?$", re.IGNORECASE)
_NPI_RE = re.compile(r"^\d{10}$")


def validate_claim(claim_data: dict) -> ValidationResult:
    """Validate claim data locally before submitting to Stedi.

    Checks:
      - Required fields present
      - CPT code format (5 digits)
      - ICD-10 code format (letter + digits, optional dot)
      - NPI format (10 digits)
      - Valid POS code
      - Charge > 0
      - At least one diagnosis code
    """
    errors: list[str] = []
    warnings: list[str] = []

    # --- Patient ---
    patient = claim_data.get("patient") or {}
    if not patient.get("first_name"):
        errors.append("Patient first name is required")
    if not patient.get("last_name"):
        errors.append("Patient last name is required")
    if not patient.get("date_of_birth"):
        errors.append("Patient date of birth is required")
    if not patient.get("gender"):
        errors.append("Patient gender is required")
    elif patient["gender"].upper() not in ("M", "F", "U"):
        warnings.append(f"Unusual gender code: {patient['gender']}. Expected M, F, or U.")
    if not patient.get("member_id"):
        errors.append("Patient member/subscriber ID is required")

    # --- Payer ---
    if not claim_data.get("payer_name"):
        errors.append("Payer name is required")
    if not claim_data.get("payer_id"):
        errors.append("Payer ID is required")

    # --- Provider ---
    provider = claim_data.get("provider") or {}
    npi = provider.get("npi", "")
    if not npi:
        errors.append("Provider NPI is required")
    elif not _NPI_RE.match(npi):
        errors.append(f"Invalid NPI format: '{npi}'. Must be 10 digits.")
    if not provider.get("tax_id"):
        errors.append("Provider tax ID is required")
    if not provider.get("name"):
        warnings.append("Provider name is missing — claim may be rejected by payer")

    # --- Diagnoses ---
    diagnoses = claim_data.get("diagnoses") or []
    if not diagnoses:
        errors.append("At least one diagnosis code is required")
    for i, dx in enumerate(diagnoses):
        code = dx.get("code", "") if isinstance(dx, dict) else str(dx)
        if not code:
            errors.append(f"Diagnosis #{i + 1}: code is empty")
        elif not _ICD10_RE.match(code):
            errors.append(f"Diagnosis #{i + 1}: invalid ICD-10 format '{code}'")

    # --- Service Lines ---
    service_lines = claim_data.get("service_lines") or []
    if not service_lines:
        errors.append("At least one service line is required")

    for i, sl in enumerate(service_lines):
        cpt = sl.get("cpt_code", "")
        if not cpt:
            errors.append(f"Service line #{i + 1}: CPT code is required")
        elif not _CPT_RE.match(cpt):
            errors.append(f"Service line #{i + 1}: invalid CPT format '{cpt}'. Must be 5 digits.")

        charge = sl.get("charge_amount", 0)
        try:
            charge = float(charge)
        except (TypeError, ValueError):
            charge = 0
        if charge <= 0:
            errors.append(f"Service line #{i + 1}: charge amount must be > 0")

        pos = sl.get("place_of_service", "11")
        if pos not in _VALID_POS_CODES:
            warnings.append(
                f"Service line #{i + 1}: POS code '{pos}' may not be valid"
            )

        if not sl.get("date_of_service"):
            errors.append(f"Service line #{i + 1}: date of service is required")

        modifier = sl.get("modifier", "")
        if modifier and not re.match(r"^[A-Z0-9]{2}$", modifier, re.IGNORECASE):
            warnings.append(
                f"Service line #{i + 1}: modifier '{modifier}' may not be valid format"
            )

    # --- Total charge ---
    total_charge = claim_data.get("total_charge", 0)
    try:
        total_charge = float(total_charge)
    except (TypeError, ValueError):
        total_charge = 0
    if total_charge <= 0:
        errors.append("Total charge must be greater than 0")

    return ValidationResult(
        is_valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Stedi format mapping
# ---------------------------------------------------------------------------

def _format_date(date_str: str) -> str:
    """Convert ISO date (YYYY-MM-DD) to YYYYMMDD for Stedi."""
    if not date_str:
        return ""
    return date_str.replace("-", "")[:8]


def _gender_code(gender: str) -> str:
    """Map gender to Stedi's expected code."""
    g = (gender or "").upper()
    if g in ("M", "MALE"):
        return "M"
    if g in ("F", "FEMALE"):
        return "F"
    return "U"


def map_to_stedi_format(claim_data: dict) -> dict:
    """Transform internal claim data to Stedi's professional claims JSON schema.

    Stedi's API accepts JSON that maps 1:1 with the X12 837P structure but
    in a developer-friendly format. This function performs the mapping from
    our CMS-1500-style data model.

    Reference: https://www.stedi.com/docs/api-reference/healthcare/post-change-medicalnetwork-professionalclaims-v3
    """
    patient = claim_data.get("patient", {})
    provider = claim_data.get("provider", {})
    diagnoses = claim_data.get("diagnoses", [])
    service_lines = claim_data.get("service_lines", [])
    provider_addr = provider.get("address", {})
    patient_addr = patient.get("address", {})

    # Build diagnosis list for claim_information
    dx_list = []
    for i, dx in enumerate(diagnoses[:12]):
        code = dx.get("code", "") if isinstance(dx, dict) else str(dx)
        dx_list.append({
            "qualifierCode": "ABK" if i == 0 else "ABF",
            "diagnosisCode": code.replace(".", ""),
        })

    # Build service lines
    stedi_service_lines = []
    for idx, sl in enumerate(service_lines):
        cpt = sl.get("cpt_code", "")
        modifier = sl.get("modifier", "")
        charge = float(sl.get("charge_amount", 0))
        units = int(sl.get("units", 1))
        dos = sl.get("date_of_service", "")
        pos = sl.get("place_of_service", "11")
        pointers = sl.get("diagnosis_pointers", [1])

        procedure = {
            "productOrServiceIdQualifier": "HC",
            "procedureCode": cpt,
        }
        if modifier:
            procedure["procedureModifier"] = [modifier]

        line = {
            "serviceLineNumber": str(idx + 1),
            "professionalService": {
                "procedureIdentifier": procedure,
                "lineItemChargeAmount": f"{charge:.2f}",
                "measurementUnit": "UN",
                "serviceUnitCount": str(units),
                "compositeDiagnosisCodePointers": {
                    "diagnosisCodePointers": [str(p) for p in pointers],
                },
                "placeOfServiceCode": pos,
            },
            "serviceDate": {
                "dateTimeQualifier": "472",
                "dateTimePeriodFormatQualifier": "D8",
                "dateTimePeriod": _format_date(dos),
            },
        }
        stedi_service_lines.append(line)

    # Assemble the Stedi payload
    stedi_payload = {
        "submitter": {
            "organizationName": provider.get("name", ""),
            "contactInformation": {
                "contactFunctionCode": "IC",
                "name": provider.get("name", ""),
            },
        },
        "receiver": {
            "organizationName": claim_data.get("payer_name", ""),
        },
        "subscriber": {
            "memberId": patient.get("member_id", ""),
            "paymentResponsibilityLevelCode": "P",
            "firstName": patient.get("first_name", ""),
            "lastName": patient.get("last_name", ""),
            "gender": _gender_code(patient.get("gender", "")),
            "dateOfBirth": _format_date(patient.get("date_of_birth", "")),
            "address": {
                "address1": patient_addr.get("address1", patient_addr.get("line1", "")),
                "city": patient_addr.get("city", ""),
                "state": patient_addr.get("state", ""),
                "postalCode": patient_addr.get("postal_code", patient_addr.get("zip", "")),
            },
        },
        "payer": {
            "organizationName": claim_data.get("payer_name", ""),
            "payerId": claim_data.get("payer_id", ""),
        },
        "billing": {
            "providerType": "billingProvider",
            "npi": provider.get("npi", ""),
            "organizationName": provider.get("name", ""),
            "taxId": provider.get("tax_id", "").replace("-", ""),
            "address": {
                "address1": provider_addr.get("address1", provider_addr.get("line1", "")),
                "city": provider_addr.get("city", ""),
                "state": provider_addr.get("state", ""),
                "postalCode": provider_addr.get("postal_code", provider_addr.get("zip", "")),
            },
        },
        "claimInformation": {
            "claimFilingCode": "CI",
            "patientControlNumber": claim_data.get("external_superbill_id", "")[:20],
            "claimChargeAmount": f"{float(claim_data.get('total_charge', 0)):.2f}",
            "placeOfServiceCode": service_lines[0].get("place_of_service", "11") if service_lines else "11",
            "claimFrequencyCode": "1",
            "signatureIndicator": "Y",
            "planParticipationCode": "A",
            "benefitsAssignmentCertificationIndicator": "Y",
            "releaseOfInformationCode": "Y",
            "healthCareCodeInformation": dx_list,
        },
        "serviceLines": stedi_service_lines,
    }

    # Add prior authorization if present
    auth_number = claim_data.get("authorization_number")
    if auth_number:
        stedi_payload["claimInformation"]["claimSupplementalInformation"] = {
            "priorAuthorizationNumber": auth_number,
        }

    # Add rendering provider if provided separately
    rendering = claim_data.get("rendering_provider")
    if rendering and rendering.get("npi"):
        stedi_payload["rendering"] = {
            "providerType": "renderingProvider",
            "npi": rendering["npi"],
            "firstName": rendering.get("first_name", ""),
            "lastName": rendering.get("last_name", ""),
        }

    return stedi_payload


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class StediClient:
    """Client for the Stedi healthcare API.

    Operates in two modes:
      - **stub** (STEDI_API_KEY is empty): returns realistic mock data
      - **live** (STEDI_API_KEY is set): calls Stedi's REST API via httpx
    """

    def __init__(self):
        self.api_key = STEDI_API_KEY
        self.base_url = _STEDI_BASE
        self._mode = "live" if self.api_key else "stub"
        logger.info("StediClient initialized in %s mode", self._mode)

    @property
    def is_live(self) -> bool:
        return self._mode == "live"

    # -----------------------------------------------------------------------
    # Claim validation (always local)
    # -----------------------------------------------------------------------

    def validate_claim(self, claim_data: dict) -> ValidationResult:
        """Validate claim data locally before submission."""
        return validate_claim(claim_data)

    # -----------------------------------------------------------------------
    # Claim submission
    # -----------------------------------------------------------------------

    async def submit_claim(self, claim_data: dict) -> ClaimSubmissionResult:
        """Submit a professional claim to Stedi.

        In live mode, POSTs to Stedi's professional claims endpoint.
        In stub mode, returns a realistic mock accepted response.
        """
        if self.is_live:
            return await self._submit_claim_live(claim_data)
        return await self._submit_claim_stub(claim_data)

    async def _submit_claim_live(self, claim_data: dict) -> ClaimSubmissionResult:
        """POST claim to Stedi API."""
        stedi_payload = map_to_stedi_format(claim_data)

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    _CLAIMS_URL,
                    json=stedi_payload,
                    headers={
                        "Authorization": f"Key {self.api_key}",
                        "Content-Type": "application/json",
                    },
                )
                body = resp.json()

                if resp.status_code in (200, 201, 202):
                    return ClaimSubmissionResult(
                        claim_id=body.get("claimId") or body.get("claims", [{}])[0].get("claimId"),
                        tracking_id=body.get("trackingId"),
                        status="submitted",
                        warnings=[w.get("message", str(w)) for w in body.get("warnings", [])],
                        raw_response=body,
                    )
                else:
                    api_errors = body.get("errors", [])
                    if not api_errors and body.get("message"):
                        api_errors = [{"message": body["message"]}]
                    return ClaimSubmissionResult(
                        status="rejected",
                        errors=api_errors if api_errors else [{"message": f"HTTP {resp.status_code}"}],
                        raw_response=body,
                    )
        except httpx.TimeoutException:
            logger.error("Stedi API timeout submitting claim")
            return ClaimSubmissionResult(
                status="error",
                errors=[{"message": "Stedi API request timed out"}],
            )
        except Exception as exc:
            logger.error("Stedi API error submitting claim: %s", exc)
            return ClaimSubmissionResult(
                status="error",
                errors=[{"message": f"Stedi API error: {exc}"}],
            )

    async def _submit_claim_stub(self, claim_data: dict) -> ClaimSubmissionResult:
        """Return a realistic stub response for testing."""
        logger.info("STUB: simulating claim submission")
        # Simulate a short network delay
        await asyncio.sleep(0.15)

        stedi_claim_id = f"stedi-clm-{uuid.uuid4().hex[:12]}"
        tracking_id = f"trk-{uuid.uuid4().hex[:8]}"
        now_iso = datetime.now(timezone.utc).isoformat()

        return ClaimSubmissionResult(
            claim_id=stedi_claim_id,
            tracking_id=tracking_id,
            status="submitted",
            warnings=[],
            raw_response={
                "claimId": stedi_claim_id,
                "trackingId": tracking_id,
                "status": "accepted",
                "acceptedAt": now_iso,
                "tradingPartner": claim_data.get("payer_id", "UNKNOWN"),
                "controlNumber": uuid.uuid4().hex[:9],
            },
        )

    # -----------------------------------------------------------------------
    # Claim status
    # -----------------------------------------------------------------------

    async def get_claim_status(self, stedi_claim_id: str) -> ClaimStatusResult:
        """Check the status of a previously submitted claim.

        In live mode, calls Stedi's claim status API.
        In stub mode, returns a mock status progression.
        """
        if self.is_live:
            return await self._get_claim_status_live(stedi_claim_id)
        return await self._get_claim_status_stub(stedi_claim_id)

    async def _get_claim_status_live(self, stedi_claim_id: str) -> ClaimStatusResult:
        """GET claim status from Stedi API."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    _CLAIM_STATUS_URL,
                    json={
                        "claimId": stedi_claim_id,
                    },
                    headers={
                        "Authorization": f"Key {self.api_key}",
                        "Content-Type": "application/json",
                    },
                )
                body = resp.json()

                if resp.status_code == 200:
                    # Parse status from Stedi's 277 response format
                    status = body.get("status", "unknown")
                    details = body.get("statusDetails", "")
                    last_updated = body.get("lastUpdated", datetime.now(timezone.utc).isoformat())
                    return ClaimStatusResult(
                        status=status,
                        last_updated=last_updated,
                        details=details,
                        raw_response=body,
                    )
                else:
                    return ClaimStatusResult(
                        status="error",
                        details=f"HTTP {resp.status_code}: {body.get('message', '')}",
                        raw_response=body,
                    )
        except Exception as exc:
            logger.error("Stedi API error checking claim status: %s", exc)
            return ClaimStatusResult(
                status="error",
                details=f"Stedi API error: {exc}",
            )

    async def _get_claim_status_stub(self, stedi_claim_id: str) -> ClaimStatusResult:
        """Return a realistic stub status response."""
        logger.info("STUB: checking claim status for %s", stedi_claim_id)
        await asyncio.sleep(0.1)

        # Simulate a progression: use the last hex char of the claim ID to
        # deterministically pick a status so repeated calls are consistent
        hex_tail = stedi_claim_id[-1] if stedi_claim_id else "0"
        status_map = {
            "0": ("acknowledged", "Claim received by payer, pending adjudication"),
            "1": ("acknowledged", "Claim received by payer, pending adjudication"),
            "2": ("in_review", "Claim is under clinical review"),
            "3": ("in_review", "Additional documentation requested"),
            "4": ("adjudicated", "Claim adjudicated — payment processing"),
            "5": ("adjudicated", "Claim adjudicated — payment processing"),
            "6": ("paid", "Payment issued to provider"),
            "7": ("paid", "Payment issued to provider"),
            "8": ("denied", "Claim denied — see denial reason codes"),
            "9": ("partially_paid", "Partial payment — see explanation of benefits"),
        }
        fallback = ("acknowledged", "Claim received by payer")
        status, details = status_map.get(hex_tail, fallback)

        return ClaimStatusResult(
            status=status,
            last_updated=datetime.now(timezone.utc).isoformat(),
            details=details,
            raw_response={
                "claimId": stedi_claim_id,
                "status": status,
                "statusDetails": details,
                "payer": "Stub Payer",
            },
        )

    # -----------------------------------------------------------------------
    # Format mapping (public for testing)
    # -----------------------------------------------------------------------

    def map_to_stedi_format(self, claim_data: dict) -> dict:
        """Transform internal claim data to Stedi's expected JSON structure."""
        return map_to_stedi_format(claim_data)

    # -----------------------------------------------------------------------
    # Eligibility verification (270/271)
    # -----------------------------------------------------------------------

    async def check_eligibility(self, patient_info: dict) -> EligibilityResult:
        """Check patient insurance eligibility via 270/271 transaction.

        In live mode, POSTs to Stedi's eligibility endpoint.
        In stub mode, returns a rich mock response suitable for frontend rendering.

        ``patient_info`` keys:
          - member_id, first_name, last_name, date_of_birth (YYYY-MM-DD or YYYYMMDD),
            gender (M/F), payer_id, provider_npi, provider_organization_name,
            service_type_codes (optional, default ["30", "MH"])
        """
        if self.is_live:
            return await self._check_eligibility_live(patient_info)
        return await self._check_eligibility_stub(patient_info)

    async def _check_eligibility_live(self, patient_info: dict) -> EligibilityResult:
        """POST a 270 eligibility inquiry to Stedi and parse the 271 response."""
        control_number = uuid.uuid4().hex[:9]
        stcs = patient_info.get("service_type_codes") or ["30", "MH"]

        payload = {
            "controlNumber": control_number,
            "tradingPartnerServiceId": patient_info.get("payer_id", ""),
            "provider": {
                "npi": patient_info.get("provider_npi", ""),
                "organizationName": patient_info.get("provider_organization_name", ""),
            },
            "subscriber": {
                "memberId": patient_info.get("member_id", ""),
                "firstName": patient_info.get("first_name", ""),
                "lastName": patient_info.get("last_name", ""),
                "dateOfBirth": _format_date(patient_info.get("date_of_birth", "")),
                "gender": _gender_code(patient_info.get("gender", "")),
            },
            "encounter": {
                "serviceTypeCodes": stcs,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    _ELIGIBILITY_URL,
                    json=payload,
                    headers={
                        "Authorization": f"Key {self.api_key}",
                        "Content-Type": "application/json",
                    },
                )
                body = resp.json()

                if resp.status_code in (200, 201):
                    return self.parse_eligibility_response(body)
                else:
                    api_errors = body.get("errors", [])
                    if not api_errors and body.get("message"):
                        api_errors = [{"message": body["message"]}]
                    return EligibilityResult(
                        active=False,
                        errors=api_errors if api_errors else [{"message": f"HTTP {resp.status_code}"}],
                        raw_response=body,
                    )
        except httpx.TimeoutException:
            logger.error("Stedi eligibility API timeout")
            return EligibilityResult(
                active=False,
                errors=[{"message": "Stedi API request timed out"}],
            )
        except Exception as exc:
            logger.error("Stedi eligibility API error: %s", exc)
            return EligibilityResult(
                active=False,
                errors=[{"message": f"Stedi API error: {exc}"}],
            )

    async def _check_eligibility_stub(self, patient_info: dict) -> EligibilityResult:
        """Return a rich, realistic mock eligibility response for testing."""
        logger.info("STUB: checking eligibility for member_id=%s", patient_info.get("member_id", "?"))
        await asyncio.sleep(0.15)

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        return EligibilityResult(
            active=True,
            plan_name="Blue Cross Blue Shield PPO",
            plan_group="GRP-8842710",
            copay={
                "amount": 20.00,
                "in_network": 20.00,
                "out_of_network": 50.00,
            },
            deductible={
                "individual": {"total": 1500.00, "remaining": 800.00},
                "family": {"total": 3000.00, "remaining": 1600.00},
            },
            coinsurance={
                "in_network_percent": 20.0,
                "out_of_network_percent": 40.0,
            },
            out_of_pocket_max={
                "individual": {"total": 6000.00, "remaining": 3200.00},
                "family": {"total": 12000.00, "remaining": 7800.00},
            },
            session_limits={
                "allowed": 30,
                "used": 12,
                "remaining": 18,
            },
            prior_auth_required=True,
            mental_health_specific=True,
            carve_out_payer=None,
            effective_date="2026-01-01",
            termination_date="",
            errors=[],
            raw_response={
                "controlNumber": uuid.uuid4().hex[:9],
                "tradingPartnerServiceId": patient_info.get("payer_id", "BCBS"),
                "provider": {
                    "npi": patient_info.get("provider_npi", "1234567890"),
                    "organizationName": patient_info.get("provider_organization_name", "Trellis Practice"),
                },
                "subscriber": {
                    "memberId": patient_info.get("member_id", "STUB-123456"),
                    "firstName": patient_info.get("first_name", "Jane"),
                    "lastName": patient_info.get("last_name", "Doe"),
                },
                "planStatus": [{"statusCode": "1", "status": "Active Coverage"}],
                "planDateInformation": {
                    "planBegin": "20260101",
                    "eligibility": today.replace("-", ""),
                },
                "benefitsInformation": [
                    {
                        "code": "1",
                        "name": "Active Coverage",
                        "serviceTypeCodes": ["30"],
                        "insuranceTypeCode": "QM",
                        "planCoverage": "Blue Cross Blue Shield PPO",
                        "benefitAmount": "20.00",
                        "inPlanNetworkIndicatorCode": "Y",
                    },
                    {
                        "code": "B",
                        "name": "Co-Payment",
                        "serviceTypeCodes": ["MH"],
                        "benefitAmount": "20.00",
                        "inPlanNetworkIndicatorCode": "Y",
                    },
                    {
                        "code": "C",
                        "name": "Deductible",
                        "serviceTypeCodes": ["30"],
                        "coverageLevelCode": "IND",
                        "benefitAmount": "1500.00",
                        "inPlanNetworkIndicatorCode": "Y",
                        "timeQualifierCode": "23",
                    },
                    {
                        "code": "C",
                        "name": "Deductible — Remaining",
                        "serviceTypeCodes": ["30"],
                        "coverageLevelCode": "IND",
                        "benefitAmount": "800.00",
                        "inPlanNetworkIndicatorCode": "Y",
                        "timeQualifierCode": "29",
                    },
                ],
                "_stub": True,
            },
        )

    def parse_eligibility_response(self, raw_response: dict) -> EligibilityResult:
        """Parse a Stedi 271 eligibility response into a clean EligibilityResult.

        Stedi's 271 response contains a ``benefitsInformation`` array where each
        entry has a ``code`` indicating the benefit type (e.g. "1" = Active,
        "B" = Co-Payment, "C" = Deductible, "A" = Co-Insurance, "G" = Out of
        Pocket, "F" = Limitations).  Coverage level ("IND" / "FAM"), in/out
        network indicator, and time qualifier codes further refine each entry.

        This parser extracts the most relevant behavioral-health fields and
        gracefully handles missing/optional data.
        """
        result = EligibilityResult(raw_response=raw_response)

        # ----- Plan status -----
        plan_statuses = raw_response.get("planStatus", [])
        for ps in plan_statuses:
            status_code = ps.get("statusCode", "")
            if status_code == "1":
                result.active = True
                break
        # Some responses use planStatus at top level, others embed in subscriber
        if not plan_statuses:
            subscriber = raw_response.get("subscriber", {})
            if subscriber.get("status", "").lower() == "active":
                result.active = True

        # ----- Plan dates -----
        date_info = raw_response.get("planDateInformation", {})
        plan_begin = date_info.get("planBegin", "")
        if plan_begin:
            result.effective_date = self._parse_stedi_date(plan_begin)
        plan_end = date_info.get("planEnd", "")
        if plan_end:
            result.termination_date = self._parse_stedi_date(plan_end)

        # ----- Benefits information -----
        benefits = raw_response.get("benefitsInformation", [])

        copay_in: float | None = None
        copay_out: float | None = None
        deductible_ind_total: float | None = None
        deductible_ind_remaining: float | None = None
        deductible_fam_total: float | None = None
        deductible_fam_remaining: float | None = None
        coinsurance_in: float | None = None
        coinsurance_out: float | None = None
        oop_ind_total: float | None = None
        oop_ind_remaining: float | None = None
        oop_fam_total: float | None = None
        oop_fam_remaining: float | None = None
        session_allowed: int | None = None
        session_used: int | None = None

        mh_service_type_codes = {"30", "MH", "A6", "CF"}

        for ben in benefits:
            code = ben.get("code", "")
            stcs = set(ben.get("serviceTypeCodes", []))
            is_mh = bool(stcs & mh_service_type_codes) or not stcs  # empty STCs = general
            in_network = ben.get("inPlanNetworkIndicatorCode", "") in ("Y", "")
            coverage_level = ben.get("coverageLevelCode", "")
            time_qualifier = ben.get("timeQualifierCode", "")
            amount_str = ben.get("benefitAmount", "")
            percent_str = ben.get("benefitPercent", "")

            amount = self._safe_float(amount_str)
            percent = self._safe_float(percent_str)

            # Active coverage — extract plan name
            if code == "1":
                result.active = True
                plan_cov = ben.get("planCoverage", "")
                if plan_cov:
                    result.plan_name = plan_cov
                ins_type = ben.get("insuranceTypeCode", "")
                group_num = ben.get("groupNumber", "")
                if group_num:
                    result.plan_group = group_num
                if stcs & mh_service_type_codes:
                    result.mental_health_specific = True

            # Co-payment (code B)
            elif code == "B" and amount is not None:
                if in_network:
                    copay_in = amount
                else:
                    copay_out = amount

            # Deductible (code C)
            elif code == "C" and amount is not None:
                # time_qualifier: "23" = calendar year, "29" = remaining
                is_remaining = time_qualifier == "29" or "remain" in ben.get("name", "").lower()
                if coverage_level == "FAM":
                    if is_remaining:
                        deductible_fam_remaining = amount
                    else:
                        deductible_fam_total = amount
                else:  # IND or unspecified
                    if is_remaining:
                        deductible_ind_remaining = amount
                    else:
                        deductible_ind_total = amount

            # Co-insurance (code A)
            elif code == "A":
                pct = percent if percent is not None else (amount if amount is not None and amount <= 1.0 else None)
                if pct is not None:
                    # Stedi may return as decimal (0.20) or whole number (20)
                    pct_val = pct * 100 if pct <= 1.0 else pct
                    if in_network:
                        coinsurance_in = pct_val
                    else:
                        coinsurance_out = pct_val

            # Out-of-pocket max (code G)
            elif code == "G" and amount is not None:
                is_remaining = time_qualifier == "29" or "remain" in ben.get("name", "").lower()
                if coverage_level == "FAM":
                    if is_remaining:
                        oop_fam_remaining = amount
                    else:
                        oop_fam_total = amount
                else:
                    if is_remaining:
                        oop_ind_remaining = amount
                    else:
                        oop_ind_total = amount

            # Limitations / quantitative (code F)
            elif code == "F":
                qty_str = ben.get("benefitQuantity", ben.get("quantity", ""))
                qty = self._safe_int(qty_str)
                if qty is not None:
                    qualifier = ben.get("quantityQualifierCode", "")
                    if qualifier == "VS" or "visit" in ben.get("name", "").lower():
                        is_used = time_qualifier == "29" or "used" in ben.get("name", "").lower()
                        if is_used:
                            session_used = qty
                        else:
                            session_allowed = qty

            # Auth/certification indicator (can appear on any benefit)
            auth_indicator = ben.get("authOrCertIndicator", "")
            if auth_indicator:
                if auth_indicator == "Y":
                    result.prior_auth_required = True
                elif auth_indicator == "N":
                    if result.prior_auth_required is None:
                        result.prior_auth_required = False
                elif auth_indicator == "U":
                    if result.prior_auth_required is None:
                        result.prior_auth_required = None  # explicit unknown

        # ----- Assemble structured fields -----
        result.copay = {
            "amount": copay_in if copay_in is not None else copay_out,
            "in_network": copay_in,
            "out_of_network": copay_out,
        }

        result.deductible = {
            "individual": {"total": deductible_ind_total, "remaining": deductible_ind_remaining},
            "family": {"total": deductible_fam_total, "remaining": deductible_fam_remaining},
        }

        result.coinsurance = {
            "in_network_percent": coinsurance_in,
            "out_of_network_percent": coinsurance_out,
        }

        result.out_of_pocket_max = {
            "individual": {"total": oop_ind_total, "remaining": oop_ind_remaining},
            "family": {"total": oop_fam_total, "remaining": oop_fam_remaining},
        }

        if session_allowed is not None or session_used is not None:
            allowed = session_allowed or 0
            used = session_used or 0
            result.session_limits = {
                "allowed": allowed,
                "used": used,
                "remaining": max(allowed - used, 0) if allowed else None,
            }

        # ----- Carve-out detection -----
        # Stedi may include a "loopIdentifier" or separate payer info for MH
        loop_info = raw_response.get("dependentAdditionalIdentification", [])
        for item in loop_info:
            if item.get("referenceIdentificationQualifier") == "2U":
                result.carve_out_payer = {
                    "name": item.get("description", ""),
                    "id": item.get("referenceIdentification", ""),
                }
                break

        return result

    # -----------------------------------------------------------------------
    # Eligibility helpers
    # -----------------------------------------------------------------------

    @staticmethod
    def _parse_stedi_date(date_str: str) -> str:
        """Convert YYYYMMDD from Stedi to YYYY-MM-DD."""
        d = date_str.replace("-", "")
        if len(d) >= 8:
            return f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        return date_str

    @staticmethod
    def _safe_float(val) -> float | None:
        if val is None or val == "":
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _safe_int(val) -> int | None:
        if val is None or val == "":
            return None
        try:
            return int(float(val))
        except (TypeError, ValueError):
            return None

    # -----------------------------------------------------------------------
    # ERA / 835 processing
    # -----------------------------------------------------------------------

    def parse_era(self, era_data: dict) -> "ERAResult":
        """Parse Stedi's ERA/835 response into structured data.

        Stedi normalizes the 835 into JSON with keys like:
          - financial_information: check number, payment method, amounts
          - payer: name, id
          - payees: list with claims -> services -> adjustments
          - claim_payment_information: per-claim detail

        In stub mode (or when era_data is empty) returns a realistic mock
        showing a partial payment scenario for testing.
        """
        if not era_data or not self.is_live:
            return self._parse_era_stub(era_data)
        return self._parse_era_live(era_data)

    def _parse_era_live(self, era_data: dict) -> "ERAResult":
        """Parse a real Stedi ERA/835 JSON response."""
        result = ERAResult(raw_data=era_data)

        # --- Top-level financial info ---
        fin = era_data.get("financial_information", {})
        result.check_number = (
            fin.get("check_or_eft_trace_number", "")
            or era_data.get("traceNumber", "")
        )
        result.total_payment_amount = self._safe_float(
            fin.get("total_actual_provider_payment_amount")
            or era_data.get("totalActualProviderPaymentAmount")
        ) or 0.0
        result.payment_date = fin.get("check_issue_or_eft_effective_date", "")

        # --- Payer info ---
        payer = era_data.get("payer", {})
        result.payer_name = payer.get("name", era_data.get("payerName", ""))
        result.payer_id = payer.get("identifier", era_data.get("payerIdentifier", ""))

        # --- Claim payments ---
        # Stedi 835 can structure claims under "payees" -> "claimPayments"
        # or directly as "claims" / "claimPaymentInformation"
        raw_claims = era_data.get("claims", [])
        if not raw_claims:
            for payee in era_data.get("payees", []):
                raw_claims.extend(payee.get("claimPayments", []))
        if not raw_claims:
            raw_claims = era_data.get("claimPaymentInformation", [])

        for rc in raw_claims:
            cp = ERAClaimPayment()
            # Patient / subscriber
            patient = rc.get("patient", rc.get("subscriber", {}))
            first = patient.get("firstName", patient.get("first_name", ""))
            last = patient.get("lastName", patient.get("last_name", ""))
            cp.patient_name = f"{first} {last}".strip()
            cp.member_id = patient.get("memberId", patient.get("member_id", ""))

            # Claim identifiers
            cp.claim_id = (
                rc.get("patientControlNumber", "")
                or rc.get("patient_control_number", "")
                or rc.get("claimId", "")
            )

            # Amounts
            cp.charged_amount = self._safe_float(
                rc.get("totalClaimChargeAmount", rc.get("charged_amount"))
            ) or 0.0
            cp.paid_amount = self._safe_float(
                rc.get("claimPaymentAmount", rc.get("paid_amount"))
            ) or 0.0

            # --- Adjustments ---
            patient_resp = 0.0
            raw_adjustments = rc.get("adjustments", rc.get("claimAdjustments", []))
            for adj_group in raw_adjustments:
                group_code = adj_group.get("claimAdjustmentGroupCode", adj_group.get("group_code", ""))
                reasons = adj_group.get("reasons", adj_group.get("adjustmentReasons", [adj_group]))
                for reason in reasons:
                    rc_code = str(reason.get("adjustmentReasonCode", reason.get("reason_code", "")))
                    rc_amount = self._safe_float(
                        reason.get("adjustmentAmount", reason.get("amount"))
                    ) or 0.0
                    adj = ERAAdjustment(
                        group_code=group_code,
                        reason_code=rc_code,
                        amount=rc_amount,
                        description=_describe_carc(rc_code),
                    )
                    cp.adjustments.append(adj)
                    if group_code == "PR":
                        patient_resp += rc_amount

            cp.patient_responsibility = patient_resp

            # --- Service lines ---
            raw_services = rc.get("serviceLines", rc.get("services", []))
            for svc in raw_services:
                proc = svc.get("procedure", svc.get("professionalService", {}))
                sl = ERAServiceLine(
                    cpt_code=proc.get("procedureCode", proc.get("cpt_code", "")),
                    charged_amount=self._safe_float(
                        svc.get("lineItemChargeAmount", svc.get("charged_amount"))
                    ) or 0.0,
                    allowed_amount=self._safe_float(
                        svc.get("lineItemProviderPaymentAmount", svc.get("allowed_amount"))
                    ) or 0.0,
                    paid_amount=self._safe_float(
                        svc.get("lineItemProviderPaymentAmount", svc.get("paid_amount"))
                    ) or 0.0,
                )
                # Service-level adjustments
                svc_adjs = svc.get("adjustments", [])
                for sa_group in svc_adjs:
                    sg_code = sa_group.get("claimAdjustmentGroupCode", sa_group.get("group_code", ""))
                    sa_reasons = sa_group.get("reasons", sa_group.get("adjustmentReasons", [sa_group]))
                    for sa_reason in sa_reasons:
                        sa_rc = str(sa_reason.get("adjustmentReasonCode", sa_reason.get("reason_code", "")))
                        sa_amt = self._safe_float(
                            sa_reason.get("adjustmentAmount", sa_reason.get("amount"))
                        ) or 0.0
                        sl.adjustments.append(ERAAdjustment(
                            group_code=sg_code,
                            reason_code=sa_rc,
                            amount=sa_amt,
                            description=_describe_carc(sa_rc),
                        ))
                cp.service_lines.append(sl)

            # --- Denial detection ---
            if cp.paid_amount == 0:
                denial_codes = [
                    a for a in cp.adjustments
                    if a.reason_code in _DENIAL_REASON_CODES
                ]
                if denial_codes:
                    cp.is_denied = True
                    cp.denial_reason = "; ".join(
                        f"{a.description} (code {a.reason_code})" for a in denial_codes
                    )

            result.claim_payments.append(cp)

        return result

    def _parse_era_stub(self, era_data: dict) -> "ERAResult":
        """Return a realistic mock ERA showing a partial payment scenario.

        Scenario: $150 charged for 90834 (individual psychotherapy, 45 min)
          - $120 allowed by fee schedule (CO-4 contractual adjustment of $30)
          - $100 paid by insurance
          - $20 patient copay (PR-3)
        """
        logger.info("STUB: returning mock ERA data")

        copay_adj = ERAAdjustment(
            group_code="PR",
            reason_code="3",
            amount=20.00,
            description=_describe_carc("3"),
        )
        contractual_adj = ERAAdjustment(
            group_code="CO",
            reason_code="4",
            amount=30.00,
            description=_describe_carc("4"),
        )

        service_line = ERAServiceLine(
            cpt_code="90834",
            charged_amount=150.00,
            allowed_amount=120.00,
            paid_amount=100.00,
            adjustments=[contractual_adj, copay_adj],
        )

        claim_payment = ERAClaimPayment(
            patient_name="Jane Doe",
            member_id="BCBS-123456789",
            claim_id=era_data.get("claim_id", f"clm-{uuid.uuid4().hex[:12]}") if era_data else f"clm-{uuid.uuid4().hex[:12]}",
            charged_amount=150.00,
            paid_amount=100.00,
            patient_responsibility=20.00,
            adjustments=[contractual_adj, copay_adj],
            service_lines=[service_line],
            is_denied=False,
            denial_reason="",
        )

        return ERAResult(
            check_number=f"CHK-{uuid.uuid4().hex[:8].upper()}",
            payer_name="Blue Cross Blue Shield",
            payer_id="BCBS",
            payment_date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            total_payment_amount=100.00,
            claim_payments=[claim_payment],
            raw_data=era_data or {"_stub": True},
        )


# ---------------------------------------------------------------------------
# CARC (Claim Adjustment Reason Code) descriptions
# Common codes mapped to plain English for ERA parsing.
# ---------------------------------------------------------------------------

CARC_DESCRIPTIONS: dict[str, str] = {
    "1": "Deductible",
    "2": "Coinsurance",
    "3": "Copay",
    "4": "Exceeds fee schedule",
    "5": "Not covered under plan",
    "6": "Prior hospitalization required",
    "9": "Not medically necessary",
    "10": "Outside coverage period",
    "11": "Diagnosis inconsistent with procedure",
    "13": "Date of death precedes service",
    "14": "Date of onset after service",
    "15": "Payment adjusted — prior payer paid",
    "16": "Missing information / Claim lacks info",
    "18": "Duplicate claim/service",
    "19": "Claim denied — workers comp",
    "20": "Claim denied — auto insurance",
    "22": "Coordination of benefits adjustment",
    "23": "Payment adjusted — charges covered under capitation",
    "24": "Payment adjusted — charges covered by managed care",
    "26": "Expenses incurred prior to coverage",
    "27": "Expenses incurred after coverage terminated",
    "29": "Filing limit expired",
    "31": "Not patient's liability — claim submitted to wrong payer",
    "32": "Our records indicate patient is not an eligible dependent",
    "33": "Claim denied — insured has no dependent coverage",
    "34": "Claim denied — insured not in group/plan on date of service",
    "35": "Claim denied — lifetime benefit maximum reached",
    "39": "Services denied at the time authorization/pre-certification was requested",
    "40": "Charges do not meet qualifications for emergent/urgent care",
    "45": "Charges exceed your contracted/legislated fee arrangement",
    "49": "Routine/preventive care not covered under this plan",
    "50": "Non-covered service — plan does not include this benefit",
    "51": "Non-covered service — pre-existing condition",
    "55": "Procedure not paid separately",
    "59": "Processed based on multiple/other coverage",
    "66": "Blood deductible",
    "89": "Professional charges for non-covered services",
    "90": "Ingredient cost adjustment — substitution not dispensed",
    "94": "Processed in excess of charges",
    "96": "Non-covered charge(s)",
    "97": "Payment adjusted — benefit for this service is included in the allowance for another service",
    "100": "Payment made to patient/insured/responsible party",
    "107": "Claim/service denied — related to another adjudicated claim",
    "109": "Claim not covered by this payer — forward to correct payer",
    "119": "Benefit maximum for this time period has been reached",
    "130": "Claim submission fee",
    "131": "Claim specific negotiated discount",
    "136": "Failure to follow plan network",
    "140": "Patient/insured health ID card not provided",
    "142": "Monthly benefit maximum reached",
    "146": "Diagnosis not covered for this place of service",
    "150": "Payer deems service is not reasonable or necessary",
    "151": "Payment adjusted — rendering provider not certified for procedure",
    "167": "Diagnosis is not covered",
    "170": "Payment is denied when performed by this type of provider",
    "171": "Payment is denied — no referral on file",
    "172": "Payment adjusted — primary payer's fee schedule amount",
    "177": "Patient has not met the deductible",
    "181": "Procedure code was invalid on the date of service",
    "182": "Procedure modifier was invalid on the date of service",
    "185": "Claim was processed as primary — forwarded to additional payer(s)",
    "187": "Consumer Operated and Oriented Plan (CO-OP) payment adjustment",
    "189": "Not otherwise classified (NOC) procedure code requires manual review",
    "190": "Payment adjusted — bi-lateral procedure",
    "192": "Non-standard adjustment code from remittance",
    "193": "Original payment decision is being maintained",
    "194": "Anesthesia units exceed procedure time allowance",
    "197": "Prior authorization/pre-certification required — not obtained",
    "198": "Precertification not provided within required timeframe",
    "199": "Revenue code and procedure code do not match",
    "204": "Service not covered when performed in this setting",
    "223": "Adjustment for provider charge exceeds maximum allowable",
    "226": "Information requested was not provided or was insufficient",
    "227": "Information requested not received within time limit",
    "233": "Does not meet criteria for separate reimbursement/payment",
    "234": "Incorrect procedure qualifier",
    "235": "Sales tax",
    "236": "Pharmacy discount",
    "237": "Pharmacy generic product utilization adjustment",
    "242": "Services not provided by network/primary care providers",
    "243": "Service not authorized by network/primary care providers",
    "246": "Non-covered service — not on this payer's fee schedule",
    "247": "Non-covered service — not a covered benefit in the patient's plan",
    "253": "Sequestration — Loss of Federal funding",
}


def _describe_carc(code: str) -> str:
    """Return a plain-English description for a CARC reason code."""
    return CARC_DESCRIPTIONS.get(str(code), f"Adjustment reason code {code}")


# ---------------------------------------------------------------------------
# ERA / 835 dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ERAAdjustment:
    """A single adjustment from the ERA."""
    group_code: str = ""        # CO, PR, OA, PI
    reason_code: str = ""       # CARC code
    amount: float = 0.0
    description: str = ""       # Plain English from CARC_DESCRIPTIONS


@dataclass
class ERAServiceLine:
    """Per-service breakdown within a claim payment."""
    cpt_code: str = ""
    charged_amount: float = 0.0
    allowed_amount: float = 0.0
    paid_amount: float = 0.0
    adjustments: list[ERAAdjustment] = field(default_factory=list)


@dataclass
class ERAClaimPayment:
    """Payment details for a single claim within an ERA."""
    patient_name: str = ""
    member_id: str = ""
    claim_id: str = ""              # Our internal reference (from CLM segment patient_control_number)
    charged_amount: float = 0.0
    paid_amount: float = 0.0
    patient_responsibility: float = 0.0
    adjustments: list[ERAAdjustment] = field(default_factory=list)
    service_lines: list[ERAServiceLine] = field(default_factory=list)
    is_denied: bool = False
    denial_reason: str = ""


@dataclass
class ERAResult:
    """Parsed ERA/835 remittance advice."""
    check_number: str = ""
    payer_name: str = ""
    payer_id: str = ""
    payment_date: str = ""
    total_payment_amount: float = 0.0
    claim_payments: list[ERAClaimPayment] = field(default_factory=list)
    raw_data: dict = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return bool(self.claim_payments)


# ERA group code descriptions
_GROUP_CODE_DESCRIPTIONS = {
    "CO": "Contractual Obligation",
    "PR": "Patient Responsibility",
    "OA": "Other Adjustment",
    "PI": "Payor Initiated Reduction",
    "CR": "Correction/Reversal",
}

# Denial-indicating CARC reason codes (non-exhaustive)
_DENIAL_REASON_CODES = {
    "5", "9", "29", "31", "34", "35", "39", "40", "49", "50", "51",
    "96", "109", "119", "150", "167", "170", "171", "197", "198", "204",
    "246", "247",
}


# Module-level singleton
stedi_client = StediClient()
