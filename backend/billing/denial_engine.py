"""Denial Management Engine — categorize, suggest corrections, and prepare resubmissions.

Analyzes CARC/RARC denial codes from ERA/835 processing, maps them to actionable
categories, generates correction suggestions, and prepares claim data for resubmission.
"""
import logging
from dataclasses import dataclass, field
from enum import Enum

from integrations.stedi import CARC_DESCRIPTIONS

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class DenialCategoryEnum(str, Enum):
    MISSING_INFO = "missing_info"
    MEDICAL_NECESSITY = "medical_necessity"
    AUTH_REQUIRED = "auth_required"
    TIMELY_FILING = "timely_filing"
    DUPLICATE = "duplicate"
    NON_COVERED = "non_covered"
    COORDINATION_OF_BENEFITS = "coordination_of_benefits"
    ELIGIBILITY = "eligibility"
    OTHER = "other"


@dataclass
class DenialCategory:
    category: str
    label: str
    description: str
    is_appealable: bool
    typical_resolution: str
    matched_codes: list[str] = field(default_factory=list)


@dataclass
class DenialSuggestion:
    action: str
    description: str
    auto_fixable: bool
    priority: str  # "high", "medium", "low"


# ---------------------------------------------------------------------------
# CARC → Category mapping
# ---------------------------------------------------------------------------
# Each CARC code maps to exactly one primary category. Codes that appear in
# multiple conceptual buckets are placed in the most actionable category.

_CARC_CATEGORY_MAP: dict[str, str] = {
    # missing_info — Missing/invalid information
    "1": "missing_info",       # Deductible (often missing info context)
    "15": "missing_info",      # Payment adjusted — prior payer paid
    "16": "missing_info",      # Missing information / Claim lacks info
    "140": "missing_info",     # Patient/insured health ID card not provided
    "181": "missing_info",     # Procedure code was invalid on date of service
    "182": "missing_info",     # Procedure modifier was invalid on date of service
    "226": "missing_info",     # Information requested was not provided or insufficient
    "227": "missing_info",     # Information requested not received within time limit
    "234": "missing_info",     # Incorrect procedure qualifier
    "252": "missing_info",     # Additional information required

    # medical_necessity — Not medically necessary
    "9": "medical_necessity",   # Not medically necessary
    "50": "medical_necessity",  # Non-covered service — plan does not include
    "55": "medical_necessity",  # Procedure not paid separately
    "56": "medical_necessity",  # Procedure not paid separately (bundled)
    "57": "medical_necessity",  # Procedure not paid separately (component)
    "58": "medical_necessity",  # Procedure not paid separately (mutually exclusive)
    "150": "medical_necessity", # Payer deems service not reasonable or necessary
    "167": "medical_necessity", # Diagnosis is not covered
    "233": "medical_necessity", # Does not meet criteria for separate reimbursement

    # auth_required — Prior authorization needed
    "39": "auth_required",     # Services denied — auth was requested and denied
    "197": "auth_required",    # Prior authorization/pre-certification required
    "198": "auth_required",    # Precertification not provided within timeframe
    "199": "auth_required",    # Revenue code and procedure code do not match

    # timely_filing — Filing deadline missed
    "29": "timely_filing",     # Filing limit expired

    # duplicate — Duplicate claim
    "18": "duplicate",         # Duplicate claim/service
    "97": "duplicate",         # Benefit included in allowance for another service
    "107": "duplicate",        # Claim denied — related to another adjudicated claim

    # non_covered — Service not covered by plan
    "5": "non_covered",        # Not covered under plan
    "49": "non_covered",       # Routine/preventive care not covered
    "51": "non_covered",       # Non-covered service — pre-existing condition
    "89": "non_covered",       # Professional charges for non-covered services
    "96": "non_covered",       # Non-covered charge(s)
    "119": "non_covered",      # Benefit maximum for this time period reached
    "135": "non_covered",      # Benefit maximum reached — not covered
    "142": "non_covered",      # Monthly benefit maximum reached
    "146": "non_covered",      # Diagnosis not covered for this place of service
    "204": "non_covered",      # Service not covered when performed in this setting
    "242": "non_covered",      # Services not provided by network/primary care providers

    # coordination_of_benefits — COB issue
    "22": "coordination_of_benefits",   # Coordination of benefits adjustment
    "23": "coordination_of_benefits",   # Payment adjusted — charges covered under capitation
    "24": "coordination_of_benefits",   # Payment adjusted — charges covered by managed care
    "31": "coordination_of_benefits",   # Not patient's liability — wrong payer
    "59": "coordination_of_benefits",   # Processed based on multiple/other coverage
    "109": "coordination_of_benefits",  # Claim not covered by this payer — forward to correct payer
    "185": "coordination_of_benefits",  # Claim processed as primary — forwarded to additional payer(s)

    # eligibility — Patient not eligible
    "27": "eligibility",       # Expenses incurred after coverage terminated
    "26": "eligibility",       # Expenses incurred prior to coverage
    "32": "eligibility",       # Patient is not an eligible dependent
    "33": "eligibility",       # Insured has no dependent coverage
    "34": "eligibility",       # Insured not in group/plan on date of service
    "35": "eligibility",       # Lifetime benefit maximum reached
    "170": "eligibility",      # Payment denied for this type of provider
    "171": "eligibility",      # Payment denied — no referral on file
}

# Category metadata
_CATEGORY_METADATA: dict[str, dict] = {
    "missing_info": {
        "label": "Missing/Invalid Information",
        "description": "The claim was denied because required information was missing, invalid, or incomplete.",
        "is_appealable": True,
        "typical_resolution": "Correct the missing/invalid fields and resubmit the claim.",
    },
    "medical_necessity": {
        "label": "Medical Necessity",
        "description": "The payer determined the service was not medically necessary or does not meet coverage criteria.",
        "is_appealable": True,
        "typical_resolution": "Submit appeal with clinical documentation supporting medical necessity. Consider peer-to-peer review.",
    },
    "auth_required": {
        "label": "Prior Authorization Required",
        "description": "The service required prior authorization that was not obtained or not provided.",
        "is_appealable": True,
        "typical_resolution": "Obtain prior authorization from the payer and resubmit with the authorization number.",
    },
    "timely_filing": {
        "label": "Timely Filing Deadline Missed",
        "description": "The claim was not submitted within the payer's filing deadline.",
        "is_appealable": False,
        "typical_resolution": "Usually unrecoverable. Appeal only if you have proof of timely submission (e.g., clearinghouse receipt).",
    },
    "duplicate": {
        "label": "Duplicate Claim",
        "description": "The payer identified this claim as a duplicate of a previously submitted claim.",
        "is_appealable": True,
        "typical_resolution": "Check if the original claim was paid. If not, resubmit as a replacement claim (frequency code 7).",
    },
    "non_covered": {
        "label": "Service Not Covered",
        "description": "The service is not covered under the patient's benefit plan.",
        "is_appealable": True,
        "typical_resolution": "Options: bill the patient directly, appeal with supporting documentation, or verify correct coding.",
    },
    "coordination_of_benefits": {
        "label": "Coordination of Benefits",
        "description": "The denial relates to coordination between multiple payers or incorrect payer assignment.",
        "is_appealable": True,
        "typical_resolution": "Verify primary/secondary payer order and resubmit to the correct payer.",
    },
    "eligibility": {
        "label": "Patient Eligibility",
        "description": "The patient was not eligible for coverage at the time of service.",
        "is_appealable": True,
        "typical_resolution": "Run an eligibility check to verify current coverage. Patient may need to update insurance information.",
    },
    "other": {
        "label": "Uncategorized Denial",
        "description": "The denial reason code does not fall into a standard category.",
        "is_appealable": True,
        "typical_resolution": "Review the specific denial code and contact the payer for clarification.",
    },
}


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

def categorize_denial(
    carc_codes: list[str],
    group_codes: list[str] | None = None,
) -> DenialCategory:
    """Categorize a denial based on CARC reason codes and group codes.

    Examines all denial codes and picks the most significant category.
    Priority order (most actionable first):
      auth_required > missing_info > eligibility > coordination_of_benefits >
      medical_necessity > duplicate > non_covered > timely_filing > other
    """
    category_priority = [
        "auth_required",
        "missing_info",
        "eligibility",
        "coordination_of_benefits",
        "medical_necessity",
        "duplicate",
        "non_covered",
        "timely_filing",
    ]

    # Collect all categories found
    found_categories: dict[str, list[str]] = {}
    for code in carc_codes:
        code_str = str(code).strip()
        cat = _CARC_CATEGORY_MAP.get(code_str)
        if cat:
            found_categories.setdefault(cat, []).append(code_str)

    # Pick highest priority category
    chosen = "other"
    for cat in category_priority:
        if cat in found_categories:
            chosen = cat
            break

    meta = _CATEGORY_METADATA[chosen]
    matched = []
    for codes in found_categories.values():
        matched.extend(codes)

    return DenialCategory(
        category=chosen,
        label=meta["label"],
        description=meta["description"],
        is_appealable=meta["is_appealable"],
        typical_resolution=meta["typical_resolution"],
        matched_codes=matched or list(carc_codes),
    )


def suggest_corrections(
    category: str,
    carc_codes: list[str],
    claim_data: dict | None = None,
) -> list[DenialSuggestion]:
    """Return actionable suggestions for resolving a denial based on category.

    Each suggestion includes whether it can be auto-fixed and its priority.
    """
    claim_data = claim_data or {}
    suggestions: list[DenialSuggestion] = []

    code_descriptions = [
        f"{c}: {CARC_DESCRIPTIONS.get(str(c), 'Unknown')}"
        for c in carc_codes
    ]
    code_summary = "; ".join(code_descriptions)

    if category == "missing_info":
        # Determine which specific fields may be missing based on CARC codes
        missing_fields = _infer_missing_fields(carc_codes, claim_data)
        if missing_fields:
            suggestions.append(DenialSuggestion(
                action="correct_and_resubmit",
                description=f"Review and correct the following fields: {', '.join(missing_fields)}. Then resubmit the claim.",
                auto_fixable=False,
                priority="high",
            ))
        suggestions.append(DenialSuggestion(
            action="verify_patient_info",
            description="Verify patient demographics (name, DOB, gender, member ID) match the payer's records exactly.",
            auto_fixable=False,
            priority="high",
        ))
        if any(str(c) in ("226", "227") for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="submit_additional_info",
                description="The payer requested additional information. Gather and submit the requested documentation.",
                auto_fixable=False,
                priority="high",
            ))
        if any(str(c) in ("181", "182") for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="verify_procedure_codes",
                description="Verify CPT/HCPCS codes and modifiers are valid for the date of service. Correct and resubmit.",
                auto_fixable=False,
                priority="high",
            ))

    elif category == "medical_necessity":
        suggestions.append(DenialSuggestion(
            action="appeal_with_documentation",
            description="Prepare an appeal with clinical documentation (treatment plan, progress notes) supporting medical necessity for this service.",
            auto_fixable=False,
            priority="high",
        ))
        suggestions.append(DenialSuggestion(
            action="peer_to_peer_review",
            description="Request a peer-to-peer review with the payer's medical director to discuss clinical justification.",
            auto_fixable=False,
            priority="medium",
        ))
        if any(str(c) in ("55", "56", "57", "58", "233") for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="check_bundling",
                description="This service may be bundled with another procedure. Check NCCI edits and consider using modifier 59 (distinct procedural service) if appropriate.",
                auto_fixable=False,
                priority="medium",
            ))
        if any(str(c) == "167" for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="verify_diagnosis",
                description="The diagnosis code may not support this service. Review and update ICD-10 codes to better reflect the clinical picture.",
                auto_fixable=False,
                priority="high",
            ))

    elif category == "auth_required":
        auth_number = claim_data.get("authorization_number")
        if auth_number:
            suggestions.append(DenialSuggestion(
                action="resubmit_with_auth",
                description=f"Authorization number '{auth_number}' is on file. Resubmit the claim with this authorization number included.",
                auto_fixable=True,
                priority="high",
            ))
        else:
            suggestions.append(DenialSuggestion(
                action="obtain_authorization",
                description="Obtain prior authorization from the payer for this service. Some payers allow retroactive authorization requests.",
                auto_fixable=False,
                priority="high",
            ))
        suggestions.append(DenialSuggestion(
            action="check_retro_auth",
            description="Contact the payer to request retroactive authorization. Many behavioral health payers allow retro-auth within 14-30 days.",
            auto_fixable=False,
            priority="medium",
        ))

    elif category == "timely_filing":
        suggestions.append(DenialSuggestion(
            action="gather_proof_of_timely_filing",
            description="Check for proof of timely submission: clearinghouse confirmation, original submission timestamp, or previous acknowledgments (277CA).",
            auto_fixable=False,
            priority="high",
        ))
        suggestions.append(DenialSuggestion(
            action="appeal_if_proof_exists",
            description="If proof of timely filing exists, submit a formal appeal with the documentation. Include the original submission date and tracking ID.",
            auto_fixable=False,
            priority="medium",
        ))
        suggestions.append(DenialSuggestion(
            action="write_off",
            description="If no proof of timely filing exists, this denial is typically unrecoverable. Consider writing off the balance.",
            auto_fixable=False,
            priority="low",
        ))

    elif category == "duplicate":
        suggestions.append(DenialSuggestion(
            action="check_original_claim",
            description="Locate the original claim submission. If it was paid, no action is needed. If unpaid, resubmit as a replacement claim (frequency code 7).",
            auto_fixable=False,
            priority="high",
        ))
        if any(str(c) == "97" for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="check_bundling_rules",
                description="CARC 97 indicates the benefit is included in another service's allowance. Review bundling/NCCI edits.",
                auto_fixable=False,
                priority="medium",
            ))
        suggestions.append(DenialSuggestion(
            action="resubmit_as_replacement",
            description="If the original claim was not paid, resubmit as a replacement claim with frequency code 7 and reference to the original claim.",
            auto_fixable=True,
            priority="medium",
        ))

    elif category == "non_covered":
        suggestions.append(DenialSuggestion(
            action="verify_benefits",
            description="Verify the patient's benefits to confirm this service type is covered. Check for behavioral health carve-outs or separate benefit administrators.",
            auto_fixable=False,
            priority="high",
        ))
        suggestions.append(DenialSuggestion(
            action="bill_patient",
            description="If the service is confirmed non-covered, inform the patient and bill them directly for the service.",
            auto_fixable=False,
            priority="medium",
        ))
        if any(str(c) in ("119", "135", "142") for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="check_benefit_limits",
                description="The patient's benefit maximum has been reached. Verify the limit and discuss payment options with the patient.",
                auto_fixable=False,
                priority="high",
            ))
        if any(str(c) in ("146", "204") for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="check_place_of_service",
                description="This service is not covered at the billed place of service. Verify and correct the place of service code, then resubmit.",
                auto_fixable=False,
                priority="high",
            ))
        suggestions.append(DenialSuggestion(
            action="appeal_with_documentation",
            description="If you believe the service should be covered, file an appeal with clinical documentation and any relevant policy references.",
            auto_fixable=False,
            priority="low",
        ))

    elif category == "coordination_of_benefits":
        suggestions.append(DenialSuggestion(
            action="verify_payer_order",
            description="Verify the correct primary/secondary payer order with the patient. Update insurance information if needed.",
            auto_fixable=False,
            priority="high",
        ))
        if any(str(c) in ("31", "109") for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="submit_to_correct_payer",
                description="This claim was submitted to the wrong payer. Identify the correct payer and resubmit.",
                auto_fixable=False,
                priority="high",
            ))
        if any(str(c) == "22" for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="submit_to_secondary",
                description="Submit the claim to the secondary payer with the primary payer's EOB/ERA attached.",
                auto_fixable=False,
                priority="high",
            ))

    elif category == "eligibility":
        suggestions.append(DenialSuggestion(
            action="run_eligibility_check",
            description="Run a real-time eligibility check to verify the patient's current coverage status and effective dates.",
            auto_fixable=False,
            priority="high",
        ))
        suggestions.append(DenialSuggestion(
            action="update_patient_insurance",
            description="Contact the patient to verify and update their insurance information. They may have new coverage.",
            auto_fixable=False,
            priority="high",
        ))
        if any(str(c) in ("27", "26", "34") for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="verify_coverage_dates",
                description="The patient was not covered on the date of service. Verify coverage effective/termination dates.",
                auto_fixable=False,
                priority="high",
            ))
        if any(str(c) == "171" for c in carc_codes):
            suggestions.append(DenialSuggestion(
                action="obtain_referral",
                description="A referral was required but not on file. Obtain a referral from the patient's PCP and resubmit.",
                auto_fixable=False,
                priority="high",
            ))

    else:
        # other / uncategorized
        suggestions.append(DenialSuggestion(
            action="review_denial_codes",
            description=f"Review denial reason codes: {code_summary}. Contact the payer for specific resolution guidance.",
            auto_fixable=False,
            priority="medium",
        ))
        suggestions.append(DenialSuggestion(
            action="contact_payer",
            description="Call the payer's provider services line to discuss this denial and determine the best course of action.",
            auto_fixable=False,
            priority="medium",
        ))

    return suggestions


def can_auto_resubmit(category: str, claim_data: dict | None = None) -> bool:
    """Determine if a denied claim can be automatically resubmitted.

    Returns True only for clear-cut cases where the necessary correction
    data already exists in the claim record.
    """
    claim_data = claim_data or {}

    if category == "auth_required":
        # Auto-resubmit if we now have an authorization number
        return bool(claim_data.get("authorization_number"))

    if category == "missing_info":
        # Could auto-resubmit if we detect the previously missing info
        # is now present — conservative: only if claim_data has been
        # explicitly corrected (indicated by a corrections dict)
        return bool(claim_data.get("_corrections_applied"))

    if category == "duplicate":
        # Can auto-resubmit as replacement if we have the original ref
        return bool(claim_data.get("original_claim_id"))

    return False


def prepare_resubmission(
    claim_data: dict,
    corrections: dict,
    is_replacement: bool = True,
    original_reference: str | None = None,
) -> dict:
    """Prepare corrected claim data for resubmission.

    Args:
        claim_data: Original claim data dict (from billing_claims.claim_data).
        corrections: Field overrides to apply to the claim data.
        is_replacement: If True, set frequency code 7 (replacement).
                        If False, treated as a new submission.
        original_reference: Original claim reference number for replacement claims.

    Returns:
        Corrected claim data dict ready for submission via stedi_client.submit_claim().
    """
    # Deep copy to avoid mutating the original
    import copy
    corrected = copy.deepcopy(claim_data)

    # Apply corrections — supports nested keys via dot notation
    for key, value in corrections.items():
        _set_nested(corrected, key, value)

    # Set resubmission metadata
    if is_replacement:
        corrected["_resubmission"] = {
            "frequency_code": "7",  # Replacement
            "original_reference": original_reference or "",
        }
    else:
        corrected["_resubmission"] = {
            "frequency_code": "1",  # Original
        }

    # Mark as corrected for auto-resubmit detection
    corrected["_corrections_applied"] = True

    return corrected


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _set_nested(data: dict, dotted_key: str, value) -> None:
    """Set a value in a nested dict using dot notation (e.g. 'patient.member_id')."""
    keys = dotted_key.split(".")
    current = data
    for k in keys[:-1]:
        if k not in current or not isinstance(current[k], dict):
            current[k] = {}
        current = current[k]
    current[keys[-1]] = value


def _infer_missing_fields(carc_codes: list[str], claim_data: dict) -> list[str]:
    """Infer which fields may be missing based on CARC codes and claim data."""
    fields = []
    code_set = {str(c) for c in carc_codes}

    if "16" in code_set:
        # Generic missing info — check common culprits
        patient = claim_data.get("patient", {})
        if not patient.get("member_id"):
            fields.append("patient.member_id")
        if not patient.get("date_of_birth"):
            fields.append("patient.date_of_birth")
        if not patient.get("gender"):
            fields.append("patient.gender")
        provider = claim_data.get("provider", {})
        if not provider.get("npi"):
            fields.append("provider.npi")
        if not provider.get("tax_id"):
            fields.append("provider.tax_id")
        if not fields:
            fields.append("(review all claim fields for missing data)")

    if "140" in code_set:
        fields.append("patient.member_id (insurance card not provided)")

    if "181" in code_set:
        fields.append("service_lines[].cpt_code (invalid for date of service)")

    if "182" in code_set:
        fields.append("service_lines[].modifier (invalid for date of service)")

    if "234" in code_set:
        fields.append("service_lines[].cpt_code (incorrect procedure qualifier)")

    if "226" in code_set or "227" in code_set:
        fields.append("(additional documentation requested by payer)")

    if "252" in code_set:
        fields.append("(additional information required — check payer correspondence)")

    return fields


def serialize_denial_category(dc: DenialCategory) -> dict:
    """Convert a DenialCategory dataclass to a JSON-serializable dict."""
    return {
        "category": dc.category,
        "label": dc.label,
        "description": dc.description,
        "is_appealable": dc.is_appealable,
        "typical_resolution": dc.typical_resolution,
        "matched_codes": dc.matched_codes,
    }


def serialize_suggestion(s: DenialSuggestion) -> dict:
    """Convert a DenialSuggestion dataclass to a JSON-serializable dict."""
    return {
        "action": s.action,
        "description": s.description,
        "auto_fixable": s.auto_fixable,
        "priority": s.priority,
    }
