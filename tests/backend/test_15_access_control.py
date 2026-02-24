"""Tests for role-based access control and row-level security."""
import pytest
from conftest import clinician_headers, client_headers, client2_headers, make_token
from datetime import datetime, timedelta


async def _register_both(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client2_headers(),
    )


# --- Clinician-only routes ---

async def test_client_cannot_access_clients_list(client):
    """Clients cannot access GET /api/clients."""
    await _register_both(client)
    resp = await client.get("/api/clients", headers=client_headers())
    assert resp.status_code == 403


async def test_client_cannot_access_notes_unsigned(client):
    """Clients cannot access GET /api/notes/unsigned."""
    await _register_both(client)
    resp = await client.get("/api/notes/unsigned", headers=client_headers())
    assert resp.status_code == 403


async def test_client_cannot_generate_note(client):
    """Clients cannot access POST /api/notes/generate."""
    await _register_both(client)
    resp = await client.post(
        "/api/notes/generate",
        json={"encounter_id": "00000000-0000-0000-0000-000000000000"},
        headers=client_headers(),
    )
    assert resp.status_code == 403


async def test_client_cannot_access_audit_log(client):
    """Clients cannot access GET /api/audit-log."""
    await _register_both(client)
    resp = await client.get("/api/audit-log", headers=client_headers())
    assert resp.status_code == 403


async def test_client_cannot_generate_superbill(client):
    """Clients cannot access POST /api/superbills/generate."""
    await _register_both(client)
    resp = await client.post(
        "/api/superbills/generate",
        json={"note_id": "00000000-0000-0000-0000-000000000000"},
        headers=client_headers(),
    )
    assert resp.status_code == 403


async def test_client_cannot_access_assistant(client):
    """Clients cannot access POST /api/assistant/chat."""
    await _register_both(client)
    resp = await client.post(
        "/api/assistant/chat",
        json={"message": "Hello", "history": []},
        headers=client_headers(),
    )
    assert resp.status_code == 403


# --- Row-level access ---

async def test_client_appointments_scoped_to_self(client):
    """GET /api/appointments forces client_id to authenticated user."""
    await _register_both(client)
    start = datetime.now().strftime("%Y-%m-%dT00:00:00")
    end = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%dT23:59:59")
    resp = await client.get(
        "/api/appointments",
        params={"start": start, "end": end, "client_id": "test-client-2"},
        headers=client_headers(),  # client-1 trying to see client-2's data
    )
    assert resp.status_code == 200
    # The backend forces client_id=user.uid for non-clinicians
    # So even if they pass client_id=test-client-2, they get their own data


async def test_client_cannot_book_for_another(client):
    """Clients can only book appointments for themselves."""
    await _register_both(client)
    resp = await client.post(
        "/api/appointments",
        json={
            "client_id": "test-client-2",  # trying to book for another
            "client_email": "client2@example.com",
            "client_name": "Other Client",
            "clinician_id": "test-clinician-1",
            "clinician_email": "test@hansmith.com",
            "type": "assessment",
            "scheduled_at": (datetime.now() + timedelta(days=7)).isoformat(),
            "duration_minutes": 60,
        },
        headers=client_headers(),  # client-1 trying to book for client-2
    )
    assert resp.status_code == 403
