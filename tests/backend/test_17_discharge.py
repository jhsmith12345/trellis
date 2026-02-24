"""Tests for the discharge workflow."""
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )


async def _create_client_and_get_uuid(client):
    """Create a client and return UUID."""
    await client.post(
        "/api/intake",
        json={
            "demographics": {"name": "Discharge Client", "dateOfBirth": "1985-01-01"},
            "presentingConcerns": "Discharge test",
        },
        headers=client_headers(),
    )
    resp = await client.get("/api/clients", headers=clinician_headers())
    for c in resp.json()["clients"]:
        if c["firebase_uid"] == "test-client-1":
            return c["id"]
    return None


async def test_discharge_status(client):
    """GET /api/clients/{id}/discharge-status returns status info."""
    await _register_clinician(client)
    client_uuid = await _create_client_and_get_uuid(client)
    if not client_uuid:
        pytest.skip("Could not find test client UUID")

    resp = await client.get(
        f"/api/clients/{client_uuid}/discharge-status",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "can_discharge" in data
    assert "client_status" in data
    assert "unsigned_notes" in data
    assert "future_appointment_count" in data


async def test_discharge_client(client):
    """POST /api/clients/{id}/discharge completes discharge workflow."""
    await _register_clinician(client)
    client_uuid = await _create_client_and_get_uuid(client)
    if not client_uuid:
        pytest.skip("Could not find test client UUID")

    resp = await client.post(
        f"/api/clients/{client_uuid}/discharge",
        json={"reason": "Treatment goals met"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "discharged"
    assert "note_id" in data
    assert "encounter_id" in data


async def test_discharge_already_discharged(client):
    """POST /api/clients/{id}/discharge returns 400 if already discharged."""
    await _register_clinician(client)
    client_uuid = await _create_client_and_get_uuid(client)
    if not client_uuid:
        pytest.skip("Could not find test client UUID")

    # Discharge once
    await client.post(
        f"/api/clients/{client_uuid}/discharge",
        json={"reason": "Done"},
        headers=clinician_headers(),
    )

    # Try again
    resp = await client.post(
        f"/api/clients/{client_uuid}/discharge",
        json={"reason": "Again"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 400
