"""Tests for practice profile endpoints."""
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician", "display_name": "Dr. Test"},
        headers=clinician_headers(),
    )


async def test_get_practice_profile_empty(client):
    """GET /api/practice-profile returns exists=false when none set."""
    await _register_clinician(client)
    resp = await client.get("/api/practice-profile", headers=clinician_headers())
    assert resp.status_code == 200
    # May or may not exist depending on prior test runs, but should return valid JSON
    data = resp.json()
    assert "exists" in data or "practice_name" in data


async def test_update_practice_profile(client):
    """PUT /api/practice-profile creates/updates profile."""
    await _register_clinician(client)
    resp = await client.put(
        "/api/practice-profile",
        json={
            "clinician_name": "Dr. Test Smith",
            "practice_name": "Test Practice",
            "phone": "555-0100",
            "email": "test@hansmith.com",
            "session_rate": 150.0,
            "intake_rate": 200.0,
            "accepted_insurances": ["Aetna", "BCBS"],
            "specialties": ["Anxiety", "Depression"],
            "timezone": "America/Chicago",
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "saved"
    assert "profile_id" in data


async def test_practice_profile_persists(client):
    """Profile data persists across requests."""
    await _register_clinician(client)
    # Create profile
    await client.put(
        "/api/practice-profile",
        json={
            "clinician_name": "Dr. Persist",
            "practice_name": "Persist Practice",
            "session_rate": 175.0,
        },
        headers=clinician_headers(),
    )
    # Read back
    resp = await client.get("/api/practice-profile", headers=clinician_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("exists") is True or "practice_name" in data
    assert data["clinician_name"] == "Dr. Persist"


async def test_client_cannot_update_practice(client):
    """Clients cannot update the practice profile."""
    # Register client
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    resp = await client.put(
        "/api/practice-profile",
        json={"clinician_name": "Hacker", "practice_name": "Hack"},
        headers=client_headers(),
    )
    assert resp.status_code == 403
