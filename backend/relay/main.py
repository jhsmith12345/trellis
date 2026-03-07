"""WebSocket relay service for voice intake sessions.

Bridges browser WebSocket <-> Gemini Live API for real-time voice intake.
Saves raw transcripts to encounters table. Supports mid-session compression
when the Gemini Live context window fills up.

Includes:
- Firebase JWT verification (HIPAA requirement)
- Practice profile injection (insurance, rates, scheduling)
- Tool calling for appointment scheduling
- Confirmation emails after booking
"""
import asyncio
import json
import logging
import sys
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from auth import verify_token
from api_client import get_practice_profile
from booking_emails import send_clinician_confirmation, send_client_confirmation
from config import ALLOWED_ORIGINS
from context import compress_mid_session, get_context_for_client
from gemini_session import build_system_prompt, run_voice_session

# Add shared module to path (works both locally and in Docker)
from pathlib import Path as _Path
_here = _Path(__file__).resolve().parent
sys.path.insert(0, str(_here.parent / "shared"))  # local dev: backend/shared
sys.path.insert(0, str(_here / "shared"))          # Docker: /app/shared
from db import close_pool, create_encounter, get_client_transcripts, update_encounter, get_client, get_clinician
from alerts import notify_bd_new_intake

from request_logging import RequestLoggingMiddleware
from safe_logging import configure_safe_logging

# Configure PHI-safe logging before any other operations
configure_safe_logging()

logger = logging.getLogger(__name__)

app = FastAPI(title="Clinical Voice AI Relay", version="1.0.0")

# PHI-safe request logging middleware
app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    await close_pool()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws/session")
async def websocket_session(ws: WebSocket):
    """Voice intake WebSocket endpoint with context injection and mid-session compression."""
    await ws.accept()

    start_time = None
    client_id = None
    encounter_id = None
    full_transcript = ""
    session_context = {}

    try:
        # ── Auth handshake ──
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        auth_msg = json.loads(raw)

        if auth_msg.get("type") != "auth":
            await ws.send_json({"type": "error", "message": "First message must be auth"})
            await ws.close(code=4001)
            return

        token = auth_msg.get("token")
        if not token:
            await ws.send_json({"type": "error", "message": "token required"})
            await ws.close(code=4001)
            return

        # ── Verify Firebase JWT ──
        try:
            verified_user = verify_token(token)
            logger.info("JWT verified for uid=%s", verified_user["uid"])
        except ValueError as e:
            logger.warning("JWT verification failed: %s", e)
            await ws.send_json({"type": "error", "message": "Invalid or expired token"})
            await ws.close(code=4003)
            return

        client_id = auth_msg.get("clientId")
        if not client_id:
            await ws.send_json({"type": "error", "message": "clientId is required"})
            await ws.close(code=4002)
            return

        intake_mode = auth_msg.get("intakeMode", "standard")
        if intake_mode not in ("standard", "iop"):
            intake_mode = "standard"

        # Ensure the authenticated user matches the claimed clientId
        if verified_user["uid"] != client_id:
            logger.warning(
                "Client ID mismatch: token uid=%s, claimed clientId=%s",
                verified_user["uid"], client_id,
            )
            await ws.send_json({"type": "error", "message": "clientId does not match authenticated user"})
            await ws.close(code=4003)
            return

        # ── Resolve clinician and client insurance for this client ──
        # Look up the client's primary_clinician_id, fall back to practice owner
        resolved_clinician_uid = None
        client_insurance = None
        try:
            client_record = await get_client(client_id)
            if client_record:
                if client_record.get("primary_clinician_id"):
                    resolved_clinician_uid = client_record["primary_clinician_id"]
                    logger.info("Client assigned to clinician: %s", resolved_clinician_uid)
                # Pull insurance data if the client uploaded their card
                if client_record.get("payer_name") or client_record.get("insurance_data"):
                    client_insurance = client_record.get("insurance_data") or {}
                    # Top-level fields override JSONB extraction data
                    if client_record.get("payer_name"):
                        client_insurance["payer_name"] = client_record["payer_name"]
                    if client_record.get("member_id"):
                        client_insurance["member_id"] = client_record["member_id"]
                    if client_record.get("group_number"):
                        client_insurance["group_number"] = client_record["group_number"]
                    logger.info("Loaded client insurance: payer=%s", client_insurance.get("payer_name"))
        except Exception as e:
            logger.warning("Failed to look up client record: %s", e)

        # ── Fetch practice profile (for the resolved clinician) ──
        practice_profile = await get_practice_profile(
            token=token,
            clinician_uid=resolved_clinician_uid,
        )
        if practice_profile:
            # If no resolved clinician, use the profile's clinician_uid (practice owner)
            if not resolved_clinician_uid:
                resolved_clinician_uid = practice_profile.get("clinician_uid")
            logger.info(
                "Loaded practice profile: %s (clinician: %s, insurances: %d, rates: intake=%s, session=%s)",
                practice_profile.get("practice_name"),
                practice_profile.get("clinician_name"),
                len(practice_profile.get("accepted_insurances", [])),
                practice_profile.get("intake_rate"),
                practice_profile.get("session_rate"),
            )
        else:
            logger.warning("No practice profile found — insurance/scheduling features will be limited")

        # Build session context for tool calls
        session_context = {
            "client_id": client_id,
            "client_email": verified_user.get("email", ""),
            "token": token,
            "practice_profile": practice_profile,
            "clinician_id": resolved_clinician_uid,
        }

        # ── Create encounter record ──
        encounter_id = await create_encounter(
            client_id=client_id,
            encounter_type="intake",
            source="voice",
        )
        logger.info("Created encounter %s for client %s", encounter_id, client_id)

        # ── Load prior context ──
        prior_transcripts = await get_client_transcripts(client_id)
        context = await get_context_for_client(prior_transcripts)
        logger.info(
            "Loaded %d prior transcripts for client %s (context: %d chars)",
            len(prior_transcripts), client_id, len(context),
        )

        # ── Send ready ──
        await ws.send_json({"type": "ready", "sessionId": encounter_id})
        start_time = time.time()

        # ── Voice session loop (handles mid-session compression) ──
        while True:
            system_prompt = build_system_prompt(
                context, practice_profile, client_insurance,
                client_email=session_context.get("client_email"),
                intake_mode=intake_mode,
            )

            logger.info("Starting Gemini Live connection (prompt: %d chars)", len(system_prompt))
            session_active = [True]
            segment, exit_reason = await run_voice_session(
                ws, system_prompt, session_active, session_context,
            )
            full_transcript += segment

            if exit_reason == "compression_needed":
                logger.info("Mid-session compression triggered")
                try:
                    await ws.send_json({
                        "type": "transcript",
                        "text": "\n[System: Organizing notes, one moment...]\n",
                    })
                except WebSocketDisconnect:
                    break

                # Compress all context + current transcript
                raw_prior = "\n\n".join(t["transcript"] for t in prior_transcripts)
                context = await compress_mid_session(raw_prior, full_transcript)
                logger.info("Compression complete, new context: %d chars", len(context))
                continue
            else:
                break

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except TimeoutError:
        logger.info("Auth timeout")
        await ws.close(code=4001)
        return
    except Exception as e:
        logger.error("Session error: %s: %s", type(e).__name__, e)
    finally:
        duration = round(time.time() - start_time) if start_time else 0

        if encounter_id and full_transcript:
            try:
                await update_encounter(
                    encounter_id,
                    transcript=full_transcript,
                    duration_sec=duration,
                    status="complete",
                )
                logger.info(
                    "Saved encounter %s: %d chars, %ds",
                    encounter_id, len(full_transcript), duration,
                )

                # Alert BD of new warm lead
                notify_bd_new_intake(
                    client_name=client_id,  # best we have from voice
                    source="voice",
                    transcript=full_transcript,
                    encounter_id=encounter_id,
                )
            except Exception as e:
                logger.error("Failed to save encounter: %s: %s", type(e).__name__, e)

            # ── Send confirmation emails if a booking was made ──
            booking = session_context.get("booking_result")
            if booking:
                logger.info("Sending booking confirmation emails for appointment %s", booking.get("id"))
                try:
                    send_clinician_confirmation(
                        clinician_email=booking.get("clinician_email", ""),
                        clinician_name=booking.get("clinician_name", "Clinician"),
                        practice_name=booking.get("practice_name", ""),
                        client_name=booking.get("client_name", ""),
                        client_email=booking.get("client_email", ""),
                        scheduled_at=booking.get("scheduled_at", ""),
                        meet_link=booking.get("meet_link"),
                        duration_minutes=booking.get("duration_minutes", 60),
                        transcript=full_transcript,
                        appointment_id=booking.get("id"),
                    )
                except Exception as e:
                    logger.error("Failed to send clinician confirmation: %s: %s", type(e).__name__, e)

                try:
                    send_client_confirmation(
                        client_email=booking.get("client_email", ""),
                        client_name=booking.get("client_name", ""),
                        clinician_name=booking.get("clinician_name", "your clinician"),
                        practice_name=booking.get("practice_name", ""),
                        scheduled_at=booking.get("scheduled_at", ""),
                        meet_link=booking.get("meet_link"),
                        duration_minutes=booking.get("duration_minutes", 60),
                    )
                except Exception as e:
                    logger.error("Failed to send client confirmation: %s: %s", type(e).__name__, e)

            try:
                await ws.send_json({
                    "type": "complete",
                    "sessionId": encounter_id,
                })
            except Exception:
                pass
