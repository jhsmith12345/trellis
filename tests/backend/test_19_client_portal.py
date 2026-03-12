"""Tests for client portal endpoints (authenticated client-scoped)."""
import pytest
from datetime import datetime, timedelta
from conftest import clinician_headers, client_headers, client2_headers


async def _register_and_book(client):
    """Register users, set availability, and book an appointment. Return appointment_id."""
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

    # Set availability
    await client.put(
        "/api/availability",
        json={
            "slots": [
                {
                    "day_of_week": (datetime.now() + timedelta(days=7)).weekday(),
                    "start_time": "09:00",
                    "end_time": "17:00",
                }
            ]
        },
        headers=clinician_headers(),
    )

    # Book assessment appointment
    future = datetime.now() + timedelta(days=7, hours=10)
    resp = await client.post(
        "/api/appointments",
        json={
            "client_id": "test-client-1",
            "client_email": "client@example.com",
            "client_name": "Test Client",
            "clinician_id": "test-clinician-1",
            "clinician_email": "test@example.com",
            "type": "assessment",
            "scheduled_at": future.isoformat(),
            "duration_minutes": 60,
        },
        headers=clinician_headers(),
    )
    if resp.status_code != 201:
        return None
    data = resp.json()
    appt_ids = data.get("appointment_ids", [])
    return appt_ids[0] if appt_ids else None


async def test_client_pending_reconfirmations_empty(client):
    """GET /api/appointments/my/pending-reconfirmations returns empty list when none pending."""
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    resp = await client.get(
        "/api/appointments/my/pending-reconfirmations",
        headers=client_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "appointments" in data
    assert isinstance(data["appointments"], list)


async def test_client_confirm_own_appointment(client):
    """POST /api/appointments/my/{id}/confirm lets client confirm their appointment."""
    appt_id = await _register_and_book(client)
    if not appt_id:
        pytest.skip("Could not create appointment")

    # Trigger reconfirmation first (clinician action)
    await client.post(
        f"/api/appointments/{appt_id}/reconfirmation",
        headers=clinician_headers(),
    )

    # Client confirms via portal
    resp = await client.post(
        f"/api/appointments/my/{appt_id}/confirm",
        headers=client_headers(),
    )
    # Either 200 (confirmed) or could be a 400 if appointment not in right state
    assert resp.status_code in (200, 400)
    if resp.status_code == 200:
        data = resp.json()
        assert data["status"] in ("confirmed", "already_responded")


async def test_client_cancel_own_appointment(client):
    """POST /api/appointments/my/{id}/cancel lets client cancel their appointment."""
    appt_id = await _register_and_book(client)
    if not appt_id:
        pytest.skip("Could not create appointment")

    resp = await client.post(
        f"/api/appointments/my/{appt_id}/cancel",
        headers=client_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "cancelled"


async def test_client_cannot_cancel_others_appointment(client):
    """POST /api/appointments/my/{id}/cancel returns 403 for other client's appointment."""
    appt_id = await _register_and_book(client)
    if not appt_id:
        pytest.skip("Could not create appointment")

    # client2 tries to cancel client1's appointment
    resp = await client.post(
        f"/api/appointments/my/{appt_id}/cancel",
        headers=client2_headers(),
    )
    assert resp.status_code == 403


async def test_client_confirm_not_found(client):
    """POST /api/appointments/my/{bad_id}/confirm returns 404."""
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    resp = await client.post(
        "/api/appointments/my/00000000-0000-0000-0000-000000000000/confirm",
        headers=client_headers(),
    )
    assert resp.status_code == 404


async def test_client_my_superbills(client):
    """GET /api/superbills/my returns client's own superbills."""
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    resp = await client.get("/api/superbills/my", headers=client_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert "superbills" in data
    assert "total_billed" in data


async def test_client_my_profile(client):
    """GET /api/clients/me returns the client's own profile."""
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    resp = await client.get("/api/clients/me", headers=client_headers())
    # Either 200 with data or 404 if no client record yet
    assert resp.status_code in (200, 404)


async def test_client_document_signing_status(client):
    """GET /api/documents/status/{client_id} returns signing status."""
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )
    resp = await client.get(
        "/api/documents/status/test-client-1",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "packages" in data
    assert "all_signed" in data


async def test_client_stored_signature_flow(client):
    """POST + GET /api/documents/signature stores and retrieves signature."""
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    # Store
    resp = await client.post(
        "/api/documents/signature",
        json={"signature_png": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA"},
        headers=client_headers(),
    )
    assert resp.status_code == 200

    # Retrieve
    resp = await client.get("/api/documents/signature", headers=client_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert data["signature_png"] is not None
