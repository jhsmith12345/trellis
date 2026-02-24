"""PDF generation for signed clinical notes.

Generates a professional clinical PDF with:
  - Practice header (name, address, NPI, credentials)
  - Client information
  - Note content with section headers
  - Signature block with rendered signature image
  - Content hash for verification
"""
import base64
import io
import logging
import re
import textwrap
from datetime import datetime

from fpdf import FPDF

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Section labels for each note format
# ---------------------------------------------------------------------------

FORMAT_SECTIONS: dict[str, list[dict[str, str]]] = {
    "SOAP": [
        {"key": "subjective", "label": "Subjective"},
        {"key": "objective", "label": "Objective"},
        {"key": "assessment", "label": "Assessment"},
        {"key": "plan", "label": "Plan"},
    ],
    "DAP": [
        {"key": "data", "label": "Data"},
        {"key": "assessment", "label": "Assessment"},
        {"key": "plan", "label": "Plan"},
    ],
    "narrative": [
        {"key": "identifying_information", "label": "Identifying Information"},
        {"key": "presenting_problem", "label": "Presenting Problem"},
        {"key": "history_of_present_illness", "label": "History of Present Illness"},
        {"key": "psychiatric_history", "label": "Psychiatric History"},
        {"key": "substance_use_history", "label": "Substance Use History"},
        {"key": "medical_history", "label": "Medical History"},
        {"key": "family_history", "label": "Family History"},
        {"key": "social_developmental_history", "label": "Social & Developmental History"},
        {"key": "mental_status_examination", "label": "Mental Status Examination"},
        {"key": "diagnostic_impressions", "label": "Diagnostic Impressions"},
        {"key": "risk_assessment", "label": "Risk Assessment"},
        {"key": "treatment_recommendations", "label": "Treatment Recommendations"},
        {"key": "clinical_summary", "label": "Clinical Summary"},
    ],
}

FORMAT_TITLES: dict[str, str] = {
    "SOAP": "SOAP Progress Note",
    "DAP": "DAP Progress Note",
    "narrative": "Biopsychosocial Assessment",
}


def _strip_html(text: str) -> str:
    """Remove HTML tags for plain-text PDF rendering."""
    if not text:
        return ""
    # Replace <br> and block-level tags with newlines
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?(p|div|h[1-6]|li|ul|ol|blockquote)[^>]*>", "\n", text, flags=re.IGNORECASE)
    # Bullet points: convert <li> content
    text = re.sub(r"<li[^>]*>", "  - ", text, flags=re.IGNORECASE)
    # Strip remaining tags
    text = re.sub(r"<[^>]+>", "", text)
    # Decode common entities
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&nbsp;", " ").replace("&middot;", "-")
    # Collapse excessive newlines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


class NotePDF(FPDF):
    """Custom PDF class for clinical notes."""

    def __init__(self, practice: dict | None = None):
        super().__init__()
        self.practice = practice or {}
        self.set_auto_page_break(auto=True, margin=25)

    def header(self):
        """Practice header on every page."""
        practice = self.practice
        practice_name = practice.get("practice_name") or practice.get("clinician_name") or "Practice"
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
            self.cell(0, 4, " | ".join(parts), new_x="LMARGIN", new_y="NEXT", align="C")

        # NPI / License
        id_parts = []
        if practice.get("npi"):
            id_parts.append(f"NPI: {practice['npi']}")
        if practice.get("license_number") and practice.get("license_state"):
            id_parts.append(f"License: {practice['license_number']} ({practice['license_state']})")
        if id_parts:
            self.set_font("Helvetica", "", 8)
            self.cell(0, 4, " | ".join(id_parts), new_x="LMARGIN", new_y="NEXT", align="C")

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


def generate_note_pdf(
    note_format: str,
    content: dict,
    client_name: str,
    client_dob: str | None,
    session_date: str,
    signed_by: str,
    signed_at: str,
    content_hash: str,
    signature_data: str | None = None,
    practice: dict | None = None,
) -> bytes:
    """Generate a PDF for a signed clinical note.

    Args:
        note_format: 'SOAP', 'DAP', or 'narrative'
        content: dict of section_key -> HTML or plain text content
        client_name: display name for the client
        client_dob: date of birth string (optional)
        session_date: formatted date of the session
        signed_by: clinician name/email
        signed_at: ISO datetime string of signing
        content_hash: SHA-256 content hash
        signature_data: base64 PNG data URL of signature (optional)
        practice: practice profile dict (optional)

    Returns:
        PDF file as bytes.
    """
    pdf = NotePDF(practice=practice)
    pdf.alias_nb_pages()
    pdf.add_page()

    # --- Document title ---
    title = FORMAT_TITLES.get(note_format, note_format)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(3)

    # --- Client info block ---
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(35, 6, "Client:", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, client_name, new_x="LMARGIN", new_y="NEXT")

    if client_dob:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(35, 6, "Date of Birth:", new_x="RIGHT")
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, client_dob, new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(35, 6, "Session Date:", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, session_date, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)

    # --- Sections ---
    sections = FORMAT_SECTIONS.get(note_format, [])
    if not sections:
        # Fallback: render all content keys
        sections = [{"key": k, "label": k.replace("_", " ").title()} for k in content.keys()]

    for section in sections:
        key = section["key"]
        label = section["label"]
        raw_text = content.get(key, "")
        text = _strip_html(raw_text)

        if not text:
            continue

        # Section header
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_fill_color(240, 240, 240)
        pdf.cell(0, 7, f"  {label}", new_x="LMARGIN", new_y="NEXT", fill=True)
        pdf.ln(2)

        # Section content
        pdf.set_font("Helvetica", "", 10)
        # Use multi_cell for text wrapping
        for paragraph in text.split("\n"):
            stripped = paragraph.strip()
            if stripped:
                pdf.multi_cell(0, 5, stripped, new_x="LMARGIN", new_y="NEXT")
            else:
                pdf.ln(3)
        pdf.ln(4)

    # --- Signature block ---
    pdf.ln(5)
    pdf.set_draw_color(180, 180, 180)
    pdf.line(10, pdf.get_y(), pdf.w - 10, pdf.get_y())
    pdf.ln(5)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Clinician Signature", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # Render signature image if available
    if signature_data:
        try:
            # Strip data URL prefix if present
            if "," in signature_data:
                b64 = signature_data.split(",", 1)[1]
            else:
                b64 = signature_data
            img_bytes = base64.b64decode(b64)
            img_stream = io.BytesIO(img_bytes)
            img_stream.name = "signature.png"
            pdf.image(img_stream, x=15, w=60, h=25)
            pdf.ln(2)
        except Exception as e:
            logger.warning("Failed to embed signature image in PDF: %s", e)

    # Signed by / at
    try:
        signed_dt = datetime.fromisoformat(signed_at.replace("Z", "+00:00"))
        signed_str = signed_dt.strftime("%B %d, %Y at %I:%M %p %Z")
    except Exception:
        signed_str = signed_at

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, f"Signed by: {signed_by}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, f"Signed at: {signed_str}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # Content hash for verification
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(128, 128, 128)
    pdf.cell(0, 4, f"Content Hash (SHA-256): {content_hash}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)

    # Output to bytes
    return pdf.output()
