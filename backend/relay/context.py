"""Context injection and compression for voice sessions.

Loads prior transcripts for a client and either injects them raw (if under
the token budget) or compresses them via Gemini 3 Flash into a structured
client profile.
"""
import logging

from google import genai
from google.genai import types

from config import PROJECT_ID, REGION

logger = logging.getLogger(__name__)

# Approximate tokens per character (conservative estimate for English text)
CHARS_PER_TOKEN = 4
# Threshold: inject raw transcripts below this, compress above
RAW_INJECTION_TOKEN_LIMIT = 50_000
RAW_INJECTION_CHAR_LIMIT = RAW_INJECTION_TOKEN_LIMIT * CHARS_PER_TOKEN  # ~200K chars

COMPRESSION_MODEL = "gemini-3-flash-preview"

COMPRESSION_PROMPT = """You are compressing clinical session history for a behavioral health client.
Your output will be injected into a voice AI intake session so the AI can continue
the conversation seamlessly with full knowledge of the client.

Preserve ALL clinically relevant information with ZERO data loss. Include:
- Client identity: name, preferred name, pronouns, date of birth
- Emergency contact details
- Presenting concerns and what brought them to treatment
- Therapy and treatment history
- Current medications and medical conditions
- Goals for treatment
- Rapport notes: tone, communication style, sensitivities, things they responded well to
- Any other details discussed in prior sessions

Output a structured client profile in natural language. Be thorough and precise.
Do not add information that was not discussed. Do not editorialize.

PRIOR SESSION TRANSCRIPTS:
"""


def estimate_tokens(text: str) -> int:
    """Rough token count estimate. ~4 chars per token for English."""
    return len(text) // CHARS_PER_TOKEN


def build_prior_context(transcripts: list[dict]) -> str:
    """Format prior transcripts into a context block for the system prompt."""
    if not transcripts:
        return ""

    parts = []
    for t in transcripts:
        date = t.get("created_at", "unknown date")
        source = t.get("source", "unknown")
        parts.append(f"--- Session ({source}, {date}) ---\n{t['transcript']}")

    return "\n\n".join(parts)


async def get_context_for_client(transcripts: list[dict]) -> str:
    """Build context string for injection into the Gemini Live system prompt.

    If prior transcripts are under 50K tokens, returns them raw.
    If over, compresses via Gemini 3 Flash.
    """
    if not transcripts:
        return ""

    raw_context = build_prior_context(transcripts)
    token_estimate = estimate_tokens(raw_context)

    if token_estimate <= RAW_INJECTION_TOKEN_LIMIT:
        logger.info(
            "Injecting raw context: %d transcripts, ~%d tokens",
            len(transcripts), token_estimate,
        )
        return raw_context

    logger.info(
        "Compressing context: %d transcripts, ~%d tokens (over %d limit)",
        len(transcripts), token_estimate, RAW_INJECTION_TOKEN_LIMIT,
    )
    return await compress_context(raw_context)


async def compress_context(text: str) -> str:
    """Compress transcript history via Gemini 3 Flash into a client profile."""
    client = genai.Client(vertexai=True, project=PROJECT_ID, location=REGION)

    try:
        response = await client.aio.models.generate_content(
            model=COMPRESSION_MODEL,
            contents=COMPRESSION_PROMPT + text,
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_budget=500),
                temperature=0.1,
            ),
        )

        result = response.text
        if not result:
            logger.error("Compression returned empty response, falling back to truncation")
            return _truncate_context(text)

        compressed_tokens = estimate_tokens(result)
        original_tokens = estimate_tokens(text)
        logger.info(
            "Compressed %d tokens → %d tokens (%.0f%% reduction)",
            original_tokens, compressed_tokens,
            (1 - compressed_tokens / original_tokens) * 100,
        )
        return f"--- Compressed Client Profile ---\n{result}"

    except Exception as e:
        logger.error("Compression failed: %s: %s — falling back to truncation", type(e).__name__, e)
        return _truncate_context(text)


async def compress_mid_session(
    prior_context: str,
    current_transcript: str,
) -> str:
    """Mid-session compression: compress all prior context + current transcript.

    Called when the Gemini Live session is nearing its token limit.
    Returns a compressed context string for the new session.
    """
    full_text = prior_context
    if current_transcript.strip():
        full_text += f"\n\n--- Current Session (in progress) ---\n{current_transcript}"

    return await compress_context(full_text)


def _truncate_context(text: str, max_chars: int = 80_000) -> str:
    """Fallback: truncate to the most recent portion that fits."""
    if len(text) <= max_chars:
        return text
    return "... [earlier history truncated] ...\n\n" + text[-max_chars:]
