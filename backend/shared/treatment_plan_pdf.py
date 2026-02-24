"""PDF generation for signed treatment plans.

Generates a professional treatment plan PDF with:
  - Practice header (name, address, NPI, credentials)
  - Client information
  - Diagnoses table (ICD-10 codes)
  - Goals with measurable objectives and interventions
  - Presenting problems
  - Review schedule
  - Signature block with rendered signature image
  - Content hash for verification
"""
import base64
import io
import logging
import re
from datetime import datetime

from fpdf import FPDF

logger = logging.getLogger(__name__)


def _strip_html(text: str) -> str:
    """Remove HTML tags for plain-text PDF rendering."""
    if not text:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?(p|div|h[1-6]|li|ul|ol|blockquote)[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li[^>]*>", "  - ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&nbsp;", " ").replace("&middot;", "-")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


class TreatmentPlanPDF(FPDF):
    """Custom PDF class for treatment plans."""

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

        self.set_font("Helvetica", "B", 14)
        self.cell(0, 7, practice_name, new_x="LMARGIN", new_y="NEXT", align="C")

        if clinician_name:
            cred_line = clinician_name
            if credentials:
                cred_line += f", {credentials}"
            self.set_font("Helvetica", "", 10)
            self.cell(0, 5, cred_line, new_x="LMARGIN", new_y="NEXT", align="C")

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

        id_parts = []
        if practice.get("npi"):
            id_parts.append(f"NPI: {practice['npi']}")
        if practice.get("license_number") and practice.get("license_state"):
            id_parts.append(f"License: {practice['license_number']} ({practice['license_state']})")
        if id_parts:
            self.set_font("Helvetica", "", 8)
            self.cell(0, 4, " | ".join(id_parts), new_x="LMARGIN", new_y="NEXT", align="C")

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


def generate_treatment_plan_pdf(
    diagnoses: list[dict],
    goals: list[dict],
    presenting_problems: str,
    review_date: str | None,
    version: int,
    client_name: str,
    client_dob: str | None,
    plan_date: str,
    signed_by: str,
    signed_at: str,
    content_hash: str,
    signature_data: str | None = None,
    practice: dict | None = None,
) -> bytes:
    """Generate a PDF for a signed treatment plan.

    Returns:
        PDF file as bytes.
    """
    pdf = TreatmentPlanPDF(practice=practice)
    pdf.alias_nb_pages()
    pdf.add_page()

    # --- Document title ---
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, "Treatment Plan", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 5, f"Version {version}", new_x="LMARGIN", new_y="NEXT", align="C")
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
    pdf.cell(35, 6, "Plan Date:", new_x="RIGHT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, plan_date, new_x="LMARGIN", new_y="NEXT")

    if review_date:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(35, 6, "Review Date:", new_x="RIGHT")
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, review_date, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(5)

    # --- Diagnoses ---
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(0, 7, "  Diagnoses", new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.ln(2)

    if diagnoses:
        for dx in diagnoses:
            code = dx.get("code", "")
            desc = dx.get("description", "")
            dx_type = dx.get("type", "")
            rank = dx.get("rank", "")
            pdf.set_font("Helvetica", "B", 10)
            prefix = f"  {rank}. " if rank else "  "
            pdf.cell(0, 5, f"{prefix}{code} - {desc}", new_x="LMARGIN", new_y="NEXT")
            if dx_type:
                pdf.set_font("Helvetica", "I", 9)
                pdf.cell(0, 4, f"     ({dx_type})", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
    else:
        pdf.set_font("Helvetica", "I", 10)
        pdf.cell(0, 5, "  No diagnoses documented.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # --- Presenting Problems ---
    if presenting_problems:
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_fill_color(240, 240, 240)
        pdf.cell(0, 7, "  Presenting Problems", new_x="LMARGIN", new_y="NEXT", fill=True)
        pdf.ln(2)
        pdf.set_font("Helvetica", "", 10)
        text = _strip_html(presenting_problems)
        for paragraph in text.split("\n"):
            stripped = paragraph.strip()
            if stripped:
                pdf.multi_cell(0, 5, stripped, new_x="LMARGIN", new_y="NEXT")
            else:
                pdf.ln(3)
        pdf.ln(4)

    # --- Goals & Objectives ---
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(0, 7, "  Treatment Goals & Objectives", new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.ln(2)

    if goals:
        for i, goal in enumerate(goals, 1):
            # Goal header
            pdf.set_font("Helvetica", "B", 10)
            goal_desc = goal.get("description", "")
            goal_status = goal.get("status", "active")
            target = goal.get("target_date", "")
            pdf.multi_cell(0, 5, f"  Goal {i}: {goal_desc}", new_x="LMARGIN", new_y="NEXT")

            pdf.set_font("Helvetica", "I", 9)
            meta_parts = []
            if goal_status:
                meta_parts.append(f"Status: {goal_status}")
            if target:
                meta_parts.append(f"Target: {target}")
            if meta_parts:
                pdf.cell(0, 4, f"     {' | '.join(meta_parts)}", new_x="LMARGIN", new_y="NEXT")
            pdf.ln(1)

            # Objectives
            objectives = goal.get("objectives", [])
            if objectives:
                pdf.set_font("Helvetica", "B", 9)
                pdf.cell(0, 5, "     Objectives:", new_x="LMARGIN", new_y="NEXT")
                pdf.set_font("Helvetica", "", 9)
                for j, obj in enumerate(objectives, 1):
                    obj_desc = obj.get("description", "") if isinstance(obj, dict) else str(obj)
                    obj_status = obj.get("status", "") if isinstance(obj, dict) else ""
                    status_tag = f" [{obj_status}]" if obj_status else ""
                    pdf.multi_cell(0, 4, f"       {j}. {obj_desc}{status_tag}", new_x="LMARGIN", new_y="NEXT")

            # Interventions
            interventions = goal.get("interventions", [])
            if interventions:
                pdf.set_font("Helvetica", "B", 9)
                pdf.cell(0, 5, "     Interventions:", new_x="LMARGIN", new_y="NEXT")
                pdf.set_font("Helvetica", "", 9)
                for intervention in interventions:
                    pdf.multi_cell(0, 4, f"       - {intervention}", new_x="LMARGIN", new_y="NEXT")

            pdf.ln(3)
    else:
        pdf.set_font("Helvetica", "I", 10)
        pdf.cell(0, 5, "  No goals documented.", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(3)

    # --- Signature block ---
    pdf.set_draw_color(180, 180, 180)
    pdf.line(10, pdf.get_y(), pdf.w - 10, pdf.get_y())
    pdf.ln(5)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Clinician Signature", new_x="LMARGIN", new_y="NEXT")
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
            pdf.image(img_stream, x=15, w=60, h=25)
            pdf.ln(2)
        except Exception as e:
            logger.warning("Failed to embed signature image in PDF: %s", e)

    try:
        signed_dt = datetime.fromisoformat(signed_at.replace("Z", "+00:00"))
        signed_str = signed_dt.strftime("%B %d, %Y at %I:%M %p %Z")
    except Exception:
        signed_str = signed_at

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, f"Signed by: {signed_by}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, f"Signed at: {signed_str}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(128, 128, 128)
    pdf.cell(0, 4, f"Content Hash (SHA-256): {content_hash}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)

    return pdf.output()
