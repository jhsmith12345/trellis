"""AI-powered CAQH profile text generation.

Uses Gemini to compose CAQH attestation profile sections from
existing practice data, saving clinicians manual data entry.
"""
import json
import logging
import os

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "trellis-mvp")
MODEL_ID = "gemini-2.5-flash"

SYSTEM_INSTRUCTION = """You are a credentialing specialist helping behavioral health providers complete their CAQH profile.
Generate professional, accurate text for CAQH profile sections based on the practice data provided.
Only use information explicitly provided — mark anything missing as [NEEDS INPUT].

Output valid JSON with section keys matching CAQH profile sections."""


async def generate_caqh_profile_text(
    practice_profile: dict,
    documents: list[dict] | None = None,
) -> dict:
    """Generate CAQH profile text sections from existing practice data.

    Args:
        practice_profile: Practice profile with clinician/practice info.
        documents: Optional list of credential document metadata.

    Returns:
        Dict with CAQH section keys and generated text values.
    """
    client = genai.Client(vertexai=True, project=GCP_PROJECT_ID, location="global")

    doc_context = ""
    if documents:
        doc_context = "\nUploaded credential documents:\n"
        for d in documents:
            doc_context += f"- {d.get('document_type', 'unknown')}: {d.get('file_name', '')} "
            if d.get("document_number"):
                doc_context += f"(#{d['document_number']}) "
            if d.get("expiration_date"):
                doc_context += f"expires {d['expiration_date']}"
            doc_context += "\n"

    prompt = f"""Generate CAQH profile text sections for this behavioral health provider.

Practice Information:
- Practice Name: {practice_profile.get('practice_name', '[NEEDS INPUT]')}
- Clinician Name: {practice_profile.get('clinician_name', '[NEEDS INPUT]')}
- Credentials: {practice_profile.get('credentials', '[NEEDS INPUT]')}
- NPI: {practice_profile.get('npi', '[NEEDS INPUT]')}
- Tax ID: {practice_profile.get('tax_id', '[NEEDS INPUT]')}
- License: {practice_profile.get('license_number', '[NEEDS INPUT]')} ({practice_profile.get('license_state', '')})
- Specialties: {practice_profile.get('specialties', '[NEEDS INPUT]')}
- Bio: {practice_profile.get('bio', '[NEEDS INPUT]')}
- Phone: {practice_profile.get('phone', '[NEEDS INPUT]')}
- Email: {practice_profile.get('email', '[NEEDS INPUT]')}
- Address: {practice_profile.get('address_line1', '')} {practice_profile.get('city', '')}, {practice_profile.get('state', '')} {practice_profile.get('zip', '')}
{doc_context}

Return JSON with these sections:
{{
  "practice_description": "Professional practice description for CAQH",
  "specialty_narrative": "Description of specialties and populations served",
  "education_training": "Education and training summary (use [NEEDS INPUT] for missing info)",
  "work_history": "Current practice details formatted for CAQH",
  "professional_references_note": "Note about references needed — [NEEDS INPUT: 3 professional references required]",
  "hospital_affiliations_note": "Note about hospital affiliations — typically N/A for outpatient behavioral health",
  "malpractice_history": "Standard attestation language for malpractice history section"
}}"""

    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                temperature=0.3,
                max_output_tokens=4096,
            ),
        )

        text = response.text
        if not text:
            return {}

        return json.loads(text)
    except (json.JSONDecodeError, Exception):
        logger.exception("Failed to generate CAQH profile text")
        return {}
