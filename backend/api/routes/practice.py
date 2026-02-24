"""Practice profile, user registration, and team management endpoints.

HIPAA Access Control:
  - POST /auth/register    — authenticated user (self-registration)
  - GET  /auth/me          — authenticated user (own profile only)
  - GET  /practice-profile — authenticated user (practice + clinician info)
  - PUT  /practice-profile — clinician (own clinician fields; owner for practice fields)
  - GET  /practice/team    — owner only
  - POST /practice/invite  — owner only
  - DELETE /practice/team/{id} — owner only
  - PATCH /practice/team/{id}  — owner only
  - All reads and writes logged to audit_events
"""
import logging
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import (
    get_current_user,
    require_role,
    require_practice_member,
    is_owner,
)

sys.path.insert(0, "../shared")
from db import (
    upsert_practice_profile,
    get_practice_profile,
    upsert_user,
    get_user,
    log_audit_event,
    get_clinician,
    get_clinician_by_email,
    create_practice,
    create_clinician,
    activate_clinician,
    deactivate_clinician,
    get_practice_clinicians,
    update_clinician,
    update_practice,
    invite_clinician,
    get_practice,
)
from mailer import send_email

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class RegisterUserRequest(BaseModel):
    role: str  # "clinician" or "client"
    display_name: str | None = None


class PracticeProfileUpdate(BaseModel):
    practice_name: str | None = None
    clinician_name: str | None = None
    credentials: str | None = None
    license_number: str | None = None
    license_state: str | None = None
    npi: str | None = None
    tax_id: str | None = None
    specialties: list[str] | None = None
    bio: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_zip: str | None = None
    accepted_insurances: list[str] | None = None
    session_rate: float | None = None
    intake_rate: float | None = None
    sliding_scale: bool | None = None
    sliding_scale_min: float | None = None
    default_session_duration: int | None = None
    intake_duration: int | None = None
    timezone: str | None = None
    practice_type: str | None = None


class InviteClinicianRequest(BaseModel):
    email: str
    clinician_name: str | None = None


class UpdateClinicianRequest(BaseModel):
    clinician_name: str | None = None
    credentials: str | None = None
    license_number: str | None = None
    license_state: str | None = None
    npi: str | None = None
    specialties: list[str] | None = None
    bio: str | None = None
    session_rate: float | None = None
    intake_rate: float | None = None
    sliding_scale: bool | None = None
    sliding_scale_min: float | None = None
    default_session_duration: int | None = None
    intake_duration: int | None = None


# ---------------------------------------------------------------------------
# User registration
# ---------------------------------------------------------------------------

@router.post("/auth/register")
async def register_user(
    body: RegisterUserRequest,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Register a user with a role. Called after Firebase Auth signup.

    For clinicians: checks for a pending invitation. If found, activates
    and links to existing practice. If not, creates a new solo practice.
    """
    if body.role not in ("clinician", "client"):
        raise HTTPException(400, "Role must be 'clinician' or 'client'")

    user_id = await upsert_user(
        firebase_uid=user["uid"],
        email=user.get("email", ""),
        role=body.role,
        display_name=body.display_name,
    )

    practice_id = None
    practice_role = None

    if body.role == "clinician":
        # Check for pending invitation by email
        email = user.get("email", "")
        invited = await get_clinician_by_email(email) if email else None

        if invited and invited["status"] == "invited":
            # Accept invitation: update placeholder firebase_uid, activate
            from db import get_pool
            pool = await get_pool()
            await pool.execute(
                "UPDATE clinicians SET firebase_uid = $1 WHERE id = $2::uuid",
                user["uid"],
                invited["id"],
            )
            await activate_clinician(user["uid"])
            practice_id = invited["practice_id"]
            practice_role = invited["practice_role"]

            # Link user to practice
            await pool.execute(
                "UPDATE users SET practice_id = $1::uuid WHERE firebase_uid = $2",
                practice_id,
                user["uid"],
            )

            logger.info(
                "Clinician %s accepted invitation, joined practice %s",
                user["uid"], practice_id,
            )
        else:
            # No invitation — create a new solo practice + owner clinician
            practice_id = await create_practice(
                name=body.display_name or "My Practice",
                practice_type="solo",
            )
            await create_clinician(
                practice_id=practice_id,
                firebase_uid=user["uid"],
                email=email,
                clinician_name=body.display_name,
                practice_role="owner",
                status="active",
                joined_at="now()",
            )
            practice_role = "owner"

            # Link user to practice
            from db import get_pool
            pool = await get_pool()
            await pool.execute(
                "UPDATE users SET practice_id = $1::uuid WHERE firebase_uid = $2",
                practice_id,
                user["uid"],
            )

            logger.info(
                "Clinician %s created solo practice %s",
                user["uid"], practice_id,
            )

    await log_audit_event(
        user_id=user["uid"],
        action="registered",
        resource_type="user",
        resource_id=user_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={
            "role": body.role,
            "practice_id": practice_id,
            "practice_role": practice_role,
        },
    )

    result = {"user_id": user_id, "role": body.role}
    if practice_id:
        result["practice_id"] = practice_id
        result["practice_role"] = practice_role
    return result


@router.get("/auth/me")
async def get_me(request: Request, user: dict = Depends(get_current_user)):
    """Get the current user's registration info, including clinician/practice data."""
    user_record = await get_user(user["uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="user_profile",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    if not user_record:
        return {"registered": False}

    result = {**user_record, "registered": True}

    # Enrich with clinician + practice info if clinician role
    if user_record.get("role") == "clinician":
        clinician = await get_clinician(user["uid"])
        if clinician:
            result["clinician"] = clinician
            practice = await get_practice(clinician["practice_id"])
            if practice:
                result["practice"] = practice

    return result


# ---------------------------------------------------------------------------
# Practice profile (backward compatible)
# ---------------------------------------------------------------------------

@router.get("/practice-profile")
async def get_profile(
    request: Request,
    clinician_uid: str | None = None,
    user: dict = Depends(get_current_user),
):
    """Get the practice profile. Accessible by both clinicians and clients.

    Optional clinician_uid query param returns a specific clinician's merged profile.
    """
    profile = await get_practice_profile(clinician_uid)

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="practice_profile",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    if not profile:
        return {"exists": False}
    return {**profile, "exists": True}


@router.put("/practice-profile")
async def update_profile(
    body: PracticeProfileUpdate,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Create or update the practice profile.

    Practice-level fields (name, address, tax_id, accepted_insurances, etc.)
    are owner-only. Clinician-level fields (clinician_name, credentials,
    rates, etc.) can be updated by the clinician themselves.
    """
    fields = {k: v for k, v in body.model_dump().items() if v is not None}

    # Check if user is trying to update practice-level fields
    _PRACTICE_ONLY_FIELDS = {
        "practice_name", "tax_id", "phone", "email", "website",
        "address_line1", "address_line2", "address_city", "address_state",
        "address_zip", "accepted_insurances", "timezone", "practice_type",
    }
    practice_fields = {k: v for k, v in fields.items() if k in _PRACTICE_ONLY_FIELDS}

    if practice_fields:
        # Verify user is owner
        clinician = await get_clinician(user["uid"])
        if clinician and clinician["practice_role"] != "owner":
            raise HTTPException(
                403,
                "Only the practice owner can update practice-level settings",
            )
        # Handle practice_type update on the practices table directly
        if "practice_type" in practice_fields and clinician:
            await update_practice(clinician["practice_id"], type=practice_fields.pop("practice_type"))
            fields.pop("practice_type", None)

    if not fields.get("clinician_name"):
        existing = await get_practice_profile(user["uid"])
        if not existing:
            raise HTTPException(400, "clinician_name is required for initial setup")

    profile_id = await upsert_practice_profile(
        clinician_uid=user["uid"],
        **{k: v for k, v in fields.items() if k != "practice_type"},
    )

    await log_audit_event(
        user_id=user["uid"],
        action="updated",
        resource_type="practice_profile",
        resource_id=profile_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={"fields": list(fields.keys())},
    )

    return {"status": "saved", "profile_id": profile_id}


# ---------------------------------------------------------------------------
# Team Management (owner only)
# ---------------------------------------------------------------------------

@router.get("/practice/team")
async def list_team(
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """List all clinicians in the practice. Owner only."""
    clinicians = await get_practice_clinicians(user["practice_id"])

    await log_audit_event(
        user_id=user["uid"],
        action="listed",
        resource_type="practice_team",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return {"clinicians": clinicians}


@router.post("/practice/invite")
async def invite_team_member(
    body: InviteClinicianRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Invite a clinician to the practice. Owner only.

    Creates a clinician record with status='invited'. When the invited
    clinician registers, they'll be auto-linked to this practice.
    """
    # Check if already invited or active
    existing = await get_clinician_by_email(body.email)
    if existing:
        if existing["status"] == "active":
            raise HTTPException(400, "This clinician is already a member of a practice")
        if existing["status"] == "invited":
            raise HTTPException(400, "This clinician has already been invited")

    clinician_id = await invite_clinician(
        practice_id=user["practice_id"],
        email=body.email,
        invited_by=user["uid"],
    )

    # Update clinician_name if provided
    if body.clinician_name:
        from db import get_pool
        pool = await get_pool()
        await pool.execute(
            "UPDATE clinicians SET clinician_name = $1 WHERE id = $2::uuid",
            body.clinician_name,
            clinician_id,
        )

    # Send invitation email
    practice = await get_practice(user["practice_id"])
    practice_name = practice["name"] if practice else "the practice"
    try:
        send_email(
            to_email=body.email,
            subject=f"You've been invited to join {practice_name} on Trellis",
            html_body=(
                f"<p>Hi{' ' + body.clinician_name if body.clinician_name else ''},</p>"
                f"<p>You've been invited to join <b>{practice_name}</b> on Trellis, "
                f"an AI-native behavioral health platform.</p>"
                f"<p>To accept this invitation, sign up at Trellis using this email "
                f"address ({body.email}). You'll be automatically linked to the practice.</p>"
                f"<p>— The Trellis Team</p>"
            ),
        )
    except Exception as e:
        logger.error("Failed to send invitation email to %s: %s", body.email, e)

    await log_audit_event(
        user_id=user["uid"],
        action="invited",
        resource_type="clinician",
        resource_id=clinician_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={"email": body.email},
    )

    return {"status": "invited", "clinician_id": clinician_id}


@router.delete("/practice/team/{clinician_id}")
async def remove_team_member(
    clinician_id: str,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Deactivate a clinician from the practice. Owner only."""
    from db import get_clinician_by_id

    clinician = await get_clinician_by_id(clinician_id)
    if not clinician:
        raise HTTPException(404, "Clinician not found")

    if clinician["practice_id"] != user["practice_id"]:
        raise HTTPException(403, "Clinician is not in your practice")

    if clinician["practice_role"] == "owner":
        raise HTTPException(400, "Cannot deactivate the practice owner")

    await deactivate_clinician(clinician["firebase_uid"])

    await log_audit_event(
        user_id=user["uid"],
        action="deactivated",
        resource_type="clinician",
        resource_id=clinician_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return {"status": "deactivated"}


@router.patch("/practice/team/{clinician_id}")
async def update_team_member(
    clinician_id: str,
    body: UpdateClinicianRequest,
    request: Request,
    user: dict = Depends(require_practice_member("owner")),
):
    """Update a clinician's details. Owner only."""
    from db import get_clinician_by_id

    clinician = await get_clinician_by_id(clinician_id)
    if not clinician:
        raise HTTPException(404, "Clinician not found")

    if clinician["practice_id"] != user["practice_id"]:
        raise HTTPException(403, "Clinician is not in your practice")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields to update")

    await update_clinician(clinician["firebase_uid"], **fields)

    await log_audit_event(
        user_id=user["uid"],
        action="updated",
        resource_type="clinician",
        resource_id=clinician_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={"fields": list(fields.keys())},
    )

    return {"status": "updated"}
