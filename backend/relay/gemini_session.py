"""Gemini Real-Time Live session management using google-genai SDK.

Handles voice intake sessions only. Note/record session types have been
removed — they will be re-added when clinician workflows are built.

Includes tool calling for:
- end_interview: end the intake conversation
- get_available_slots: fetch available appointment slots from the scheduling API
- book_appointment: book an intake assessment appointment
"""
import asyncio
import json
import logging
import time

from google import genai
from google.genai import types

from config import GEMINI_MODEL, PROJECT_ID, REGION

EXTRACTION_MODEL = "gemini-2.5-flash"

logger = logging.getLogger(__name__)

INTAKE_SYSTEM_PROMPT = """You are a warm, professional clinical intake specialist named Trellis. You are conducting a voice-based
intake interview for a new therapy/counseling client. Your job is to gather the following
information through natural conversation — do not read from a list, make it conversational:

1. First, introduce yourself and ask their name and preferred pronouns
2. Date of birth
3. Emergency contact (name, phone, relationship)
4. What brings them in today (presenting concerns)
5. Prior therapy experience
6. Current medications
7. Relevant medical conditions
8. Goals for therapy
9. Their insurance provider (or if they prefer to self-pay)

Be warm, empathetic, and patient. Start by warmly greeting them and asking their name.
If someone seems uncomfortable with a question, acknowledge that and offer to skip it.
Confirm information back to them.

Do NOT output any JSON. Just have a natural conversation.

IMPORTANT: Do NOT end the interview prematurely. After gathering all clinical information,
you should address insurance and scheduling. Once you have confirmed their insurance status
and offered to schedule their first appointment, and the client has either booked or declined,
THEN ask if there is anything else they'd like to share. Only after the user confirms they are
done should you thank them warmly, let them know their clinician will follow up soon, and call
the end_interview tool. Never call end_interview without this explicit confirmation from the user."""

IOP_INTAKE_SYSTEM_PROMPT = """You are a warm, compassionate admissions specialist named Trellis working for a substance \
abuse and behavioral health treatment center. You are conducting a voice-based pre-assessment \
conversation with someone seeking IOP (Intensive Outpatient) or PHP (Partial Hospitalization) \
treatment.

Your goal is to have a genuine, supportive conversation that gathers clinical information \
while making the person feel heard and understood. This is often a vulnerable moment — many \
people calling are in crisis, court-ordered, or taking a difficult first step. Meet them \
with warmth, patience, and zero judgment.

CONVERSATION APPROACH:
- Be conversational, not clinical. You're talking WITH them, not AT them.
- Let them talk. If they want to share their story, let them. Don't rush to the next question.
- Reflect back what you hear: "It sounds like alcohol has been the biggest challenge..."
- Normalize their experience: "A lot of people we work with have a similar story."
- If they seem uncomfortable, acknowledge it: "I know these questions can be tough. We can \
come back to that if you'd like."
- Use natural transitions between topics, not abrupt pivots.

INFORMATION TO GATHER (through natural conversation, not as a checklist):

1. SUBSTANCE USE HISTORY (spend the most time here — this is the heart of the conversation):
   - What substance(s) they use (be specific: alcohol, opioids, methamphetamine, etc.)
   - For each substance: age of first use, current frequency, typical dose/amount, \
route of administration (oral, IV, smoking, etc.), date of last use
   - What led them to seek treatment right now
   - Process addictions if any (gambling, sex/porn, gaming)

2. PRIOR TREATMENT HISTORY (important for insurance — probe for specifics):
   - Have they been in recovery or treatment before?
   - If yes: What type? (detox, residential, PHP, IOP, outpatient)
   - How long was each stay? (number of days matters for insurance calculations)
   - Was it at a hospital/medical facility or a behavioral health center?
   - When was this treatment? (this calendar year is especially important)
   - Are they currently in any treatment program?

3. MENTAL HEALTH:
   - Current or past mental health treatment (therapy, psychiatry)
   - Any psychiatric diagnoses (depression, anxiety, PTSD, bipolar, ADD, etc.)
   - History of trauma (don't push — just ask if they're comfortable sharing)
   - Disordered eating history

4. MEDICAL HISTORY:
   - History of withdrawal symptoms (what kind, how severe)
   - Anti-craving medications (Vivitrol, Naltrexone, Campral, Antabuse) — current or past
   - Currently on Suboxone or Methadone maintenance
   - Other medical conditions
   - Recent hospitalizations (past 30 days)
   - Physical limitations
   - Allergies (medication, food, environmental)
   - Current medications (get names if they know them)

5. RISK SCREENING (handle with clinical sensitivity):
   - In the past month, have they wished they were dead or wished they could go to sleep \
and not wake up?
   - In the past month, have they had any thoughts of killing themselves?
   - Have they ever done anything or prepared to do anything to end their life?
   - History of self-harm behaviors
   - Anger issues
   For any "yes" answers: acknowledge with care, note it, and reassure them that sharing \
this helps us provide better support. Do NOT minimize or skip over these.

6. LEGAL SITUATION:
   - Currently on probation
   - Active warrants
   - Sex offender status (mention that a search may be run during the application process)
   - Other legal issues
   - Participation in specialty courts (Drug Court, Family Court, Veterans Court)

7. EMPLOYMENT & PRACTICAL:
   - Current employment status and recent history
   - Interest in help with tax filing (for insurance subsidies)

8. GOALS AND MOTIVATION:
   - What does recovery look like for them?
   - What are they hoping to get from treatment?
   - What's motivating them right now?

IMPORTANT GUIDELINES:
- Do NOT output any JSON. Just have a natural conversation.
- Do NOT re-ask information you already have from their form data (name, DOB, address, \
contacts, insurance — these are injected below if available).
- Prior treatment details are CRITICAL for insurance calculations. Gently probe for \
specifics: "Do you remember roughly how many days you were in detox?" and "Was that at \
a hospital or more of a treatment center?"
- The more clinical detail you gather, the stronger the case for insurance pre-authorization. \
Elicit severity, frequency, failed prior attempts, co-occurring conditions, and functional \
impairment naturally through conversation.
- This conversation typically runs 15-25 minutes. Don't rush it.

ENDING THE CONVERSATION:
After you've covered all major areas, ask: "Is there anything else you'd like us to know \
about you or your situation?" Only after they confirm they're finished should you thank them \
warmly, let them know the admissions team will review everything and be in touch soon, and \
call the end_interview tool. Never call end_interview without explicit confirmation."""

INSURANCE_PROMPT_TEMPLATE = """

--- Practice Insurance & Rates ---
This practice accepts the following insurance plans: {accepted_insurances}

If the client's insurance is on this list, let them know the good news that their insurance is accepted.

If the client's insurance is NOT on this list, empathetically let them know that unfortunately their
specific plan is not currently accepted, but offer the following self-pay options:
- Intake assessment session rate: ${intake_rate}/session
- Ongoing session rate: ${session_rate}/session{sliding_scale_info}

Be sensitive when discussing finances. If they seem concerned about cost, mention the sliding scale
option if available, and reassure them that many clients use out-of-network benefits for partial
reimbursement.
"""

SCHEDULING_PROMPT_TEMPLATE = """

--- Scheduling ---
Practice name: {practice_name}
Clinician: {clinician_name}{credentials}

After gathering clinical information and confirming insurance/payment:
1. Ask if the client would like to schedule their initial intake assessment appointment
2. If yes, use the get_available_slots tool to find available times
3. Present 3-5 options conversationally (e.g., "I have openings on Tuesday at 10am, Wednesday at 2pm...")
4. When they pick a slot, confirm the date/time and use the book_appointment tool
5. After booking, let them know they'll receive a confirmation email with the appointment details
   and a video meeting link

The intake assessment is typically a {intake_duration}-minute session (CPT code 90791).
"""

INTAKE_CONTEXT_SUFFIX = """

You have prior context about this client from previous sessions. Use it to:
- Greet them by name if known
- Skip questions that were already answered
- Follow up on anything that was mentioned but not fully explored
- Acknowledge their previous visit(s) warmly

Do NOT re-ask information you already have. Focus on gathering anything still missing
and deepening your understanding of their situation."""

CLIENT_INSURANCE_TEMPLATE = """

--- Client's Insurance (already provided) ---
The client has already uploaded their insurance card and provided the following information.
Do NOT ask them about insurance again. Instead, confirm what you have on file and let them
know whether their plan is accepted (based on the practice's accepted plans listed above).

Subscriber name: {subscriber_name}
Insurance company: {payer_name}
Member ID: {member_id}
Group number: {group_number}
Plan name: {plan_name}
Plan type: {plan_type}

If the subscriber name is provided, greet them by that name — do NOT ask for their name again.
If any other fields say "Not provided", you may briefly ask about that specific missing
detail, but do not re-ask about fields that are already filled in."""


EXTRACTION_PROMPT_TEMPLATE = (
    "You are a clinical data extraction assistant. Given the following transcript "
    "of a voice-based intake interview, extract structured data.\n\n"
    'Return ONLY valid JSON with the following structure:\n'
    '{\n'
    '  "demographics": {\n'
    '    "preferredName": "string or null",\n'
    '    "pronouns": "string or null",\n'
    '    "dateOfBirth": "string (YYYY-MM-DD) or null",\n'
    '    "emergencyContact": {\n'
    '      "name": "string or null",\n'
    '      "phone": "string or null",\n'
    '      "relationship": "string or null"\n'
    '    }\n'
    '  },\n'
    '  "presentingConcerns": "string or null",\n'
    '  "history": {\n'
    '    "priorTherapy": "boolean or null",\n'
    '    "priorTherapyDetails": "string or null",\n'
    '    "medications": "string or null",\n'
    '    "medicalConditions": "string or null"\n'
    '  },\n'
    '  "goals": "string or null",\n'
    '  "additionalNotes": "string or null"\n'
    '}\n\n'
    "If information was not provided, use null. Do not guess or fabricate.\n\n"
    "TRANSCRIPT:\n"
)

IOP_EXTRACTION_PROMPT_TEMPLATE = (
    "You are a clinical data extraction assistant for a substance abuse treatment center. "
    "Given the following transcript of a voice-based admissions conversation, extract "
    "structured data for the admissions team.\n\n"
    'Return ONLY valid JSON with the following structure:\n'
    '{\n'
    '  "demographics": {\n'
    '    "preferredName": "string or null",\n'
    '    "pronouns": "string or null",\n'
    '    "dateOfBirth": "string (YYYY-MM-DD) or null"\n'
    '  },\n'
    '  "substanceHistory": [\n'
    '    {\n'
    '      "substance": "string",\n'
    '      "ageOfFirstUse": "number or null",\n'
    '      "frequency": "string or null",\n'
    '      "averageDose": "string or null",\n'
    '      "routeOfAdministration": "string or null",\n'
    '      "lastUse": "string (YYYY-MM-DD) or null"\n'
    '    }\n'
    '  ],\n'
    '  "processAddictions": ["string"],\n'
    '  "whatLedToTreatment": "string or null",\n'
    '  "priorTreatment": {\n'
    '    "hasBeenInRecovery": "boolean or null",\n'
    '    "currentlyInTreatment": "boolean or null",\n'
    '    "history": [\n'
    '      {\n'
    '        "type": "detox | residential | php | iop | outpatient",\n'
    '        "facilityType": "medical | behavioral_health | null",\n'
    '        "durationDays": "number or null",\n'
    '        "approximateDate": "string or null",\n'
    '        "thisCalendarYear": "boolean or null"\n'
    '      }\n'
    '    ]\n'
    '  },\n'
    '  "mentalHealth": {\n'
    '    "currentlyInTreatment": "boolean or null",\n'
    '    "priorTreatment": "boolean or null",\n'
    '    "diagnoses": "string or null",\n'
    '    "traumaHistory": "boolean or null",\n'
    '    "disorderedEating": "boolean or null"\n'
    '  },\n'
    '  "medicalHistory": {\n'
    '    "withdrawalSymptoms": "boolean or null",\n'
    '    "withdrawalDetails": "string or null",\n'
    '    "antiCravingMeds": "string or null",\n'
    '    "suboxoneMethadone": "none | suboxone | methadone | null",\n'
    '    "medicalConditions": "string or null",\n'
    '    "recentHospitalization": "boolean or null",\n'
    '    "physicalLimitations": "string or null",\n'
    '    "allergies": "string or null",\n'
    '    "currentMedications": "string or null"\n'
    '  },\n'
    '  "riskScreening": {\n'
    '    "passiveDeathWish": "boolean or null",\n'
    '    "activeSuicidalIdeation": "boolean or null",\n'
    '    "priorSuicideAttempt": "boolean or null",\n'
    '    "selfHarmHistory": "boolean or null",\n'
    '    "angerIssues": "boolean or null"\n'
    '  },\n'
    '  "legal": {\n'
    '    "onProbation": "boolean or null",\n'
    '    "activeWarrants": "boolean or null",\n'
    '    "sexOffender": "boolean or null",\n'
    '    "specialtyCourt": "string or null",\n'
    '    "otherLegalIssues": "string or null"\n'
    '  },\n'
    '  "employment": {\n'
    '    "status": "string or null",\n'
    '    "details": "string or null"\n'
    '  },\n'
    '  "goals": "string or null",\n'
    '  "additionalNotes": "string or null",\n'
    '  "faInputs": {\n'
    '    "priorDetoxDays": "number or null",\n'
    '    "priorDetoxType": "medical | behavioral_health | null",\n'
    '    "priorResidentialDays": "number or null",\n'
    '    "priorResidentialType": "medical | behavioral_health | null",\n'
    '    "priorPhpDays": "number or null",\n'
    '    "priorTreatmentThisYear": "boolean or null"\n'
    '  }\n'
    '}\n\n'
    "If information was not provided, use null. Do not guess or fabricate.\n"
    "For faInputs, only include prior treatment that occurred this calendar year.\n\n"
    "TRANSCRIPT:\n"
)


def extract_intake_data(transcript: str) -> dict | None:
    """Extract structured intake data from transcript using Gemini generateContent via genai SDK."""
    if not transcript.strip():
        logger.warning("Empty transcript, skipping extraction")
        return None

    client = genai.Client(
        vertexai=True, project=PROJECT_ID, location=REGION
    )

    try:
        response = client.models.generate_content(
            model=EXTRACTION_MODEL,
            contents=EXTRACTION_PROMPT_TEMPLATE + transcript,
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
            ),
        )

        text = response.text
        if not text:
            logger.error("Extraction returned empty response")
            return None

        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            logger.error("Extraction returned non-dict type: %s", type(parsed).__name__)
            return None
        return parsed
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        logger.error("Failed to parse extraction result: %s: %s", type(e).__name__, e)
        return None
    except Exception as e:
        logger.error("Extraction API call failed: %s: %s", type(e).__name__, e)
        return None


def validate_intake_data(data: dict) -> list[str]:
    """Validate extracted intake data. Returns list of error messages (empty = valid)."""
    errors = []
    demographics = data.get("demographics") or {}

    if not demographics.get("preferredName"):
        errors.append("Client name is missing")
    if not demographics.get("dateOfBirth"):
        errors.append("Date of birth is missing")

    return errors


# ---------------------------------------------------------------------------
# Token estimation for mid-session compression
# ---------------------------------------------------------------------------

# Audio: ~25 tokens/sec per direction = ~50 tokens/sec total
AUDIO_TOKENS_PER_SEC = 50
# Trigger compression when estimated tokens hit this threshold
COMPRESSION_TRIGGER_TOKENS = 100_000
# Approximate chars per token for transcript text
CHARS_PER_TOKEN = 4


def build_system_prompt(
    prior_context: str,
    practice_profile: dict | None = None,
    client_insurance: dict | None = None,
    client_email: str | None = None,
    intake_mode: str = "standard",
) -> str:
    """Build the full system prompt with optional prior context and practice info.

    Args:
        prior_context: Prior client transcripts/context string
        practice_profile: Practice profile dict from API (includes insurance, rates, etc.)
        client_insurance: Client's insurance data from their profile (e.g. from card upload)
        client_email: Client's email from Firebase auth (already known, no need to ask)
        intake_mode: "standard" for basic therapy intake, "iop" for IOP/PHP admissions
    """
    prompt = IOP_INTAKE_SYSTEM_PROMPT if intake_mode == "iop" else INTAKE_SYSTEM_PROMPT

    if client_email:
        prompt += f"""

--- Client Email (already known) ---
The client's email address is: {client_email}
Do NOT ask for their email address — you already have it from their sign-in.
Use this email when booking appointments."""

    # Inject practice profile info (insurance, rates, scheduling)
    if practice_profile:
        accepted = practice_profile.get("accepted_insurances") or []
        session_rate = practice_profile.get("session_rate")
        intake_rate = practice_profile.get("intake_rate")
        sliding_scale = practice_profile.get("sliding_scale", False)
        sliding_scale_min = practice_profile.get("sliding_scale_min")

        if accepted or session_rate or intake_rate:
            sliding_scale_info = ""
            if sliding_scale and sliding_scale_min is not None:
                sliding_scale_info = f"\n- Sliding scale available (minimum ${sliding_scale_min}/session for those with financial need)"

            insurance_list = ", ".join(accepted) if accepted else "None (self-pay only practice)"

            prompt += INSURANCE_PROMPT_TEMPLATE.format(
                accepted_insurances=insurance_list,
                intake_rate=intake_rate or "N/A",
                session_rate=session_rate or "N/A",
                sliding_scale_info=sliding_scale_info,
            )

        # Scheduling context
        practice_name = practice_profile.get("practice_name", "the practice")
        clinician_name = practice_profile.get("clinician_name", "the clinician")
        credentials = practice_profile.get("credentials", "")
        if credentials:
            credentials = f", {credentials}"
        intake_duration = practice_profile.get("intake_duration", 60)

        prompt += SCHEDULING_PROMPT_TEMPLATE.format(
            practice_name=practice_name,
            clinician_name=clinician_name,
            credentials=credentials,
            intake_duration=intake_duration,
        )

    # Inject client's pre-existing insurance info (e.g. from card upload)
    if client_insurance:
        payer = client_insurance.get("payer_name")
        member = client_insurance.get("member_id")
        # Only inject if there's at least a payer name or member ID
        if payer or member:
            prompt += CLIENT_INSURANCE_TEMPLATE.format(
                subscriber_name=client_insurance.get("subscriber_name") or "Not provided",
                payer_name=payer or "Not provided",
                member_id=member or "Not provided",
                group_number=client_insurance.get("group_number") or "Not provided",
                plan_name=client_insurance.get("plan_name") or "Not provided",
                plan_type=client_insurance.get("plan_type") or "Not provided",
            )

    # Add prior context if available
    if prior_context:
        prompt += INTAKE_CONTEXT_SUFFIX
        prompt += f"\n\n--- Prior Client Context ---\n{prior_context}"

    return prompt


def _build_tools() -> list[types.Tool]:
    """Build the tool declarations for the Gemini Live session."""
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="end_interview",
                    description=(
                        "Call this tool ONLY after you have explicitly asked the user if "
                        "there is anything else they'd like to add or if they are ready to "
                        "finish, AND the user has confirmed they are done. Never call this "
                        "tool without first confirming with the user that they are ready to "
                        "end the conversation."
                    ),
                ),
                types.FunctionDeclaration(
                    name="get_available_slots",
                    description=(
                        "Fetch available appointment slots for the intake assessment. "
                        "Call this when the client wants to schedule their first appointment. "
                        "Returns a list of available time slots over the next two weeks."
                    ),
                    parameters=types.Schema(
                        type="OBJECT",
                        properties={
                            "preferred_date": types.Schema(
                                type="STRING",
                                description=(
                                    "Optional: client's preferred date in YYYY-MM-DD format. "
                                    "If not provided, slots for the next two weeks will be returned."
                                ),
                            ),
                        },
                    ),
                ),
                types.FunctionDeclaration(
                    name="book_appointment",
                    description=(
                        "Book an intake assessment appointment for the client. Call this "
                        "after the client has chosen a specific time slot from the available "
                        "options. You MUST have the client's name and email address before "
                        "calling this tool."
                    ),
                    parameters=types.Schema(
                        type="OBJECT",
                        properties={
                            "scheduled_at": types.Schema(
                                type="STRING",
                                description="The selected appointment time in ISO 8601 format (e.g., 2026-02-25T10:00:00)",
                            ),
                            "client_name": types.Schema(
                                type="STRING",
                                description="The client's full name as provided during the intake",
                            ),
                            "client_email": types.Schema(
                                type="STRING",
                                description="The client's email address for confirmation",
                            ),
                        },
                        required=["scheduled_at", "client_name", "client_email"],
                    ),
                ),
            ]
        )
    ]


async def _handle_tool_call(
    fc_name: str,
    fc_args: dict,
    session_context: dict,
) -> dict:
    """Handle a tool call from Gemini and return the response.

    Args:
        fc_name: Function call name
        fc_args: Function call arguments
        session_context: Dict with session state (client_id, token, practice_profile, etc.)

    Returns:
        Response dict to send back to Gemini.
    """
    from api_client import get_available_slots, book_appointment

    practice_profile = session_context.get("practice_profile") or {}
    clinician_id = session_context.get("clinician_id") or practice_profile.get("clinician_uid", "")
    clinician_email = practice_profile.get("clinician_email") or practice_profile.get("email", "")
    token = session_context.get("token", "")
    client_id = session_context.get("client_id", "")

    if fc_name == "get_available_slots":
        # PHI-safe: log tool name only, not args which may contain client info
        logger.info("Tool call: get_available_slots")

        preferred_date = fc_args.get("preferred_date")
        start_date = None
        end_date = None

        if preferred_date:
            # Search around the preferred date (3 days before to 7 days after)
            from datetime import datetime, timedelta
            try:
                pref = datetime.fromisoformat(preferred_date)
                start_date = (pref - timedelta(days=1)).replace(hour=0, minute=0).isoformat()
                end_date = (pref + timedelta(days=7)).replace(hour=23, minute=59).isoformat()
            except ValueError:
                pass

        slots = await get_available_slots(
            clinician_id=clinician_id,
            start_date=start_date,
            end_date=end_date,
            token=token,
        )

        if not slots:
            return {"available_slots": [], "message": "No available slots found in the requested timeframe. Try asking the client about a different week."}

        # Format slots for conversational presentation (limit to 10 for brevity)
        formatted = []
        for slot in slots[:10]:
            from datetime import datetime
            start = datetime.fromisoformat(slot["start"])
            formatted.append({
                "start": slot["start"],
                "display": start.strftime("%A, %B %d at %I:%M %p"),
            })

        return {
            "available_slots": formatted,
            "total_available": len(slots),
            "message": f"Found {len(slots)} available slots. Present 3-5 of the best options conversationally.",
        }

    elif fc_name == "book_appointment":
        # PHI-safe: log tool name only, not args which contain client name/email
        logger.info("Tool call: book_appointment")

        scheduled_at = fc_args.get("scheduled_at", "")
        client_name = fc_args.get("client_name", "")
        client_email = fc_args.get("client_email", "") or session_context.get("client_email", "")

        if not scheduled_at or not client_name or not client_email:
            return {"error": "Missing required fields: scheduled_at, client_name, and client_email are all required."}

        intake_duration = practice_profile.get("intake_duration", 60)

        result = await book_appointment(
            client_id=client_id,
            client_email=client_email,
            client_name=client_name,
            clinician_id=clinician_id,
            clinician_email=clinician_email,
            scheduled_at=scheduled_at,
            duration_minutes=intake_duration,
            token=token,
        )

        if not result:
            return {"error": "Failed to book the appointment. Please try a different time slot."}

        # Store booking result in session context for email sending
        session_context["booking_result"] = {
            **result,
            "client_name": client_name,
            "client_email": client_email,
            "clinician_name": practice_profile.get("clinician_name", ""),
            "clinician_email": clinician_email,
            "practice_name": practice_profile.get("practice_name", ""),
            "duration_minutes": intake_duration,
        }

        from datetime import datetime
        try:
            appt_dt = datetime.fromisoformat(scheduled_at)
            display_time = appt_dt.strftime("%A, %B %d, %Y at %I:%M %p")
        except ValueError:
            display_time = scheduled_at

        meet_link = result.get("meet_link", "")
        return {
            "success": True,
            "appointment_id": result.get("id"),
            "scheduled_at": scheduled_at,
            "display_time": display_time,
            "meet_link": meet_link,
            "message": (
                f"Appointment booked for {display_time}. "
                f"{'A Google Meet link has been created: ' + meet_link if meet_link else 'A video meeting link will be sent with the confirmation email.'} "
                "Confirmation emails will be sent to both the client and clinician."
            ),
        }

    return {"error": f"Unknown tool: {fc_name}"}


async def run_voice_session(
    ws,
    system_prompt: str,
    session_active_ref: list,
    session_context: dict | None = None,
) -> tuple[str, str]:
    """Run a bidirectional voice intake session between browser WebSocket and Gemini Live API.

    Args:
        ws: The browser WebSocket connection
        system_prompt: The full system prompt (with practice info, prior context, etc.)
        session_active_ref: Mutable list [bool] for signaling session end
        session_context: Dict with session state for tool calls (client_id, token, practice_profile)

    Returns:
        (transcript_segment, exit_reason) where exit_reason is one of:
        - "ended": session ended normally (end_interview tool or client disconnect)
        - "compression_needed": token limit approaching, needs mid-session compression
    """
    from fastapi import WebSocketDisconnect

    if session_context is None:
        session_context = {}

    text_buffer: list[str] = []
    session_start = time.time()
    exit_reason = "ended"

    client = genai.Client(
        vertexai=True, project=PROJECT_ID, location=REGION
    )

    tools = _build_tools()

    live_config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name="Aoede"
                )
            )
        ),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                disabled=False,
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
            ),
        ),
        # Safety net: server-side sliding window compression
        context_window_compression=types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow(
                target_tokens=10000,
            ),
            trigger_tokens=120000,
        ),
        system_instruction=system_prompt,
        output_audio_transcription={},
        input_audio_transcription={},
        tools=tools,
    )

    async with client.aio.live.connect(
        model=GEMINI_MODEL,
        config=live_config,
    ) as gemini:

        await gemini.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(text="Begin the conversation. Greet the user warmly.")],
            ),
            turn_complete=True,
        )

        # ── Receive loop (Gemini -> Browser) ──
        async def receive_from_gemini():
            nonlocal exit_reason
            try:
                while session_active_ref[0]:
                    async for response in gemini.receive():
                        if not session_active_ref[0]:
                            break

                        tc = response.tool_call
                        if tc:
                            for fc in tc.function_calls:
                                if fc.name == "end_interview":
                                    transcript_so_far = "".join(text_buffer)
                                    if len(transcript_so_far.strip()) < 200:
                                        logger.info("Ignoring premature end_interview (transcript: %d chars)", len(transcript_so_far))
                                        await gemini.send_tool_response(
                                            function_responses=[types.FunctionResponse(
                                                name="end_interview",
                                                response={"error": "The interview is not complete yet. Not enough information has been gathered. Please continue the conversation and ask the user if there is anything else they want to share before ending."},
                                            )]
                                        )
                                        continue
                                    logger.info("Gemini called end_interview tool")
                                    await asyncio.sleep(3)
                                    try:
                                        await ws.send_json({"type": "interview_ended"})
                                    except WebSocketDisconnect:
                                        pass
                                    session_active_ref[0] = False
                                    return

                                elif fc.name in ("get_available_slots", "book_appointment"):
                                    logger.info("Gemini called %s tool", fc.name)
                                    try:
                                        # Notify client that we're looking up info
                                        action_msg = (
                                            "Checking available appointment times..."
                                            if fc.name == "get_available_slots"
                                            else "Booking your appointment..."
                                        )
                                        await ws.send_json({
                                            "type": "transcript",
                                            "text": f"\n[System: {action_msg}]\n",
                                        })
                                    except WebSocketDisconnect:
                                        session_active_ref[0] = False
                                        return

                                    # Execute the tool call
                                    tool_args = dict(fc.args) if fc.args else {}
                                    result = await _handle_tool_call(
                                        fc.name, tool_args, session_context,
                                    )

                                    # PHI-safe: log tool name and success status only, not result content
                                    logger.info("Tool %s completed (result keys: %s)", fc.name, list(result.keys()) if isinstance(result, dict) else "non-dict")

                                    # Send the result back to Gemini
                                    await gemini.send_tool_response(
                                        function_responses=[types.FunctionResponse(
                                            name=fc.name,
                                            response=result,
                                        )]
                                    )
                                else:
                                    logger.warning("Unknown tool call: %s", fc.name)
                                    await gemini.send_tool_response(
                                        function_responses=[types.FunctionResponse(
                                            name=fc.name,
                                            response={"error": f"Unknown tool: {fc.name}"},
                                        )]
                                    )
                            continue

                        sc = response.server_content
                        if not sc:
                            continue

                        if sc.model_turn:
                            for part in sc.model_turn.parts:
                                if part.inline_data and part.inline_data.data:
                                    try:
                                        await ws.send_bytes(part.inline_data.data)
                                    except WebSocketDisconnect:
                                        session_active_ref[0] = False
                                        return
                                if part.text:
                                    text_buffer.append(part.text)
                                    try:
                                        await ws.send_json({"type": "transcript", "text": part.text})
                                    except WebSocketDisconnect:
                                        session_active_ref[0] = False
                                        return

                        if sc.output_transcription and sc.output_transcription.text:
                            text_buffer.append(sc.output_transcription.text)
                            try:
                                await ws.send_json({"type": "transcript", "text": sc.output_transcription.text})
                            except WebSocketDisconnect:
                                session_active_ref[0] = False
                                return

                        if sc.input_transcription and sc.input_transcription.text:
                            text_buffer.append(f"\n[User]: {sc.input_transcription.text}")

                        if sc.turn_complete:
                            try:
                                await ws.send_json({"type": "turn_complete"})
                            except WebSocketDisconnect:
                                session_active_ref[0] = False
                                return

            except Exception as e:
                logger.error("Gemini receive error: %s: %s", type(e).__name__, e)
            finally:
                session_active_ref[0] = False

        # ── Send loop (Browser -> Gemini) ──
        async def send_to_gemini():
            nonlocal exit_reason
            try:
                while session_active_ref[0]:
                    data = await ws.receive()

                    if data.get("type") == "websocket.disconnect":
                        logger.info("Browser disconnected")
                        break

                    if data.get("bytes"):
                        await gemini.send_realtime_input(
                            media=types.Blob(
                                data=data["bytes"],
                                mime_type="audio/pcm;rate=16000",
                            )
                        )

                    elif data.get("text"):
                        msg = json.loads(data["text"])
                        if msg.get("type") == "end":
                            logger.info("Received end message from browser")
                            break

                    # Check if we need mid-session compression
                    elapsed = time.time() - session_start
                    audio_tokens = int(elapsed * AUDIO_TOKENS_PER_SEC)
                    text_tokens = len("".join(text_buffer)) // CHARS_PER_TOKEN
                    prompt_tokens = len(system_prompt) // CHARS_PER_TOKEN
                    estimated_total = audio_tokens + text_tokens + prompt_tokens

                    if estimated_total >= COMPRESSION_TRIGGER_TOKENS:
                        logger.info(
                            "Token estimate %d >= %d, triggering compression",
                            estimated_total, COMPRESSION_TRIGGER_TOKENS,
                        )
                        exit_reason = "compression_needed"
                        break

            except WebSocketDisconnect:
                logger.info("Browser WebSocketDisconnect")
            except Exception as e:
                logger.error("Send loop error: %s: %s", type(e).__name__, e)
            finally:
                session_active_ref[0] = False

        recv_task = asyncio.create_task(receive_from_gemini())
        send_task = asyncio.create_task(send_to_gemini())
        done, pending = await asyncio.wait(
            [recv_task, send_task], return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    return "".join(text_buffer), exit_reason
