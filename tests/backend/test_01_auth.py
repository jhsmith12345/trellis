"""Tests for auth/register and auth/me endpoints."""
import pytest
from conftest import make_token, clinician_headers, client_headers


async def test_register_clinician(client):
    """POST /api/auth/register creates a clinician user."""
    headers = clinician_headers()
    resp = await client.post(
        "/api/auth/register",
        json={"role": "clinician", "display_name": "Dr. Test"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "clinician"
    assert "user_id" in data


async def test_register_client(client):
    """POST /api/auth/register creates a client user."""
    headers = client_headers()
    resp = await client.post(
        "/api/auth/register",
        json={"role": "client", "display_name": "Test Client"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "client"


async def test_register_invalid_role(client):
    """POST /api/auth/register rejects invalid roles."""
    headers = clinician_headers()
    resp = await client.post(
        "/api/auth/register",
        json={"role": "admin"},
        headers=headers,
    )
    assert resp.status_code == 400


async def test_get_me_registered(client):
    """GET /api/auth/me returns profile after registration."""
    headers = clinician_headers()
    # Register first
    await client.post(
        "/api/auth/register",
        json={"role": "clinician", "display_name": "Dr. Test"},
        headers=headers,
    )
    resp = await client.get("/api/auth/me", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["registered"] is True
    assert data["role"] == "clinician"
    assert data["email"] == "test@hansmith.com"


async def test_get_me_unregistered(client):
    """GET /api/auth/me returns registered=false for unknown user."""
    token = make_token("unknown-user-xyz", "nobody@example.com")
    resp = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["registered"] is False


async def test_missing_token_returns_401(client):
    """Endpoints return 401 when Authorization header is missing."""
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_invalid_token_returns_401(client):
    """Endpoints return 401 for malformed tokens."""
    resp = await client.get(
        "/api/auth/me", headers={"Authorization": "Bearer not.a.valid.jwt.token"}
    )
    assert resp.status_code == 401
