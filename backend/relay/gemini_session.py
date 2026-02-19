"""Gemini Real-Time Live session management using google-genai SDK."""
import asyncio
import json
import logging
import struct

from google import genai
from google.genai import types

from config import GEMINI_MODEL, PROJECT_ID, REGION

EXTRACTION_MODEL = "gemini-2.5-flash"

logger = logging.getLogger(__name__)

INTAKE_SYSTEM_PROMPT = """You are a warm, professional clinical intake specialist. You are conducting a voice-based
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

Be warm, empathetic, and patient. Start by warmly greeting them and asking their name.
If someone seems uncomfortable with a question, acknowledge that and offer to skip it.
Confirm information back to them.

Do NOT output any JSON. Just have a natural conversation.

IMPORTANT: Do NOT end the interview prematurely. After you believe you have gathered all the information,
you MUST explicitly ask the user something like "I think I have everything I need. Is there anything
else you'd like to share, or are you ready to wrap up?" Only after the user confirms they are done
should you thank them warmly, let them know their clinician will follow up soon, and call the
end_interview tool. Never call end_interview without this explicit confirmation from the user."""

NOTE_SYSTEM_PROMPT = """You are a clinical documentation assistant helping a therapist recall and document their session.
The clinician will talk through what happened. Your job is to:

1. Listen to their debrief
2. Ask follow-up questions to help them capture important clinical details

Focus on drawing out: what happened (observations, client statements, themes), clinical impressions, and next steps/plan.

Do NOT output any JSON or structured text. Just have a natural voice conversation.
When the clinician indicates they're done, thank them and call the end_interview tool.

The client is: {client_name}
Session number: {session_number}"""


def build_client_context(client_data: dict, sessions: list[dict]) -> str:
    """Format client intake data and past session notes into a context block."""
    parts = []

    name = client_data.get("displayName", "Unknown")
    parts.append(f"Client: {name}")

    intake = client_data.get("intakeData")
    if intake:
        demographics = intake.get("demographics", {})
        if demographics.get("pronouns"):
            parts.append(f"Pronouns: {demographics['pronouns']}")
        if demographics.get("dateOfBirth"):
            parts.append(f"DOB: {demographics['dateOfBirth']}")
        if intake.get("presentingConcerns"):
            parts.append(f"Presenting Concerns: {intake['presentingConcerns']}")
        history = intake.get("history", {})
        if history.get("medications"):
            parts.append(f"Medications: {history['medications']}")
        if history.get("medicalConditions"):
            parts.append(f"Medical Conditions: {history['medicalConditions']}")
        if intake.get("goals"):
            parts.append(f"Goals: {intake['goals']}")

    if sessions:
        parts.append(f"\nPast Sessions ({len(sessions)}):")
        for i, s in enumerate(sessions, 1):
            date_str = ""
            d = s.get("date")
            if d:
                date_str = f" ({d})" if isinstance(d, str) else ""
            note = s.get("note")
            if note:
                parts.append(f"\n--- Session {i}{date_str} ---")
                for key in ("subjective", "objective", "assessment", "plan", "data", "content"):
                    if key in note:
                        parts.append(f"{key.capitalize()}: {note[key]}")

    return "\n".join(parts)


def get_system_prompt(session_type: str, note_format: str | None = None, client_name: str = "", session_number: int = 1) -> str:
    """Get the appropriate system prompt."""
    if session_type == "intake":
        return INTAKE_SYSTEM_PROMPT

    return NOTE_SYSTEM_PROMPT.format(client_name=client_name, session_number=session_number)


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


NOTE_EXTRACTION_PROMPTS = {
    "SOAP": (
        "You are a clinical documentation assistant. Given the following transcript of a clinician's "
        "session debrief, produce a structured SOAP note.\n\n"
        "Return ONLY valid JSON with these keys:\n"
        '{\n'
        '  "format": "SOAP",\n'
        '  "subjective": "string",\n'
        '  "objective": "string",\n'
        '  "assessment": "string",\n'
        '  "plan": "string",\n'
        '  "flags": [{"type": "string", "text": "string", "severity": "low|medium|high"}]\n'
        '}\n\n'
        "Flag any risk language (suicidal ideation, self-harm, harm to others), medication changes, "
        "or crisis indicators. If none detected, flags should be an empty array.\n"
        "If information is sparse, do your best with what's available.\n\n"
        "TRANSCRIPT:\n"
    ),
    "DAP": (
        "You are a clinical documentation assistant. Given the following transcript of a clinician's "
        "session debrief, produce a structured DAP note.\n\n"
        "Return ONLY valid JSON with these keys:\n"
        '{\n'
        '  "format": "DAP",\n'
        '  "data": "string",\n'
        '  "assessment": "string",\n'
        '  "plan": "string",\n'
        '  "flags": [{"type": "string", "text": "string", "severity": "low|medium|high"}]\n'
        '}\n\n'
        "Flag any risk language (suicidal ideation, self-harm, harm to others), medication changes, "
        "or crisis indicators. If none detected, flags should be an empty array.\n"
        "If information is sparse, do your best with what's available.\n\n"
        "TRANSCRIPT:\n"
    ),
    "narrative": (
        "You are a clinical documentation assistant. Given the following transcript of a clinician's "
        "session debrief, produce a narrative clinical note.\n\n"
        "Return ONLY valid JSON with these keys:\n"
        '{\n'
        '  "format": "narrative",\n'
        '  "content": "string",\n'
        '  "flags": [{"type": "string", "text": "string", "severity": "low|medium|high"}]\n'
        '}\n\n'
        "Flag any risk language (suicidal ideation, self-harm, harm to others), medication changes, "
        "or crisis indicators. If none detected, flags should be an empty array.\n"
        "If information is sparse, do your best with what's available.\n\n"
        "TRANSCRIPT:\n"
    ),
}


def generate_note(transcript: str, note_format: str = "SOAP") -> dict | None:
    """Generate a structured clinical note from transcript using Gemini."""
    if not transcript.strip():
        logger.warning("Empty transcript, skipping note generation")
        return None

    prompt = NOTE_EXTRACTION_PROMPTS.get(note_format, NOTE_EXTRACTION_PROMPTS["SOAP"])

    client = genai.Client(
        vertexai=True, project=PROJECT_ID, location=REGION
    )

    try:
        response = client.models.generate_content(
            model=EXTRACTION_MODEL,
            contents=prompt + transcript,
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
            ),
        )

        text = response.text
        if not text:
            logger.error("Note generation returned empty response")
            return None

        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            logger.error("Note generation returned non-dict type: %s", type(parsed).__name__)
            return None
        return parsed
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        logger.error("Failed to parse note result: %s: %s", type(e).__name__, e)
        return None
    except Exception as e:
        logger.error("Note generation API call failed: %s: %s", type(e).__name__, e)
        return None


def pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000, channels: int = 1, sample_width: int = 2) -> bytes:
    """Wrap raw PCM data in a WAV header."""
    data_size = len(pcm_data)
    header = struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF',
        36 + data_size,
        b'WAVE',
        b'fmt ',
        16,
        1,  # PCM format
        channels,
        sample_rate,
        sample_rate * channels * sample_width,
        channels * sample_width,
        sample_width * 8,
        b'data',
        data_size,
    )
    return header + pcm_data


def transcribe_audio(audio_data: bytes) -> str:
    """Transcribe raw PCM audio using Gemini batch API."""
    if not audio_data:
        logger.warning("Empty audio data, skipping transcription")
        return ""

    wav_data = pcm_to_wav(audio_data)

    client = genai.Client(
        vertexai=True, project=PROJECT_ID, location=REGION
    )

    try:
        response = client.models.generate_content(
            model=EXTRACTION_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part(
                            inline_data=types.Blob(
                                data=wav_data,
                                mime_type="audio/wav",
                            )
                        ),
                        types.Part(text="Transcribe this audio recording of a therapy session verbatim. Include speaker labels where possible (e.g. [Clinician]: and [Client]:). Return only the transcript text, no other commentary."),
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                temperature=0.1,
            ),
        )

        text = response.text
        if not text:
            logger.error("Transcription returned empty response")
            return ""

        return text.strip()
    except Exception as e:
        logger.error("Transcription failed: %s: %s", type(e).__name__, e)
        return ""


async def run_voice_session(ws, system_prompt: str, session_active_ref: list, recorder=None, skip_greeting: bool = False):
    """Run a bidirectional voice session between browser WebSocket and Gemini Live API.

    Args:
        ws: FastAPI WebSocket (browser connection)
        system_prompt: System instruction for Gemini
        session_active_ref: Mutable list [bool] to signal session end
        recorder: Optional AudioRecorder for authenticated sessions

    Returns:
        (transcript, structured_result) tuple
    """
    from fastapi import WebSocketDisconnect

    text_buffer: list[str] = []
    structured_result: dict | None = None

    client = genai.Client(
        vertexai=True, project=PROJECT_ID, location=REGION
    )

    # Define end_interview tool for Gemini to call when intake is complete
    end_interview_tool = types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="end_interview",
                description="Call this tool ONLY after you have explicitly asked the user if there is anything else they'd like to add or if they are ready to finish, AND the user has confirmed they are done. Never call this tool without first confirming with the user that they are ready to end the conversation.",
            )
        ]
    )

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
            ),
        ),
        system_instruction=system_prompt,
        output_audio_transcription={},
        input_audio_transcription={},
        tools=[end_interview_tool],
    )

    async with client.aio.live.connect(
        model=GEMINI_MODEL,
        config=live_config,
    ) as gemini:

        # Kick off conversation (skip for co-session where Gemini stays silent)
        if not skip_greeting:
            await gemini.send_client_content(
                turns=types.Content(
                    role="user",
                    parts=[types.Part(text="Begin the conversation. Greet the user warmly.")],
                ),
                turn_complete=True,
            )

        # ── Receive loop (Gemini -> Browser) ──
        async def receive_from_gemini():
            nonlocal structured_result
            try:
                while session_active_ref[0]:
                    async for response in gemini.receive():
                        if not session_active_ref[0]:
                            break

                        # Handle tool calls (e.g. end_interview)
                        tc = response.tool_call
                        if tc:
                            for fc in tc.function_calls:
                                if fc.name == "end_interview":
                                    # Reject if no real conversation has happened yet
                                    transcript_so_far = "".join(text_buffer)
                                    if len(transcript_so_far.strip()) < 200:
                                        logger.info("Ignoring premature end_interview (transcript: %d chars)", len(transcript_so_far))
                                        # Tell Gemini to continue and confirm with user
                                        await gemini.send_tool_response(
                                            function_responses=[types.FunctionResponse(
                                                name="end_interview",
                                                response={"error": "The interview is not complete yet. Not enough information has been gathered. Please continue the conversation and ask the user if there is anything else they want to share before ending."},
                                            )]
                                        )
                                        continue
                                    logger.info("Gemini called end_interview tool")
                                    # Let final audio chunks finish playing on client
                                    await asyncio.sleep(3)
                                    try:
                                        await ws.send_json({"type": "interview_ended"})
                                    except WebSocketDisconnect:
                                        pass
                                    session_active_ref[0] = False
                                    return
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
                                    full = "".join(text_buffer)
                                    try:
                                        s = full.find("{")
                                        e = full.rfind("}") + 1
                                        if s >= 0 and e > s:
                                            structured_result = json.loads(full[s:e])
                                    except (json.JSONDecodeError, ValueError):
                                        pass
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
            try:
                while session_active_ref[0]:
                    data = await ws.receive()

                    if data.get("type") == "websocket.disconnect":
                        logger.info("Browser disconnected")
                        break

                    if data.get("bytes"):
                        audio_data = data["bytes"]
                        if recorder:
                            recorder.write_chunk(audio_data)
                        await gemini.send_realtime_input(
                            media=types.Blob(
                                data=audio_data,
                                mime_type="audio/pcm;rate=16000",
                            )
                        )

                    elif data.get("text"):
                        msg = json.loads(data["text"])
                        if msg.get("type") == "end":
                            logger.info("Received end message from browser")
                            break

            except WebSocketDisconnect:
                logger.info("Browser WebSocketDisconnect")
            except Exception as e:
                logger.error("Send loop error: %s: %s", type(e).__name__, e)
            finally:
                session_active_ref[0] = False

        # Run both loops concurrently
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

    # Return results after async with closes the Gemini session
    return "".join(text_buffer), structured_result
