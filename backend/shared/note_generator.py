"""AI clinical note generation using Gemini 2.5 Flash.

Generates structured clinical notes from session transcripts + appointment metadata.
Supports three note formats:
  - Biopsychosocial Assessment (intake/90791)
  - SOAP Progress Note (90834/90837)
  - DAP Progress Note (90834/90837)

The appointment type determines the note format:
  - assessment → Biopsychosocial Assessment
  - individual / individual_extended → SOAP or DAP (based on clinician preference)
"""
import json
import logging
import os

from google import genai
from google.genai.types import GenerateContentConfig

logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = os.getenv("GEMINI_NOTE_MODEL", "gemini-2.5-flash")
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "trellis-mvp")
GCP_REGION = os.getenv("GCP_REGION", "us-central1")


def _get_client() -> genai.Client:
    """Create a Gemini client configured for Vertex AI."""
    return genai.Client(
        vertexai=True,
        project=GCP_PROJECT_ID,
        location=GCP_REGION,
    )


# ---------------------------------------------------------------------------
# Clinical Prompts
# ---------------------------------------------------------------------------

SYSTEM_INSTRUCTION = """You are a clinical documentation assistant for a licensed behavioral health therapist.
Your role is to generate professional clinical notes from session transcripts.

CRITICAL GUIDELINES:
- Use only information explicitly stated or clearly observable in the transcript.
- Do NOT fabricate clinical details, diagnoses, or observations not supported by the transcript.
- Use professional clinical language appropriate for medical records.
- Be thorough but concise — avoid unnecessary repetition.
- When information is not available or not discussed, explicitly state "Not assessed" or "Not discussed during this session."
- Use person-first language (e.g., "client with depression" not "depressed client").
- Document risk factors when mentioned; if not discussed, note "No risk factors identified during this session."
- All output must be valid JSON matching the specified structure.
- Do NOT include the client's full name in the note content — use "the client" or first name only.
- Protect PHI: do not include SSN, full DOB, or other unnecessary identifiers in the note body.
"""

BIOPSYCHOSOCIAL_PROMPT = """Generate a comprehensive Biopsychosocial Assessment note from this intake session transcript.

This is for CPT code 90791 (Psychiatric Diagnostic Evaluation).

TRANSCRIPT:
{transcript}

APPOINTMENT METADATA:
- Appointment Type: {appointment_type}
- Session Date: {session_date}
- Session Duration: {duration_display}
- Client Name: {client_name}

{treatment_plan_context}

Generate a structured biopsychosocial assessment in the following JSON format. Each field should be a string with the clinical content (use markdown formatting within strings for structure):

{{
  "identifying_information": "Age, gender identity, pronouns, referral source, presenting context. Brief identifying statement.",
  "presenting_problem": "Chief complaint in the client's own words. Reason for seeking treatment. Onset, duration, severity, and impact on functioning.",
  "history_of_present_illness": "Detailed chronological narrative of current symptoms. Onset, course, precipitating factors, exacerbating/relieving factors. Previous treatment attempts and outcomes.",
  "psychiatric_history": "Past diagnoses, hospitalizations, medication trials (with responses), previous therapy modalities and outcomes, history of self-harm or suicidal ideation/attempts.",
  "substance_use_history": "Current and past substance use (alcohol, cannabis, nicotine, prescription misuse, illicit substances). Age of first use, frequency, quantity, last use, withdrawal history, treatment history. If denied, state 'Client denies current or past substance use.'",
  "medical_history": "Current medical conditions, medications (with doses if mentioned), allergies, relevant surgical history, primary care provider. Sleep patterns, appetite, exercise.",
  "family_history": "Family psychiatric and substance use history. Family structure, relationships, family of origin dynamics. Genogram-relevant information.",
  "social_developmental_history": "Education, employment, living situation, relationships (romantic/platonic), children, military service, legal history, cultural/religious factors, developmental milestones if relevant, trauma history (ACEs, abuse, neglect, significant losses).",
  "mental_status_examination": "Appearance, behavior, speech, mood (client-reported), affect (clinician-observed), thought process, thought content, perceptions, cognition (orientation, memory, attention, concentration), insight, judgment. Base this on observations from the transcript.",
  "diagnostic_impressions": "Provisional DSM-5 diagnoses with ICD-10-CM codes. Include:\n- Primary diagnosis with code\n- Any secondary/comorbid diagnoses with codes\n- Rule-out diagnoses if applicable\n- Z-codes for relevant psychosocial factors\nFormat each as: 'ICD-10 Code — DSM-5 Diagnosis Name'",
  "risk_assessment": "Suicidal ideation (current/past), homicidal ideation, self-harm behaviors, access to means, protective factors, risk level (low/moderate/high), safety plan if indicated.",
  "treatment_recommendations": "Recommended frequency and modality of treatment, therapeutic approach (CBT, DBT, psychodynamic, etc.), referrals (psychiatry, medical, group therapy), treatment goals (brief), estimated treatment duration, level of care recommendation.",
  "clinical_summary": "2-3 sentence integrative summary synthesizing key findings, diagnostic conceptualization, and treatment direction."
}}

Return ONLY the JSON object, no additional text or markdown code fences."""

SOAP_PROMPT = """Generate a SOAP progress note from this therapy session transcript.

This is for CPT code {cpt_code} ({cpt_description}).

TRANSCRIPT:
{transcript}

APPOINTMENT METADATA:
- Appointment Type: {appointment_type}
- Session Date: {session_date}
- Session Duration: {duration_display}
- Client Name: {client_name}

{treatment_plan_context}

Generate a structured SOAP note in the following JSON format. Each field should be a string with clinical content:

{{
  "subjective": "Client's self-reported experience since last session. Include:\n- Mood and symptom changes (better/worse/same)\n- Significant life events or stressors\n- Response to previous interventions/homework\n- Sleep, appetite, energy level changes if mentioned\n- Client's own words/quotes for key statements (use quotation marks)\n- Medication adherence and side effects if applicable",
  "objective": "Clinician's observations during the session. Include:\n- Appearance, grooming, eye contact\n- Affect and mood presentation (congruent/incongruent)\n- Speech (rate, volume, coherence)\n- Behavior and engagement level\n- Psychomotor activity\n- Cognitive functioning observations\n- Therapeutic interventions used this session (e.g., CBT thought records, exposure work, mindfulness exercises, psychoeducation topics)\n- Treatment plan goal progress (reference specific goals if treatment plan is available)",
  "assessment": "Clinical interpretation and formulation. Include:\n- Current diagnostic status and any changes\n- Response to treatment (improving/stable/declining)\n- Progress toward treatment goals\n- Risk assessment update (SI/HI/SH — if discussed, or 'Denied current SI/HI')\n- Functional status changes\n- Clinical conceptualization of current presentation",
  "plan": "Next steps for treatment. Include:\n- Next session date and focus areas\n- Between-session assignments/homework\n- Medication changes if discussed (note: recommended by prescriber, not therapist)\n- Referrals if indicated\n- Safety plan updates if applicable\n- Treatment plan modifications if warranted\n- Coordination of care notes"
}}

Return ONLY the JSON object, no additional text or markdown code fences."""

DAP_PROMPT = """Generate a DAP progress note from this therapy session transcript.

This is for CPT code {cpt_code} ({cpt_description}).

TRANSCRIPT:
{transcript}

APPOINTMENT METADATA:
- Appointment Type: {appointment_type}
- Session Date: {session_date}
- Session Duration: {duration_display}
- Client Name: {client_name}

{treatment_plan_context}

Generate a structured DAP note in the following JSON format. Each field should be a string with clinical content:

{{
  "data": "Observable and reported information from the session. Include:\n- Client's reported symptoms, mood, and experiences since last session\n- Significant events, stressors, or changes discussed\n- Key client statements (in quotation marks)\n- Clinician observations: appearance, affect, behavior, engagement\n- Therapeutic interventions used (techniques, exercises, psychoeducation)\n- Topics and themes explored during the session\n- Homework/assignment review from previous session",
  "assessment": "Clinical assessment and interpretation. Include:\n- Current diagnostic status\n- Response to treatment interventions\n- Progress toward treatment plan goals (reference specific goals if available)\n- Risk assessment (SI/HI/SH status)\n- Functional changes (work, relationships, daily activities)\n- Clinical formulation of current presentation\n- Barriers to progress if identified",
  "plan": "Treatment plan and next steps. Include:\n- Next session date, time, and planned focus\n- Between-session assignments or homework\n- Treatment plan goal updates or modifications\n- Referrals or coordination of care\n- Medication-related notes if applicable (e.g., 'Recommended client discuss with prescriber')\n- Safety planning if warranted\n- Anticipated treatment direction"
}}

Return ONLY the JSON object, no additional text or markdown code fences."""


# ---------------------------------------------------------------------------
# Note Generation Functions
# ---------------------------------------------------------------------------

CPT_MAP = {
    "assessment": ("90791", "Psychiatric Diagnostic Evaluation"),
    "individual": ("90834", "Individual Psychotherapy, 45 min"),
    "individual_extended": ("90837", "Individual Psychotherapy, 60 min"),
}


def _format_duration(duration_sec: int | None) -> str:
    """Format duration in seconds to human-readable string."""
    if not duration_sec:
        return "Not recorded"
    minutes = duration_sec // 60
    if minutes < 60:
        return f"{minutes} minutes"
    hours = minutes // 60
    remaining = minutes % 60
    if remaining:
        return f"{hours}h {remaining}m"
    return f"{hours} hour{'s' if hours > 1 else ''}"


def _build_treatment_plan_context(treatment_plan: dict | None) -> str:
    """Build treatment plan context string for prompt injection."""
    if not treatment_plan:
        return "TREATMENT PLAN: No active treatment plan on file."

    parts = ["ACTIVE TREATMENT PLAN:"]

    diagnoses = treatment_plan.get("diagnoses")
    if diagnoses:
        parts.append("Diagnoses:")
        for dx in diagnoses:
            code = dx.get("code", "")
            desc = dx.get("description", "")
            parts.append(f"  - {code}: {desc}")

    goals = treatment_plan.get("goals")
    if goals:
        parts.append("Treatment Goals:")
        for i, goal in enumerate(goals, 1):
            desc = goal.get("description", "")
            parts.append(f"  Goal {i}: {desc}")
            objectives = goal.get("objectives", [])
            for j, obj in enumerate(objectives, 1):
                obj_desc = obj.get("description", "") if isinstance(obj, dict) else str(obj)
                parts.append(f"    Objective {i}.{j}: {obj_desc}")

    presenting = treatment_plan.get("presenting_problems")
    if presenting:
        parts.append(f"Presenting Problems: {presenting}")

    return "\n".join(parts)


async def generate_note(
    transcript: str,
    appointment_type: str,
    note_format: str | None = None,
    client_name: str = "the client",
    session_date: str = "",
    duration_sec: int | None = None,
    treatment_plan: dict | None = None,
) -> dict:
    """Generate a clinical note from a session transcript using Gemini.

    Args:
        transcript: Full session transcript with speaker labels.
        appointment_type: 'assessment', 'individual', or 'individual_extended'.
        note_format: 'SOAP', 'DAP', or None (auto-select based on appointment type).
        client_name: Client's first name or "the client" for the prompt.
        session_date: ISO date string for the session.
        duration_sec: Session duration in seconds.
        treatment_plan: Active treatment plan dict (diagnoses, goals, etc.).

    Returns:
        Dict with:
            - format: 'SOAP', 'DAP', or 'narrative' (biopsychosocial)
            - content: Parsed JSON content of the note
            - raw_text: Raw text response from Gemini (for debugging)
    """
    client = _get_client()

    # Determine format and prompt
    cpt_code, cpt_description = CPT_MAP.get(appointment_type, ("90834", "Individual Psychotherapy"))
    duration_display = _format_duration(duration_sec)
    treatment_plan_context = _build_treatment_plan_context(treatment_plan)

    if appointment_type == "assessment":
        # Intake assessment → biopsychosocial
        chosen_format = "narrative"
        prompt = BIOPSYCHOSOCIAL_PROMPT.format(
            transcript=transcript,
            appointment_type=appointment_type,
            session_date=session_date or "Not recorded",
            duration_display=duration_display,
            client_name=client_name,
            treatment_plan_context=treatment_plan_context,
        )
    elif note_format == "DAP":
        chosen_format = "DAP"
        prompt = DAP_PROMPT.format(
            transcript=transcript,
            appointment_type=appointment_type,
            cpt_code=cpt_code,
            cpt_description=cpt_description,
            session_date=session_date or "Not recorded",
            duration_display=duration_display,
            client_name=client_name,
            treatment_plan_context=treatment_plan_context,
        )
    else:
        # Default to SOAP for progress notes
        chosen_format = "SOAP"
        prompt = SOAP_PROMPT.format(
            transcript=transcript,
            appointment_type=appointment_type,
            cpt_code=cpt_code,
            cpt_description=cpt_description,
            session_date=session_date or "Not recorded",
            duration_display=duration_display,
            client_name=client_name,
            treatment_plan_context=treatment_plan_context,
        )

    logger.info(
        "Generating %s note for %s appointment (transcript length: %d chars)",
        chosen_format, appointment_type, len(transcript),
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
        logger.info("Note generation complete (%d chars response)", len(raw_text))

        # Parse JSON response
        try:
            content = json.loads(raw_text)
        except json.JSONDecodeError:
            # Try to extract JSON from response if wrapped in markdown
            import re
            json_match = re.search(r'\{[\s\S]*\}', raw_text)
            if json_match:
                content = json.loads(json_match.group())
            else:
                logger.error("Failed to parse note generation response as JSON")
                content = {"raw_content": raw_text}

        return {
            "format": chosen_format,
            "content": content,
            "raw_text": raw_text,
        }

    except Exception as e:
        logger.error("Note generation failed: %s: %s", type(e).__name__, e)
        raise


DICTATION_TO_SOAP_PROMPT = """You are converting a clinician's freeform dictation into a structured SOAP progress note.

The clinician has dictated their session notes informally. Your job is to organize this information
into the proper SOAP format while preserving all clinical details. Do NOT fabricate information
that is not present in the dictation.

This is for CPT code {cpt_code} ({cpt_description}).

CLINICIAN'S DICTATION:
{dictation}

SESSION METADATA:
- Session Date: {session_date}
- Session Duration: {duration_display}
- Client Name: {client_name}

{treatment_plan_context}

Generate a structured SOAP note in the following JSON format:

{{
  "subjective": "Client's self-reported experience. Extract any client statements, mood reports, symptom changes, life events, stressors, sleep/appetite changes, and medication adherence from the dictation.",
  "objective": "Clinician observations. Extract appearance, affect, behavior, engagement, speech patterns, psychomotor activity, interventions used, and treatment plan progress from the dictation.",
  "assessment": "Clinical interpretation. Extract diagnostic status, treatment response, progress toward goals, risk assessment, and clinical formulation from the dictation.",
  "plan": "Next steps. Extract planned next session focus, homework assignments, referrals, safety planning, and treatment modifications from the dictation."
}}

Return ONLY the JSON object, no additional text or markdown code fences."""

DICTATION_TO_DAP_PROMPT = """You are converting a clinician's freeform dictation into a structured DAP progress note.

The clinician has dictated their session notes informally. Your job is to organize this information
into the proper DAP format while preserving all clinical details. Do NOT fabricate information
that is not present in the dictation.

This is for CPT code {cpt_code} ({cpt_description}).

CLINICIAN'S DICTATION:
{dictation}

SESSION METADATA:
- Session Date: {session_date}
- Session Duration: {duration_display}
- Client Name: {client_name}

{treatment_plan_context}

Generate a structured DAP note in the following JSON format:

{{
  "data": "Observable and reported information. Extract client statements, symptoms, clinician observations, interventions used, topics discussed, and homework review from the dictation.",
  "assessment": "Clinical assessment. Extract diagnostic status, treatment response, progress toward goals, risk assessment, functional changes, and clinical formulation from the dictation.",
  "plan": "Treatment plan and next steps. Extract next session plans, homework, referrals, coordination of care, and treatment modifications from the dictation."
}}

Return ONLY the JSON object, no additional text or markdown code fences."""

DICTATION_TO_NARRATIVE_PROMPT = """You are converting a clinician's freeform dictation into a structured Biopsychosocial Assessment.

The clinician has dictated their intake assessment notes informally. Your job is to organize this
information into the proper biopsychosocial format while preserving all clinical details.
Do NOT fabricate information that is not present in the dictation. For sections where no information
was provided in the dictation, write "Not assessed" or "Not discussed."

This is for CPT code 90791 (Psychiatric Diagnostic Evaluation).

CLINICIAN'S DICTATION:
{dictation}

SESSION METADATA:
- Session Date: {session_date}
- Session Duration: {duration_display}
- Client Name: {client_name}

{treatment_plan_context}

Generate a structured biopsychosocial assessment in the following JSON format:

{{
  "identifying_information": "Age, gender identity, referral source, presenting context.",
  "presenting_problem": "Chief complaint, reason for seeking treatment, onset, duration, severity.",
  "history_of_present_illness": "Chronological narrative of current symptoms, precipitating factors.",
  "psychiatric_history": "Past diagnoses, hospitalizations, medication trials, previous therapy.",
  "substance_use_history": "Current and past substance use or denial of use.",
  "medical_history": "Current medical conditions, medications, allergies, sleep, appetite.",
  "family_history": "Family psychiatric and substance use history, family structure.",
  "social_developmental_history": "Education, employment, relationships, trauma history.",
  "mental_status_examination": "Appearance, behavior, speech, mood, affect, thought process, cognition.",
  "diagnostic_impressions": "Provisional DSM-5 diagnoses with ICD-10-CM codes.",
  "risk_assessment": "SI/HI, self-harm, protective factors, risk level.",
  "treatment_recommendations": "Recommended frequency, modality, therapeutic approach, referrals.",
  "clinical_summary": "2-3 sentence integrative summary."
}}

Return ONLY the JSON object, no additional text or markdown code fences."""


async def generate_note_from_dictation(
    dictation: str,
    note_format: str = "SOAP",
    client_name: str = "the client",
    session_date: str = "",
    duration_sec: int | None = None,
    treatment_plan: dict | None = None,
) -> dict:
    """Generate a structured clinical note from freeform clinician dictation.

    Takes informal dictation text and uses Gemini to organize it into
    the appropriate clinical note format (SOAP, DAP, or narrative).
    """
    client = _get_client()
    duration_display = _format_duration(duration_sec)
    treatment_plan_context = _build_treatment_plan_context(treatment_plan)

    if note_format == "narrative":
        chosen_format = "narrative"
        prompt = DICTATION_TO_NARRATIVE_PROMPT.format(
            dictation=dictation,
            session_date=session_date or "Not recorded",
            duration_display=duration_display,
            client_name=client_name,
            treatment_plan_context=treatment_plan_context,
        )
    elif note_format == "DAP":
        chosen_format = "DAP"
        cpt_code, cpt_description = CPT_MAP.get("individual", ("90834", "Individual Psychotherapy"))
        prompt = DICTATION_TO_DAP_PROMPT.format(
            dictation=dictation,
            cpt_code=cpt_code,
            cpt_description=cpt_description,
            session_date=session_date or "Not recorded",
            duration_display=duration_display,
            client_name=client_name,
            treatment_plan_context=treatment_plan_context,
        )
    else:
        chosen_format = "SOAP"
        cpt_code, cpt_description = CPT_MAP.get("individual", ("90834", "Individual Psychotherapy"))
        prompt = DICTATION_TO_SOAP_PROMPT.format(
            dictation=dictation,
            cpt_code=cpt_code,
            cpt_description=cpt_description,
            session_date=session_date or "Not recorded",
            duration_display=duration_display,
            client_name=client_name,
            treatment_plan_context=treatment_plan_context,
        )

    logger.info(
        "Generating %s note from dictation (%d chars)",
        chosen_format, len(dictation),
    )

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
    logger.info("Dictation note generation complete (%d chars response)", len(raw_text))

    try:
        content = json.loads(raw_text)
    except json.JSONDecodeError:
        import re
        json_match = re.search(r'\{[\s\S]*\}', raw_text)
        if json_match:
            content = json.loads(json_match.group())
        else:
            logger.error("Failed to parse dictation note response as JSON")
            content = {"raw_content": raw_text}

    return {
        "format": chosen_format,
        "content": content,
        "raw_text": raw_text,
    }


async def regenerate_note(
    transcript: str,
    appointment_type: str,
    note_format: str,
    client_name: str = "the client",
    session_date: str = "",
    duration_sec: int | None = None,
    treatment_plan: dict | None = None,
    feedback: str | None = None,
) -> dict:
    """Regenerate a clinical note, optionally with clinician feedback.

    Same as generate_note but can incorporate clinician feedback for
    a better regeneration.
    """
    if feedback:
        # Append feedback instruction to transcript
        transcript_with_feedback = (
            f"{transcript}\n\n"
            f"---\nCLINICIAN FEEDBACK ON PREVIOUS DRAFT:\n{feedback}\n"
            f"Please incorporate this feedback into the regenerated note."
        )
    else:
        transcript_with_feedback = transcript

    return await generate_note(
        transcript=transcript_with_feedback,
        appointment_type=appointment_type,
        note_format=note_format,
        client_name=client_name,
        session_date=session_date,
        duration_sec=duration_sec,
        treatment_plan=treatment_plan,
    )
