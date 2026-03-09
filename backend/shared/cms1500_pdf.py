"""CMS-1500 claim form PDF generation.

Generates a professional CMS-1500 (Health Insurance Claim Form) PDF from
superbill data, client demographics, practice info, and clinician details.
The output is a data-filled representation of the CMS-1500 form that
clearinghouses and payers accept — not a pixel-perfect overlay on the
official red pre-printed form.

Uses fpdf2 (same library as superbill_pdf.py).
"""

import base64
import io
import logging
from datetime import datetime

from fpdf import FPDF

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_date_mmddyyyy(val) -> str:
    """Format a date value as MM/DD/YYYY."""
    if not val:
        return ""
    if hasattr(val, "strftime"):
        return val.strftime("%m/%d/%Y")
    # Try parsing ISO string
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        return dt.strftime("%m/%d/%Y")
    except Exception:
        return str(val)


def _fmt_date_mmddyy(val) -> str:
    """Format a date value as MM DD YY (CMS-1500 service date format)."""
    if not val:
        return ""
    if hasattr(val, "strftime"):
        return val.strftime("%m %d %y")
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        return dt.strftime("%m %d %y")
    except Exception:
        return str(val)


def _safe(val, default: str = "") -> str:
    """Return str(val) if truthy, else default."""
    if val is None:
        return default
    s = str(val).strip()
    return s if s else default


def _split_name(full_name: str) -> tuple[str, str]:
    """Split 'First Last' into (last, first). Best effort."""
    parts = full_name.strip().split()
    if len(parts) == 0:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    return (parts[-1], " ".join(parts[:-1]))


def _format_address_line(data: dict, prefix: str = "") -> str:
    """Build a single address line from dict fields."""
    line1 = _safe(data.get(f"{prefix}address_line1"))
    city = _safe(data.get(f"{prefix}address_city") or data.get(f"{prefix}city"))
    state = _safe(data.get(f"{prefix}address_state") or data.get(f"{prefix}state"))
    zip_code = _safe(data.get(f"{prefix}address_zip") or data.get(f"{prefix}zip"))
    parts = []
    if line1:
        parts.append(line1)
    csz = []
    if city:
        csz.append(city)
    if state:
        csz.append(state)
    csz_str = ", ".join(csz)
    if zip_code:
        csz_str += f" {zip_code}"
    if csz_str.strip():
        parts.append(csz_str.strip())
    return ", ".join(parts)


# ---------------------------------------------------------------------------
# CMS-1500 field mapping
# ---------------------------------------------------------------------------

def build_cms1500_data(
    superbill: dict,
    client: dict,
    practice: dict,
    clinician: dict,
) -> dict:
    """Build a structured dict of all 33 CMS-1500 box values.

    Args:
        superbill: Superbill record dict.
        client: Client record dict.
        practice: Practice profile dict.
        clinician: Clinician record dict.

    Returns:
        Dict keyed by box number/label with string values.
    """
    client = client or {}
    practice = practice or {}
    clinician = clinician or {}
    superbill = superbill or {}

    full_name = _safe(client.get("full_name"), "Unknown")
    last, first = _split_name(full_name)
    patient_name = f"{last}, {first}" if first else last

    dob = client.get("date_of_birth")
    sex = _safe(client.get("sex"), "").upper()
    if sex not in ("M", "F"):
        sex = ""

    # Address
    client_addr_line1 = _safe(client.get("address_line1"))
    client_city = _safe(client.get("address_city"))
    client_state = _safe(client.get("address_state"))
    client_zip = _safe(client.get("address_zip"))
    client_phone = _safe(client.get("phone"))

    # Insurance
    payer_name = _safe(client.get("payer_name"))
    member_id = _safe(client.get("member_id"))
    group_number = _safe(client.get("group_number"))

    # Secondary insurance
    sec_payer = _safe(client.get("secondary_payer_name"))
    sec_member_id = _safe(client.get("secondary_member_id"))
    sec_group = _safe(client.get("secondary_group_number"))
    has_secondary = bool(sec_payer)

    # Diagnosis codes
    dx_codes_raw = superbill.get("diagnosis_codes") or []
    if isinstance(dx_codes_raw, str):
        import json
        try:
            dx_codes_raw = json.loads(dx_codes_raw)
        except Exception:
            dx_codes_raw = []
    # Up to 12 ICD-10 codes
    dx_codes = dx_codes_raw[:12]
    dx_list = []
    for i, dx in enumerate(dx_codes):
        code = dx.get("code", "") if isinstance(dx, dict) else str(dx)
        letter = chr(65 + i)  # A, B, C, ...
        dx_list.append({"pointer": letter, "code": code})

    # Service line
    dos = superbill.get("date_of_service")
    dos_formatted = _fmt_date_mmddyy(dos)
    cpt_code = _safe(superbill.get("cpt_code"))
    modifiers = superbill.get("modifiers") or []
    if isinstance(modifiers, str):
        import json
        try:
            modifiers = json.loads(modifiers)
        except Exception:
            modifiers = []
    modifier_str = ", ".join(str(m) for m in modifiers) if modifiers else ""
    pos = _safe(superbill.get("place_of_service"), "11")
    fee = superbill.get("fee")
    fee_val = float(fee) if fee is not None else 0.0
    amount_paid = float(superbill.get("amount_paid") or 0)
    balance = fee_val - amount_paid

    # Diagnosis pointers for service line (all diagnoses apply)
    dx_pointers = ",".join(d["pointer"] for d in dx_list) if dx_list else "A"

    # Practice / clinician
    practice_name = _safe(
        practice.get("practice_name") or practice.get("clinician_name"),
        "Practice",
    )
    practice_addr = _format_address_line(practice)
    practice_phone = _safe(practice.get("phone"))
    practice_npi = _safe(practice.get("npi"))
    practice_tax_id = _safe(practice.get("tax_id"))

    clinician_name = _safe(clinician.get("clinician_name"))
    clinician_npi = _safe(clinician.get("npi"))

    # Patient account number: first 8 chars of client UUID
    client_id = _safe(client.get("id") or client.get("firebase_uid"), "")
    patient_acct = client_id[:8].upper() if client_id else ""

    auth_number = _safe(superbill.get("auth_number"))

    return {
        "box_1": "Group Health Plan" if payer_name else "Other",
        "box_1a": member_id,
        "box_2": patient_name,
        "box_3_dob": _fmt_date_mmddyyyy(dob),
        "box_3_sex": sex,
        "box_4": patient_name,  # Insured name (Self)
        "box_5_street": client_addr_line1,
        "box_5_city": client_city,
        "box_5_state": client_state,
        "box_5_zip": client_zip,
        "box_5_phone": client_phone,
        "box_6": "Self",
        "box_7_street": client_addr_line1,  # Same as patient (Self)
        "box_7_city": client_city,
        "box_7_state": client_state,
        "box_7_zip": client_zip,
        "box_7_phone": client_phone,
        "box_9_name": sec_payer if has_secondary else "",
        "box_9a": sec_member_id if has_secondary else "",
        "box_9b": "",  # Other insured DOB — not tracked
        "box_9c": "",  # Employer — not tracked
        "box_9d": sec_group if has_secondary else "",
        "box_10a": "No",  # Employment related
        "box_10b": "No",  # Auto accident
        "box_10c": "No",  # Other accident
        "box_11": group_number,
        "box_11a_dob": _fmt_date_mmddyyyy(dob),
        "box_11a_sex": sex,
        "box_11c": payer_name,
        "box_11d": "Yes" if has_secondary else "No",
        "box_12": "SIGNATURE ON FILE",
        "box_13": "SIGNATURE ON FILE",
        # Boxes 14-20 blank for outpatient behavioral health
        "box_14": "",
        "box_15": "",
        "box_16": "",
        "box_17": "",
        "box_17a": "",
        "box_17b": "",
        "box_18": "",
        "box_19": "",
        "box_20": "No",
        "box_21": dx_list,
        "box_22": "",  # Resubmission code
        "box_23": auth_number,
        # Service line (Box 24)
        "box_24": [{
            "a_from": dos_formatted,
            "a_to": dos_formatted,
            "b_pos": pos,
            "c_emg": "",
            "d_cpt": cpt_code,
            "d_modifiers": modifier_str,
            "e_pointer": dx_pointers,
            "f_charges": f"{fee_val:.2f}",
            "g_units": "1",
            "h_epsdt": "",
            "i_qual": "",
            "j_npi": clinician_npi or practice_npi,
        }],
        "box_25_tax_id": practice_tax_id,
        "box_25_type": "EIN",
        "box_26": patient_acct,
        "box_27": "Yes",
        "box_28": f"{fee_val:.2f}",
        "box_29": f"{amount_paid:.2f}",
        "box_30": f"{balance:.2f}",
        "box_31_signature": "SIGNATURE ON FILE",
        "box_31_date": _fmt_date_mmddyyyy(dos or datetime.now()),
        "box_32_name": practice_name,
        "box_32_address": practice_addr,
        "box_32a": practice_npi,
        "box_32b": "",  # Other ID
        "box_33_name": practice_name,
        "box_33_address": practice_addr,
        "box_33_phone": practice_phone,
        "box_33a": practice_npi,
        "box_33b": "",  # Other ID
    }


# ---------------------------------------------------------------------------
# PDF Generation
# ---------------------------------------------------------------------------

class CMS1500PDF(FPDF):
    """Custom PDF for CMS-1500 claim form layout."""

    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="Letter")
        self.set_auto_page_break(auto=False)
        # Colors
        self._header_bg = (0, 51, 102)  # Dark navy for section headers
        self._box_border = (180, 180, 180)
        self._light_bg = (245, 245, 245)

    def _section_header(self, text: str):
        """Render a dark section header bar."""
        self.set_fill_color(*self._header_bg)
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 8)
        self.cell(0, 5, f"  {text}", new_x="LMARGIN", new_y="NEXT", fill=True)
        self.set_text_color(0, 0, 0)

    def _box_label(self, text: str, w: float, h: float = 3.5):
        """Render a small box-number label."""
        self.set_font("Helvetica", "", 5.5)
        self.set_text_color(100, 100, 100)
        self.cell(w, h, text, new_x="RIGHT")
        self.set_text_color(0, 0, 0)

    def _box_value(self, text: str, w: float, h: float = 5, bold: bool = False):
        """Render a box value."""
        self.set_font("Helvetica", "B" if bold else "", 8)
        self.cell(w, h, _safe(text), new_x="RIGHT")

    def _labeled_field(self, label: str, value: str, label_w: float = 30, value_w: float = 60, h: float = 5):
        """Render label + value inline."""
        self.set_font("Helvetica", "", 6)
        self.set_text_color(100, 100, 100)
        self.cell(label_w, h, label, new_x="RIGHT")
        self.set_text_color(0, 0, 0)
        self.set_font("Helvetica", "", 8)
        self.cell(value_w, h, _safe(value), new_x="RIGHT")

    def _draw_hline(self):
        self.set_draw_color(*self._box_border)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())

    def footer(self):
        self.set_y(-10)
        self.set_font("Helvetica", "I", 6)
        self.set_text_color(150, 150, 150)
        self.cell(0, 4, "CMS-1500 Claim Form  |  Generated by Trellis EHR", align="C")
        self.set_text_color(0, 0, 0)


def generate_cms1500_pdf(
    superbill_data: dict,
    client: dict,
    practice: dict,
    clinician: dict,
    signature_data: str | None = None,
) -> bytes:
    """Generate a CMS-1500 claim form PDF.

    Args:
        superbill_data: Superbill record dict (or already-mapped dict).
        client: Client record dict.
        practice: Practice profile dict.
        clinician: Clinician record dict.
        signature_data: Optional base64-encoded PNG signature.

    Returns:
        PDF file as bytes.
    """
    fields = build_cms1500_data(superbill_data, client, practice, clinician)

    pdf = CMS1500PDF()
    pdf.add_page()
    lm = pdf.l_margin  # 10
    pw = pdf.w - pdf.l_margin - pdf.r_margin  # printable width ~196

    # -----------------------------------------------------------------------
    # Title
    # -----------------------------------------------------------------------
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, "HEALTH INSURANCE CLAIM FORM", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 4, "CMS-1500 / APPROVED OMB-0938-1197 FORM 1500", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(2)

    # -----------------------------------------------------------------------
    # CARRIER / INSURANCE SECTION (Boxes 1-1a top)
    # -----------------------------------------------------------------------
    pdf._section_header("CARRIER INFORMATION")
    pdf.ln(1)

    half = pw / 2

    # Box 1: Insurance type + Box 1a: Insured ID
    y0 = pdf.get_y()
    pdf._labeled_field("1. INSURANCE TYPE:", fields["box_1"], 28, half - 28)
    pdf._labeled_field("1a. INSURED'S ID:", fields["box_1a"], 26, half - 28)
    pdf.ln(5)

    # -----------------------------------------------------------------------
    # PATIENT / INSURED SECTION (Boxes 2-11d)
    # -----------------------------------------------------------------------
    pdf._section_header("PATIENT AND INSURED INFORMATION")
    pdf.ln(1)

    # Row: Box 2, 3, 4
    pdf._labeled_field("2. PATIENT NAME:", fields["box_2"], 28, half - 28)
    dob_sex = f'{fields["box_3_dob"]}   {fields["box_3_sex"]}'
    pdf._labeled_field("3. DOB / SEX:", dob_sex, 22, half - 24)
    pdf.ln(5)

    pdf._labeled_field("4. INSURED'S NAME:", fields["box_4"], 28, half - 28)
    pdf._labeled_field("6. RELATIONSHIP:", fields["box_6"], 26, half - 28)
    pdf.ln(5)

    # Box 5: Patient address
    addr5 = fields["box_5_street"]
    csz5_parts = []
    if fields["box_5_city"]:
        csz5_parts.append(fields["box_5_city"])
    if fields["box_5_state"]:
        csz5_parts.append(fields["box_5_state"])
    csz5 = ", ".join(csz5_parts)
    if fields["box_5_zip"]:
        csz5 += f" {fields['box_5_zip']}"

    pdf._labeled_field("5. PATIENT ADDRESS:", addr5, 28, half - 28)
    pdf._labeled_field("PHONE:", fields["box_5_phone"], 12, half - 14)
    pdf.ln(5)
    pdf._labeled_field("", csz5, 28, half - 28)
    pdf.ln(5)

    # Box 9: Secondary insurance
    if fields["box_9_name"]:
        pdf._labeled_field("9. OTHER INSURED:", fields["box_9_name"], 28, half - 28)
        pdf._labeled_field("9a. POLICY/GROUP:", fields["box_9a"], 26, half - 28)
        pdf.ln(5)
        pdf._labeled_field("9d. INS. PLAN NAME:", fields["box_9d"], 28, half - 28)
        pdf.ln(5)

    # Box 10: Condition related to
    pdf._labeled_field("10a. EMPLOYMENT:", fields["box_10a"], 28, 18)
    pdf._labeled_field("10b. AUTO ACCIDENT:", fields["box_10b"], 30, 18)
    pdf._labeled_field("10c. OTHER:", fields["box_10c"], 18, 18)
    pdf.ln(5)

    # Box 11
    pdf._labeled_field("11. GROUP NUMBER:", fields["box_11"], 28, half - 28)
    pdf._labeled_field("11c. INS. PLAN:", fields["box_11c"], 22, half - 24)
    pdf.ln(5)

    dob_sex_11a = f'{fields["box_11a_dob"]}   {fields["box_11a_sex"]}'
    pdf._labeled_field("11a. INSURED DOB/SEX:", dob_sex_11a, 32, half - 32)
    pdf._labeled_field("11d. OTHER PLAN:", fields["box_11d"], 24, half - 26)
    pdf.ln(5)

    # Box 12, 13
    pdf._labeled_field("12. PATIENT SIGNATURE:", fields["box_12"], 34, half - 34)
    pdf._labeled_field("13. INSURED SIGNATURE:", fields["box_13"], 34, half - 36)
    pdf.ln(5)

    # -----------------------------------------------------------------------
    # Boxes 14-20 (mostly blank for behavioral health)
    # -----------------------------------------------------------------------
    if fields["box_23"]:
        pdf._labeled_field("23. PRIOR AUTH #:", fields["box_23"], 28, half - 28)
        pdf.ln(5)

    # -----------------------------------------------------------------------
    # DIAGNOSIS CODES (Box 21)
    # -----------------------------------------------------------------------
    pdf._section_header("DIAGNOSIS OR NATURE OF ILLNESS OR INJURY (Box 21)  —  ICD-10-CM")
    pdf.ln(1)

    dx_list = fields.get("box_21", [])
    if dx_list:
        # Render in rows of 4
        col_w = pw / 4
        for i in range(0, len(dx_list), 4):
            chunk = dx_list[i:i + 4]
            for dx in chunk:
                pdf.set_font("Helvetica", "B", 7)
                pdf.cell(6, 5, f"{dx['pointer']}.", new_x="RIGHT")
                pdf.set_font("Helvetica", "", 8)
                pdf.cell(col_w - 6, 5, dx["code"], new_x="RIGHT")
            pdf.ln(5)
    else:
        pdf.set_font("Helvetica", "I", 8)
        pdf.cell(0, 5, "  No diagnosis codes", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)

    # -----------------------------------------------------------------------
    # SERVICE LINE TABLE (Box 24)
    # -----------------------------------------------------------------------
    pdf._section_header("SERVICES / PROCEDURES (Box 24)")
    pdf.ln(1)

    # Column widths
    c_from = 22
    c_to = 22
    c_pos = 10
    c_cpt = 22
    c_mod = 16
    c_ptr = 14
    c_chg = 22
    c_units = 12
    c_npi = pw - c_from - c_to - c_pos - c_cpt - c_mod - c_ptr - c_chg - c_units

    # Header row
    pdf.set_font("Helvetica", "B", 6)
    pdf.set_fill_color(*pdf._light_bg)
    pdf.cell(c_from, 4, "24A. FROM", fill=True, new_x="RIGHT")
    pdf.cell(c_to, 4, "TO", fill=True, new_x="RIGHT")
    pdf.cell(c_pos, 4, "24B. POS", fill=True, new_x="RIGHT")
    pdf.cell(c_cpt, 4, "24D. CPT", fill=True, new_x="RIGHT")
    pdf.cell(c_mod, 4, "MOD", fill=True, new_x="RIGHT")
    pdf.cell(c_ptr, 4, "24E. PTR", fill=True, new_x="RIGHT")
    pdf.cell(c_chg, 4, "24F. $", fill=True, align="R", new_x="RIGHT")
    pdf.cell(c_units, 4, "24G. UNITS", fill=True, align="C", new_x="RIGHT")
    pdf.cell(c_npi, 4, "24J. NPI", fill=True, new_x="LMARGIN", new_y="NEXT")

    # Data rows
    pdf.set_font("Helvetica", "", 8)
    for line in fields.get("box_24", []):
        pdf.cell(c_from, 5, line["a_from"], new_x="RIGHT")
        pdf.cell(c_to, 5, line["a_to"], new_x="RIGHT")
        pdf.cell(c_pos, 5, line["b_pos"], new_x="RIGHT")
        pdf.set_font("Helvetica", "B", 8)
        pdf.cell(c_cpt, 5, line["d_cpt"], new_x="RIGHT")
        pdf.set_font("Helvetica", "", 7)
        pdf.cell(c_mod, 5, line["d_modifiers"], new_x="RIGHT")
        pdf.set_font("Helvetica", "", 8)
        pdf.cell(c_ptr, 5, line["e_pointer"], new_x="RIGHT")
        pdf.cell(c_chg, 5, line["f_charges"], align="R", new_x="RIGHT")
        pdf.cell(c_units, 5, line["g_units"], align="C", new_x="RIGHT")
        pdf.cell(c_npi, 5, line["j_npi"], new_x="LMARGIN", new_y="NEXT")

    pdf.ln(2)
    pdf._draw_hline()
    pdf.ln(2)

    # -----------------------------------------------------------------------
    # TOTALS (Boxes 25-30)
    # -----------------------------------------------------------------------
    pdf._section_header("BILLING SUMMARY (Boxes 25-30)")
    pdf.ln(1)

    third = pw / 3

    # Row 1
    tax_display = fields["box_25_tax_id"]
    if tax_display:
        tax_display += f"  ({fields['box_25_type']})"
    pdf._labeled_field("25. TAX ID:", tax_display, 18, third - 18)
    pdf._labeled_field("26. PATIENT ACCT:", fields["box_26"], 28, third - 28)
    pdf._labeled_field("27. ACCEPT ASSIGN:", fields["box_27"], 28, third - 30)
    pdf.ln(5)

    # Row 2: Charges
    pdf._labeled_field("28. TOTAL CHARGE:", f"$ {fields['box_28']}", 28, third - 28)
    pdf._labeled_field("29. AMOUNT PAID:", f"$ {fields['box_29']}", 26, third - 26)
    pdf.set_font("Helvetica", "B", 9)
    bal_label_w = 26
    pdf.set_font("Helvetica", "", 6)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(bal_label_w, 5, "30. BALANCE DUE:", new_x="RIGHT")
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(third - bal_label_w - 2, 5, f"$ {fields['box_30']}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # -----------------------------------------------------------------------
    # PROVIDER SIGNATURE (Box 31)
    # -----------------------------------------------------------------------
    pdf._section_header("PROVIDER SIGNATURE (Box 31)")
    pdf.ln(2)

    if signature_data:
        try:
            if "," in signature_data:
                b64 = signature_data.split(",", 1)[1]
            else:
                b64 = signature_data
            img_bytes = base64.b64decode(b64)
            img_stream = io.BytesIO(img_bytes)
            img_stream.name = "signature.png"
            pdf.image(img_stream, x=lm + 2, w=50, h=18)
            pdf.ln(2)
        except Exception as e:
            logger.warning("Failed to embed signature in CMS-1500 PDF: %s", e)
            pdf.set_font("Helvetica", "", 8)
            pdf.cell(0, 5, fields["box_31_signature"], new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.set_font("Helvetica", "", 8)
        pdf.cell(0, 5, fields["box_31_signature"], new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "", 7)
    pdf.cell(0, 4, f"Date: {fields['box_31_date']}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # -----------------------------------------------------------------------
    # SERVICE FACILITY & BILLING PROVIDER (Boxes 32-33)
    # -----------------------------------------------------------------------
    pdf._section_header("SERVICE FACILITY (Box 32) / BILLING PROVIDER (Box 33)")
    pdf.ln(1)

    # Two columns
    col = pw / 2

    y_start = pdf.get_y()

    # Box 32: Service Facility (left)
    pdf.set_font("Helvetica", "B", 7)
    pdf.cell(col, 4, "32. SERVICE FACILITY", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(col, 4, fields["box_32_name"], new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 7)
    pdf.cell(col, 3.5, fields["box_32_address"], new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 7)
    pdf.cell(col, 4, f"NPI: {fields['box_32a']}", new_x="LMARGIN", new_y="NEXT")

    y_after_left = pdf.get_y()

    # Box 33: Billing Provider (right)
    pdf.set_y(y_start)
    x_right = lm + col + 4
    pdf.set_x(x_right)
    pdf.set_font("Helvetica", "B", 7)
    pdf.cell(col - 4, 4, "33. BILLING PROVIDER", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(x_right)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(col - 4, 4, fields["box_33_name"], new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(x_right)
    pdf.set_font("Helvetica", "", 7)
    pdf.cell(col - 4, 3.5, fields["box_33_address"], new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(x_right)
    pdf.set_font("Helvetica", "", 7)
    pdf.cell(col - 4, 3.5, f"Phone: {fields['box_33_phone']}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(x_right)
    pdf.set_font("Helvetica", "B", 7)
    pdf.cell(col - 4, 4, f"NPI: {fields['box_33a']}", new_x="LMARGIN", new_y="NEXT")

    y_after_right = pdf.get_y()
    pdf.set_y(max(y_after_left, y_after_right) + 3)

    # -----------------------------------------------------------------------
    # Generation timestamp
    # -----------------------------------------------------------------------
    pdf.set_font("Helvetica", "I", 6)
    pdf.set_text_color(160, 160, 160)
    generated_at = datetime.now().strftime("%B %d, %Y at %I:%M %p")
    pdf.cell(0, 4, f"Generated: {generated_at}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)

    return pdf.output()
