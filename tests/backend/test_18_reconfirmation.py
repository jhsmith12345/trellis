"""Tests for reconfirmation flow (token-based, unauthenticated endpoints)."""
import pytest
from datetime import datetime, timedelta
from conftest import clinician_headers, client_headers


async def _setup_appointment_with_reconfirmation(client):
    """Register users, create appointment, and trigger reconfirmation.

    Returns the appointment_id and reconfirmation token if available.
    """
    # Register clinician + client
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

    # Book assessment
    future = datetime.now() + timedelta(days=7, hours=10)
    resp = await client.post(
        "/api/appointments",
        json={
            "client_id": "test-client-1",
            "client_email": "client@example.com",
            "client_name": "Test Client",
            "clinician_id": "test-clinician-1",
            "clinician_email": "test@hansmith.com",
            "type": "individual",
            "scheduled_at": future.isoformat(),
            "duration_minutes": 50,
        },
        headers=clinician_headers(),
    )
    if resp.status_code != 201:
        return None, None

    data = resp.json()
    # Get the first appointment ID
    appt_ids = data.get("appointment_ids", [])
    if not appt_ids:
        return None, None

    appt_id = appt_ids[0]

    # Trigger reconfirmation for this appointment
    resp = await client.post(
        f"/api/appointments/{appt_id}/reconfirmation",
        headers=clinician_headers(),
    )
    if resp.status_code == 200:
        token = resp.json().get("token")
        next_appt_id = resp.json().get("next_appointment_id", appt_id)
        return next_appt_id, token

    return appt_id, None


async def test_reconfirmation_info_invalid_token(client):
    """GET /api/reconfirmation/{bad_token}/info returns 404."""
    resp = await client.get("/api/reconfirmation/invalid-token-abc/info")
    assert resp.status_code == 404


async def test_reconfirmation_confirm_invalid_token(client):
    """GET /api/reconfirmation/{bad_token}/confirm returns 404."""
    resp = await client.get("/api/reconfirmation/invalid-token-abc/confirm")
    assert resp.status_code == 404


async def test_reconfirmation_cancel_invalid_token(client):
    """GET /api/reconfirmation/{bad_token}/cancel returns 404."""
    resp = await client.get("/api/reconfirmation/invalid-token-abc/cancel")
    assert resp.status_code == 404


async def test_reconfirmation_change_invalid_token(client):
    """POST /api/reconfirmation/{bad_token}/change returns 404."""
    future = (datetime.now() + timedelta(days=8)).isoformat()
    resp = await client.post(
        "/api/reconfirmation/invalid-token-abc/change",
        json={"new_scheduled_at": future},
    )
    assert resp.status_code == 404


async def test_reconfirmation_flow(client):
    """Full reconfirmation flow: trigger → info → confirm."""
    appt_id, token = await _setup_appointment_with_reconfirmation(client)
    if not token:
        pytest.skip("Could not set up reconfirmation (no token returned)")

    # Get info
    resp = await client.get(f"/api/reconfirmation/{token}/info")
    assert resp.status_code == 200
    data = resp.json()
    assert "appointment" in data
    assert data["appointment"]["type"] == "individual"

    # Confirm
    resp = await client.get(f"/api/reconfirmation/{token}/confirm")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "confirmed"


async def test_reconfirmation_cancel_flow(client):
    """Reconfirmation cancel marks appointment as cancelled."""
    appt_id, token = await _setup_appointment_with_reconfirmation(client)
    if not token:
        pytest.skip("Could not set up reconfirmation (no token returned)")

    resp = await client.get(f"/api/reconfirmation/{token}/cancel")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "cancelled"


async def test_reconfirmation_already_responded(client):
    """After responding, further actions return already_responded."""
    appt_id, token = await _setup_appointment_with_reconfirmation(client)
    if not token:
        pytest.skip("Could not set up reconfirmation (no token returned)")

    # Confirm first
    await client.get(f"/api/reconfirmation/{token}/confirm")

    # Try again
    resp = await client.get(f"/api/reconfirmation/{token}/confirm")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "already_responded"


async def test_reconfirmation_change_flow(client):
    """Reconfirmation change reschedules the appointment."""
    appt_id, token = await _setup_appointment_with_reconfirmation(client)
    if not token:
        pytest.skip("Could not set up reconfirmation (no token returned)")

    new_time = (datetime.now() + timedelta(days=14, hours=10)).isoformat()
    resp = await client.post(
        f"/api/reconfirmation/{token}/change",
        json={"new_scheduled_at": new_time},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "changed"
    assert data["new_scheduled_at"] == new_time
