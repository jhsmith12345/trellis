"""Shared fixtures and helpers for Trellis API tests.

Uses the real database (Cloud SQL) with DEV_MODE=1 for JWT bypass.
All GCP services (Calendar, Gmail, Drive, Vision, AI) are mocked.
"""
import base64
import json
import os
import sys
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# ---------------------------------------------------------------------------
# Environment setup — must happen BEFORE importing the app
# ---------------------------------------------------------------------------
os.environ["DEV_MODE"] = "1"
os.environ["DATABASE_URL"] = (
    "postgresql://postgres:trellis-dev-2026@34.172.69.164:5432/trellis"
)
os.environ["CRON_SECRET"] = "dev-cron-secret"
os.environ["GCP_PROJECT_ID"] = "trellis-mvp"
os.environ["GCP_REGION"] = "us-central1"

# Add this directory to sys.path so tests can `from conftest import ...`
_this_dir = os.path.abspath(os.path.dirname(__file__))
if _this_dir not in sys.path:
    sys.path.insert(0, _this_dir)

# Add backend paths so imports resolve
api_dir = os.path.join(os.path.dirname(__file__), "../../backend/api")
shared_dir = os.path.join(os.path.dirname(__file__), "../../backend/shared")
sys.path.insert(0, os.path.abspath(api_dir))
sys.path.insert(0, os.path.abspath(shared_dir))

from main import app  # noqa: E402

# ---------------------------------------------------------------------------
# Token helper
# ---------------------------------------------------------------------------

def make_token(uid: str = "test-clinician-1", email: str = "test@hansmith.com") -> str:
    """Build a fake JWT accepted by DEV_MODE auth."""
    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "none"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = (
        base64.urlsafe_b64encode(
            json.dumps({"user_id": uid, "email": email, "sub": uid}).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    return f"{header}.{payload}.fake"


# Convenience tokens
CLINICIAN_TOKEN = make_token("test-clinician-1", "test@hansmith.com")
CLIENT_TOKEN = make_token("test-client-1", "client@example.com")
CLIENT2_TOKEN = make_token("test-client-2", "client2@example.com")


def clinician_headers():
    return {"Authorization": f"Bearer {CLINICIAN_TOKEN}"}


def client_headers():
    return {"Authorization": f"Bearer {CLIENT_TOKEN}"}


def client2_headers():
    return {"Authorization": f"Bearer {CLIENT2_TOKEN}"}


# ---------------------------------------------------------------------------
# Unique test data helpers — prevent collisions across test runs
# ---------------------------------------------------------------------------

TEST_RUN_ID = uuid.uuid4().hex[:8]


def unique_uid(base: str) -> str:
    """Generate a unique UID for test data to avoid collisions."""
    return f"{base}-{TEST_RUN_ID}"


# ---------------------------------------------------------------------------
# AsyncClient fixture
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def client():
    # Reset the db pool so it is created on THIS test's event loop
    import db as _db_module
    _db_module._pool = None

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Close the pool after the test so the next test starts fresh
    if _db_module._pool is not None:
        await _db_module._pool.close()
        _db_module._pool = None


# ---------------------------------------------------------------------------
# GCP service mocks (autouse) — prevent real API calls
# ---------------------------------------------------------------------------

# Track sent emails for assertions
_sent_emails: list[dict] = []


def _mock_send_email(to, subject, html_body, text_body=None):
    _sent_emails.append(
        {"to": to, "subject": subject, "html_body": html_body, "text_body": text_body}
    )


def _mock_send_email_with_attachment(
    to, subject, html_body, text_body=None,
    attachment_data=None, attachment_filename=None, attachment_mime_type=None,
):
    _sent_emails.append(
        {"to": to, "subject": subject, "html_body": html_body, "text_body": text_body,
         "attachment_filename": attachment_filename}
    )


@pytest.fixture(autouse=True)
def mock_gcp_services():
    """Mock all GCP service calls to prevent real API traffic."""
    _sent_emails.clear()

    patches = []

    # --- Google Calendar ---
    # Imported in scheduling.py as: from gcal import create_calendar_event, ...
    # Also in clients.py (discharge), sessions.py, documents.py
    gcal_create = patch(
        "gcal.create_calendar_event",
        return_value=("https://meet.google.com/test-123", "test-event-123"),
    )
    gcal_delete = patch("gcal.delete_calendar_event", return_value=None)
    gcal_update = patch("gcal.update_calendar_event", return_value=None)
    gcal_get_recording = patch(
        "gcal.get_meet_recording_for_event", return_value=None
    )
    gcal_download = patch(
        "gcal.download_recording", return_value=None
    )
    gcal_delete_drive = patch("gcal.delete_drive_file", return_value=True)

    # --- Gmail ---
    mail_send = patch("mailer.send_email", side_effect=_mock_send_email)
    mail_send_attach = patch(
        "mailer.send_email_with_attachment",
        side_effect=_mock_send_email_with_attachment,
    )

    # --- AI generators ---
    note_gen = patch(
        "note_generator.generate_note",
        new_callable=AsyncMock,
        return_value={
            "format": "SOAP",
            "content": {
                "subjective": "Client reported feeling better.",
                "objective": "Client appeared calm and engaged.",
                "assessment": "Progress toward goals.",
                "plan": "Continue current treatment approach.",
            },
        },
    )
    note_regen = patch(
        "note_generator.regenerate_note",
        new_callable=AsyncMock,
        return_value={
            "format": "SOAP",
            "content": {
                "subjective": "Updated subjective after feedback.",
                "objective": "Updated objective.",
                "assessment": "Updated assessment.",
                "plan": "Updated plan.",
            },
        },
    )
    tp_gen = patch(
        "treatment_plan_generator.generate_treatment_plan",
        new_callable=AsyncMock,
        return_value={
            "diagnoses": [{"code": "F41.1", "description": "Generalized anxiety disorder"}],
            "goals": [
                {
                    "description": "Reduce anxiety symptoms",
                    "objectives": [
                        {"description": "Practice deep breathing daily", "target_date": "2026-06-01"}
                    ],
                }
            ],
            "presenting_problems": "Generalized anxiety with sleep disturbance",
            "review_date": "2026-06-01",
        },
    )
    tp_update = patch(
        "treatment_plan_generator.update_treatment_plan",
        new_callable=AsyncMock,
        return_value={
            "diagnoses": [{"code": "F41.1", "description": "Generalized anxiety disorder"}],
            "goals": [
                {
                    "description": "Updated goal",
                    "objectives": [
                        {"description": "Updated objective", "target_date": "2026-09-01"}
                    ],
                }
            ],
            "presenting_problems": "Updated presenting problems",
            "review_date": "2026-09-01",
        },
    )
    discharge_gen = patch(
        "discharge_generator.generate_discharge_summary",
        new_callable=AsyncMock,
        return_value={
            "format": "discharge",
            "content": {
                "reason_for_treatment": "Anxiety management",
                "course_of_treatment": "8 sessions of CBT",
                "progress_toward_goals": "Significant improvement",
                "diagnoses_at_discharge": "F41.1",
                "discharge_recommendations": "Continue self-care practices",
                "medications_at_discharge": "None",
                "risk_assessment": "Low risk",
                "clinical_summary": "Client made significant progress.",
            },
        },
    )

    # --- Vision ---
    vision_extract = patch(
        "vision.extract_insurance_card",
        new_callable=AsyncMock,
        return_value={
            "payer_name": "Blue Cross Blue Shield",
            "member_id": "XYZ123456",
            "group_number": "GRP789",
            "plan_name": "PPO Gold",
            "plan_type": "PPO",
            "subscriber_name": "Test Client",
        },
    )

    # --- Alerts ---
    alerts_notify = patch("alerts.notify_bd_new_intake", return_value=None)

    # --- PDF generators ---
    note_pdf = patch(
        "note_pdf.generate_note_pdf",
        return_value=b"%PDF-1.4 fake note pdf content",
    )
    tp_pdf = patch(
        "treatment_plan_pdf.generate_treatment_plan_pdf",
        return_value=b"%PDF-1.4 fake treatment plan pdf content",
    )
    sb_pdf = patch(
        "superbill_pdf.generate_superbill_pdf",
        return_value=b"%PDF-1.4 fake superbill pdf content",
    )

    # --- Gemini (assistant) ---
    # The assistant imports google.genai directly at module level
    gemini_mock = MagicMock()
    gemini_mock.text = "This is a test assistant response."
    gemini_client_mock = MagicMock()
    gemini_client_mock.models.generate_content.return_value = gemini_mock
    assistant_client = patch(
        "routes.assistant._get_client",
        return_value=gemini_client_mock,
    )

    # --- Patches at import-use locations ---
    # When a route does `from X import func`, patching X.func doesn't affect
    # the already-imported reference. We must also patch routes.module.func.

    # gcal functions used in scheduling, clients, sessions
    gcal_create_sched = patch(
        "routes.scheduling.create_calendar_event",
        return_value=("https://meet.google.com/test-123", "test-event-123"),
    )
    gcal_delete_sched = patch("routes.scheduling.delete_calendar_event", return_value=None)
    gcal_update_sched = patch("routes.scheduling.update_calendar_event", return_value=None)
    gcal_delete_clients = patch("routes.clients.delete_calendar_event", return_value=None)
    gcal_sess_get = patch("routes.sessions.get_meet_recording_for_event", return_value=None)
    gcal_sess_dl = patch("routes.sessions.download_recording", return_value=None)
    gcal_sess_del = patch("routes.sessions.delete_drive_file", return_value=True)

    # mailer used in scheduling, documents, billing (billing imports lazily so module-level patch works)
    mail_send_sched = patch("routes.scheduling.send_email", side_effect=_mock_send_email)
    mail_send_docs = patch("routes.documents.send_email", side_effect=_mock_send_email)

    # note_generator used in notes
    note_gen_routes = patch(
        "routes.notes.generate_note",
        new_callable=AsyncMock,
        return_value={
            "format": "SOAP",
            "content": {
                "subjective": "Client reported feeling better.",
                "objective": "Client appeared calm and engaged.",
                "assessment": "Progress toward goals.",
                "plan": "Continue current treatment approach.",
            },
        },
    )
    note_regen_routes = patch(
        "routes.notes.regenerate_note",
        new_callable=AsyncMock,
        return_value={
            "format": "SOAP",
            "content": {
                "subjective": "Updated subjective after feedback.",
                "objective": "Updated objective.",
                "assessment": "Updated assessment.",
                "plan": "Updated plan.",
            },
        },
    )
    note_pdf_routes = patch(
        "routes.notes.generate_note_pdf",
        return_value=b"%PDF-1.4 fake note pdf content",
    )

    # treatment_plan_generator used in notes and treatment_plans
    tp_gen_notes = patch(
        "routes.notes.ai_generate_plan",
        new_callable=AsyncMock,
        return_value={
            "diagnoses": [{"code": "F41.1", "description": "Generalized anxiety disorder"}],
            "goals": [{"description": "Reduce anxiety", "objectives": [{"description": "Practice daily", "target_date": "2026-06-01"}]}],
            "presenting_problems": "Anxiety",
            "review_date": "2026-06-01",
        },
    )
    tp_gen_tp_routes = patch(
        "routes.treatment_plans.generate_treatment_plan",
        new_callable=AsyncMock,
        return_value={
            "diagnoses": [{"code": "F41.1", "description": "Generalized anxiety disorder"}],
            "goals": [{"description": "Reduce anxiety symptoms", "objectives": [{"description": "Practice deep breathing daily", "target_date": "2026-06-01"}]}],
            "presenting_problems": "Generalized anxiety with sleep disturbance",
            "review_date": "2026-06-01",
        },
    )
    tp_update_routes = patch(
        "routes.treatment_plans.ai_update_plan",
        new_callable=AsyncMock,
        return_value={
            "diagnoses": [{"code": "F41.1", "description": "Generalized anxiety disorder"}],
            "goals": [{"description": "Updated goal", "objectives": [{"description": "Updated objective", "target_date": "2026-09-01"}]}],
            "presenting_problems": "Updated presenting problems",
            "review_date": "2026-09-01",
        },
    )
    tp_pdf_routes = patch(
        "routes.treatment_plans.generate_treatment_plan_pdf",
        return_value=b"%PDF-1.4 fake treatment plan pdf content",
    )

    # superbill_pdf used in billing
    sb_pdf_routes = patch(
        "routes.billing.generate_superbill_pdf",
        return_value=b"%PDF-1.4 fake superbill pdf content",
    )

    # vision used in clients
    vision_routes = patch(
        "routes.clients.extract_insurance_card",
        new_callable=AsyncMock,
        return_value={
            "payer_name": "Blue Cross Blue Shield",
            "member_id": "XYZ123456",
            "group_number": "GRP789",
            "plan_name": "PPO Gold",
            "plan_type": "PPO",
            "subscriber_name": "Test Client",
        },
    )

    # discharge_generator used in clients
    discharge_gen_routes = patch(
        "routes.clients.generate_discharge_summary",
        new_callable=AsyncMock,
        return_value={
            "format": "discharge",
            "content": {
                "reason_for_treatment": "Anxiety management",
                "course_of_treatment": "8 sessions of CBT",
                "progress_toward_goals": "Significant improvement",
                "diagnoses_at_discharge": "F41.1",
                "discharge_recommendations": "Continue self-care practices",
                "medications_at_discharge": "None",
                "risk_assessment": "Low risk",
                "clinical_summary": "Client made significant progress.",
            },
        },
    )

    # alerts used in intake
    alerts_intake = patch("routes.intake.notify_bd_new_intake", return_value=None)

    all_patches = [
        gcal_create, gcal_delete, gcal_update, gcal_get_recording,
        gcal_download, gcal_delete_drive,
        mail_send, mail_send_attach,
        note_gen, note_regen, tp_gen, tp_update, discharge_gen,
        vision_extract,
        alerts_notify,
        note_pdf, tp_pdf, sb_pdf,
        assistant_client,
        # Import-use location patches
        gcal_create_sched, gcal_delete_sched, gcal_update_sched,
        gcal_delete_clients, gcal_sess_get, gcal_sess_dl, gcal_sess_del,
        mail_send_sched, mail_send_docs,
        note_gen_routes, note_regen_routes, note_pdf_routes,
        tp_gen_notes, tp_gen_tp_routes, tp_update_routes, tp_pdf_routes,
        sb_pdf_routes, vision_routes, discharge_gen_routes, alerts_intake,
    ]

    mocks = {}
    for p in all_patches:
        mocks[p.attribute] = p.start()
        patches.append(p)

    yield mocks

    for p in patches:
        p.stop()


@pytest.fixture
def sent_emails():
    """Access the list of emails sent during this test."""
    return _sent_emails


# ---------------------------------------------------------------------------
# Database cleanup — remove test data after each test
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(autouse=True)
async def cleanup_test_data():
    """Clean up test data created during each test.

    Uses a fresh asyncpg connection (not the app pool) to avoid event loop
    conflicts between the ASGI app and the test fixture teardown.
    """
    yield

    import asyncpg

    conn = await asyncpg.connect(os.environ["DATABASE_URL"].replace(
        "postgresql://", "postgresql://"
    ))

    try:
        # Delete test data in dependency order
        test_uids = [
            "test-clinician-1", "test-client-1", "test-client-2",
            f"test-clinician-1-{TEST_RUN_ID}",
            f"test-client-1-{TEST_RUN_ID}",
            f"test-client-2-{TEST_RUN_ID}",
        ]

        client_uids = test_uids

        # Superbills
        await conn.execute(
            "DELETE FROM superbills WHERE client_id = ANY($1::text[])",
            client_uids,
        )

        # Clinical notes (via encounters)
        await conn.execute(
            """
            DELETE FROM clinical_notes WHERE encounter_id IN (
                SELECT id FROM encounters WHERE client_id = ANY($1::text[])
            )
            """,
            client_uids,
        )

        # Treatment plans
        await conn.execute(
            "DELETE FROM treatment_plans WHERE client_id = ANY($1::text[])",
            client_uids,
        )

        # Encounters
        await conn.execute(
            "DELETE FROM encounters WHERE client_id = ANY($1::text[])",
            client_uids,
        )

        # Appointments
        await conn.execute(
            "DELETE FROM appointments WHERE client_id = ANY($1::text[]) OR clinician_id = ANY($1::text[])",
            client_uids,
        )

        # Documents / document packages
        await conn.execute(
            """
            DELETE FROM documents WHERE package_id IN (
                SELECT id FROM document_packages WHERE client_id = ANY($1::text[])
            )
            """,
            client_uids,
        )
        await conn.execute(
            "DELETE FROM document_packages WHERE client_id = ANY($1::text[])",
            client_uids,
        )

        # Stored signatures
        await conn.execute(
            "DELETE FROM stored_signatures WHERE user_id = ANY($1::text[])",
            client_uids,
        )

        # Clinician availability
        await conn.execute(
            "DELETE FROM clinician_availability WHERE clinician_id = ANY($1::text[])",
            client_uids,
        )

        # Recording config
        await conn.execute(
            "DELETE FROM recording_config WHERE clinician_id = ANY($1::text[])",
            client_uids,
        )

        # Practice profile
        await conn.execute(
            "DELETE FROM practice_profile WHERE clinician_uid = ANY($1::text[])",
            client_uids,
        )

        # Clients
        await conn.execute(
            "DELETE FROM clients WHERE firebase_uid = ANY($1::text[])",
            client_uids,
        )

        # Audit events (clean up test audit data)
        await conn.execute(
            "DELETE FROM audit_events WHERE user_id = ANY($1::text[])",
            client_uids,
        )

        # Users
        await conn.execute(
            "DELETE FROM users WHERE firebase_uid = ANY($1::text[])",
            client_uids,
        )
    finally:
        await conn.close()
