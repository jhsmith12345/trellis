"""Tests for treatment plan endpoints."""
import json
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )


async def _create_client_with_assessment_note(client):
    """Create a client, encounter, and signed narrative (assessment) note.

    The treatment plan generator requires a narrative note to exist.
    """
    # Create encounter via intake
    intake_resp = await client.post(
        "/api/intake",
        json={
            "demographics": {"name": "TP Client", "dateOfBirth": "1988-06-20"},
            "presentingConcerns": "Anxiety and depression",
        },
        headers=client_headers(),
    )
    encounter_id = intake_resp.json()["encounterId"]

    # Generate a note (mock returns SOAP but we need narrative for TP)
    # We'll insert a narrative note directly via the DB for this test
    from db import get_pool
    pool = await get_pool()
    note_row = await pool.fetchrow(
        """
        INSERT INTO clinical_notes (encounter_id, format, content, status)
        VALUES ($1::uuid, 'narrative', $2::jsonb, 'signed')
        RETURNING id
        """,
        encounter_id,
        json.dumps({
            "clinical_summary": "Client presents with GAD symptoms.",
            "history": "No prior treatment.",
            "mental_status": "Alert and oriented.",
            "diagnostic_impressions": "F41.1 GAD",
            "recommendations": "Weekly CBT sessions.",
        }),
    )
    return encounter_id, str(note_row["id"])


async def test_generate_treatment_plan(client):
    """POST /api/treatment-plans/generate creates a draft plan."""
    await _register_clinician(client)
    encounter_id, note_id = await _create_client_with_assessment_note(client)

    resp = await client.post(
        "/api/treatment-plans/generate",
        json={"client_id": "test-client-1"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "plan_id" in data
    assert data["status"] == "draft"
    assert data["action"] == "generated"
    assert "plan" in data


async def test_get_treatment_plan(client):
    """GET /api/treatment-plans/{id} returns plan with details."""
    await _register_clinician(client)
    await _create_client_with_assessment_note(client)

    gen_resp = await client.post(
        "/api/treatment-plans/generate",
        json={"client_id": "test-client-1"},
        headers=clinician_headers(),
    )
    plan_id = gen_resp.json()["plan_id"]

    resp = await client.get(
        f"/api/treatment-plans/{plan_id}",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == plan_id
    assert "diagnoses" in data
    assert "goals" in data


async def test_update_treatment_plan(client):
    """PUT /api/treatment-plans/{id} updates draft plan."""
    await _register_clinician(client)
    await _create_client_with_assessment_note(client)

    gen_resp = await client.post(
        "/api/treatment-plans/generate",
        json={"client_id": "test-client-1"},
        headers=clinician_headers(),
    )
    plan_id = gen_resp.json()["plan_id"]

    resp = await client.put(
        f"/api/treatment-plans/{plan_id}",
        json={
            "presenting_problems": "Updated presenting problems",
            "status": "review",
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "updated"


async def test_sign_treatment_plan(client):
    """POST /api/treatment-plans/{id}/sign signs and locks a plan."""
    await _register_clinician(client)
    await _create_client_with_assessment_note(client)

    gen_resp = await client.post(
        "/api/treatment-plans/generate",
        json={"client_id": "test-client-1"},
        headers=clinician_headers(),
    )
    plan_id = gen_resp.json()["plan_id"]

    resp = await client.post(
        f"/api/treatment-plans/{plan_id}/sign",
        json={"signature_data": "data:image/png;base64,fakeSig"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "signed"
    assert "content_hash" in data


async def test_due_for_review(client):
    """GET /api/treatment-plans/due-for-review returns plans near review date."""
    await _register_clinician(client)
    resp = await client.get(
        "/api/treatment-plans/due-for-review",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "plans" in data
    assert "count" in data


async def test_treatment_plan_not_found(client):
    """GET /api/treatment-plans/{bad_id} returns 404."""
    await _register_clinician(client)
    resp = await client.get(
        "/api/treatment-plans/00000000-0000-0000-0000-000000000000",
        headers=clinician_headers(),
    )
    assert resp.status_code == 404
