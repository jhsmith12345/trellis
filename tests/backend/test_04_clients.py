"""Tests for client endpoints."""
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician", "display_name": "Dr. Test"},
        headers=clinician_headers(),
    )


async def _register_client(client):
    await client.post(
        "/api/auth/register",
        json={"role": "client", "display_name": "Test Client"},
        headers=client_headers(),
    )


async def _create_client_via_intake(client):
    """Create a client profile by submitting an intake."""
    return await client.post(
        "/api/intake",
        json={
            "demographics": {
                "name": "Client For Tests",
                "dateOfBirth": "1990-01-01",
            },
            "presentingConcerns": "Testing concerns",
        },
        headers=client_headers(),
    )


async def test_list_clients_clinician_only(client):
    """GET /api/clients requires clinician role."""
    await _register_clinician(client)
    resp = await client.get("/api/clients", headers=clinician_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert "clients" in data


async def test_list_clients_denied_for_client(client):
    """GET /api/clients returns 403 for client role."""
    await _register_client(client)
    resp = await client.get("/api/clients", headers=client_headers())
    assert resp.status_code == 403


async def test_get_my_profile(client):
    """GET /api/clients/me returns current client profile."""
    await _create_client_via_intake(client)
    resp = await client.get("/api/clients/me", headers=client_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("exists") is True or "full_name" in data


async def test_get_my_profile_not_found(client):
    """GET /api/clients/me returns exists=false for unknown client."""
    from conftest import make_token
    token = make_token("no-profile-user", "noprofile@example.com")
    resp = await client.get(
        "/api/clients/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    assert resp.json()["exists"] is False


async def test_update_my_profile(client):
    """PUT /api/clients/me updates client demographics."""
    await _create_client_via_intake(client)
    resp = await client.put(
        "/api/clients/me",
        json={"phone": "555-1234", "address_city": "Chicago"},
        headers=client_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "updated"


async def test_upload_insurance_card(client):
    """POST /api/clients/insurance-card extracts data from mock vision."""
    import base64
    fake_image = base64.b64encode(b"fake image bytes").decode()
    resp = await client.post(
        "/api/clients/insurance-card",
        json={"front": fake_image, "mime_type": "image/jpeg"},
        headers=client_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "extraction" in data
    assert data["extraction"]["payer_name"] == "Blue Cross Blue Shield"


async def test_upload_insurance_card_bad_mime(client):
    """POST /api/clients/insurance-card rejects unsupported MIME types."""
    import base64
    fake_image = base64.b64encode(b"fake").decode()
    resp = await client.post(
        "/api/clients/insurance-card",
        json={"front": fake_image, "mime_type": "application/pdf"},
        headers=client_headers(),
    )
    assert resp.status_code == 400


async def test_save_insurance(client):
    """POST /api/clients/insurance saves insurance data."""
    await _create_client_via_intake(client)
    resp = await client.post(
        "/api/clients/insurance",
        json={
            "payer_name": "Aetna",
            "member_id": "MBR123",
            "group_number": "GRP456",
        },
        headers=client_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "saved"
