"""Tests for audit log endpoints."""
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )


async def test_list_audit_events(client):
    """GET /api/audit-log returns paginated audit events."""
    await _register_clinician(client)
    # Generate some audit events by hitting an endpoint
    await client.get("/api/auth/me", headers=clinician_headers())

    resp = await client.get("/api/audit-log", headers=clinician_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert "events" in data
    assert "total" in data
    assert "page" in data
    assert "per_page" in data
    assert "total_pages" in data
    assert "filters" in data


async def test_audit_log_pagination(client):
    """GET /api/audit-log supports pagination."""
    await _register_clinician(client)
    resp = await client.get(
        "/api/audit-log",
        params={"page": 1, "per_page": 10},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["per_page"] == 10
    assert data["page"] == 1


async def test_audit_log_filter_by_action(client):
    """GET /api/audit-log filters by action type."""
    await _register_clinician(client)
    resp = await client.get(
        "/api/audit-log",
        params={"action": "registered"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    for event in data["events"]:
        assert event["action"] == "registered"


async def test_audit_log_filter_by_resource_type(client):
    """GET /api/audit-log filters by resource type."""
    await _register_clinician(client)
    resp = await client.get(
        "/api/audit-log",
        params={"resource_type": "user"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200


async def test_audit_log_requires_clinician(client):
    """GET /api/audit-log is clinician-only."""
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    resp = await client.get("/api/audit-log", headers=client_headers())
    assert resp.status_code == 403
