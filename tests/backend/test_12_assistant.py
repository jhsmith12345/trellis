"""Tests for AI assistant endpoint."""
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )


async def test_assistant_chat(client):
    """POST /api/assistant/chat returns AI response."""
    await _register_clinician(client)
    resp = await client.post(
        "/api/assistant/chat",
        json={"message": "How many clients do I have?", "history": []},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "response" in data
    assert "context_used" in data


async def test_assistant_with_history(client):
    """POST /api/assistant/chat accepts conversation history."""
    await _register_clinician(client)
    resp = await client.post(
        "/api/assistant/chat",
        json={
            "message": "Tell me more about them",
            "history": [
                {"role": "user", "content": "Who are my clients?"},
                {"role": "assistant", "content": "You have several clients."},
            ],
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200


async def test_assistant_empty_message(client):
    """POST /api/assistant/chat rejects empty messages."""
    await _register_clinician(client)
    resp = await client.post(
        "/api/assistant/chat",
        json={"message": "   ", "history": []},
        headers=clinician_headers(),
    )
    assert resp.status_code == 400


async def test_assistant_requires_clinician(client):
    """POST /api/assistant/chat is clinician-only."""
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    resp = await client.post(
        "/api/assistant/chat",
        json={"message": "Hello?", "history": []},
        headers=client_headers(),
    )
    assert resp.status_code == 403
