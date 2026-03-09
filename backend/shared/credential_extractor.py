"""Credential document extraction via Gemini 3 Flash vision.

Extracts structured metadata from uploaded credential documents
(malpractice certs, licenses, W-9s, etc.) using Gemini vision.
"""
import base64
import json
import logging
import re

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

EXTRACTION_MODEL = "gemini-3-flash-preview"

PROMPTS = {
    "malpractice_cert": """Extract these fields from this malpractice/professional liability insurance certificate.
Return null for any field not visible or unreadable.
{
  "policy_number": "Policy number",
  "carrier_name": "Insurance carrier/company name",
  "coverage_amount": "Coverage amount (e.g. $1M/$3M)",
  "effective_date": "Policy effective date (YYYY-MM-DD)",
  "expiration_date": "Policy expiration date (YYYY-MM-DD)",
  "insured_name": "Name of insured professional"
}
Return ONLY valid JSON. No markdown, no explanation.""",

    "license": """Extract these fields from this professional license document.
Return null for any field not visible or unreadable.
{
  "license_number": "License number",
  "license_type": "Type of license (e.g. LCSW, LPC, PhD, PsyD)",
  "state": "Issuing state",
  "issue_date": "Issue date (YYYY-MM-DD)",
  "expiration_date": "Expiration date (YYYY-MM-DD)",
  "holder_name": "Name of license holder"
}
Return ONLY valid JSON. No markdown, no explanation.""",

    "w9": """Extract these fields from this W-9 form.
Return null for any field not visible or unreadable.
{
  "name": "Name as shown on tax return",
  "business_name": "Business name if different",
  "tax_classification": "Tax classification (individual, LLC, S-Corp, etc.)",
  "address": "Full address",
  "tax_id_last4": "Last 4 digits of SSN or EIN only (for verification)"
}
Return ONLY valid JSON. No markdown, no explanation.""",

    "dea_certificate": """Extract these fields from this DEA certificate.
Return null for any field not visible or unreadable.
{
  "dea_number": "DEA registration number",
  "schedules": "Authorized schedules",
  "expiration_date": "Expiration date (YYYY-MM-DD)",
  "holder_name": "Name of registrant"
}
Return ONLY valid JSON. No markdown, no explanation.""",

    "board_certification": """Extract these fields from this board certification document.
Return null for any field not visible or unreadable.
{
  "board_name": "Certifying board name",
  "specialty": "Specialty or certification area",
  "certification_date": "Date certified (YYYY-MM-DD)",
  "expiration_date": "Expiration date (YYYY-MM-DD)",
  "holder_name": "Name of certificate holder"
}
Return ONLY valid JSON. No markdown, no explanation.""",
}

# Fallback prompt for document types without a specific template
DEFAULT_PROMPT = """Extract any identifying information from this document.
Return null for any field not visible or unreadable.
{
  "document_title": "Title or type of document",
  "holder_name": "Name of the person this document belongs to",
  "document_number": "Any identifying number on the document",
  "issue_date": "Issue date if shown (YYYY-MM-DD)",
  "expiration_date": "Expiration date if shown (YYYY-MM-DD)",
  "issuing_authority": "Organization that issued this document"
}
Return ONLY valid JSON. No markdown, no explanation."""


def _b64_decode(data: str) -> bytes:
    """Strip optional data URI prefix and decode base64."""
    match = re.match(r"^data:[^;]+;base64,", data)
    if match:
        data = data[match.end():]
    return base64.b64decode(data)


async def extract_credential_document(
    file_b64: str,
    mime_type: str,
    document_type: str,
    project_id: str,
) -> dict:
    """Extract structured data from a credential document via Gemini vision.

    Args:
        file_b64: Base64-encoded document (may include data URI prefix).
        mime_type: MIME type (image/* or application/pdf).
        document_type: One of the credentialing document types.
        project_id: GCP project ID.

    Returns:
        Dict with extracted fields. Empty dict on failure.
    """
    client = genai.Client(vertexai=True, project=project_id, location="global")

    prompt = PROMPTS.get(document_type, DEFAULT_PROMPT)

    parts: list[types.Part] = [
        types.Part.from_text(text=f"Credential document ({document_type}):"),
        types.Part.from_bytes(data=_b64_decode(file_b64), mime_type=mime_type),
        types.Part.from_text(text=prompt),
    ]

    try:
        response = await client.aio.models.generate_content(
            model=EXTRACTION_MODEL,
            contents=parts,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )

        text = response.text
        if not text:
            logger.error("Gemini returned empty response for credential extraction")
            return {}

        return json.loads(text)
    except json.JSONDecodeError:
        logger.error("Failed to parse Gemini credential extraction response")
        return {}
    except Exception:
        logger.exception("Credential document extraction failed")
        return {}
