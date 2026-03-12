"""Tests for clinical note generation, editing, and signing endpoints."""
import json
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )


async def _create_encounter(client):
    """Create a client + encounter for note generation."""
    # Submit intake to create client + encounter
    resp = await client.post(
        "/api/intake",
        json={
            "demographics": {
                "name": "Note Test Client",
                "dateOfBirth": "1995-03-15",
            },
            "presentingConcerns": "Anxiety about work",
        },
        headers=client_headers(),
    )
    return resp.json()["encounterId"]


async def test_generate_note(client):
    """POST /api/notes/generate creates a draft note from an encounter."""
    await _register_clinician(client)
    encounter_id = await _create_encounter(client)

    resp = await client.post(
        "/api/notes/generate",
        json={"encounter_id": encounter_id},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "note_id" in data
    assert data["status"] == "draft"
    assert "content" in data
    return data["note_id"]


async def test_get_note(client):
    """GET /api/notes/{id} returns note with encounter data."""
    await _register_clinician(client)
    encounter_id = await _create_encounter(client)
    gen_resp = await client.post(
        "/api/notes/generate",
        json={"encounter_id": encounter_id},
        headers=clinician_headers(),
    )
    note_id = gen_resp.json()["note_id"]

    resp = await client.get(f"/api/notes/{note_id}", headers=clinician_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == note_id
    assert data["status"] == "draft"
    assert "content" in data
    assert "transcript" in data


async def test_update_note(client):
    """PUT /api/notes/{id} updates draft note content."""
    await _register_clinician(client)
    encounter_id = await _create_encounter(client)
    gen_resp = await client.post(
        "/api/notes/generate",
        json={"encounter_id": encounter_id},
        headers=clinician_headers(),
    )
    note_id = gen_resp.json()["note_id"]

    resp = await client.put(
        f"/api/notes/{note_id}",
        json={
            "content": {"subjective": "Updated content", "objective": "...", "assessment": "...", "plan": "..."},
            "status": "review",
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "updated"


async def test_sign_note(client):
    """POST /api/notes/{id}/sign signs and locks a note."""
    await _register_clinician(client)
    encounter_id = await _create_encounter(client)
    gen_resp = await client.post(
        "/api/notes/generate",
        json={"encounter_id": encounter_id},
        headers=clinician_headers(),
    )
    note_id = gen_resp.json()["note_id"]

    resp = await client.post(
        f"/api/notes/{note_id}/sign",
        json={"signature_data": "data:image/png;base64,fakeSig"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "signed"
    assert "content_hash" in data
    assert data["signed_by"] == "test@example.com"


async def test_cannot_edit_signed_note(client):
    """PUT /api/notes/{id} returns 400 for signed notes."""
    await _register_clinician(client)
    encounter_id = await _create_encounter(client)
    gen_resp = await client.post(
        "/api/notes/generate",
        json={"encounter_id": encounter_id},
        headers=clinician_headers(),
    )
    note_id = gen_resp.json()["note_id"]

    # Sign
    await client.post(
        f"/api/notes/{note_id}/sign",
        json={"signature_data": "data:image/png;base64,fakeSig"},
        headers=clinician_headers(),
    )

    # Try to edit
    resp = await client.put(
        f"/api/notes/{note_id}",
        json={"content": {"subjective": "Hacked"}},
        headers=clinician_headers(),
    )
    assert resp.status_code == 400


async def test_unsigned_notes_list(client):
    """GET /api/notes/unsigned returns draft/review notes."""
    await _register_clinician(client)
    encounter_id = await _create_encounter(client)
    await client.post(
        "/api/notes/generate",
        json={"encounter_id": encounter_id},
        headers=clinician_headers(),
    )

    resp = await client.get("/api/notes/unsigned", headers=clinician_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert "notes" in data
    assert "count" in data


async def test_amend_signed_note(client):
    """POST /api/notes/{id}/amend creates amendment of signed note."""
    await _register_clinician(client)
    encounter_id = await _create_encounter(client)
    gen_resp = await client.post(
        "/api/notes/generate",
        json={"encounter_id": encounter_id},
        headers=clinician_headers(),
    )
    note_id = gen_resp.json()["note_id"]

    # Sign the note
    await client.post(
        f"/api/notes/{note_id}/sign",
        json={"signature_data": "data:image/png;base64,fakeSig"},
        headers=clinician_headers(),
    )

    # Amend
    resp = await client.post(
        f"/api/notes/{note_id}/amend",
        json={
            "content": {"subjective": "Amended content", "objective": "...", "assessment": "...", "plan": "..."},
            "reason": "Corrected observation",
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "amendment_created"
    assert "amendment_id" in data
    assert data["original_note_id"] == note_id


async def test_note_not_found(client):
    """GET /api/notes/{bad_id} returns 404."""
    await _register_clinician(client)
    resp = await client.get(
        "/api/notes/00000000-0000-0000-0000-000000000000",
        headers=clinician_headers(),
    )
    assert resp.status_code == 404
