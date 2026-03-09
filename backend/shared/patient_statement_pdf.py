"""PDF generation for patient statements (client-facing billing documents).

Generates a professional patient statement with:
  - Practice header (name, address, phone, email)
  - Statement date and period
  - Client info (name, address, account number)
  - Services table (date, description, charges, payments, balance per line)
  - Summary totals with prominent Balance Due
  - Payment instructions
  - Practice contact footer
"""
import logging
from datetime import date, datetime

from fpdf import FPDF

from superbill_pdf import CPT_DESCRIPTIONS

logger = logging.getLogger(__name__)


class StatementPDF(FPDF):
    """Custom PDF class for patient statements."""

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
        if practice.get("email"):
            parts.append(f"Email: {practice['email']}")
        if parts:
            self.set_font("Helvetica", "", 8)
            self.cell(
                0, 4, " | ".join(parts), new_x="LMARGIN", new_y="NEXT", align="C"
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


def generate_patient_statement(
    client: dict,
    superbills: list[dict],
    practice: dict | None = None,
    clinician: dict | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    payment_instructions: str | None = None,
) -> bytes:
    """Generate a professional patient statement PDF.

    Args:
        client: Client record dict (full_name, address fields, firebase_uid/id).
        superbills: List of superbill dicts (date_of_service, cpt_code,
            cpt_description, fee, amount_paid, status).
        practice: Practice profile dict for header/contact info.
        clinician: Clinician profile dict (optional, used if practice is sparse).
        from_date: Start of statement period (None = all time).
        to_date: End of statement period (None = today).
        payment_instructions: Custom payment text (has sensible default).

    Returns:
        PDF file as bytes.
    """
    practice = practice or {}
    to_date = to_date or date.today()

    if payment_instructions is None:
        payment_instructions = (
            "Please remit payment within 30 days. "
            "Contact our office with questions."
        )

    pdf = StatementPDF(practice=practice)
    pdf.alias_nb_pages()
    pdf.add_page()

    # --- Document title ---
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, "PATIENT STATEMENT", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(3)

    # --- Two-column: Statement info (left) / Client info (right) ---
    y_start = pdf.get_y()
    col_width = (pdf.w - 20) / 2  # 10mm margin each side

    # Left column: Statement details
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(
        col_width, 6, "  STATEMENT DETAILS",
        new_x="LMARGIN", new_y="NEXT", fill=True,
    )
    pdf.ln(2)

    statement_date = datetime.now().strftime("%B %d, %Y")
    _field(pdf, "Statement Date:", statement_date, col_width)

    if from_date:
        period_from = from_date.strftime("%B %d, %Y")
    else:
        period_from = "All prior services"
    period_to = to_date.strftime("%B %d, %Y")
    _field(pdf, "Period:", f"{period_from} - {period_to}", col_width)

    # Account number: first 8 chars of client UUID
    client_id = str(client.get("id") or client.get("firebase_uid") or "")
    account_number = client_id[:8].upper() if client_id else "-"
    _field(pdf, "Account #:", account_number, col_width)

    y_after_left = pdf.get_y()

    # Right column: Client info
    pdf.set_y(y_start)
    x_right = 10 + col_width + 5

    pdf.set_x(x_right)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(
        col_width - 5, 6, "  BILL TO",
        new_x="LMARGIN", new_y="NEXT", fill=True,
    )
    pdf.ln(2)

    client_name = client.get("full_name") or "Client"
    _right_field(pdf, "Name:", client_name, x_right, col_width - 5)

    address = _format_address(client)
    if address:
        _right_field(pdf, "Address:", address, x_right, col_width - 5)

    if client.get("phone"):
        _right_field(pdf, "Phone:", client["phone"], x_right, col_width - 5)
    if client.get("email"):
        _right_field(pdf, "Email:", client["email"], x_right, col_width - 5)

    y_after_right = pdf.get_y()

    # Move past both columns
    pdf.set_y(max(y_after_left, y_after_right) + 5)

    # --- Separator ---
    pdf.set_draw_color(180, 180, 180)
    pdf.line(10, pdf.get_y(), pdf.w - 10, pdf.get_y())
    pdf.ln(5)

    # --- SERVICES TABLE ---
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(0, 6, "  SERVICES", new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.ln(3)

    # Column widths: Date(30) | Description(70) | Charges(30) | Payments(30) | Balance(30)
    w_date = 30
    w_desc = 70
    w_charges = 30
    w_payments = 30
    w_balance = 30

    # Table header
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(230, 230, 230)
    pdf.cell(w_date, 6, " Date", fill=True, new_x="RIGHT")
    pdf.cell(w_desc, 6, " Description", fill=True, new_x="RIGHT")
    pdf.cell(w_charges, 6, " Charges", fill=True, align="R", new_x="RIGHT")
    pdf.cell(w_payments, 6, " Payments", fill=True, align="R", new_x="RIGHT")
    pdf.cell(w_balance, 6, " Balance", fill=True, align="R", new_x="LMARGIN", new_y="NEXT")

    # Table rows
    total_charges = 0.0
    total_payments = 0.0

    # Sort superbills by date_of_service
    sorted_bills = sorted(
        superbills,
        key=lambda s: s.get("date_of_service") or "",
    )

    pdf.set_font("Helvetica", "", 8)
    for i, sb in enumerate(sorted_bills):
        # Alternate row shading
        if i % 2 == 1:
            pdf.set_fill_color(248, 248, 248)
            fill = True
        else:
            fill = False

        dos = sb.get("date_of_service")
        if hasattr(dos, "strftime"):
            dos_str = dos.strftime("%m/%d/%Y")
        elif dos:
            dos_str = str(dos)
        else:
            dos_str = "-"

        cpt = sb.get("cpt_code", "")
        desc = sb.get("cpt_description") or CPT_DESCRIPTIONS.get(cpt, "Psychotherapy")
        description = f"{desc} ({cpt})" if cpt else desc

        fee = float(sb.get("fee") or 0)
        paid = float(sb.get("amount_paid") or 0)
        line_balance = fee - paid

        total_charges += fee
        total_payments += paid

        pdf.cell(w_date, 5, f" {dos_str}", fill=fill, new_x="RIGHT")
        pdf.cell(w_desc, 5, f" {description}", fill=fill, new_x="RIGHT")
        pdf.cell(w_charges, 5, f"${fee:,.2f} ", fill=fill, align="R", new_x="RIGHT")
        pdf.cell(w_payments, 5, f"${paid:,.2f} ", fill=fill, align="R", new_x="RIGHT")
        pdf.cell(w_balance, 5, f"${line_balance:,.2f} ", fill=fill, align="R", new_x="LMARGIN", new_y="NEXT")

    if not sorted_bills:
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(0, 6, "  No services found for this period.", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(3)

    # --- SUMMARY ---
    pdf.set_draw_color(200, 200, 200)
    summary_x = pdf.w - 10 - w_charges - w_payments - w_balance
    pdf.line(summary_x, pdf.get_y(), pdf.w - 10, pdf.get_y())
    pdf.ln(3)

    total_balance = total_charges - total_payments

    # Total Charges
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(summary_x - 10, 5, "", new_x="RIGHT")
    pdf.cell(w_charges + w_payments, 5, "Total Charges:", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(w_balance, 5, f"${total_charges:,.2f}", align="R", new_x="LMARGIN", new_y="NEXT")

    # Total Payments
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(summary_x - 10, 5, "", new_x="RIGHT")
    pdf.cell(w_charges + w_payments, 5, "Total Payments:", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(w_balance, 5, f"${total_payments:,.2f}", align="R", new_x="LMARGIN", new_y="NEXT")

    # Balance Due (bold, prominent)
    pdf.ln(1)
    pdf.set_draw_color(100, 100, 100)
    pdf.line(summary_x + w_charges + w_payments, pdf.get_y(), pdf.w - 10, pdf.get_y())
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(summary_x - 10, 6, "", new_x="RIGHT")
    pdf.cell(w_charges + w_payments, 6, "BALANCE DUE:", new_x="RIGHT")
    pdf.cell(w_balance, 6, f"${total_balance:,.2f}", align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(8)

    # --- PAYMENT INSTRUCTIONS ---
    pdf.set_draw_color(180, 180, 180)
    pdf.line(10, pdf.get_y(), pdf.w - 10, pdf.get_y())
    pdf.ln(5)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "Payment Instructions", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font("Helvetica", "", 9)
    pdf.multi_cell(0, 4, payment_instructions, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(5)

    # --- Practice contact footer ---
    practice_name = (
        practice.get("practice_name")
        or practice.get("clinician_name")
        or "Practice"
    )
    contact_parts = []
    if practice.get("phone"):
        contact_parts.append(f"Phone: {practice['phone']}")
    if practice.get("email"):
        contact_parts.append(f"Email: {practice['email']}")

    if contact_parts:
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(
            0, 4,
            f"{practice_name} | {' | '.join(contact_parts)}",
            new_x="LMARGIN", new_y="NEXT", align="C",
        )
        pdf.set_text_color(0, 0, 0)

    pdf.ln(3)

    # --- Footer note ---
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(128, 128, 128)
    pdf.multi_cell(
        0, 4,
        "This statement is for your records. If you have insurance, "
        "please submit superbills to your carrier for reimbursement. "
        "Contact our office if you have any questions about this statement.",
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


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _field(pdf: FPDF, label: str, value: str, col_width: float):
    """Render a label: value pair in the left column."""
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(35, 5, f"  {label}", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(col_width - 35, 5, value, new_x="LMARGIN", new_y="NEXT")


def _right_field(
    pdf: FPDF, label: str, value: str, x_right: float, width: float,
):
    """Render a label: value pair in the right column."""
    pdf.set_x(x_right)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(25, 5, f"  {label}", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(width - 25, 5, value, new_x="LMARGIN", new_y="NEXT")


def _format_address(client: dict) -> str | None:
    """Build a one-line address from client fields."""
    parts = []
    if client.get("address_line1"):
        parts.append(client["address_line1"])
    city_state = []
    if client.get("address_city"):
        city_state.append(client["address_city"])
    if client.get("address_state"):
        city_state.append(client["address_state"])
    if city_state:
        cs = ", ".join(city_state)
        if client.get("address_zip"):
            cs += f" {client['address_zip']}"
        parts.append(cs)
    return ", ".join(parts) if parts else None
