"""PDF generation for superbills (billing documents).

Generates a professional superbill PDF with:
  - Practice header (name, address, NPI, credentials, tax ID)
  - Provider information block
  - Client/patient information (name, DOB, address, insurance)
  - Date of service
  - CPT code with description
  - ICD-10 diagnosis codes with descriptions
  - Fee schedule and totals
  - Billing status
"""
import logging
from datetime import datetime

from fpdf import FPDF

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CPT code descriptions
# ---------------------------------------------------------------------------

CPT_DESCRIPTIONS: dict[str, str] = {
    "90791": "Psychiatric Diagnostic Evaluation",
    "90834": "Psychotherapy, 45 minutes",
    "90837": "Psychotherapy, 60 minutes",
    "90832": "Psychotherapy, 30 minutes",
    "90847": "Family Psychotherapy with patient present",
    "90846": "Family Psychotherapy without patient present",
}


class SuperbillPDF(FPDF):
    """Custom PDF class for superbills."""

    def __init__(self, practice: dict | None = None):
        super().__init__()
        self.practice = practice or {}
        self.set_auto_page_break(auto=True, margin=25)

    def header(self):
        """Practice header on every page."""
        practice = self.practice
        practice_name = (
            practice.get("practice_name")
            or practice.get("clinician_name")
            or "Practice"
        )
        clinician_name = practice.get("clinician_name") or ""
        credentials = practice.get("credentials") or ""

        # Practice name
        self.set_font("Helvetica", "B", 14)
        self.cell(0, 7, practice_name, new_x="LMARGIN", new_y="NEXT", align="C")

        # Clinician credentials
        if clinician_name:
            cred_line = clinician_name
            if credentials:
                cred_line += f", {credentials}"
            self.set_font("Helvetica", "", 10)
            self.cell(0, 5, cred_line, new_x="LMARGIN", new_y="NEXT", align="C")

        # Address line
        parts = []
        if practice.get("address_line1"):
            addr = practice["address_line1"]
            if practice.get("address_city"):
                addr += f", {practice['address_city']}"
            if practice.get("address_state"):
                addr += f", {practice['address_state']}"
            if practice.get("address_zip"):
                addr += f" {practice['address_zip']}"
            parts.append(addr)
        if practice.get("phone"):
            parts.append(f"Phone: {practice['phone']}")
        if parts:
            self.set_font("Helvetica", "", 8)
            self.cell(
                0, 4, " | ".join(parts), new_x="LMARGIN", new_y="NEXT", align="C"
            )

        # NPI / Tax ID / License
        id_parts = []
        if practice.get("npi"):
            id_parts.append(f"NPI: {practice['npi']}")
        if practice.get("tax_id"):
            id_parts.append(f"Tax ID: {practice['tax_id']}")
        if practice.get("license_number") and practice.get("license_state"):
            id_parts.append(
                f"License: {practice['license_number']} ({practice['license_state']})"
            )
        if id_parts:
            self.set_font("Helvetica", "", 8)
            self.cell(
                0, 4, " | ".join(id_parts), new_x="LMARGIN", new_y="NEXT", align="C"
            )

        # Horizontal rule
        self.ln(3)
        self.set_draw_color(180, 180, 180)
        self.line(10, self.get_y(), self.w - 10, self.get_y())
        self.ln(5)

    def footer(self):
        """Page number footer."""
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")


def generate_superbill_pdf(
    client_name: str,
    client_dob: str | None,
    client_address: str | None,
    client_phone: str | None,
    client_email: str | None,
    insurance_payer: str | None,
    insurance_member_id: str | None,
    insurance_group: str | None,
    date_of_service: str,
    cpt_code: str,
    cpt_description: str | None,
    diagnosis_codes: list[dict],
    fee: float | None,
    amount_paid: float | None,
    status: str,
    practice: dict | None = None,
    rendering_clinician: dict | None = None,
) -> bytes:
    """Generate a professional superbill PDF.

    Args:
        client_name: Client's full name.
        client_dob: Date of birth string.
        client_address: Formatted address.
        client_phone: Phone number.
        client_email: Email address.
        insurance_payer: Insurance company name (or None for self-pay).
        insurance_member_id: Insurance member ID.
        insurance_group: Insurance group number.
        date_of_service: Formatted date of service.
        cpt_code: CPT procedure code (e.g., '90834').
        cpt_description: CPT code description.
        diagnosis_codes: List of {code, description, rank} dicts.
        fee: Session fee amount.
        amount_paid: Amount paid.
        status: Billing status.
        practice: Practice profile dict (used as billing provider in group mode).
        rendering_clinician: Optional clinician dict for group practices (Box 24J).
            When provided, the PDF shows separate Billing and Rendering Provider sections.
            When None, a single Provider section is shown (solo mode).

    Returns:
        PDF file as bytes.
    """
    pdf = SuperbillPDF(practice=practice)
    pdf.alias_nb_pages()
    pdf.add_page()

    # --- Document title ---
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, "SUPERBILL / ENCOUNTER FORM", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(3)

    # --- Two-column layout: Provider Info / Patient Info ---
    y_start = pdf.get_y()
    col_width = (pdf.w - 20) / 2  # 10mm margin each side

    practice = practice or {}
    is_group = rendering_clinician is not None

    if is_group:
        # ---- BILLING PROVIDER (Box 33 — left column) ----
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_fill_color(240, 240, 240)
        pdf.cell(col_width, 6, "  BILLING PROVIDER (Box 33)", new_x="LMARGIN", new_y="NEXT", fill=True)
        pdf.ln(2)

        _provider_field(pdf, "Practice:", practice.get("practice_name") or practice.get("clinician_name") or "-")
        _provider_field(pdf, "Group NPI:", practice.get("npi") or "-")
        _provider_field(pdf, "Tax ID:", practice.get("tax_id") or "-")

        _render_address(pdf, practice, col_width)

        if practice.get("phone"):
            _provider_field(pdf, "Phone:", practice["phone"])

        pdf.ln(3)

        # ---- RENDERING PROVIDER (Box 24J — still left column) ----
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_fill_color(240, 240, 240)
        pdf.cell(col_width, 6, "  RENDERING PROVIDER (Box 24J)", new_x="LMARGIN", new_y="NEXT", fill=True)
        pdf.ln(2)

        _provider_field(pdf, "Provider:", rendering_clinician.get("clinician_name") or "-")
        if rendering_clinician.get("credentials"):
            _provider_field(pdf, "Credentials:", rendering_clinician["credentials"])
        _provider_field(pdf, "Individual NPI:", rendering_clinician.get("npi") or "-")
        if rendering_clinician.get("license_number"):
            license_str = rendering_clinician["license_number"]
            if rendering_clinician.get("license_state"):
                license_str += f" ({rendering_clinician['license_state']})"
            _provider_field(pdf, "License:", license_str)
    else:
        # ---- PROVIDER INFORMATION (solo mode — left column) ----
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_fill_color(240, 240, 240)
        pdf.cell(col_width, 6, "  PROVIDER INFORMATION", new_x="LMARGIN", new_y="NEXT", fill=True)
        pdf.ln(2)

        _provider_field(pdf, "Provider:", practice.get("clinician_name") or "-")
        if practice.get("credentials"):
            _provider_field(pdf, "Credentials:", practice["credentials"])
        _provider_field(pdf, "NPI:", practice.get("npi") or "-")
        _provider_field(pdf, "Tax ID:", practice.get("tax_id") or "-")
        if practice.get("license_number"):
            license_str = practice["license_number"]
            if practice.get("license_state"):
                license_str += f" ({practice['license_state']})"
            _provider_field(pdf, "License:", license_str)

        _render_address(pdf, practice, col_width)

        if practice.get("phone"):
            _provider_field(pdf, "Phone:", practice["phone"])

    y_after_provider = pdf.get_y()

    # ---- PATIENT INFORMATION (right column) ----
    pdf.set_y(y_start)
    pdf.set_x(10 + col_width + 5)

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(240, 240, 240)
    # Use a cell starting at the right column
    x_right = 10 + col_width + 5
    pdf.set_x(x_right)
    pdf.cell(col_width - 5, 6, "  PATIENT INFORMATION", new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.ln(2)

    _patient_field(pdf, "Patient:", client_name, x_right, col_width - 5)
    _patient_field(pdf, "DOB:", client_dob or "-", x_right, col_width - 5)
    if client_address:
        _patient_field(pdf, "Address:", client_address, x_right, col_width - 5)
    if client_phone:
        _patient_field(pdf, "Phone:", client_phone, x_right, col_width - 5)
    if client_email:
        _patient_field(pdf, "Email:", client_email, x_right, col_width - 5)

    # Insurance info
    pdf.ln(2)
    pdf.set_x(x_right)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(col_width - 5, 5, "  Insurance:", new_x="LMARGIN", new_y="NEXT")

    if insurance_payer:
        _patient_field(pdf, "Payer:", insurance_payer, x_right, col_width - 5)
        if insurance_member_id:
            _patient_field(pdf, "Member ID:", insurance_member_id, x_right, col_width - 5)
        if insurance_group:
            _patient_field(pdf, "Group #:", insurance_group, x_right, col_width - 5)
    else:
        pdf.set_x(x_right)
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(col_width - 5, 5, "  Self-pay / Out-of-network", new_x="LMARGIN", new_y="NEXT")

    y_after_patient = pdf.get_y()

    # Move past both columns
    pdf.set_y(max(y_after_provider, y_after_patient) + 5)

    # --- Separator ---
    pdf.set_draw_color(180, 180, 180)
    pdf.line(10, pdf.get_y(), pdf.w - 10, pdf.get_y())
    pdf.ln(5)

    # --- SERVICE DETAILS ---
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(0, 6, "  SERVICE DETAILS", new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(35, 5, "Date of Service:", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, date_of_service, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(3)

    # CPT Code Table Header
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(230, 230, 230)
    pdf.cell(25, 6, " CPT Code", fill=True, new_x="RIGHT")
    pdf.cell(95, 6, " Description", fill=True, new_x="RIGHT")
    pdf.cell(35, 6, " Fee", fill=True, align="R", new_x="LMARGIN", new_y="NEXT")

    # CPT Code Row
    desc = cpt_description or CPT_DESCRIPTIONS.get(cpt_code, "Psychotherapy")
    fee_str = f"${fee:,.2f}" if fee is not None else "-"

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(25, 6, f" {cpt_code}", new_x="RIGHT")
    pdf.cell(95, 6, f" {desc}", new_x="RIGHT")
    pdf.cell(35, 6, f" {fee_str}", align="R", new_x="LMARGIN", new_y="NEXT")

    # Totals
    pdf.ln(2)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(120, pdf.get_y(), pdf.w - 10, pdf.get_y())
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(120, 5, "", new_x="RIGHT")
    pdf.cell(25, 5, "Total Charges:", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(10, 5, fee_str, align="R", new_x="LMARGIN", new_y="NEXT")

    amount_paid_val = amount_paid or 0
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(120, 5, "", new_x="RIGHT")
    pdf.cell(25, 5, "Amount Paid:", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(10, 5, f"${amount_paid_val:,.2f}", align="R", new_x="LMARGIN", new_y="NEXT")

    balance = (fee or 0) - amount_paid_val
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(120, 5, "", new_x="RIGHT")
    pdf.cell(25, 5, "Balance Due:", new_x="RIGHT")
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(10, 5, f"${balance:,.2f}", align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(5)

    # --- DIAGNOSIS CODES ---
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(0, 6, "  DIAGNOSIS CODES (ICD-10)", new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.ln(3)

    if diagnosis_codes:
        # Header row
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(230, 230, 230)
        pdf.cell(10, 6, " #", fill=True, new_x="RIGHT")
        pdf.cell(25, 6, " Code", fill=True, new_x="RIGHT")
        pdf.cell(0, 6, " Description", fill=True, new_x="LMARGIN", new_y="NEXT")

        for dx in diagnosis_codes:
            code = dx.get("code", "")
            desc = dx.get("description", "")
            rank = dx.get("rank", "")
            pdf.set_font("Helvetica", "", 9)
            pdf.cell(10, 5, f" {rank}", new_x="RIGHT")
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(25, 5, f" {code}", new_x="RIGHT")
            pdf.set_font("Helvetica", "", 9)
            pdf.cell(0, 5, f" {desc}", new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(0, 5, "  No diagnosis codes available.", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(5)

    # --- STATUS ---
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(30, 5, "Billing Status:", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    status_display = status.replace("_", " ").title()
    pdf.cell(0, 5, status_display, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(5)

    # --- PROVIDER SIGNATURE LINE ---
    pdf.set_draw_color(180, 180, 180)
    pdf.line(10, pdf.get_y(), pdf.w - 10, pdf.get_y())
    pdf.ln(8)

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, "Provider Signature: ____________________________    Date: ____________________", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(8)

    # --- Footer note ---
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(128, 128, 128)
    pdf.multi_cell(
        0, 4,
        "This superbill is provided for insurance reimbursement purposes. "
        "Please submit to your insurance carrier for out-of-network reimbursement "
        "or retain for your records.",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.set_text_color(0, 0, 0)

    # --- Generation timestamp ---
    pdf.ln(3)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(160, 160, 160)
    generated_at = datetime.now().strftime("%B %d, %Y at %I:%M %p")
    pdf.cell(0, 4, f"Generated: {generated_at}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)

    return pdf.output()


def _provider_field(pdf: FPDF, label: str, value: str):
    """Render a label: value pair in the provider column."""
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(30, 5, f"  {label}", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    col_width = (pdf.w - 20) / 2
    pdf.cell(col_width - 30, 5, value, new_x="LMARGIN", new_y="NEXT")


def _patient_field(pdf: FPDF, label: str, value: str, x_right: float, width: float):
    """Render a label: value pair in the patient column."""
    pdf.set_x(x_right)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(30, 5, f"  {label}", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(width - 30, 5, value, new_x="LMARGIN", new_y="NEXT")


def _render_address(pdf: FPDF, data: dict, col_width: float):
    """Render address fields from a practice or clinician dict."""
    addr_parts = []
    if data.get("address_line1"):
        addr_parts.append(data["address_line1"])
    city_state = []
    if data.get("address_city"):
        city_state.append(data["address_city"])
    if data.get("address_state"):
        city_state.append(data["address_state"])
    if city_state:
        cs = ", ".join(city_state)
        if data.get("address_zip"):
            cs += f" {data['address_zip']}"
        addr_parts.append(cs)
    if addr_parts:
        _provider_field(pdf, "Address:", addr_parts[0])
        for extra in addr_parts[1:]:
            pdf.set_font("Helvetica", "", 9)
            pdf.cell(30, 5, "", new_x="RIGHT")
            pdf.cell(col_width - 30, 5, extra, new_x="LMARGIN", new_y="NEXT")
