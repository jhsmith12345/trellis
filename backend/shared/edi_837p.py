"""ANSI X12 837P Professional claim file generator.

Generates valid 837P EDI files from superbill data for submission to
clearinghouses. No external EDI libraries — the X12 format is just
structured text with specific segment ordering and delimiters.

Delimiters:
  - Element separator: *
  - Sub-element separator: :
  - Segment terminator: ~

References:
  - ASC X12 837P Implementation Guide (005010X222A1)
  - CMS-1500 field mapping in cms1500_pdf.py
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe(val: Any, default: str = "") -> str:
    """Return str(val) stripped if truthy, else default."""
    if val is None:
        return default
    s = str(val).strip()
    return s if s else default


def _fmt_date_ccyymmdd(val) -> str:
    """Format a date as CCYYMMDD (e.g., 20260308)."""
    if not val:
        return datetime.now(timezone.utc).strftime("%Y%m%d")
    if hasattr(val, "strftime"):
        return val.strftime("%Y%m%d")
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        return dt.strftime("%Y%m%d")
    except Exception:
        return str(val).replace("-", "")[:8]


def _fmt_time_hhmm(val=None) -> str:
    """Format a time as HHMM."""
    if val and hasattr(val, "strftime"):
        return val.strftime("%H%M")
    return datetime.now(timezone.utc).strftime("%H%M")


def _control_number_from_uuid(uuid_str: str, length: int = 9) -> str:
    """Derive a numeric control number from a UUID string.

    Takes hex characters from the UUID, converts to int, then truncates/pads
    to the requested length. Control numbers must be numeric.
    """
    hex_chars = uuid_str.replace("-", "")[:16]
    try:
        num = int(hex_chars, 16)
    except ValueError:
        num = abs(hash(uuid_str))
    return str(num)[-length:].zfill(length)


def _pad_isa(segment: str) -> str:
    """Pad ISA segment to exactly 106 characters (including trailing ~).

    The ISA segment has 16 fixed-length elements. The total length before the
    segment terminator must be 105 characters, plus the ~ makes 106.
    """
    # Remove trailing ~ if present, we'll re-add it
    seg = segment.rstrip("~")
    # ISA must be exactly 105 chars before the terminator
    if len(seg) < 105:
        seg = seg + " " * (105 - len(seg))
    elif len(seg) > 105:
        seg = seg[:105]
    return seg + "~"


def _split_name(full_name: str) -> tuple[str, str]:
    """Split 'First Last' into (last, first). Best effort."""
    parts = full_name.strip().split()
    if len(parts) == 0:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    return (parts[-1], " ".join(parts[:-1]))


def _normalize_dx_codes(raw) -> list[dict]:
    """Normalize diagnosis_codes from various formats to list of dicts."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if not raw or not isinstance(raw, list):
        return []
    result = []
    for dx in raw:
        if isinstance(dx, dict):
            code = dx.get("code", "")
            result.append({"code": code.replace(".", "")})
        elif isinstance(dx, str):
            result.append({"code": dx.replace(".", "")})
    return result


def _normalize_modifiers(raw) -> list[str]:
    """Normalize modifiers from various formats."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if not raw or not isinstance(raw, list):
        return []
    return [str(m).strip() for m in raw if str(m).strip()]


# ---------------------------------------------------------------------------
# Segment builders
# ---------------------------------------------------------------------------

class EDI837PBuilder:
    """Builds an ANSI X12 837P Professional claim file.

    Usage:
        builder = EDI837PBuilder()
        builder.add_claim(superbill, client, practice, clinician)
        edi_content = builder.build()
    """

    def __init__(self):
        self._segments: list[str] = []
        self._segment_count = 0  # counts segments between ST/SE
        self._hl_counter = 0
        self._claim_count = 0
        self._now = datetime.now(timezone.utc)
        self._interchange_control = ""
        self._group_control = ""
        self._transaction_control = ""

    def _add(self, segment: str):
        """Add a segment to the output."""
        self._segments.append(segment + "~")
        self._segment_count += 1

    def _add_raw(self, segment: str):
        """Add a pre-formatted segment (e.g., ISA with padding)."""
        self._segments.append(segment)
        self._segment_count += 1

    def build_single(
        self,
        superbill: dict,
        client: dict,
        practice: dict,
        clinician: dict,
    ) -> str:
        """Generate a complete 837P file for a single claim."""
        sb_id = _safe(superbill.get("id"), "000000000")
        ctrl = _control_number_from_uuid(sb_id)

        self._build_interchange_header(ctrl)
        self._build_functional_group_header(ctrl, practice)
        self._build_transaction_header(ctrl)
        self._build_submitter_and_receiver(practice)

        # Hierarchical structure
        self._hl_counter = 0
        self._build_billing_provider_hl(superbill, practice, clinician)
        self._build_subscriber_hl(superbill, client, practice, clinician)

        self._build_transaction_trailer(ctrl)
        self._build_functional_group_trailer(ctrl)
        self._build_interchange_trailer(ctrl)

        return "\n".join(self._segments)

    def build_batch(
        self,
        claims: list[dict],
    ) -> str:
        """Generate a single 837P file with multiple claims.

        Each item in claims must have keys: superbill, client, practice, clinician.
        """
        if not claims:
            return ""

        # Use first superbill's ID for interchange control
        first_sb_id = _safe(claims[0]["superbill"].get("id"), "000000000")
        ctrl = _control_number_from_uuid(first_sb_id)
        practice = claims[0]["practice"]

        self._build_interchange_header(ctrl)
        self._build_functional_group_header(ctrl, practice)
        self._build_transaction_header(ctrl)
        self._build_submitter_and_receiver(practice)

        # All claims share the same billing provider HL
        self._hl_counter = 0
        self._hl_counter += 1
        billing_hl = self._hl_counter

        # HL - Billing Provider
        self._add(f"HL*{billing_hl}**20*1")

        # 2010AA — Billing Provider Name
        practice_name = _safe(
            practice.get("practice_name") or practice.get("clinician_name"),
            "PRACTICE",
        ).upper()
        practice_npi = _safe(practice.get("npi"))
        self._add(f"NM1*85*2*{practice_name}*****XX*{practice_npi}")

        # Billing provider address
        addr1 = _safe(practice.get("address_line1")).upper()
        self._add(f"N3*{addr1}")

        city = _safe(practice.get("city") or practice.get("address_city")).upper()
        state = _safe(practice.get("state") or practice.get("address_state")).upper()
        zip_code = _safe(practice.get("zip") or practice.get("address_zip"))
        self._add(f"N4*{city}*{state}*{zip_code}")

        # Tax ID
        tax_id = _safe(practice.get("tax_id")).replace("-", "")
        if tax_id:
            self._add(f"REF*EI*{tax_id}")

        # Add each claim as a subscriber HL
        for claim_data in claims:
            sb = claim_data["superbill"]
            cl = claim_data["client"]
            pr = claim_data["practice"]
            clin = claim_data["clinician"]

            self._hl_counter += 1
            subscriber_hl = self._hl_counter

            # HL - Subscriber
            self._add(f"HL*{subscriber_hl}*{billing_hl}*22*0")

            # SBR - Subscriber Information
            payer_name = _safe(cl.get("payer_name"))
            has_secondary = bool(_safe(cl.get("secondary_payer_name")))
            payer_responsibility = "P"  # Primary
            self._add(f"SBR*{payer_responsibility}*18*{_safe(cl.get('group_number'))}******CI")

            self._build_subscriber_detail(sb, cl, pr, clin)

        self._build_transaction_trailer(ctrl)
        self._build_functional_group_trailer(ctrl)
        self._build_interchange_trailer(ctrl)

        return "\n".join(self._segments)

    # -------------------------------------------------------------------
    # Interchange / Group / Transaction envelope
    # -------------------------------------------------------------------

    def _build_interchange_header(self, ctrl: str):
        """ISA segment — Interchange Control Header."""
        date_str = self._now.strftime("%y%m%d")
        time_str = self._now.strftime("%H%M")

        # ISA element widths are fixed:
        # ISA01(2) ISA02(10) ISA03(2) ISA04(10) ISA05(2) ISA06(15)
        # ISA07(2) ISA08(15) ISA09(6) ISA10(4) ISA11(1) ISA12(5)
        # ISA13(9) ISA14(1) ISA15(1) ISA16(1)
        isa = (
            f"ISA*00*{'':10s}*00*{'':10s}"
            f"*ZZ*{'TRELLIS':15s}"
            f"*ZZ*{'CLEARINGHOUSE':15s}"
            f"*{date_str}*{time_str}"
            f"*^*00501*{ctrl}*0*P*:"
        )
        self._add_raw(_pad_isa(isa))

    def _build_functional_group_header(self, ctrl: str, practice: dict):
        """GS segment — Functional Group Header."""
        date_str = self._now.strftime("%Y%m%d")
        time_str = self._now.strftime("%H%M")
        sender_id = _safe(practice.get("npi"), "TRELLIS")
        self._add(
            f"GS*HC*{sender_id}*CLEARINGHOUSE*{date_str}*{time_str}*{ctrl}*X*005010X222A1"
        )

    def _build_transaction_header(self, ctrl: str):
        """ST segment — Transaction Set Header + BHT."""
        self._segment_count = 0  # reset for ST/SE counting
        self._segments_start_idx = len(self._segments)
        self._add(f"ST*837*{ctrl[:4].zfill(4)}*005010X222A1")
        # BHT — Beginning of Hierarchical Transaction
        # 0019 = Original, CH = Chargeable
        date_str = self._now.strftime("%Y%m%d")
        time_str = self._now.strftime("%H%M")
        self._add(f"BHT*0019*00*{ctrl}*{date_str}*{time_str}*CH")

    def _build_submitter_and_receiver(self, practice: dict):
        """1000A Submitter and 1000B Receiver loops."""
        # 1000A — Submitter Name
        practice_name = _safe(
            practice.get("practice_name") or practice.get("clinician_name"),
            "PRACTICE",
        ).upper()
        contact_phone = _safe(practice.get("phone")).replace("-", "").replace("(", "").replace(")", "").replace(" ", "")
        self._add(f"NM1*41*2*{practice_name}*****46*{_safe(practice.get('npi'))}")

        # PER — Submitter Contact
        if contact_phone:
            self._add(f"PER*IC*{practice_name}*TE*{contact_phone}")
        else:
            self._add(f"PER*IC*{practice_name}")

        # 1000B — Receiver Name
        self._add("NM1*40*2*CLEARINGHOUSE*****46*CLEARINGHOUSE")

    # -------------------------------------------------------------------
    # Hierarchical Levels (single claim mode)
    # -------------------------------------------------------------------

    def _build_billing_provider_hl(
        self,
        superbill: dict,
        practice: dict,
        clinician: dict,
    ):
        """HL 2000A — Billing Provider Hierarchical Level."""
        self._hl_counter += 1
        billing_hl = self._hl_counter
        self._billing_hl = billing_hl

        # HL segment: ID * parent * level code (20=billing) * child code (1=has children)
        self._add(f"HL*{billing_hl}**20*1")

        # 2010AA — Billing Provider Name
        practice_name = _safe(
            practice.get("practice_name") or practice.get("clinician_name"),
            "PRACTICE",
        ).upper()
        practice_npi = _safe(practice.get("npi"))

        # NM1*85 = Billing Provider (entity type 2 = non-person)
        self._add(f"NM1*85*2*{practice_name}*****XX*{practice_npi}")

        # N3 — Address
        addr1 = _safe(practice.get("address_line1")).upper()
        self._add(f"N3*{addr1}")

        # N4 — City, State, Zip
        city = _safe(practice.get("city") or practice.get("address_city")).upper()
        state = _safe(practice.get("state") or practice.get("address_state")).upper()
        zip_code = _safe(practice.get("zip") or practice.get("address_zip"))
        self._add(f"N4*{city}*{state}*{zip_code}")

        # REF*EI — Tax ID
        tax_id = _safe(practice.get("tax_id")).replace("-", "")
        if tax_id:
            self._add(f"REF*EI*{tax_id}")

    def _build_subscriber_hl(
        self,
        superbill: dict,
        client: dict,
        practice: dict,
        clinician: dict,
    ):
        """HL 2000B — Subscriber Hierarchical Level + claim details."""
        self._hl_counter += 1
        subscriber_hl = self._hl_counter

        # HL: ID * parent (billing) * 22 (subscriber) * 0 (no children — patient is subscriber)
        self._add(f"HL*{subscriber_hl}*{self._billing_hl}*22*0")

        # SBR — Subscriber Information
        # SBR01: P=Primary, S=Secondary, T=Tertiary
        # SBR02: 18=Self
        # SBR03: Group number
        # SBR09: CI=Commercial Insurance
        group_number = _safe(client.get("group_number"))
        self._add(f"SBR*P*18*{group_number}******CI")

        self._build_subscriber_detail(superbill, client, practice, clinician)

    def _build_subscriber_detail(
        self,
        superbill: dict,
        client: dict,
        practice: dict,
        clinician: dict,
    ):
        """Build 2010BA, 2010BB, 2300, and 2400 loops for a claim."""
        # ---------------------------------------------------------------
        # 2010BA — Subscriber Name
        # ---------------------------------------------------------------
        full_name = _safe(client.get("full_name"), "UNKNOWN")
        last, first = _split_name(full_name)
        member_id = _safe(client.get("member_id"))

        # NM1*IL = Insured/Subscriber (entity type 1 = person)
        self._add(f"NM1*IL*1*{last.upper()}*{first.upper()}****MI*{member_id}")

        # N3 — Subscriber Address
        addr1 = _safe(client.get("address_line1")).upper()
        if addr1:
            self._add(f"N3*{addr1}")

        # N4 — City, State, Zip
        city = _safe(client.get("address_city")).upper()
        state = _safe(client.get("address_state")).upper()
        zip_code = _safe(client.get("address_zip"))
        if city or state or zip_code:
            self._add(f"N4*{city}*{state}*{zip_code}")

        # DMG — Subscriber Demographics (DOB, gender)
        dob = client.get("date_of_birth")
        if dob:
            dob_str = _fmt_date_ccyymmdd(dob)
            sex = _safe(client.get("sex"), "").upper()
            gender_code = "M" if sex == "M" else ("F" if sex == "F" else "U")
            self._add(f"DMG*D8*{dob_str}*{gender_code}")

        # ---------------------------------------------------------------
        # 2010BB — Payer Name
        # ---------------------------------------------------------------
        payer_name = _safe(client.get("payer_name"), "UNKNOWN PAYER").upper()
        payer_id = _safe(
            superbill.get("payer_id") or client.get("payer_id"),
            "UNKNOWN",
        )

        # NM1*PR = Payer (entity type 2 = non-person)
        self._add(f"NM1*PR*2*{payer_name}*****PI*{payer_id}")

        # ---------------------------------------------------------------
        # 2300 — Claim Information
        # ---------------------------------------------------------------
        sb_id = _safe(superbill.get("id"), "000000000")
        fee = superbill.get("fee")
        fee_val = float(fee) if fee is not None else 0.0
        pos = _safe(superbill.get("place_of_service"), "11")

        # CLM segment:
        # CLM01: Patient account number (superbill ID first 20 chars)
        # CLM02: Total charge amount
        # CLM05: Place of service : Facility code qualifier (B) : Frequency code (1=original)
        # CLM06: Provider signature on file (Y)
        # CLM07: Accept assignment (A=assigned)
        # CLM08: Benefits assignment (Y)
        # CLM09: Release of info (Y)
        patient_acct = sb_id.replace("-", "")[:20]
        self._add(
            f"CLM*{patient_acct}*{fee_val:.2f}***{pos}:B:1*Y*A*Y*Y"
        )

        # HI — Diagnosis Codes
        dx_codes = _normalize_dx_codes(superbill.get("diagnosis_codes"))
        if dx_codes:
            # Build HI segment: first code uses ABK (principal), rest use ABF
            hi_elements = []
            for i, dx in enumerate(dx_codes[:12]):
                qualifier = "ABK" if i == 0 else "ABF"
                code = dx["code"].replace(".", "")
                hi_elements.append(f"{qualifier}:{code}")
            self._add(f"HI*{'*'.join(hi_elements)}")

        # REF*G1 — Prior Authorization Number (if exists)
        auth_number = _safe(superbill.get("auth_number"))
        if auth_number:
            self._add(f"REF*G1*{auth_number}")

        # ---------------------------------------------------------------
        # 2320 — Other Subscriber Info (secondary insurance)
        # ---------------------------------------------------------------
        sec_payer = _safe(client.get("secondary_payer_name"))
        if sec_payer:
            sec_payer_id = _safe(
                superbill.get("secondary_payer_id") or client.get("secondary_payer_id"),
                "UNKNOWN",
            )
            sec_member_id = _safe(
                superbill.get("secondary_member_id") or client.get("secondary_member_id"),
            )
            sec_group = _safe(client.get("secondary_group_number"))

            # SBR for secondary
            self._add(f"SBR*S*18*{sec_group}******CI")

            # OI — Other Insurance Coverage Information
            # OI03: Y = Yes, benefits assigned
            # OI06: Y = Release of information
            self._add("OI***Y*B**Y")

            # 2330A — Other Subscriber Name
            # For self-pay secondary, subscriber is the same person
            self._add(f"NM1*IL*1*{last.upper()}*{first.upper()}****MI*{sec_member_id}")

            # 2330B — Other Payer Name
            self._add(f"NM1*PR*2*{sec_payer.upper()}*****PI*{sec_payer_id}")

        # ---------------------------------------------------------------
        # 2400 — Service Line Detail
        # ---------------------------------------------------------------
        cpt_code = _safe(superbill.get("cpt_code"))
        modifiers = _normalize_modifiers(superbill.get("modifiers"))

        # SV1 — Professional Service
        # SV1-1: Procedure code (HC = HCPCS, followed by CPT and modifiers separated by :)
        proc_code_parts = ["HC", cpt_code] + modifiers
        proc_code = ":".join(proc_code_parts)

        # SV1-2: Charge amount
        # SV1-3: Unit basis (UN = Unit)
        # SV1-4: Quantity
        # SV1-5: Place of service
        # SV1-7: Diagnosis code pointer(s) — 1-based index into HI codes
        dx_pointers = ":".join(str(i + 1) for i in range(min(len(dx_codes), 4))) if dx_codes else "1"
        self._add(
            f"SV1*{proc_code}*{fee_val:.2f}*UN*1*{pos}**{dx_pointers}"
        )

        # DTP*472 — Service Date
        dos = superbill.get("date_of_service")
        dos_str = _fmt_date_ccyymmdd(dos)
        self._add(f"DTP*472*D8*{dos_str}")

        # ---------------------------------------------------------------
        # 2420A — Rendering Provider (if different from billing)
        # ---------------------------------------------------------------
        clinician_npi = _safe(clinician.get("npi"))
        practice_npi = _safe(practice.get("npi"))
        billing_npi = _safe(superbill.get("billing_npi")) or practice_npi

        if clinician_npi and clinician_npi != billing_npi:
            clin_name = _safe(clinician.get("clinician_name"), "UNKNOWN")
            clin_last, clin_first = _split_name(clin_name)
            # NM1*82 = Rendering Provider (entity type 1 = person)
            self._add(
                f"NM1*82*1*{clin_last.upper()}*{clin_first.upper()}****XX*{clinician_npi}"
            )

    # -------------------------------------------------------------------
    # Trailers
    # -------------------------------------------------------------------

    def _build_transaction_trailer(self, ctrl: str):
        """SE segment — Transaction Set Trailer."""
        # SE01 = number of segments including ST and SE
        # We need to count from ST to SE inclusive
        count = self._segment_count + 1  # +1 for SE itself
        self._add(f"SE*{count}*{ctrl[:4].zfill(4)}")

    def _build_functional_group_trailer(self, ctrl: str):
        """GE segment — Functional Group Trailer."""
        # GE01 = number of transaction sets (always 1 for us)
        self._add(f"GE*1*{ctrl}")

    def _build_interchange_trailer(self, ctrl: str):
        """IEA segment — Interchange Control Trailer."""
        # IEA01 = number of functional groups (always 1)
        self._add(f"IEA*1*{ctrl}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_837p(
    superbill_data: dict,
    client: dict,
    practice: dict,
    clinician: dict,
) -> str:
    """Generate an ANSI X12 837P Professional claim file for a single superbill.

    Args:
        superbill_data: Superbill record dict.
        client: Client record dict.
        practice: Practice profile dict.
        clinician: Clinician record dict.

    Returns:
        EDI 837P file content as a string.
    """
    builder = EDI837PBuilder()
    return builder.build_single(superbill_data, client, practice, clinician)


def generate_837p_batch(
    superbills_with_data: list[dict],
) -> str:
    """Generate a single ANSI X12 837P file containing multiple claims.

    Args:
        superbills_with_data: List of dicts, each with keys:
            - superbill: Superbill record dict
            - client: Client record dict
            - practice: Practice profile dict
            - clinician: Clinician record dict

    Returns:
        EDI 837P file content as a string.
    """
    builder = EDI837PBuilder()
    return builder.build_batch(superbills_with_data)
