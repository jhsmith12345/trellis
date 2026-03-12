"""AI-powered follow-up message drafting for credentialing applications.

Uses Gemini to generate professional follow-up emails/fax messages
when insurance credentialing applications are stale.
"""
import json
import logging
import os

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "your-gcp-project")
MODEL_ID = "gemini-2.5-flash"

SYSTEM_INSTRUCTION = """You are a professional credentialing coordinator assistant for a behavioral health practice.
You draft polite, professional follow-up messages to insurance company provider relations departments
regarding pending credentialing applications.

Guidelines:
- Be concise and professional
- Include specific details (application date, provider name, NPI)
- Reference any prior follow-ups
- Request a status update and estimated timeline
- Include the practice contact info for callback
- Output valid JSON with "subject" and "body" keys
"""


async def draft_followup_message(
    payer_record: dict,
    timeline_events: list[dict],
    practice_profile: dict,
) -> dict:
    """Generate a follow-up message for a pending credentialing application.

    Args:
        payer_record: The credentialing_payers record.
        timeline_events: Recent timeline events for context.
        practice_profile: Practice profile with clinician info.

    Returns:
        Dict with "subject" and "body" keys.
    """
    client = genai.Client(vertexai=True, project=GCP_PROJECT_ID, location="global")

    # Build context about prior follow-ups
    prior_followups = [
        e for e in timeline_events
        if e.get("event_type") in ("follow_up_call", "follow_up_email")
    ]
    followup_context = ""
    if prior_followups:
        followup_context = f"\nPrior follow-ups ({len(prior_followups)}):\n"
        for f in prior_followups[:5]:
            followup_context += f"- {f.get('created_at', 'unknown date')}: {f.get('description', '')}\n"

    prompt = f"""Draft a follow-up email to the insurance company's provider relations department.

Payer: {payer_record.get('payer_name', 'Unknown')}
Application submitted: {payer_record.get('application_submitted_at', 'Unknown')}
Current status: {payer_record.get('status', 'pending')}

Provider: {practice_profile.get('clinician_name', 'Unknown')}
NPI: {practice_profile.get('npi', 'Unknown')}
Practice: {practice_profile.get('practice_name', 'Unknown')}
Phone: {practice_profile.get('phone', 'Unknown')}
Email: {practice_profile.get('email', 'Unknown')}
{followup_context}

Return JSON: {{"subject": "email subject line", "body": "full email body"}}"""

    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                temperature=0.4,
                max_output_tokens=2048,
            ),
        )

        text = response.text
        if not text:
            return {"subject": "", "body": ""}

        return json.loads(text)
    except (json.JSONDecodeError, Exception):
        logger.exception("Failed to draft follow-up message")
        return {"subject": "", "body": ""}
