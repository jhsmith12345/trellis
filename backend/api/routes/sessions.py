"""Session recording + transcription pipeline.

Component 6: Handles the full pipeline from Meet recording to stored encounter:
  1. Poll Drive for new recordings after sessions end
  2. Match recording to appointment via Calendar event ID / Meet code
  3. Download recording and transcribe via Google Speech-to-Text V2 with diarization
  4. Store transcript as encounter (type=clinical, source=voice)
  5. Link encounter to appointment, update appointment status
  6. Optionally delete recording from Drive after transcription

HIPAA Access Control:
  - POST /cron/process-recordings — X-Cron-Secret header auth (Cloud Scheduler)
  - POST /sessions/process/{id}   — clinician-only (require_role)
  - GET  /sessions/recording-status — clinician-only (require_role)
  - GET/PUT /sessions/config       — clinician-only (require_role)
  - GET /sessions/{id}/transcript  — clinician-only (require_role)
  - All reads and writes logged to audit_events

Endpoints:
  - POST /api/cron/process-recordings   — polls Drive, processes new recordings (cron)
  - POST /api/sessions/process/{id}     — manually trigger processing for one appointment
  - GET  /api/sessions/recording-status  — list recent appointments with recording status
  - GET  /api/sessions/config            — get recording configuration
  - PUT  /api/sessions/config            — update recording configuration
"""
import asyncio
import logging
import os
import sys
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Header
from pydantic import BaseModel

from auth import require_role, require_practice_member, get_current_user_with_role, is_clinician, is_owner

sys.path.insert(0, "../shared")
from db import (
    get_completed_appointments_needing_recording,
    update_appointment_recording,
    update_appointment_status,
    get_appointment,
    create_encounter,
    log_audit_event,
    get_recording_config,
    upsert_recording_config,
    get_appointments_by_recording_status,
    get_next_appointment_in_series,
    set_reconfirmation_sent,
)
from gcal import (
    get_meet_recording_for_event,
    get_all_recordings_for_event,
    download_recording,
    delete_drive_file,
    strip_conference_data,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Shared secret for cron endpoint authentication
CRON_SECRET = os.getenv("CRON_SECRET", "dev-cron-secret")

# GCP project settings for Speech-to-Text
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "trellis-mvp")
GCP_REGION = os.getenv("GCP_REGION", "us-central1")

# How far back to search for recordings (in minutes)
RECORDING_SEARCH_WINDOW = int(os.getenv("RECORDING_SEARCH_WINDOW", "360"))

# How far back to look for appointments needing processing (in hours)
APPOINTMENT_LOOKBACK_HOURS = int(os.getenv("APPOINTMENT_LOOKBACK_HOURS", "12"))

# Base URLs for email links
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:5173")
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080")

SA_KEY_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "sa-key.json")


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _verify_cron_secret(x_cron_secret: str | None = Header(None, alias="X-Cron-Secret")) -> None:
    """Verify the shared secret for cron endpoints."""
    if x_cron_secret != CRON_SECRET:
        raise HTTPException(403, "Invalid cron secret")


# ---------------------------------------------------------------------------
# Speech-to-Text V2 pipeline with speaker diarization
# ---------------------------------------------------------------------------

async def transcribe_recording(
    audio_bytes: bytes,
    mime_type: str,
    sample_rate_hertz: int = 16000,
    min_speaker_count: int = 2,
    max_speaker_count: int = 2,
) -> dict:
    """Transcribe audio using Google Cloud Speech-to-Text V2 with speaker diarization.

    Uses the Speech-to-Text V2 API (google.cloud.speech_v2) with Chirp model
    for high-quality transcription with speaker diarization.

    Args:
        audio_bytes: Raw audio file bytes.
        mime_type: MIME type of the audio (e.g., "video/mp4", "audio/wav").
        sample_rate_hertz: Expected sample rate (used for some codecs).
        min_speaker_count: Minimum expected speakers (default 2: clinician + client).
        max_speaker_count: Maximum expected speakers.

    Returns:
        Dict with:
            - transcript: Full formatted transcript with speaker labels
            - speaker_count: Number of detected speakers
            - duration_sec: Audio duration in seconds
            - word_count: Total word count
            - raw_results: Raw API response for debugging
    """
    from google.cloud import speech_v2
    from google.cloud.speech_v2.types import cloud_speech
    from google.api_core.client_options import ClientOptions

    # Use regional endpoint for V2 API
    client_options = ClientOptions(
        api_endpoint=f"{GCP_REGION}-speech.googleapis.com",
    )
    client = speech_v2.SpeechAsyncClient(client_options=client_options)

    # Build recognition config with diarization
    # The V2 API uses "recognizers" — we use inline config for simplicity
    recognition_config = cloud_speech.RecognitionConfig(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=["en-US"],
        model="chirp_2",
        features=cloud_speech.RecognitionFeatures(
            enable_word_time_offsets=True,
            diarization_config=cloud_speech.SpeakerDiarizationConfig(
                min_speaker_count=min_speaker_count,
                max_speaker_count=max_speaker_count,
            ),
            enable_automatic_punctuation=True,
        ),
    )

    recognizer_name = f"projects/{GCP_PROJECT_ID}/locations/{GCP_REGION}/recognizers/_"

    # For files larger than ~10MB, we should use long-running recognition
    # (batch recognize). For MVP, use inline recognition for simplicity
    # with a size check to route to batch for large files.
    file_size_mb = len(audio_bytes) / (1024 * 1024)
    logger.info("Audio size: %.1f MB, transcribing...", file_size_mb)

    if file_size_mb > 10:
        # Use batch (long-running) recognition for large files
        return await _transcribe_batch(
            client, recognizer_name, recognition_config,
            audio_bytes, mime_type,
        )
    else:
        # Use inline recognition for smaller files
        return await _transcribe_inline(
            client, recognizer_name, recognition_config,
            audio_bytes, mime_type,
        )


async def _transcribe_inline(
    client,
    recognizer_name: str,
    recognition_config,
    audio_bytes: bytes,
    mime_type: str,
) -> dict:
    """Inline (synchronous) transcription for smaller files (<10MB)."""
    from google.cloud.speech_v2.types import cloud_speech

    request = cloud_speech.RecognizeRequest(
        recognizer=recognizer_name,
        config=recognition_config,
        content=audio_bytes,
    )

    response = await client.recognize(request=request)
    return _format_transcription_result(response)


async def _transcribe_batch(
    client,
    recognizer_name: str,
    recognition_config,
    audio_bytes: bytes,
    mime_type: str,
) -> dict:
    """Batch (long-running) transcription for larger files.

    Writes audio to a temp file, uploads to GCS for processing, then
    polls for completion. For MVP we use inline content with
    batch_recognize which supports larger files.
    """
    from google.cloud.speech_v2.types import cloud_speech
    from google.cloud import storage

    # For batch recognize, we need to upload to GCS first
    bucket_name = f"{GCP_PROJECT_ID}-trellis-temp"
    blob_name = f"recordings/temp_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.mp4"

    try:
        # Upload to GCS
        storage_client = storage.Client(project=GCP_PROJECT_ID)

        # Create bucket if it doesn't exist
        try:
            bucket = storage_client.get_bucket(bucket_name)
        except Exception:
            bucket = storage_client.create_bucket(bucket_name, location=GCP_REGION)
            logger.info("Created temp GCS bucket: %s", bucket_name)

        blob = bucket.blob(blob_name)
        blob.upload_from_string(audio_bytes, content_type=mime_type)
        gcs_uri = f"gs://{bucket_name}/{blob_name}"
        logger.info("Uploaded recording to %s for batch processing", gcs_uri)

        # Batch recognize
        request = cloud_speech.BatchRecognizeRequest(
            recognizer=recognizer_name,
            config=recognition_config,
            files=[
                cloud_speech.BatchRecognizeFileMetadata(
                    uri=gcs_uri,
                )
            ],
            recognition_output_config=cloud_speech.RecognitionOutputConfig(
                inline_response_config=cloud_speech.InlineOutputConfig(),
            ),
        )

        operation = await client.batch_recognize(request=request)
        logger.info("Batch transcription started, waiting for completion...")

        # Wait for the operation to complete (with timeout)
        result = await asyncio.wait_for(
            _wait_for_operation(operation),
            timeout=600,  # 10 minute timeout
        )

        # Extract results from batch response
        if result and result.results:
            for file_result in result.results.values():
                if file_result.transcript:
                    return _format_batch_result(file_result)

        logger.warning("Batch transcription returned no results")
        return {"transcript": "", "speaker_count": 0, "duration_sec": 0, "word_count": 0, "raw_results": None}

    finally:
        # Clean up temp GCS file
        try:
            blob = storage_client.bucket(bucket_name).blob(blob_name)
            blob.delete()
            logger.info("Cleaned up temp GCS file: %s", gcs_uri)
        except Exception as e:
            logger.warning("Failed to clean up temp GCS file: %s", e)


async def _wait_for_operation(operation):
    """Poll a long-running operation until completion."""
    result = await operation.result()
    return result


def _format_transcription_result(response) -> dict:
    """Format Speech-to-Text V2 inline response into structured transcript.

    Processes diarization results to create a readable transcript with
    speaker labels (Speaker 1, Speaker 2, etc.).
    """
    if not response.results:
        return {"transcript": "", "speaker_count": 0, "duration_sec": 0, "word_count": 0, "raw_results": None}

    # Collect all words with speaker tags from diarization
    all_words = []
    speakers = set()
    total_duration_sec = 0

    for result in response.results:
        if not result.alternatives:
            continue
        alt = result.alternatives[0]

        # Get word-level details with speaker tags
        for word_info in alt.words:
            speaker_tag = getattr(word_info, "speaker_label", "") or getattr(word_info, "speaker_tag", 0)
            speakers.add(speaker_tag)
            all_words.append({
                "word": word_info.word,
                "speaker": speaker_tag,
                "start_time": word_info.start_offset.total_seconds() if word_info.start_offset else 0,
                "end_time": word_info.end_offset.total_seconds() if word_info.end_offset else 0,
            })
            if word_info.end_offset:
                end_sec = word_info.end_offset.total_seconds()
                if end_sec > total_duration_sec:
                    total_duration_sec = end_sec

    # Build formatted transcript with speaker turns
    transcript = _build_diarized_transcript(all_words)

    return {
        "transcript": transcript,
        "speaker_count": len(speakers),
        "duration_sec": int(total_duration_sec),
        "word_count": len(all_words),
        "raw_results": None,  # Don't store raw API response (PHI concerns)
    }


def _format_batch_result(file_result) -> dict:
    """Format batch recognition result."""
    all_words = []
    speakers = set()
    total_duration_sec = 0

    if file_result.transcript and file_result.transcript.results:
        for result in file_result.transcript.results:
            if not result.alternatives:
                continue
            alt = result.alternatives[0]

            for word_info in alt.words:
                speaker_tag = getattr(word_info, "speaker_label", "") or getattr(word_info, "speaker_tag", 0)
                speakers.add(speaker_tag)
                all_words.append({
                    "word": word_info.word,
                    "speaker": speaker_tag,
                    "start_time": word_info.start_offset.total_seconds() if word_info.start_offset else 0,
                    "end_time": word_info.end_offset.total_seconds() if word_info.end_offset else 0,
                })
                if word_info.end_offset:
                    end_sec = word_info.end_offset.total_seconds()
                    if end_sec > total_duration_sec:
                        total_duration_sec = end_sec

    transcript = _build_diarized_transcript(all_words)

    return {
        "transcript": transcript,
        "speaker_count": len(speakers),
        "duration_sec": int(total_duration_sec),
        "word_count": len(all_words),
        "raw_results": None,
    }


def _build_diarized_transcript(words: list[dict]) -> str:
    """Build a readable transcript from diarized word list.

    Groups consecutive words by the same speaker into paragraphs,
    prefixed with speaker labels.

    Example output:
        Speaker 1: Hello, how are you doing today?
        Speaker 2: I'm doing well, thank you for asking.
        Speaker 1: Let's talk about how your week has been.
    """
    if not words:
        return ""

    lines = []
    current_speaker = None
    current_text = []

    for w in words:
        speaker = w["speaker"]
        if speaker != current_speaker:
            # Flush current speaker's text
            if current_text and current_speaker is not None:
                label = f"Speaker {current_speaker}"
                lines.append(f"{label}: {' '.join(current_text)}")
            current_speaker = speaker
            current_text = [w["word"]]
        else:
            current_text.append(w["word"])

    # Flush last speaker
    if current_text and current_speaker is not None:
        label = f"Speaker {current_speaker}"
        lines.append(f"{label}: {' '.join(current_text)}")

    return "\n\n".join(lines)


# ---------------------------------------------------------------------------
# Short-transcript validation via Gemini Flash
# ---------------------------------------------------------------------------

# Transcripts under this character count get LLM-validated to filter junk
SHORT_TRANSCRIPT_THRESHOLD = 2000

GEMINI_MODEL = os.getenv("GEMINI_NOTE_MODEL", "gemini-2.5-flash-preview-05-20")


async def validate_short_transcript(transcript: str) -> str:
    """Ask Gemini Flash whether a short transcript is a real clinical session.

    Returns one of: "session", "not_session", "uncertain".
    """
    from google import genai
    from google.genai.types import GenerateContentConfig

    client = genai.Client(
        vertexai=True,
        project=GCP_PROJECT_ID,
        location=GCP_REGION,
    )

    prompt = (
        "You are triaging a short therapy session recording transcript. "
        "Determine if this is an actual clinical therapy session or a "
        "non-clinical interaction (tech test, scheduling call, brief check-in, accidental join).\n\n"
        f"Transcript:\n{transcript[:3000]}\n\n"
        "Respond with exactly one word: session | not_session | uncertain"
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=GenerateContentConfig(
                temperature=0.0,
                max_output_tokens=10,
            ),
        )
        result = response.text.strip().lower()
        if result in ("session", "not_session", "uncertain"):
            return result
        logger.warning("Unexpected LLM validation response: %s", result)
        return "uncertain"
    except Exception as e:
        logger.error("LLM transcript validation failed: %s", e)
        return "uncertain"


# ---------------------------------------------------------------------------
# Core processing pipeline
# ---------------------------------------------------------------------------

async def process_single_appointment(
    appointment: dict,
    delete_after: bool = True,
) -> dict:
    """Process a single appointment's recording(s) through the full pipeline.

    Clusters all recordings matching the appointment's Meet code (handles
    disconnection/rejoin producing multiple fragments), concatenates the
    audio, transcribes, and validates short transcripts via LLM.

    Steps:
    1. Find ALL recordings in Drive matching the Meet code
    2. Download and concatenate audio fragments
    3. Transcribe with speaker diarization
    4. If transcript < 2000 chars, LLM-validate (filter junk/test calls)
    5. Store as encounter
    6. Link to appointment
    7. Optionally delete recordings

    Args:
        appointment: Appointment dict from db.
        delete_after: Whether to delete the recording(s) after transcription.

    Returns:
        Dict with processing results.
    """
    appt_id = appointment["id"]
    calendar_event_id = appointment.get("calendar_event_id")
    meet_link = appointment.get("meet_link")

    if not calendar_event_id:
        logger.warning("Appointment %s has no calendar_event_id, skipping", appt_id)
        await update_appointment_recording(
            appt_id,
            recording_status="skipped",
            recording_error="No calendar event ID",
        )
        return {"status": "skipped", "reason": "no_calendar_event"}

    # Step 1: Mark as processing
    await update_appointment_recording(appt_id, recording_status="processing")

    try:
        # Step 2: Find ALL recordings matching the Meet code
        recordings = get_all_recordings_for_event(
            calendar_event_id=calendar_event_id,
            meet_link=meet_link,
            search_minutes=RECORDING_SEARCH_WINDOW,
            clinician_email=appointment.get("clinician_email", ""),
        )

        if not recordings:
            logger.info("No recording found for appointment %s (event %s)", appt_id, calendar_event_id)
            await update_appointment_recording(
                appt_id,
                recording_status="pending",
                recording_error="Recording not found in Drive yet",
            )
            return {"status": "pending", "reason": "recording_not_found"}

        file_ids = [r["id"] for r in recordings]
        file_names = [r.get("name", "unknown") for r in recordings]
        logger.info(
            "Found %d recording(s) for appointment %s: %s",
            len(recordings), appt_id, file_names,
        )

        # Store the first file ID for backwards compatibility
        await update_appointment_recording(appt_id, recording_file_id=file_ids[0])

        # Step 3: Download all fragments and concatenate
        all_audio_chunks: list[bytes] = []
        total_bytes = 0
        mime_type = "video/mp4"

        for rec in recordings:
            download_result = download_recording(rec["id"], clinician_email=appointment.get("clinician_email", ""))
            if not download_result:
                logger.warning("Failed to download fragment %s, skipping", rec["id"])
                continue
            chunk_bytes, chunk_mime = download_result
            all_audio_chunks.append(chunk_bytes)
            total_bytes += len(chunk_bytes)
            mime_type = chunk_mime  # Use last mime type

        if not all_audio_chunks:
            raise RuntimeError("Failed to download any recording fragments")

        # Concatenate audio fragments
        if len(all_audio_chunks) == 1:
            combined_audio = all_audio_chunks[0]
        else:
            combined_audio = b"".join(all_audio_chunks)
            logger.info(
                "Concatenated %d fragments (%d bytes total) for appointment %s",
                len(all_audio_chunks), total_bytes, appt_id,
            )

        # Step 4: Transcribe with diarization
        transcription = await transcribe_recording(
            audio_bytes=combined_audio,
            mime_type=mime_type,
            min_speaker_count=2,
            max_speaker_count=2,
        )

        transcript_text = transcription.get("transcript", "")
        if not transcript_text:
            raise RuntimeError("Transcription returned empty result")

        logger.info(
            "Transcription complete: %d words, %d speakers, %d seconds",
            transcription.get("word_count", 0),
            transcription.get("speaker_count", 0),
            transcription.get("duration_sec", 0),
        )

        # Step 5: LLM-validate short transcripts to filter junk
        llm_validation = None
        if len(transcript_text) < SHORT_TRANSCRIPT_THRESHOLD:
            llm_validation = await validate_short_transcript(transcript_text)
            logger.info(
                "Short transcript validation for %s: %s (%d chars)",
                appt_id, llm_validation, len(transcript_text),
            )
            if llm_validation == "not_session":
                await update_appointment_recording(
                    appt_id,
                    recording_status="skipped",
                    recording_error="Short recording classified as non-clinical by LLM",
                )
                # Still delete recordings to clean up
                if delete_after:
                    for fid in file_ids:
                        delete_drive_file(fid, clinician_email=appointment.get("clinician_email", ""))
                return {
                    "status": "skipped",
                    "reason": "non_clinical_transcript",
                    "appointment_id": appt_id,
                    "llm_validation": llm_validation,
                    "transcript_length": len(transcript_text),
                }

        # Step 6: Store as encounter
        encounter_data = {
            "appointment_id": appt_id,
            "appointment_type": appointment.get("type"),
            "recording_file_ids": file_ids,
            "recording_file_names": file_names,
            "recording_fragment_count": len(recordings),
            "duration_sec": transcription.get("duration_sec", 0),
            "speaker_count": transcription.get("speaker_count", 0),
            "word_count": transcription.get("word_count", 0),
            "transcription_source": "google_stt_v2_chirp",
            "processed_at": datetime.utcnow().isoformat(),
        }
        if llm_validation:
            encounter_data["llm_validation"] = llm_validation

        encounter_id = await create_encounter(
            client_id=appointment["client_id"],
            encounter_type="clinical",
            source="voice",
            clinician_id=appointment.get("clinician_id"),
            transcript=transcript_text,
            data=encounter_data,
            duration_sec=transcription.get("duration_sec"),
            status="complete",
        )

        logger.info("Created encounter %s for appointment %s", encounter_id, appt_id)

        # Step 7: Link encounter to appointment and mark as completed
        await update_appointment_recording(
            appt_id,
            recording_status="completed",
            encounter_id=encounter_id,
        )

        if appointment.get("status") != "completed":
            await update_appointment_status(appt_id, "completed")

        # Strip Meet link so old link goes dead
        if calendar_event_id:
            try:
                strip_conference_data(calendar_event_id, clinician_email=appointment.get("clinician_email", ""))
            except Exception as e:
                logger.error("Failed to strip conference data for %s: %s", appt_id, e)

        # Step 8: Optionally delete recordings from Drive
        recordings_deleted = 0
        if delete_after:
            for fid in file_ids:
                if delete_drive_file(fid, clinician_email=appointment.get("clinician_email", "")):
                    recordings_deleted += 1
                else:
                    logger.warning("Failed to delete recording %s", fid)

        return {
            "status": "completed",
            "encounter_id": encounter_id,
            "appointment_id": appt_id,
            "duration_sec": transcription.get("duration_sec", 0),
            "word_count": transcription.get("word_count", 0),
            "speaker_count": transcription.get("speaker_count", 0),
            "recording_fragment_count": len(recordings),
            "recordings_deleted": recordings_deleted,
            "llm_validation": llm_validation,
        }

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        logger.error(
            "Recording processing failed for appointment %s: %s",
            appt_id, error_msg,
        )
        await update_appointment_recording(
            appt_id,
            recording_status="failed",
            recording_error=error_msg[:500],
        )
        return {"status": "failed", "error": error_msg, "appointment_id": appt_id}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class RecordingConfigRequest(BaseModel):
    delete_after_transcription: bool = True
    auto_process: bool = True


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@router.post("/cron/process-recordings")
async def cron_process_recordings(
    request: Request,
    _: None = Depends(_verify_cron_secret),
):
    """Poll Drive for new recordings and process them through the STT pipeline.

    This is the main cron endpoint for the recording pipeline, called by
    Cloud Scheduler every 5 minutes.

    Flow:
    1. Find appointments that ended recently and need recording processing
    2. For each, search Drive for the recording
    3. Download, transcribe (STT V2 + diarization), store as encounter
    4. Optionally delete recording from Drive
    5. Trigger reconfirmation flow for recurring appointments

    Protected by X-Cron-Secret header.
    """
    # Get appointments needing recording processing
    appointments = await get_completed_appointments_needing_recording(
        lookback_hours=APPOINTMENT_LOOKBACK_HOURS,
    )

    if not appointments:
        return {"processed": 0, "results": [], "message": "No appointments need processing"}

    logger.info("Found %d appointment(s) needing recording processing", len(appointments))

    results = []
    processed = 0
    failed = 0
    pending = 0

    for appt in appointments:
        # Check recording config for this clinician
        config = await get_recording_config(appt["clinician_id"])
        delete_after = True
        if config:
            delete_after = config.get("delete_after_transcription", True)
            if not config.get("auto_process", True):
                logger.info("Auto-processing disabled for clinician %s, skipping", appt["clinician_id"])
                continue

        result = await process_single_appointment(appt, delete_after=delete_after)
        results.append(result)

        if result["status"] == "completed":
            processed += 1

            # Trigger reconfirmation for recurring appointments
            if appt.get("recurrence_id"):
                try:
                    await _trigger_reconfirmation(appt, request)
                except Exception as e:
                    logger.error(
                        "Failed to trigger reconfirmation for appointment %s: %s",
                        appt["id"], e,
                    )

            # Log audit event
            await log_audit_event(
                user_id=None,
                action="recording_processed",
                resource_type="appointment",
                resource_id=appt["id"],
                ip_address=_client_ip(request),
                user_agent="Cloud Scheduler",
                metadata={
                    "encounter_id": result.get("encounter_id"),
                    "duration_sec": result.get("duration_sec"),
                    "word_count": result.get("word_count"),
                    "recording_deleted": result.get("recording_deleted"),
                },
            )
        elif result["status"] == "failed":
            failed += 1
            await log_audit_event(
                user_id=None,
                action="recording_processing_failed",
                resource_type="appointment",
                resource_id=appt["id"],
                ip_address=_client_ip(request),
                user_agent="Cloud Scheduler",
                metadata={"error": result.get("error", "")[:200]},
            )
        else:
            pending += 1

    return {
        "processed": processed,
        "failed": failed,
        "pending": pending,
        "total": len(appointments),
        "results": results,
    }


async def _trigger_reconfirmation(appointment: dict, request: Request) -> None:
    """Trigger the reconfirmation email flow for the next appointment in a recurring series.

    This is called after a recording is successfully processed, mirroring what
    happens when POST /api/appointments/{id}/reconfirmation is called manually.
    """
    import uuid as uuid_mod

    if not appointment.get("recurrence_id"):
        return

    next_appt = await get_next_appointment_in_series(
        appointment["recurrence_id"],
        appointment["scheduled_at"],
    )
    if not next_appt:
        logger.info("No upcoming appointment in series for reconfirmation (appt %s)", appointment["id"])
        return

    # Generate reconfirmation token and send email
    token = str(uuid_mod.uuid4())
    await set_reconfirmation_sent(next_appt["id"], token)

    # Build action URLs
    from routes.scheduling import _build_reconfirmation_html, _build_reconfirmation_text

    confirm_url = f"{API_BASE_URL}/api/reconfirmation/{token}/confirm"
    change_url = f"{APP_BASE_URL}/reconfirmation/{token}/change"
    cancel_url = f"{API_BASE_URL}/api/reconfirmation/{token}/cancel"

    next_dt = datetime.fromisoformat(next_appt["scheduled_at"])
    date_str = next_dt.strftime("%A, %B %d, %Y")
    time_str = next_dt.strftime("%I:%M %p")

    html = _build_reconfirmation_html(
        client_name=next_appt["client_name"],
        next_appt_date=date_str,
        next_appt_time=time_str,
        confirm_url=confirm_url,
        change_url=change_url,
        cancel_url=cancel_url,
    )
    text = _build_reconfirmation_text(
        client_name=next_appt["client_name"],
        next_appt_date=date_str,
        next_appt_time=time_str,
        confirm_url=confirm_url,
        change_url=change_url,
        cancel_url=cancel_url,
    )

    try:
        from mailer import send_email
        send_email(
            to=next_appt["client_email"],
            subject=f"Confirm Your Next Appointment — {date_str}",
            html_body=html,
            text_body=text,
        )
        logger.info(
            "Sent reconfirmation email for appointment %s (next: %s)",
            appointment["id"], next_appt["id"],
        )
    except Exception as e:
        logger.error("Failed to send reconfirmation email: %s", e)

    await log_audit_event(
        user_id=None,
        action="reconfirmation_sent",
        resource_type="appointment",
        resource_id=next_appt["id"],
        ip_address=_client_ip(request),
        user_agent="Cloud Scheduler (post-recording)",
        metadata={
            "token": token,
            "source_appointment": appointment["id"],
            "trigger": "recording_pipeline",
        },
    )


@router.post("/sessions/process/{appointment_id}")
async def manual_process_recording(
    appointment_id: str,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Manually trigger recording processing for a specific appointment.

    Clinician-only. Non-owners can only process their own appointments.
    Useful for retrying failed processing or manually triggering when
    auto-process is disabled.
    """
    appt = await get_appointment(appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")

    # Non-owners can only process their own appointments
    if not is_owner(user) and appt.get("clinician_id") != user["uid"]:
        raise HTTPException(403, "Access denied — you can only process your own appointments")

    # Check recording config
    config = await get_recording_config(user["uid"])
    delete_after = config.get("delete_after_transcription", True) if config else True

    result = await process_single_appointment(appt, delete_after=delete_after)

    await log_audit_event(
        user_id=user["uid"],
        action="recording_manual_process",
        resource_type="appointment",
        resource_id=appointment_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "result_status": result["status"],
            "encounter_id": result.get("encounter_id"),
        },
    )

    return result


@router.get("/sessions/recording-status")
async def get_recording_statuses(
    request: Request,
    clinician_id: str | None = None,
    user: dict = Depends(require_practice_member()),
):
    """List recent appointments with their recording processing status.

    Returns appointments grouped by recording_status for the clinician dashboard.
    Non-owners see only their own appointments; owners can optionally filter by clinician_id.
    """
    # Non-owners can only see their own recordings
    if not is_owner(user):
        filter_clinician = user["uid"]
    else:
        filter_clinician = clinician_id  # None means all

    # Get appointments with various recording statuses — no PHI in response
    completed = await get_appointments_by_recording_status("completed", limit=20, clinician_id=filter_clinician)
    processing = await get_appointments_by_recording_status("processing", limit=10, clinician_id=filter_clinician)
    failed = await get_appointments_by_recording_status("failed", limit=10, clinician_id=filter_clinician)
    pending = await get_appointments_by_recording_status("pending", limit=10, clinician_id=filter_clinician)

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="recording_status",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {
        "completed": completed,
        "processing": processing,
        "failed": failed,
        "pending": pending,
        "summary": {
            "completed_count": len(completed),
            "processing_count": len(processing),
            "failed_count": len(failed),
            "pending_count": len(pending),
        },
    }


@router.get("/sessions/config")
async def get_session_config(
    user: dict = Depends(require_role("clinician")),
):
    """Get the current recording configuration for the clinician."""
    config = await get_recording_config(user["uid"])
    if not config:
        # Return defaults
        return {
            "delete_after_transcription": True,
            "auto_process": True,
        }
    return config


@router.put("/sessions/config")
async def update_session_config(
    body: RecordingConfigRequest,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Update recording configuration for the clinician.

    Controls:
    - delete_after_transcription: Whether to delete recordings from Drive
      after successful transcription (default: true, recommended for PHI)
    - auto_process: Whether to automatically process recordings via cron
      (default: true)
    """
    config_id = await upsert_recording_config(
        clinician_id=user["uid"],
        delete_after_transcription=body.delete_after_transcription,
        auto_process=body.auto_process,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="updated",
        resource_type="recording_config",
        resource_id=config_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "delete_after_transcription": body.delete_after_transcription,
            "auto_process": body.auto_process,
        },
    )

    return {
        "status": "saved",
        "delete_after_transcription": body.delete_after_transcription,
        "auto_process": body.auto_process,
    }


@router.get("/sessions/{appointment_id}/transcript")
async def get_session_transcript(
    appointment_id: str,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Get the transcript for a specific session/appointment.

    Returns the encounter transcript if recording has been processed.
    Clinicians can view any transcript; clients can only view their own.
    """
    appt = await get_appointment(appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")

    # Access control
    if not is_clinician(user) and appt.get("client_id") != user["uid"]:
        raise HTTPException(403, "Access denied")

    if not appt.get("encounter_id"):
        recording_status = appt.get("recording_status", "unknown")
        raise HTTPException(
            404,
            f"No transcript available. Recording status: {recording_status}",
        )

    # Fetch the encounter
    from db import get_pool
    pool = await get_pool()
    r = await pool.fetchrow(
        """
        SELECT id, client_id, clinician_id, type, source, transcript,
               data, duration_sec, status, created_at
        FROM encounters
        WHERE id = $1::uuid
        """,
        appt["encounter_id"],
    )

    if not r:
        raise HTTPException(404, "Encounter not found")

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="session_transcript",
        resource_id=appointment_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"encounter_id": str(r["id"])},
    )

    return {
        "encounter_id": str(r["id"]),
        "appointment_id": appointment_id,
        "transcript": r["transcript"],
        "data": r["data"],
        "duration_sec": r["duration_sec"],
        "status": r["status"],
        "created_at": r["created_at"].isoformat(),
    }
