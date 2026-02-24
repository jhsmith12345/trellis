"""Tests for intake submission endpoint."""
import pytest
from conftest import client_headers


async def test_submit_intake(client):
    """POST /api/intake creates encounter and client profile."""
    resp = await client.post(
        "/api/intake",
        json={
            "demographics": {
                "name": "Test Client Intake",
                "preferredName": "Testy",
                "pronouns": "they/them",
                "dateOfBirth": "1990-05-15",
                "emergencyContact": {
                    "name": "Mom Client",
                    "phone": "555-0999",
                    "relationship": "Parent",
                },
            },
            "presentingConcerns": "Anxiety and sleep issues",
            "history": {
                "priorTherapy": True,
                "priorTherapyDetails": "CBT for 6 months in 2024",
                "medications": "Sertraline 50mg",
                "medicalConditions": "None",
            },
            "goals": "Better sleep, less worry",
            "additionalNotes": "Prefer evening appointments",
        },
        headers=client_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "received"
    assert "encounterId" in data
    assert data["name"] == "Test Client Intake"


async def test_submit_intake_minimal(client):
    """POST /api/intake works with minimal required fields."""
    resp = await client.post(
        "/api/intake",
        json={
            "demographics": {
                "name": "Minimal Client",
                "dateOfBirth": "2000-01-01",
            },
        },
        headers=client_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "received"


async def test_submit_intake_requires_auth(client):
    """POST /api/intake returns 401 without auth."""
    resp = await client.post(
        "/api/intake",
        json={
            "demographics": {"name": "No Auth", "dateOfBirth": "2000-01-01"},
        },
    )
    assert resp.status_code == 401
