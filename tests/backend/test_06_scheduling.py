"""Tests for scheduling/appointment endpoints."""
import pytest
from datetime import datetime, timedelta
from conftest import clinician_headers, client_headers


async def _setup_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )
    # Set availability for slot computation
    await client.put(
        "/api/availability",
        json={
            "windows": [
                {"day_of_week": i, "start_time": "08:00", "end_time": "18:00"}
                for i in range(7)
            ]
        },
        headers=clinician_headers(),
    )


async def _setup_client(client):
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )


def _future_iso(days=7, hour=10):
    dt = datetime.now() + timedelta(days=days)
    return dt.replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


async def _book_assessment(client, scheduled_at=None):
    """Helper to book an assessment appointment."""
    return await client.post(
        "/api/appointments",
        json={
            "client_id": "test-client-1",
            "client_email": "client@example.com",
            "client_name": "Test Client",
            "clinician_id": "test-clinician-1",
            "clinician_email": "test@hansmith.com",
            "type": "assessment",
            "scheduled_at": scheduled_at or _future_iso(),
            "duration_minutes": 60,
        },
        headers=clinician_headers(),
    )


async def test_get_slots(client):
    """GET /api/appointments/slots returns available slots."""
    await _setup_clinician(client)
    start = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00")
    end = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%dT23:59:59")
    resp = await client.get(
        "/api/appointments/slots",
        params={
            "clinician_id": "test-clinician-1",
            "start": start,
            "end": end,
            "type": "assessment",
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "slots" in data


async def test_book_assessment(client):
    """POST /api/appointments books a single assessment."""
    await _setup_clinician(client)
    await _setup_client(client)
    resp = await _book_assessment(client)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["appointments"]) == 1
    assert data["appointments"][0]["type"] == "assessment"
    assert data["recurrence_id"] is None


async def test_book_individual_creates_series(client):
    """POST /api/appointments for individual creates 4 recurring instances."""
    await _setup_clinician(client)
    await _setup_client(client)
    resp = await client.post(
        "/api/appointments",
        json={
            "client_id": "test-client-1",
            "client_email": "client@example.com",
            "client_name": "Test Client",
            "clinician_id": "test-clinician-1",
            "clinician_email": "test@hansmith.com",
            "type": "individual",
            "scheduled_at": _future_iso(days=7),
            "duration_minutes": 50,
            "cadence": "weekly",
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["appointments"]) == 4
    assert data["recurrence_id"] is not None


async def test_list_appointments(client):
    """GET /api/appointments returns appointments in date range."""
    await _setup_clinician(client)
    await _setup_client(client)
    await _book_assessment(client)

    start = datetime.now().strftime("%Y-%m-%dT00:00:00")
    end = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%dT23:59:59")
    resp = await client.get(
        "/api/appointments",
        params={"start": start, "end": end},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "appointments" in data


async def test_cancel_appointment(client):
    """PATCH /api/appointments/{id} cancels an appointment."""
    await _setup_clinician(client)
    await _setup_client(client)
    book_resp = await _book_assessment(client)
    appt_id = book_resp.json()["appointments"][0]["id"]

    resp = await client.patch(
        f"/api/appointments/{appt_id}",
        json={"status": "cancelled", "cancelled_reason": "Test cancellation"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


async def test_invalid_appointment_type(client):
    """POST /api/appointments rejects invalid appointment types."""
    await _setup_clinician(client)
    resp = await client.post(
        "/api/appointments",
        json={
            "client_id": "test-client-1",
            "client_email": "client@example.com",
            "client_name": "Test Client",
            "clinician_id": "test-clinician-1",
            "clinician_email": "test@hansmith.com",
            "type": "invalid_type",
            "scheduled_at": _future_iso(),
            "duration_minutes": 60,
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 400


async def test_schedule_view(client):
    """GET /api/schedule returns unified schedule."""
    await _setup_clinician(client)
    start = datetime.now().strftime("%Y-%m-%dT00:00:00")
    end = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%dT23:59:59")
    resp = await client.get(
        "/api/schedule",
        params={"start": start, "end": end},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    assert "appointments" in resp.json()
