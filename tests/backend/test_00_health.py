"""Tests for health check endpoints."""
import pytest


async def test_root_health_returns_ok(client):
    """GET /health (root) returns simple ok."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


async def test_api_health_post(client):
    """POST /api/health runs comprehensive checks (DB should pass)."""
    resp = await client.post("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "checks" in data
    assert "database" in data["checks"]
    # Database should be ok since we use real DB
    assert data["checks"]["database"]["status"] == "ok"
    assert "elapsed_ms" in data
