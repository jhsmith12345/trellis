"""Tests for session recording configuration endpoints."""
import pytest
from conftest import clinician_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )


async def test_get_recording_config_default(client):
    """GET /api/sessions/config returns defaults when none set."""
    await _register_clinician(client)
    resp = await client.get("/api/sessions/config", headers=clinician_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert data["delete_after_transcription"] is True
    assert data["auto_process"] is True


async def test_update_recording_config(client):
    """PUT /api/sessions/config updates configuration."""
    await _register_clinician(client)
    resp = await client.put(
        "/api/sessions/config",
        json={"delete_after_transcription": False, "auto_process": True},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "saved"
    assert data["delete_after_transcription"] is False

    # Verify it persists
    resp2 = await client.get("/api/sessions/config", headers=clinician_headers())
    assert resp2.json()["delete_after_transcription"] is False


async def test_recording_status(client):
    """GET /api/sessions/recording-status returns status groups."""
    await _register_clinician(client)
    resp = await client.get(
        "/api/sessions/recording-status", headers=clinician_headers()
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "completed" in data
    assert "processing" in data
    assert "failed" in data
    assert "pending" in data
    assert "summary" in data
