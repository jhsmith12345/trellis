"""AI treatment plan generation using Gemini 2.5 Flash.

Generates structured treatment plans from intake assessment notes,
encounter transcripts, and clinical data. Supports both initial
generation (after intake) and updates (incorporating new sessions).

Output structure:
  - DSM-5 diagnoses with ICD-10 codes (JSONB list)
  - Treatment goals with measurable objectives (JSONB list)
  - Presenting problems summary (text)
  - Review schedule recommendation (date)
"""
import json
import logging
import os
from datetime import datetime, timedelta

from google import genai
from google.genai.types import GenerateContentConfig

logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = os.getenv("GEMINI_NOTE_MODEL", "gemini-2.5-flash-preview-05-20")
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
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_INSTRUCTION = """You are a clinical documentation assistant for a licensed behavioral health therapist.
Your role is to generate evidence-based treatment plans from clinical data.

CRITICAL GUIDELINES:
- Base all diagnoses on information explicitly discussed or assessed in the clinical data.
- Use only DSM-5 diagnoses with accurate ICD-10-CM codes.
- Treatment goals must be SMART: Specific, Measurable, Achievable, Relevant, Time-bound.
- Each goal must have at least 2-3 measurable objectives.
- Interventions should reference evidence-based therapeutic modalities (CBT, DBT, MI, etc.).
- Use person-first language (e.g., "client with depression" not "depressed client").
- Do NOT fabricate clinical details not supported by the provided data.
- When information is insufficient for a diagnosis, use provisional or rule-out qualifiers.
- All output must be valid JSON matching the specified structure.
- Do NOT include the client's full name in the content — use "the client" or first name only.
"""

INITIAL_TREATMENT_PLAN_PROMPT = """Generate a comprehensive treatment plan based on the following intake assessment.

INTAKE ASSESSMENT NOTE:
{assessment_content}

INTAKE ENCOUNTER TRANSCRIPT:
{transcript}

CLIENT INFORMATION:
- Client Name (first only): {client_name}
- Date of Assessment: {assessment_date}

Generate a structured treatment plan in the following JSON format:

{{
  "diagnoses": [
    {{
      "code": "ICD-10-CM code (e.g., F33.1)",
      "description": "Full DSM-5 diagnosis name (e.g., Major Depressive Disorder, Recurrent, Moderate)",
      "rank": 1,
      "type": "primary"
    }}
  ],
  "goals": [
    {{
      "id": "goal_1",
      "description": "Clear, specific treatment goal statement",
      "target_date": "YYYY-MM-DD (typically 3-6 months from assessment)",
      "status": "active",
      "objectives": [
        {{
          "id": "obj_1_1",
          "description": "Specific, measurable objective with quantifiable criteria (e.g., 'Client will reduce PHQ-9 score from X to below 10 within 3 months')",
          "status": "active"
        }}
      ],
      "interventions": [
        "Specific evidence-based intervention (e.g., 'Cognitive restructuring using CBT thought records to identify and challenge negative automatic thoughts')"
      ]
    }}
  ],
  "presenting_problems": "Concise summary of presenting problems and clinical formulation. Include symptom severity, functional impairment, and relevant psychosocial factors.",
  "recommended_frequency": "Recommended session frequency (e.g., 'Weekly individual therapy (90834) for initial 8-12 weeks, then biweekly as symptoms improve')",
  "review_period_days": 90
}}

IMPORTANT:
- Include 1-3 diagnoses (primary + any comorbid). Use Z-codes for relevant psychosocial factors.
- Include 2-4 treatment goals, each with 2-3 measurable objectives.
- Goals should address different domains (symptom reduction, skill building, functional improvement, etc.).
- Target dates should be realistic (typically 3-6 months for initial goals).
- Interventions should be specific to the diagnosis and evidence-based.

Return ONLY the JSON object, no additional text or markdown code fences."""

UPDATE_TREATMENT_PLAN_PROMPT = """Update this treatment plan based on new clinical data from recent sessions.

CURRENT TREATMENT PLAN:
Diagnoses: {current_diagnoses}
Goals: {current_goals}
Presenting Problems: {current_presenting_problems}

RECENT CLINICAL NOTES (since last plan update):
{recent_notes}

RECENT ENCOUNTER TRANSCRIPTS (since last plan update):
{recent_transcripts}

CLIENT INFORMATION:
- Client Name (first only): {client_name}
- Original Plan Date: {original_plan_date}
- Sessions Since Last Update: {session_count}

Generate an UPDATED treatment plan incorporating progress, setbacks, and new clinical information from recent sessions. The updated plan should:

1. Retain diagnoses that are still relevant; add new ones if warranted by new data; mark resolved ones.
2. Update goal statuses based on progress (active/met/modified/deferred).
3. Modify objectives that need updating based on progress.
4. Add new goals if new treatment targets have emerged.
5. Update interventions if the therapeutic approach has evolved.
6. Update presenting problems to reflect current clinical picture.

Use the same JSON format:

{{
  "diagnoses": [
    {{
      "code": "ICD-10-CM code",
      "description": "Full DSM-5 diagnosis name",
      "rank": 1,
      "type": "primary or secondary or provisional"
    }}
  ],
  "goals": [
    {{
      "id": "goal_1",
      "description": "Goal statement (updated if modified)",
      "target_date": "YYYY-MM-DD",
      "status": "active or met or modified or deferred",
      "objectives": [
        {{
          "id": "obj_1_1",
          "description": "Measurable objective (updated with current progress data if available)",
          "status": "active or met or modified"
        }}
      ],
      "interventions": [
        "Specific evidence-based intervention"
      ]
    }}
  ],
  "presenting_problems": "Updated summary reflecting current clinical picture and progress since last plan.",
  "recommended_frequency": "Updated session frequency recommendation based on progress",
  "review_period_days": 90
}}

Return ONLY the JSON object, no additional text or markdown code fences."""


# ---------------------------------------------------------------------------
# Generation Functions
# ---------------------------------------------------------------------------

async def generate_treatment_plan(
    assessment_content: dict | str,
    transcript: str = "",
    client_name: str = "the client",
    assessment_date: str = "",
) -> dict:
    """Generate an initial treatment plan from an intake assessment.

    Args:
        assessment_content: The intake assessment note content (dict of sections or string).
        transcript: The intake encounter transcript.
        client_name: Client's first name or "the client".
        assessment_date: ISO date string of the assessment.

    Returns:
        Dict with diagnoses, goals, presenting_problems, review_period_days.
    """
    client = _get_client()

    # Format assessment content
    if isinstance(assessment_content, dict):
        assessment_str = "\n\n".join(
            f"**{k.replace('_', ' ').title()}:**\n{v}"
            for k, v in assessment_content.items()
            if v
        )
    else:
        assessment_str = str(assessment_content)

    prompt = INITIAL_TREATMENT_PLAN_PROMPT.format(
        assessment_content=assessment_str,
        transcript=transcript[:50000] if transcript else "Not available",
        client_name=client_name,
        assessment_date=assessment_date or "Not recorded",
    )

    logger.info(
        "Generating initial treatment plan (assessment length: %d chars, transcript: %d chars)",
        len(assessment_str), len(transcript) if transcript else 0,
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
        logger.info("Treatment plan generation complete (%d chars response)", len(raw_text))

        content = _parse_json_response(raw_text)
        return _normalize_plan(content)

    except Exception as e:
        logger.error("Treatment plan generation failed: %s: %s", type(e).__name__, e)
        raise


async def update_treatment_plan(
    current_plan: dict,
    recent_notes: list[dict],
    recent_transcripts: list[dict],
    client_name: str = "the client",
    original_plan_date: str = "",
) -> dict:
    """Update/regenerate a treatment plan based on new clinical data.

    Args:
        current_plan: The current active treatment plan dict.
        recent_notes: List of clinical note dicts since last plan.
        recent_transcripts: List of encounter transcript dicts since last plan.
        client_name: Client's first name.
        original_plan_date: Date of the original/current plan.

    Returns:
        Dict with updated diagnoses, goals, presenting_problems, review_period_days.
    """
    client = _get_client()

    # Format current plan data
    current_diagnoses = json.dumps(current_plan.get("diagnoses", []), indent=2)
    current_goals = json.dumps(current_plan.get("goals", []), indent=2)
    current_presenting = current_plan.get("presenting_problems", "Not documented")

    # Format recent notes
    notes_text = ""
    for note in recent_notes:
        note_content = note.get("content", {})
        if isinstance(note_content, str):
            try:
                note_content = json.loads(note_content)
            except (json.JSONDecodeError, TypeError):
                pass
        if isinstance(note_content, dict):
            sections = "\n".join(
                f"  {k}: {v}" for k, v in note_content.items() if v
            )
        else:
            sections = str(note_content)
        notes_text += f"\n--- Note ({note.get('format', 'unknown')}) - {note.get('created_at', '')} ---\n{sections}\n"

    if not notes_text:
        notes_text = "No new clinical notes since last plan update."

    # Format recent transcripts
    transcripts_text = ""
    for enc in recent_transcripts:
        t = enc.get("transcript", "")
        if t:
            # Truncate individual transcripts to keep within token limits
            t_truncated = t[:10000] + ("..." if len(t) > 10000 else "")
            transcripts_text += f"\n--- Encounter ({enc.get('type', 'unknown')}) - {enc.get('created_at', '')} ---\n{t_truncated}\n"

    if not transcripts_text:
        transcripts_text = "No new encounter transcripts since last plan update."

    prompt = UPDATE_TREATMENT_PLAN_PROMPT.format(
        current_diagnoses=current_diagnoses,
        current_goals=current_goals,
        current_presenting_problems=current_presenting,
        recent_notes=notes_text[:30000],
        recent_transcripts=transcripts_text[:30000],
        client_name=client_name,
        original_plan_date=original_plan_date or "Unknown",
        session_count=len(recent_notes),
    )

    logger.info(
        "Updating treatment plan (notes: %d, transcripts: %d)",
        len(recent_notes), len(recent_transcripts),
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
        logger.info("Treatment plan update complete (%d chars response)", len(raw_text))

        content = _parse_json_response(raw_text)
        return _normalize_plan(content)

    except Exception as e:
        logger.error("Treatment plan update failed: %s: %s", type(e).__name__, e)
        raise


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_json_response(raw_text: str) -> dict:
    """Parse JSON from Gemini response, handling markdown fences."""
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        import re
        json_match = re.search(r'\{[\s\S]*\}', raw_text)
        if json_match:
            return json.loads(json_match.group())
        logger.error("Failed to parse treatment plan response as JSON")
        return {"raw_content": raw_text}


def _normalize_plan(content: dict) -> dict:
    """Normalize the generated plan to ensure consistent structure."""
    # Ensure diagnoses have required fields
    diagnoses = content.get("diagnoses", [])
    for i, dx in enumerate(diagnoses):
        dx.setdefault("code", "")
        dx.setdefault("description", "")
        dx.setdefault("rank", i + 1)
        dx.setdefault("type", "primary" if i == 0 else "secondary")

    # Ensure goals have required fields
    goals = content.get("goals", [])
    for i, goal in enumerate(goals):
        goal.setdefault("id", f"goal_{i + 1}")
        goal.setdefault("description", "")
        goal.setdefault("target_date", "")
        goal.setdefault("status", "active")
        goal.setdefault("objectives", [])
        goal.setdefault("interventions", [])
        for j, obj in enumerate(goal["objectives"]):
            if isinstance(obj, str):
                goal["objectives"][j] = {
                    "id": f"obj_{i + 1}_{j + 1}",
                    "description": obj,
                    "status": "active",
                }
            else:
                obj.setdefault("id", f"obj_{i + 1}_{j + 1}")
                obj.setdefault("description", "")
                obj.setdefault("status", "active")

    # Compute review date
    review_period = content.get("review_period_days", 90)
    review_date = (datetime.now() + timedelta(days=review_period)).strftime("%Y-%m-%d")

    return {
        "diagnoses": diagnoses,
        "goals": goals,
        "presenting_problems": content.get("presenting_problems", ""),
        "recommended_frequency": content.get("recommended_frequency", ""),
        "review_date": review_date,
    }
