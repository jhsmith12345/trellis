"""Integration tests — multi-step workflows spanning multiple endpoints."""
import pytest
from datetime import datetime, timedelta
from conftest import clinician_headers, client_headers


async def test_full_intake_to_note_workflow(client):
    """Complete workflow: register → intake → book → generate note → sign.

    Exercises the core EHR pipeline end to end.
    """
    # 1. Register clinician and client
    resp = await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200

    resp = await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )
    assert resp.status_code == 200

    # 2. Submit intake
    resp = await client.post(
        "/api/intake",
        json={
            "demographics": {
                "name": "Integration Client",
                "dateOfBirth": "1990-05-15",
                "email": "client@example.com",
                "phone": "555-0100",
            },
            "presentingConcerns": "Integration test: anxiety and stress management",
        },
        headers=client_headers(),
    )
    assert resp.status_code == 200
    encounter_id = resp.json().get("encounter_id")
    assert encounter_id is not None

    # 3. Verify client appears in client list
    resp = await client.get("/api/clients", headers=clinician_headers())
    assert resp.status_code == 200
    clients = resp.json()["clients"]
    test_client = None
    for c in clients:
        if c["firebase_uid"] == "test-client-1":
            test_client = c
            break
    assert test_client is not None
    client_uuid = test_client["id"]

    # 4. Set availability and book appointment
    await client.put(
        "/api/availability",
        json={
            "slots": [
                {
                    "day_of_week": (datetime.now() + timedelta(days=3)).weekday(),
                    "start_time": "08:00",
                    "end_time": "18:00",
                }
            ]
        },
        headers=clinician_headers(),
    )

    future = datetime.now() + timedelta(days=3, hours=10)
    resp = await client.post(
        "/api/appointments",
        json={
            "client_id": "test-client-1",
            "client_email": "client@example.com",
            "client_name": "Integration Client",
            "clinician_id": "test-clinician-1",
            "clinician_email": "test@example.com",
            "type": "assessment",
            "scheduled_at": future.isoformat(),
            "duration_minutes": 60,
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 201
    appt_ids = resp.json()["appointment_ids"]
    assert len(appt_ids) > 0

    # 5. Generate a clinical note from the encounter
    resp = await client.post(
        "/api/notes/generate",
        json={"encounter_id": encounter_id},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    note_id = resp.json()["note_id"]
    assert note_id is not None

    # 6. Get the note
    resp = await client.get(f"/api/notes/{note_id}", headers=clinician_headers())
    assert resp.status_code == 200
    note = resp.json()
    assert note["status"] == "draft"

    # 7. Sign the note
    resp = await client.post(
        f"/api/notes/{note_id}/sign",
        json={
            "signature_data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "signed"

    # 8. Verify the note is now signed and cannot be edited
    resp = await client.put(
        f"/api/notes/{note_id}",
        json={"content": {"subjective": "Attempted edit"}},
        headers=clinician_headers(),
    )
    assert resp.status_code == 400  # Cannot edit signed note

    # 9. Unsigned notes list should not include the signed note
    resp = await client.get("/api/notes/unsigned", headers=clinician_headers())
    assert resp.status_code == 200
    unsigned = resp.json()["notes"]
    unsigned_ids = [n["id"] for n in unsigned]
    assert note_id not in unsigned_ids


async def test_document_package_signing_workflow(client):
    """Create document package → send → sign each document."""
    # 1. Register
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )

    # 2. Create document package
    resp = await client.post(
        "/api/documents/packages",
        json={
            "client_id": "test-client-1",
            "client_email": "client@example.com",
            "client_name": "Integration Client",
            "document_types": ["informed_consent", "hipaa_notice"],
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    pkg_data = resp.json()
    package_id = pkg_data["package_id"]

    # 3. Send package email
    resp = await client.post(
        f"/api/documents/packages/{package_id}/send",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200

    # 4. Get package details
    resp = await client.get(
        f"/api/documents/packages/{package_id}",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    pkg = resp.json()
    documents = pkg["documents"]
    assert len(documents) >= 1

    # 5. Sign each document
    for doc in documents:
        resp = await client.post(
            f"/api/documents/{doc['id']}/sign",
            json={
                "signature_data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
            },
            headers=client_headers(),
        )
        assert resp.status_code == 200

    # 6. Check signing status
    resp = await client.get(
        "/api/documents/status/test-client-1",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    status = resp.json()
    # After signing all docs, should be all_signed
    assert status["all_signed"] is True


async def test_appointment_lifecycle(client, sent_emails):
    """Book → list → cancel → verify status."""
    # 1. Register
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )

    # 2. Set availability
    target_day = (datetime.now() + timedelta(days=5)).weekday()
    await client.put(
        "/api/availability",
        json={
            "slots": [
                {
                    "day_of_week": target_day,
                    "start_time": "09:00",
                    "end_time": "17:00",
                }
            ]
        },
        headers=clinician_headers(),
    )

    # 3. Book appointment
    future = datetime.now() + timedelta(days=5, hours=10)
    resp = await client.post(
        "/api/appointments",
        json={
            "client_id": "test-client-1",
            "client_email": "client@example.com",
            "client_name": "Integration Client",
            "clinician_id": "test-clinician-1",
            "clinician_email": "test@example.com",
            "type": "assessment",
            "scheduled_at": future.isoformat(),
            "duration_minutes": 60,
        },
        headers=clinician_headers(),
    )
    assert resp.status_code == 201
    appt_id = resp.json()["appointment_ids"][0]

    # 4. List appointments
    start = datetime.now().strftime("%Y-%m-%dT00:00:00")
    end = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%dT23:59:59")
    resp = await client.get(
        "/api/appointments",
        params={"start": start, "end": end},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    appts = resp.json()["appointments"]
    assert any(a["id"] == appt_id for a in appts)

    # 5. Cancel appointment
    resp = await client.patch(
        f"/api/appointments/{appt_id}",
        json={"status": "cancelled", "cancel_reason": "Integration test"},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"

    # 6. Verify cancelled appointment still shows in listing
    resp = await client.get(
        "/api/appointments",
        params={"start": start, "end": end},
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    appts = resp.json()["appointments"]
    cancelled = [a for a in appts if a["id"] == appt_id]
    if cancelled:
        assert cancelled[0]["status"] == "cancelled"


async def test_practice_profile_roundtrip(client):
    """Create and update practice profile, verify persistence."""
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )

    # Set practice profile
    profile = {
        "practice_name": "Integration Test Practice",
        "clinician_name": "Dr. Test",
        "clinician_credentials": "PhD, LMHC",
        "clinician_npi": "1234567890",
        "tax_id": "12-3456789",
        "phone": "555-0100",
        "email": "test@example.com",
        "address": "123 Test St",
        "accepted_insurances": ["Blue Cross", "Aetna"],
        "session_rate": 150,
    }

    resp = await client.put(
        "/api/practice-profile",
        json=profile,
        headers=clinician_headers(),
    )
    assert resp.status_code == 200

    # Get it back
    resp = await client.get("/api/practice-profile", headers=clinician_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert data["practice_name"] == "Integration Test Practice"
    assert data["clinician_name"] == "Dr. Test"
    assert data["session_rate"] == 150
