"""Tests for clinician availability endpoints."""
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )


async def test_set_availability(client):
    """PUT /api/availability creates availability windows."""
    await _register_clinician(client)
    resp = await client.put(
        "/api/availability",
        json={
            "windows": [
                {"day_of_week": 1, "start_time": "09:00", "end_time": "12:00"},
                {"day_of_week": 1, "start_time": "13:00", "end_time": "17:00"},
                {"day_of_week": 3, "start_time": "10:00", "end_time": "15:00"},
            ]
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "saved"
    assert data["window_count"] == 3


async def test_get_availability(client):
    """GET /api/availability returns saved windows."""
    await _register_clinician(client)
    # Set first
    await client.put(
        "/api/availability",
        json={
            "windows": [
                {"day_of_week": 2, "start_time": "08:00", "end_time": "12:00"},
            ]
        },
        headers=clinician_headers(),
    )
    # Get
    resp = await client.get("/api/availability", headers=clinician_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert "windows" in data
    assert len(data["windows"]) >= 1


async def test_replace_availability(client):
    """PUT /api/availability replaces (not appends) windows."""
    await _register_clinician(client)
    # Set initial
    await client.put(
        "/api/availability",
        json={
            "windows": [
                {"day_of_week": 1, "start_time": "09:00", "end_time": "12:00"},
                {"day_of_week": 2, "start_time": "09:00", "end_time": "12:00"},
            ]
        },
        headers=clinician_headers(),
    )
    # Replace with just one
    await client.put(
        "/api/availability",
        json={
            "windows": [
                {"day_of_week": 4, "start_time": "10:00", "end_time": "14:00"},
            ]
        },
        headers=clinician_headers(),
    )
    resp = await client.get("/api/availability", headers=clinician_headers())
    data = resp.json()
    assert len(data["windows"]) == 1
    assert data["windows"][0]["day_of_week"] == 4


async def test_client_cannot_set_availability(client):
    """Clients cannot set availability."""
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    resp = await client.put(
        "/api/availability",
        json={"windows": [{"day_of_week": 1, "start_time": "09:00", "end_time": "12:00"}]},
        headers=client_headers(),
    )
    assert resp.status_code == 403
