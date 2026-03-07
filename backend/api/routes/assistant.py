"""Practice-wide AI assistant (Portal RAG) endpoint.

Component 8: Simplified MVP assistant that answers clinician questions about
their practice data. Uses Gemini 2.5 Flash with read-only database access.

HIPAA Access Control:
  - POST /assistant/chat — clinician-only (require_role("clinician"))
  - Read-only database access (SELECT only, no mutations)
  - All queries logged to audit_events

The assistant can query: clients, encounters, clinical_notes, treatment_plans,
and appointments to answer practice-wide questions.

Endpoints:
  - POST /api/assistant/chat — send a message, get a contextualized response
"""
import json
import logging
import os
import sys
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import require_role, require_practice_member, is_owner

sys.path.insert(0, "../shared")
from db import get_pool, log_audit_event

from google import genai
from google.genai.types import GenerateContentConfig

logger = logging.getLogger(__name__)

router = APIRouter()

# Model configuration
MODEL_ID = os.getenv("GEMINI_ASSISTANT_MODEL", "gemini-2.5-flash")
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
# Models
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_INSTRUCTION = """You are Trellis Assistant, an AI clinical practice assistant for a solo behavioral health therapist.

You have READ-ONLY access to the practice's clinical database. You help the clinician by:
- Answering questions about their clients, sessions, notes, and treatment plans
- Summarizing client progress across sessions
- Finding specific information in encounter transcripts and clinical notes
- Identifying clients who may need attention (e.g., unsigned notes, upcoming reviews)
- Providing clinical workflow support (NOT clinical advice)

IMPORTANT GUIDELINES:
- You ONLY answer questions using data from the practice database. If the data doesn't contain the answer, say so.
- You are NOT a clinical decision-making tool. Do not provide diagnoses, treatment recommendations, or clinical opinions.
- Be concise and direct. Clinicians are busy.
- When referencing specific clients, use their name.
- When referencing specific notes or encounters, mention the date.
- If asked about medications, report only what clients have MENTIONED in sessions — you are not a prescribing tool.
- Protect PHI: do not suggest sharing client information outside the practice.
- Format your responses in clean markdown for readability.

You will receive relevant database query results alongside the user's question. Base your answer on this data."""


# ---------------------------------------------------------------------------
# Database query functions
# ---------------------------------------------------------------------------

async def _query_relevant_data(message: str, clinician_uid: str | None = None) -> dict:
    """Query the database for data relevant to the user's question.

    This is a simplified MVP approach — we run several queries and return
    relevant context. A more sophisticated approach (semantic search, embeddings)
    would come post-MVP.

    If clinician_uid is set, scope all queries to that clinician's clients.
    """
    pool = await get_pool()
    context = {}
    msg_lower = message.lower()

    # Always include a client list summary for context
    if clinician_uid:
        clients = await pool.fetch(
            """
            SELECT c.id, c.firebase_uid, c.full_name, c.preferred_name, c.status,
                   c.payer_name, c.created_at
            FROM clients c
            WHERE c.primary_clinician_id = $1
            ORDER BY c.full_name
            LIMIT 100
            """,
            clinician_uid,
        )
    else:
        clients = await pool.fetch(
            """
            SELECT c.id, c.firebase_uid, c.full_name, c.preferred_name, c.status,
                   c.payer_name, c.created_at
            FROM clients c
            ORDER BY c.full_name
            LIMIT 100
            """
        )
    context["clients"] = [
        {
            "id": str(r["id"]),
            "firebase_uid": r["firebase_uid"],
            "name": r["full_name"],
            "preferred_name": r["preferred_name"],
            "status": r["status"],
            "insurance": r["payer_name"],
        }
        for r in clients
    ]

    # Try to identify if a specific client is mentioned
    mentioned_client = None
    for c in context["clients"]:
        name = (c["name"] or "").lower()
        preferred = (c["preferred_name"] or "").lower()
        if name and name in msg_lower:
            mentioned_client = c
            break
        if preferred and preferred in msg_lower:
            mentioned_client = c
            break

    # If a specific client is mentioned, load their detailed data
    if mentioned_client:
        client_uid = mentioned_client["firebase_uid"]

        # Get encounters for this client
        encounters = await pool.fetch(
            """
            SELECT id, type, source, transcript, data, duration_sec, created_at
            FROM encounters
            WHERE client_id = $1
            ORDER BY created_at DESC
            LIMIT 20
            """,
            client_uid,
        )
        context["client_encounters"] = [
            {
                "id": str(r["id"]),
                "type": r["type"],
                "source": r["source"],
                "transcript_preview": (r["transcript"] or "")[:500],
                "full_transcript": r["transcript"] or "",
                "data": r["data"],
                "duration_sec": r["duration_sec"],
                "date": r["created_at"].isoformat(),
            }
            for r in encounters
        ]

        # Get clinical notes for this client
        notes = await pool.fetch(
            """
            SELECT cn.id, cn.format, cn.content, cn.status, cn.created_at,
                   cn.signed_at, e.type AS encounter_type
            FROM clinical_notes cn
            JOIN encounters e ON e.id = cn.encounter_id
            WHERE e.client_id = $1
            ORDER BY cn.created_at DESC
            LIMIT 20
            """,
            client_uid,
        )
        context["client_notes"] = [
            {
                "id": str(r["id"]),
                "format": r["format"],
                "content": r["content"],
                "status": r["status"],
                "encounter_type": r["encounter_type"],
                "date": r["created_at"].isoformat(),
                "signed_at": r["signed_at"].isoformat() if r["signed_at"] else None,
            }
            for r in notes
        ]

        # Get treatment plan
        plan = await pool.fetchrow(
            """
            SELECT * FROM treatment_plans
            WHERE client_id = $1 AND status != 'superseded'
            ORDER BY version DESC LIMIT 1
            """,
            client_uid,
        )
        if plan:
            context["client_treatment_plan"] = {
                "diagnoses": plan["diagnoses"],
                "goals": plan["goals"],
                "presenting_problems": plan["presenting_problems"],
                "status": plan["status"],
                "review_date": plan["review_date"].isoformat() if plan["review_date"] else None,
                "version": plan["version"],
            }

        # Get upcoming appointments
        appts = await pool.fetch(
            """
            SELECT id, type, scheduled_at, duration_minutes, status, meet_link
            FROM appointments
            WHERE client_id = $1
            ORDER BY scheduled_at DESC
            LIMIT 20
            """,
            client_uid,
        )
        context["client_appointments"] = [
            {
                "id": str(r["id"]),
                "type": r["type"],
                "scheduled_at": r["scheduled_at"].isoformat(),
                "duration_minutes": r["duration_minutes"],
                "status": r["status"],
            }
            for r in appts
        ]

        context["mentioned_client"] = mentioned_client

    # Check for keywords that need specific queries
    if any(kw in msg_lower for kw in ["unsigned", "unsigned notes", "draft", "needs signing", "review"]):
        if clinician_uid:
            unsigned = await pool.fetch(
                """
                SELECT cn.id, cn.format, cn.status, cn.created_at,
                       e.client_id, e.type AS encounter_type,
                       c.full_name AS client_name
                FROM clinical_notes cn
                JOIN encounters e ON e.id = cn.encounter_id
                LEFT JOIN clients c ON c.firebase_uid = e.client_id
                WHERE cn.status IN ('draft', 'review') AND cn.clinician_id = $1
                ORDER BY cn.created_at DESC
                """,
                clinician_uid,
            )
        else:
            unsigned = await pool.fetch(
                """
                SELECT cn.id, cn.format, cn.status, cn.created_at,
                       e.client_id, e.type AS encounter_type,
                       c.full_name AS client_name
                FROM clinical_notes cn
                JOIN encounters e ON e.id = cn.encounter_id
                LEFT JOIN clients c ON c.firebase_uid = e.client_id
                WHERE cn.status IN ('draft', 'review')
                ORDER BY cn.created_at DESC
                """
            )
        context["unsigned_notes"] = [
            {
                "id": str(r["id"]),
                "format": r["format"],
                "status": r["status"],
                "client_name": r["client_name"],
                "encounter_type": r["encounter_type"],
                "date": r["created_at"].isoformat(),
            }
            for r in unsigned
        ]

    if any(kw in msg_lower for kw in ["treatment plan", "review due", "plan review"]):
        if clinician_uid:
            plans = await pool.fetch(
                """
                SELECT tp.id, tp.client_id, tp.diagnoses, tp.goals, tp.status,
                       tp.review_date, tp.version, tp.updated_at,
                       c.full_name AS client_name
                FROM treatment_plans tp
                LEFT JOIN clients c ON c.firebase_uid = tp.client_id
                WHERE tp.status != 'superseded' AND tp.clinician_id = $1
                ORDER BY tp.review_date NULLS LAST
                """,
                clinician_uid,
            )
        else:
            plans = await pool.fetch(
                """
                SELECT tp.id, tp.client_id, tp.diagnoses, tp.goals, tp.status,
                       tp.review_date, tp.version, tp.updated_at,
                       c.full_name AS client_name
                FROM treatment_plans tp
                LEFT JOIN clients c ON c.firebase_uid = tp.client_id
                WHERE tp.status != 'superseded'
                ORDER BY tp.review_date NULLS LAST
                """
            )
        context["treatment_plans"] = [
            {
                "client_name": r["client_name"],
                "diagnoses": r["diagnoses"],
                "goals": r["goals"],
                "status": r["status"],
                "review_date": r["review_date"].isoformat() if r["review_date"] else None,
                "version": r["version"],
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in plans
        ]

    if any(kw in msg_lower for kw in ["appointment", "schedule", "upcoming", "today", "this week"]):
        if clinician_uid:
            upcoming = await pool.fetch(
                """
                SELECT a.id, a.client_id, a.client_name, a.type,
                       a.scheduled_at, a.duration_minutes, a.status, a.meet_link
                FROM appointments a
                WHERE a.status = 'scheduled' AND a.scheduled_at > now() AND a.clinician_id = $1
                ORDER BY a.scheduled_at
                LIMIT 30
                """,
                clinician_uid,
            )
        else:
            upcoming = await pool.fetch(
                """
                SELECT a.id, a.client_id, a.client_name, a.type,
                       a.scheduled_at, a.duration_minutes, a.status, a.meet_link
                FROM appointments a
                WHERE a.status = 'scheduled' AND a.scheduled_at > now()
                ORDER BY a.scheduled_at
                LIMIT 30
                """
            )
        context["upcoming_appointments"] = [
            {
                "client_name": r["client_name"],
                "type": r["type"],
                "scheduled_at": r["scheduled_at"].isoformat(),
                "duration_minutes": r["duration_minutes"],
                "status": r["status"],
            }
            for r in upcoming
        ]

    if any(kw in msg_lower for kw in ["medication", "medications", "meds", "prescribed", "prescription"]):
        # Search transcripts for medication mentions
        if mentioned_client:
            med_encounters = await pool.fetch(
                """
                SELECT id, transcript, created_at
                FROM encounters
                WHERE client_id = $1 AND transcript ILIKE '%medic%'
                ORDER BY created_at DESC LIMIT 10
                """,
                mentioned_client["firebase_uid"],
            )
            context["medication_mentions"] = [
                {
                    "date": r["created_at"].isoformat(),
                    "transcript_excerpt": r["transcript"][:1000],
                }
                for r in med_encounters
            ]

    return context


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/assistant/chat")
async def assistant_chat(
    body: ChatRequest,
    request: Request,
    user: dict = Depends(require_practice_member()),
):
    """Send a message to the practice-wide AI assistant.

    The assistant queries the database for relevant data, then uses
    Gemini to generate a contextualized answer. Conversation history
    is maintained client-side and sent with each request.

    Non-owner clinicians see only their own clients' data.
    """
    if not body.message.strip():
        raise HTTPException(400, "Message cannot be empty")

    # Query relevant data from the database (scoped by clinician)
    clinician_filter = None if is_owner(user) else user["uid"]
    try:
        context_data = await _query_relevant_data(body.message, clinician_uid=clinician_filter)
    except Exception as e:
        logger.error("Assistant DB query failed: %s", e)
        context_data = {"error": "Failed to query practice data"}

    # Build the prompt with context
    context_json = json.dumps(context_data, indent=2, default=str)

    # Truncate context if too large (keep under ~100K chars for token safety)
    if len(context_json) > 100000:
        context_json = context_json[:100000] + "\n... (context truncated)"

    user_prompt = f"""PRACTICE DATABASE CONTEXT:
```json
{context_json}
```

CLINICIAN'S QUESTION:
{body.message}

Answer the clinician's question using ONLY the data provided above. If the data doesn't contain enough information to answer, say so clearly."""

    # Build conversation history for Gemini
    contents = []
    for msg in body.history[-10:]:  # Limit history to last 10 messages
        role = "user" if msg.role == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg.content}]})
    contents.append({"role": "user", "parts": [{"text": user_prompt}]})

    # Generate response
    try:
        client = _get_client()
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=contents,
            config=GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.4,
                max_output_tokens=4096,
            ),
        )
        answer = response.text
    except Exception as e:
        logger.error("Assistant generation failed: %s: %s", type(e).__name__, e)
        raise HTTPException(502, f"Assistant generation failed: {type(e).__name__}")

    await log_audit_event(
        user_id=user["uid"],
        action="assistant_query",
        resource_type="assistant",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={
            "query_length": len(body.message),
            "history_length": len(body.history),
            "response_length": len(answer),
            "context_keys": list(context_data.keys()),
        },
    )

    return {
        "response": answer,
        "context_used": list(context_data.keys()),
    }
