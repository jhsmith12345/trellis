"""WebSocket relay service for the clinical voice AI platform.

Ported from live-voice-intake-note. Firestore references replaced with
placeholder DB writes — will be wired to Cloud SQL via the shared backend.
"""
import asyncio
import json
import logging
import time
import uuid

from audio_recorder import AudioRecorder
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from gemini_session import (
    build_client_context,
    extract_intake_data,
    generate_note,
    get_system_prompt,
    run_voice_session,
    transcribe_audio,
    validate_intake_data,
)

from config import ALLOWED_ORIGINS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Clinical Voice AI Relay", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Placeholder DB layer — will be replaced with Cloud SQL queries
# ---------------------------------------------------------------------------

async def db_create_session(session_data: dict) -> str:
    """Placeholder: create a session record. Returns session ID."""
    session_id = uuid.uuid4().hex[:20]
    logger.info("DB placeholder: create session %s — %s", session_id, list(session_data.keys()))
    return session_id


async def db_update_session(session_id: str, update_data: dict) -> None:
    """Placeholder: update a session record."""
    logger.info("DB placeholder: update session %s — %s", session_id, list(update_data.keys()))


async def db_get_client(client_id: str) -> dict | None:
    """Placeholder: fetch a client record."""
    logger.info("DB placeholder: get client %s", client_id)
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws/session")
async def websocket_session(ws: WebSocket):
    """Main WebSocket endpoint for voice sessions."""
    await ws.accept()

    recorder = None
    start_time = None
    session_type = None
    client_id = None
    note_format = None
    session_id = None
    transcript = ""
    structured = None

    try:
        # Step 1: Wait for auth message
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        auth_msg = json.loads(raw)

        if auth_msg.get("type") != "auth":
            await ws.send_json({"type": "error", "message": "First message must be auth"})
            await ws.close(code=4001)
            return

        # Step 2: Validate auth
        # TODO: Wire up Firebase Auth token verification
        token = auth_msg.get("token")
        if not token:
            await ws.send_json({"type": "error", "message": "token required"})
            await ws.close(code=4001)
            return

        session_type = auth_msg.get("sessionType", "note")
        client_id = auth_msg.get("clientId")
        note_format = auth_msg.get("noteFormat", "SOAP")

        if not client_id:
            await ws.send_json({"type": "error", "message": "clientId is required"})
            await ws.close(code=4002)
            return

        # Create session record (placeholder)
        session_id = await db_create_session({
            "clientId": client_id,
            "type": session_type,
            "status": "processing",
        })

        # Set up audio recorder
        if session_type == "intake":
            gcs_path = f"audio/intake/{client_id}/{session_id}.webm"
        else:
            gcs_path = f"audio/notes/{client_id}/{session_id}.webm"
        recorder = AudioRecorder(gcs_path)

        system_prompt = get_system_prompt(session_type, note_format, "Client", 1)

        # Step 3: Send ready signal
        await ws.send_json({
            "type": "ready",
            "sessionId": session_id,
        })

        start_time = time.time()

        if session_type == "record":
            # Record-only mode: no Gemini connection, just buffer audio
            logger.info("Starting record-only session")
            session_active = [True]
            try:
                while session_active[0]:
                    data = await ws.receive()

                    if data.get("type") == "websocket.disconnect":
                        logger.info("Browser disconnected during recording")
                        break

                    if data.get("bytes"):
                        if recorder:
                            recorder.write_chunk(data["bytes"])

                    elif data.get("text"):
                        msg = json.loads(data["text"])
                        if msg.get("type") == "end":
                            logger.info("Received end message, stopping recording")
                            break
            except WebSocketDisconnect:
                logger.info("Browser disconnected during recording")

            # Post-process: transcribe + generate note
            if recorder:
                audio_data = recorder.get_audio_data()
                if audio_data and len(audio_data) > 1000:
                    logger.info("Transcribing recorded audio (%d bytes)", len(audio_data))
                    transcript = transcribe_audio(audio_data)
                    logger.info("Transcription complete, length: %d", len(transcript))

            logger.info("Record session ended, transcript length: %d", len(transcript))
        else:
            # Step 4: Run the voice session (handles Gemini connection + relay loops)
            logger.info("Starting voice session via SDK (type=%s)", session_type)
            session_active = [True]
            transcript, structured = await run_voice_session(
                ws, system_prompt, session_active, recorder,
            )
            logger.info("Voice session ended, transcript length: %d", len(transcript))

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except TimeoutError:
        logger.info("Auth timeout")
        await ws.close(code=4001)
        return
    except Exception as e:
        logger.error("Session error: %s: %s", type(e).__name__, e)
    finally:
        # Finalize session
        duration = time.time() - start_time if start_time else 0

        if recorder:
            try:
                recorder.finalize()
            except Exception:
                logger.error("Failed to finalize audio upload")

        if session_id and transcript is not None:
            try:
                note_result = None
                update_data = {
                    "audioDurationSeconds": round(duration),
                    "audioRef": recorder.gcs_path if recorder else "",
                    "transcript": transcript,
                }

                if session_type == "intake" and structured:
                    update_data["status"] = "draft"
                elif len(transcript.strip()) > 20:
                    logger.info("Generating %s note from transcript (%d chars)", note_format, len(transcript))
                    note_result = generate_note(transcript, note_format or "SOAP")
                    if note_result:
                        logger.info("Note generated successfully")
                        update_data["status"] = "draft"
                        update_data["note"] = note_result
                    else:
                        logger.error("Note generation failed")

                await db_update_session(session_id, update_data)

                try:
                    await ws.send_json({
                        "type": "complete",
                        "sessionId": session_id,
                        "result": note_result,
                    })
                except Exception:
                    pass

            except Exception as finalize_err:
                logger.error("Failed to finalize session data: %s: %s", type(finalize_err).__name__, finalize_err)
