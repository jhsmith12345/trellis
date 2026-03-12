"""AI discharge summary generation using Gemini 2.5 Flash.

Generates comprehensive discharge summaries from the client's full treatment
history: encounters, clinical notes, treatment plan, and appointment history.

Output: A structured discharge summary stored as a clinical note
(note_format='discharge', encounter type='clinical', source='clinician').

Discharge summary sections:
  - Reason for treatment / presenting problems
  - Course of treatment summary
  - Progress toward treatment goals
  - Current diagnoses and status
  - Discharge recommendations (aftercare, referrals, follow-up)
  - Medications at discharge (if mentioned)
  - Risk assessment at discharge
"""
import json
import logging
import os

from google import genai
from google.genai.types import GenerateContentConfig

logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = os.getenv("GEMINI_NOTE_MODEL", "gemini-2.5-flash")
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "your-gcp-project")
GCP_REGION = os.getenv("GCP_REGION", "us-central1")


def _get_client() -> genai.Client:
    """Create a Gemini client configured for Vertex AI."""
    return genai.Client(
        vertexai=True,
        project=GCP_PROJECT_ID,
        location=GCP_REGION,
    )


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_INSTRUCTION = """You are a clinical documentation assistant for a licensed behavioral health therapist.
Your role is to generate a professional discharge summary from the client's complete treatment history.

CRITICAL GUIDELINES:
- Use only information explicitly documented in the provided clinical data (notes, transcripts, treatment plan).
- Do NOT fabricate clinical details, diagnoses, or outcomes not supported by the data.
- Use professional clinical language appropriate for medical records.
- Be thorough but concise — this is a formal clinical document.
- When information is not available, explicitly state "Not documented" or "Information not available."
- Use person-first language (e.g., "client with depression" not "depressed client").
- Document risk factors clearly with current assessment.
- All output must be valid JSON matching the specified structure.
- Do NOT include the client's full name in the content — use "the client" or first name only.
- Protect PHI: do not include SSN, full DOB, or other unnecessary identifiers.
"""

DISCHARGE_SUMMARY_PROMPT = """Generate a comprehensive discharge summary for a client completing behavioral health treatment.

CLIENT INFORMATION:
- Client Name (first only): {client_name}
- Treatment Start Date: {treatment_start_date}
- Discharge Date: {discharge_date}
- Total Sessions: {total_sessions}
- Treatment Duration: {treatment_duration}

ACTIVE TREATMENT PLAN:
{treatment_plan_context}

CLINICAL NOTES HISTORY (chronological):
{clinical_notes_summary}

ENCOUNTER HISTORY (chronological):
{encounter_summary}

APPOINTMENT HISTORY:
{appointment_summary}

Generate a structured discharge summary in the following JSON format. Each field should be a string with clinical content (use markdown formatting within strings for structure):

{{
  "reason_for_treatment": "Presenting problems and reason for seeking treatment. Include the client's chief complaints at intake, symptom severity at presentation, functional impairments, and referral source if documented.",
  "course_of_treatment": "Chronological summary of the treatment course. Include:\n- Treatment modality and approach used (CBT, DBT, MI, psychodynamic, etc.)\n- Frequency and duration of sessions\n- Key therapeutic themes and interventions\n- Significant events or turning points in treatment\n- Client engagement and participation\n- Any treatment modifications or adjustments made\n- Barriers encountered and how they were addressed",
  "progress_toward_goals": "Detailed assessment of progress toward each treatment plan goal. For each goal:\n- State the original goal\n- Describe measurable progress made (reference objective data when available: PHQ-9 scores, behavioral frequency, functional improvements)\n- Current status: met / partially met / not met / ongoing\n- Specific achievements and skills developed\n- Areas of continued growth needed",
  "diagnoses_at_discharge": "Current diagnostic status at the time of discharge. Include:\n- Primary diagnosis with ICD-10 code and current status (resolved / in remission / improved / stable / unchanged)\n- Secondary/comorbid diagnoses with codes and status\n- Any diagnoses added or removed during treatment\n- Rationale for diagnostic changes if applicable",
  "discharge_recommendations": "Comprehensive aftercare and follow-up recommendations. Include:\n- Recommended level of care going forward (no further treatment needed / step-down / referral to specialist)\n- Specific referrals (psychiatry, group therapy, specialized treatment programs, community resources)\n- Follow-up recommendations (timeline for check-ins, booster sessions, relapse prevention plan)\n- Self-care strategies and coping skills to maintain\n- Support system utilization recommendations\n- Crisis resources and safety planning information",
  "medications_at_discharge": "Medications mentioned during treatment at the time of discharge. If medications were discussed in sessions:\n- List current medications with doses if documented\n- Note any medication changes during treatment\n- Prescriber information if available\nIf not discussed, state: 'Medication management was not within the scope of this therapeutic relationship. Client should consult with their prescribing provider for medication-related concerns.'",
  "risk_assessment": "Risk assessment at the time of discharge. Include:\n- Current suicidal ideation (SI): denied / endorsed (with details)\n- Current homicidal ideation (HI): denied / endorsed (with details)\n- Self-harm behaviors: current status\n- Protective factors present (support system, future orientation, coping skills, engagement in treatment)\n- Risk level at discharge: low / moderate / high\n- Safety plan status (in place / updated / not indicated)\n- Compared to initial risk level at intake if documented",
  "clinical_summary": "3-5 sentence integrative summary of the treatment episode. Synthesize the client's overall trajectory from intake to discharge, key outcomes, prognosis, and any important considerations for future providers."
}}

Return ONLY the JSON object, no additional text or markdown code fences."""


# ---------------------------------------------------------------------------
# Context Formatting Helpers
# ---------------------------------------------------------------------------

def _format_treatment_plan(treatment_plan: dict | None) -> str:
    """Format the treatment plan for prompt injection."""
    if not treatment_plan:
        return "No active treatment plan on file."

    parts = []

    # Diagnoses
    diagnoses = treatment_plan.get("diagnoses")
    if diagnoses:
        parts.append("Diagnoses:")
        for dx in diagnoses:
            code = dx.get("code", "")
            desc = dx.get("description", "")
            parts.append(f"  - {code}: {desc}")

    # Goals
    goals = treatment_plan.get("goals")
    if goals:
        parts.append("\nTreatment Goals:")
        for i, goal in enumerate(goals, 1):
            desc = goal.get("description", "")
            status = goal.get("status", "active")
            parts.append(f"  Goal {i} [{status}]: {desc}")
            objectives = goal.get("objectives", [])
            for j, obj in enumerate(objectives, 1):
                obj_desc = obj.get("description", "") if isinstance(obj, dict) else str(obj)
                obj_status = obj.get("status", "active") if isinstance(obj, dict) else "active"
                parts.append(f"    Objective {i}.{j} [{obj_status}]: {obj_desc}")
            interventions = goal.get("interventions", [])
            if interventions:
                parts.append(f"    Interventions: {'; '.join(interventions)}")

    # Presenting problems
    presenting = treatment_plan.get("presenting_problems")
    if presenting:
        parts.append(f"\nPresenting Problems: {presenting}")

    return "\n".join(parts) if parts else "Treatment plan exists but has no content."


def _format_clinical_notes(notes: list[dict]) -> str:
    """Format clinical notes history for prompt injection."""
    if not notes:
        return "No clinical notes on file."

    parts = []
    for note in notes:
        note_format = note.get("format", "unknown")
        status = note.get("status", "unknown")
        created = note.get("created_at", "")
        content = note.get("content", {})

        parts.append(f"\n--- {note_format.upper()} Note ({status}) - {created} ---")

        if isinstance(content, str):
            try:
                content = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                parts.append(content[:5000])
                continue

        if isinstance(content, dict):
            for section_key, section_val in content.items():
                if section_val:
                    # Truncate very long sections
                    val_str = str(section_val)[:3000]
                    parts.append(f"  {section_key}: {val_str}")
        else:
            parts.append(str(content)[:5000])

    # Cap total length to avoid token overflow
    result = "\n".join(parts)
    if len(result) > 60000:
        result = result[:60000] + "\n... [truncated for length]"
    return result


def _format_encounters(encounters: list[dict]) -> str:
    """Format encounter history for prompt injection."""
    if not encounters:
        return "No encounters on file."

    parts = []
    for enc in encounters:
        enc_type = enc.get("type", "unknown")
        enc_source = enc.get("source", "unknown")
        created = enc.get("created_at", "")
        transcript = enc.get("transcript", "")
        duration = enc.get("duration_sec")

        duration_str = ""
        if duration:
            mins = duration // 60
            duration_str = f" ({mins} min)"

        parts.append(f"\n--- {enc_type} encounter ({enc_source}){duration_str} - {created} ---")

        if transcript:
            # Include transcript but truncated
            parts.append(transcript[:5000])
            if len(transcript) > 5000:
                parts.append("... [transcript truncated]")

    result = "\n".join(parts)
    if len(result) > 60000:
        result = result[:60000] + "\n... [truncated for length]"
    return result


def _format_appointments(appointments: list[dict]) -> str:
    """Format appointment history for prompt injection."""
    if not appointments:
        return "No appointment history."

    parts = ["Appointment history:"]
    completed = 0
    cancelled = 0
    no_show = 0

    for appt in appointments:
        status = appt.get("status", "")
        appt_type = appt.get("type", "")
        scheduled = appt.get("scheduled_at", "")

        if status == "completed":
            completed += 1
        elif status == "cancelled":
            cancelled += 1
        elif status == "no_show":
            no_show += 1

    parts.append(f"  Total completed sessions: {completed}")
    parts.append(f"  Cancelled appointments: {cancelled}")
    parts.append(f"  No-shows: {no_show}")

    # List individual appointments (limit to last 20 for context)
    for appt in appointments[:20]:
        status = appt.get("status", "")
        appt_type = appt.get("type", "")
        scheduled = appt.get("scheduled_at", "")[:10]  # date only
        parts.append(f"  - {scheduled}: {appt_type} [{status}]")

    if len(appointments) > 20:
        parts.append(f"  ... and {len(appointments) - 20} more appointments")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

async def generate_discharge_summary(
    client_name: str = "the client",
    treatment_start_date: str = "",
    discharge_date: str = "",
    total_sessions: int = 0,
    treatment_plan: dict | None = None,
    clinical_notes: list[dict] | None = None,
    encounters: list[dict] | None = None,
    appointments: list[dict] | None = None,
) -> dict:
    """Generate a discharge summary from the client's full treatment history.

    Args:
        client_name: Client's first name or "the client".
        treatment_start_date: ISO date string for treatment start.
        discharge_date: ISO date string for discharge.
        total_sessions: Total number of completed sessions.
        treatment_plan: Active treatment plan dict.
        clinical_notes: List of clinical note dicts (chronological).
        encounters: List of encounter dicts (chronological).
        appointments: List of appointment dicts.

    Returns:
        Dict with:
            - format: 'discharge'
            - content: Parsed JSON content of the discharge summary
            - raw_text: Raw text response from Gemini
    """
    client = _get_client()

    # Calculate treatment duration
    treatment_duration = "Unknown"
    if treatment_start_date and discharge_date:
        try:
            from datetime import datetime
            start = datetime.fromisoformat(treatment_start_date.replace("Z", "+00:00"))
            end = datetime.fromisoformat(discharge_date.replace("Z", "+00:00"))
            delta = end - start
            months = delta.days // 30
            weeks = (delta.days % 30) // 7
            if months > 0:
                treatment_duration = f"{months} month{'s' if months != 1 else ''}"
                if weeks > 0:
                    treatment_duration += f", {weeks} week{'s' if weeks != 1 else ''}"
            elif weeks > 0:
                treatment_duration = f"{weeks} week{'s' if weeks != 1 else ''}"
            else:
                treatment_duration = f"{delta.days} day{'s' if delta.days != 1 else ''}"
        except Exception:
            treatment_duration = "Unable to calculate"

    # Format context
    treatment_plan_context = _format_treatment_plan(treatment_plan)
    clinical_notes_summary = _format_clinical_notes(clinical_notes or [])
    encounter_summary = _format_encounters(encounters or [])
    appointment_summary = _format_appointments(appointments or [])

    prompt = DISCHARGE_SUMMARY_PROMPT.format(
        client_name=client_name,
        treatment_start_date=treatment_start_date or "Not recorded",
        discharge_date=discharge_date or "Not recorded",
        total_sessions=total_sessions,
        treatment_duration=treatment_duration,
        treatment_plan_context=treatment_plan_context,
        clinical_notes_summary=clinical_notes_summary,
        encounter_summary=encounter_summary,
        appointment_summary=appointment_summary,
    )

    logger.info(
        "Generating discharge summary (notes: %d, encounters: %d, sessions: %d, prompt length: %d chars)",
        len(clinical_notes or []),
        len(encounters or []),
        total_sessions,
        len(prompt),
    )

    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config=GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.3,
                max_output_tokens=8192,
                response_mime_type="application/json",
            ),
        )

        raw_text = response.text
        logger.info("Discharge summary generation complete (%d chars response)", len(raw_text))

        # Parse JSON response
        try:
            content = json.loads(raw_text)
        except json.JSONDecodeError:
            import re
            json_match = re.search(r'\{[\s\S]*\}', raw_text)
            if json_match:
                content = json.loads(json_match.group())
            else:
                logger.error("Failed to parse discharge summary response as JSON")
                content = {"raw_content": raw_text}

        return {
            "format": "discharge",
            "content": content,
            "raw_text": raw_text,
        }

    except Exception as e:
        logger.error("Discharge summary generation failed: %s: %s", type(e).__name__, e)
        raise
