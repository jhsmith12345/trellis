"""Insurance card extraction via Gemini 3 Flash vision.

Sends card images as inline base64 parts, returns structured JSON
with extracted insurance fields.
"""
import base64
import json
import logging
import re

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

EXTRACTION_MODEL = "gemini-3-flash-preview"

EXTRACTION_PROMPT = """You are extracting structured data from a health insurance card image.

Extract the following fields. Return null for any field that is not visible or unreadable.

{
  "payer_name": "Insurance company name",
  "plan_name": "Plan name if shown",
  "member_id": "Member/subscriber ID number",
  "group_number": "Group number",
  "plan_type": "HMO, PPO, EPO, POS, etc.",
  "subscriber_name": "Name of the subscriber on the card",
  "rx_bin": "Pharmacy BIN number",
  "rx_pcn": "Pharmacy PCN",
  "rx_group": "Pharmacy group ID",
  "payer_phone": "Member services phone number",
  "effective_date": "Coverage effective date",
  "copay_info": "Any copay amounts shown (e.g. office visit, specialist, ER)"
}

Return ONLY valid JSON matching this schema. No markdown, no explanation."""


def _b64_decode(data: str) -> bytes:
    """Strip optional data URI prefix and decode base64."""
    # Handle "data:image/jpeg;base64,/9j/4AAQ..." format
    match = re.match(r"^data:[^;]+;base64,", data)
    if match:
        data = data[match.end():]
    return base64.b64decode(data)


async def extract_insurance_card(
    front_b64: str,
    mime_type: str,
    project_id: str,
    region: str,
    back_b64: str | None = None,
) -> dict:
    """Extract insurance info from card image(s) via Gemini vision.

    Args:
        front_b64: Base64-encoded front of card (may include data URI prefix).
        mime_type: MIME type of the image (e.g. "image/jpeg").
        project_id: GCP project ID.
        region: GCP region.
        back_b64: Optional base64-encoded back of card.

    Returns:
        Dict with extracted insurance fields. Unreadable fields are null.
    """
    # Gemini 3 Flash Preview is only available on the global endpoint
    client = genai.Client(vertexai=True, project=project_id, location="global")

    parts: list[types.Part] = [
        types.Part.from_text(text="Front of insurance card:"),
        types.Part.from_bytes(data=_b64_decode(front_b64), mime_type=mime_type),
    ]

    if back_b64:
        parts.append(types.Part.from_text(text="Back of insurance card:"))
        parts.append(types.Part.from_bytes(data=_b64_decode(back_b64), mime_type=mime_type))

    parts.append(types.Part.from_text(text=EXTRACTION_PROMPT))

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
        logger.error("Gemini returned empty response for insurance extraction")
        return {}

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.error("Failed to parse Gemini response as JSON: %s", text[:200])
        return {}
