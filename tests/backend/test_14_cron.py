"""Tests for cron endpoints (Cloud Scheduler)."""
import pytest


CRON_HEADERS = {"X-Cron-Secret": "dev-cron-secret"}
BAD_CRON_HEADERS = {"X-Cron-Secret": "wrong-secret"}


async def test_cron_check_reconfirmations(client):
    """POST /api/cron/check-reconfirmations runs with correct secret."""
    resp = await client.post(
        "/api/cron/check-reconfirmations", headers=CRON_HEADERS
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "released_count" in data


async def test_cron_send_reminders(client):
    """POST /api/cron/send-reminders runs with correct secret."""
    resp = await client.post("/api/cron/send-reminders", headers=CRON_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert "sent_count" in data
    assert "errors" in data


async def test_cron_check_no_shows(client):
    """POST /api/cron/check-no-shows runs with correct secret."""
    resp = await client.post("/api/cron/check-no-shows", headers=CRON_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert "no_show_count" in data


async def test_cron_check_unsigned_docs(client):
    """POST /api/cron/check-unsigned-docs runs with correct secret."""
    resp = await client.post(
        "/api/cron/check-unsigned-docs", headers=CRON_HEADERS
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "clinician_alerts" in data
    assert "client_reminders" in data


async def test_cron_process_recordings(client):
    """POST /api/cron/process-recordings runs with correct secret."""
    resp = await client.post(
        "/api/cron/process-recordings", headers=CRON_HEADERS
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "processed" in data


async def test_cron_rejects_bad_secret(client):
    """Cron endpoints return 403 with wrong secret."""
    resp = await client.post(
        "/api/cron/check-reconfirmations", headers=BAD_CRON_HEADERS
    )
    assert resp.status_code == 403


async def test_cron_rejects_no_secret(client):
    """Cron endpoints return 403 without X-Cron-Secret header."""
    resp = await client.post("/api/cron/send-reminders")
    assert resp.status_code == 403
