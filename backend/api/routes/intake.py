"""Intake submission endpoint.

HIPAA Access Control:
  - POST /intake — authenticated user (submits own intake data)
  - Intake data stored as JSONB in encounters table
  - All submissions logged to audit_events
"""
import sys
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from auth import get_current_user

sys.path.insert(0, "../shared")
from db import create_encounter, upsert_client, log_audit_event
from alerts import notify_bd_new_intake

router = APIRouter()


class EmergencyContact(BaseModel):
    name: str | None = None
    phone: str | None = None
    relationship: str | None = None


class Demographics(BaseModel):
    name: str
    preferredName: str | None = None
    pronouns: str | None = None
    dateOfBirth: str
    emergencyContact: EmergencyContact = EmergencyContact()


class History(BaseModel):
    priorTherapy: bool | None = None
    priorTherapyDetails: str | None = None
    medications: str | None = None
    medicalConditions: str | None = None


class IntakePayload(BaseModel):
    demographics: Demographics
    presentingConcerns: str | None = None
    history: History = History()
    goals: str | None = None
    additionalNotes: str | None = None


def _payload_to_transcript(payload: IntakePayload) -> str:
    """Convert structured intake form data to a readable transcript string."""
    d = payload.demographics
    lines = [f"Name: {d.name}"]
    if d.preferredName:
        lines.append(f"Preferred name: {d.preferredName}")
    if d.pronouns:
        lines.append(f"Pronouns: {d.pronouns}")
    lines.append(f"Date of birth: {d.dateOfBirth}")

    ec = d.emergencyContact
    if ec.name:
        lines.append(f"Emergency contact: {ec.name}, {ec.phone or 'no phone'}, {ec.relationship or 'no relationship specified'}")

    if payload.presentingConcerns:
        lines.append(f"Presenting concerns: {payload.presentingConcerns}")

    h = payload.history
    if h.priorTherapy is not None:
        lines.append(f"Prior therapy: {'yes' if h.priorTherapy else 'no'}")
    if h.priorTherapyDetails:
        lines.append(f"Prior therapy details: {h.priorTherapyDetails}")
    if h.medications:
        lines.append(f"Medications: {h.medications}")
    if h.medicalConditions:
        lines.append(f"Medical conditions: {h.medicalConditions}")

    if payload.goals:
        lines.append(f"Goals: {payload.goals}")
    if payload.additionalNotes:
        lines.append(f"Additional notes: {payload.additionalNotes}")

    return "\n".join(lines)


@router.post("/intake")
async def submit_intake(
    payload: IntakePayload,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Accept a client intake form submission and save to encounters table."""
    transcript = _payload_to_transcript(payload)

    encounter_id = await create_encounter(
        client_id=user["uid"],
        encounter_type="intake",
        source="form",
        transcript=transcript,
        data=payload.model_dump(),
        status="complete",
    )

    # Upsert client profile with demographics from intake
    ec = payload.demographics.emergencyContact
    await upsert_client(
        firebase_uid=user["uid"],
        email=user.get("email", ""),
        full_name=payload.demographics.name,
        preferred_name=payload.demographics.preferredName,
        pronouns=payload.demographics.pronouns,
        date_of_birth=payload.demographics.dateOfBirth,
        emergency_contact_name=ec.name,
        emergency_contact_phone=ec.phone,
        emergency_contact_relationship=ec.relationship,
        intake_completed_at=datetime.now(timezone.utc).isoformat(),
    )

    await log_audit_event(
        user_id=user["uid"],
        action="intake_submitted",
        resource_type="encounter",
        resource_id=encounter_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    # Alert BD of new warm lead
    notify_bd_new_intake(
        client_name=payload.demographics.name,
        source="form",
        transcript=transcript,
        data=payload.model_dump(),
        encounter_id=encounter_id,
    )

    return {
        "status": "received",
        "encounterId": encounter_id,
        "clientId": user["uid"],
        "name": payload.demographics.name,
    }
