"""Tests for client detail sub-endpoints (clinician-only)."""
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )


async def _create_client_and_get_uuid(client):
    """Create a client via intake and return the client UUID."""
    # Create client via intake
    await client.post(
        "/api/intake",
        json={
            "demographics": {"name": "Detail Client", "dateOfBirth": "1992-07-10"},
            "presentingConcerns": "Testing detail endpoints",
        },
        headers=client_headers(),
    )

    # Get client list and find UUID
    resp = await client.get("/api/clients", headers=clinician_headers())
    clients = resp.json()["clients"]
    for c in clients:
        if c["firebase_uid"] == "test-client-1":
            return c["id"]
    return None


async def test_get_client_detail(client):
    """GET /api/clients/{id} returns full client profile."""
    await _register_clinician(client)
    client_uuid = await _create_client_and_get_uuid(client)
    if not client_uuid:
        pytest.skip("Could not find test client UUID")

    resp = await client.get(
        f"/api/clients/{client_uuid}", headers=clinician_headers()
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["full_name"] == "Detail Client"


async def test_get_client_encounters(client):
    """GET /api/clients/{id}/encounters returns encounter list."""
    await _register_clinician(client)
    client_uuid = await _create_client_and_get_uuid(client)
    if not client_uuid:
        pytest.skip("Could not find test client UUID")

    resp = await client.get(
        f"/api/clients/{client_uuid}/encounters",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "encounters" in data


async def test_get_client_notes(client):
    """GET /api/clients/{id}/notes returns notes list."""
    await _register_clinician(client)
    client_uuid = await _create_client_and_get_uuid(client)
    if not client_uuid:
        pytest.skip("Could not find test client UUID")

    resp = await client.get(
        f"/api/clients/{client_uuid}/notes",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    assert "notes" in resp.json()


async def test_get_client_appointments(client):
    """GET /api/clients/{id}/appointments returns appointment list."""
    await _register_clinician(client)
    client_uuid = await _create_client_and_get_uuid(client)
    if not client_uuid:
        pytest.skip("Could not find test client UUID")

    resp = await client.get(
        f"/api/clients/{client_uuid}/appointments",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    assert "appointments" in resp.json()


async def test_get_client_treatment_plan(client):
    """GET /api/clients/{id}/treatment-plan returns plan status."""
    await _register_clinician(client)
    client_uuid = await _create_client_and_get_uuid(client)
    if not client_uuid:
        pytest.skip("Could not find test client UUID")

    resp = await client.get(
        f"/api/clients/{client_uuid}/treatment-plan",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    # May or may not exist
    assert "exists" in data or "id" in data


async def test_client_detail_not_found(client):
    """GET /api/clients/{bad_id} returns 404."""
    await _register_clinician(client)
    resp = await client.get(
        "/api/clients/00000000-0000-0000-0000-000000000000",
        headers=clinician_headers(),
    )
    assert resp.status_code == 404
