"""Practice profile, user registration, and team management endpoints.

HIPAA Access Control:
  - POST /auth/register    — authenticated user (self-registration)
  - POST /auth/switch-role — authenticated user (role switching, blocked if data exists)
  - GET  /auth/me          — authenticated user (own profile only)
  - GET  /practice/status  — public (no auth, returns init state)
  - GET  /invitations/{token} — public (validates invite token)
  - GET  /practice/clinicians — public (active clinician list for group practice picker)
  - GET  /practice-profile — authenticated user (practice + clinician info)
  - PUT  /practice-profile — clinician (own clinician fields; owner for practice fields)
  - GET  /practice/team    — owner only
  - POST /practice/invite  — owner only
  - DELETE /practice/team/{id} — owner only
  - PATCH /practice/team/{id}  — owner only
  - All reads and writes logged to audit_events
"""
import logging
import os
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
    check_user_has_data,
    delete_clinician_and_practice,
    is_practice_initialized,
    get_client_invitation_by_token,
    get_client_invitation_by_email,
    accept_client_invitation,
    get_active_practice_clinicians,
    upsert_client,
)
from mailer import send_email

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class RegisterUserRequest(BaseModel):
    role: str | None = None  # "clinician" or "client" — auto-determined if omitted
    display_name: str | None = None
    invite_token: str | None = None
    primary_clinician_id: str | None = None


class SwitchRoleRequest(BaseModel):
    new_role: str  # "clinician" or "client"


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
    cash_only: bool | None = None


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
# Public endpoints (no auth required)
# ---------------------------------------------------------------------------

@router.get("/practice/status")
async def practice_status():
    """Check if the practice has been initialized. No auth required.

    Called by the landing page before login to determine what UI to show.
    """
    info = await is_practice_initialized()
    if not info["initialized"]:
        return {"initialized": False}
    return {
        "initialized": True,
        "practice_name": info["practice_name"],
        "practice_type": info["practice_type"],
        "cash_only": info.get("cash_only", False),
    }


@router.get("/invitations/{token}")
async def validate_invitation(token: str):
    """Validate a client invite token. No auth required.

    Called by the landing page when ?invite=TOKEN is in the URL.
    """
    invitation = await get_client_invitation_by_token(token)
    if not invitation:
        raise HTTPException(404, "Invitation not found or expired")
    return {
        "practice_name": invitation["practice_name"],
        "clinician_name": invitation["clinician_name"],
        "email": invitation["email"],
        "intake_mode": invitation.get("intake_mode", "standard"),
    }


@router.get("/practice/clinicians")
async def list_practice_clinicians_public():
    """List active clinicians for the practice. No auth required.

    Used by the clinician picker during organic client onboarding
    in group practices. Only returns public-facing info.
    """
    info = await is_practice_initialized()
    if not info["initialized"]:
        return {"clinicians": []}
    clinicians = await get_active_practice_clinicians(info["practice_id"])
    return {"clinicians": clinicians}


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

    Role auto-determination (when role is omitted):
    - No practice exists → clinician (first setup)
    - Practice exists + pending clinician invite by email → clinician
    - Practice exists → client (with optional invite_token or primary_clinician_id)

    For clinicians: checks for a pending invitation. If found, activates
    and links to existing practice. If not, creates a new solo practice.

    For clients: links to inviting clinician (via token or email), chosen
    clinician (group practice picker), or practice owner (solo practice).
    """
    from datetime import datetime, timezone
    from db import get_pool

    email = user.get("email", "")
    practice_info = await is_practice_initialized()

    # --- Determine role ---
    role = body.role
    if role and role not in ("clinician", "client"):
        raise HTTPException(400, "Role must be 'clinician' or 'client'")

    if not role:
        if not practice_info["initialized"]:
            # First user → clinician (practice setup)
            role = "clinician"
        else:
            # Check for pending clinician invitation by email
            clinician_invite = await get_clinician_by_email(email) if email else None
            if clinician_invite and clinician_invite["status"] == "invited":
                role = "clinician"
            else:
                role = "client"

    # Block new clinician registration when practice already exists (unless invited)
    if role == "clinician" and practice_info["initialized"]:
        clinician_invite = await get_clinician_by_email(email) if email else None
        if not (clinician_invite and clinician_invite["status"] == "invited"):
            raise HTTPException(403, "This practice is already set up. Clinicians must be invited by the practice owner.")

    user_id = await upsert_user(
        firebase_uid=user["uid"],
        email=email,
        role=role,
        display_name=body.display_name,
    )

    practice_id = None
    practice_role = None
    primary_clinician_uid = None

    if role == "clinician":
        # Check for pending clinician invitation by email
        invited = await get_clinician_by_email(email) if email else None

        if invited and invited["status"] == "invited":
            # Accept clinician invitation
            pool = await get_pool()
            await pool.execute(
                "UPDATE clinicians SET firebase_uid = $1 WHERE id = $2::uuid",
                user["uid"],
                invited["id"],
            )
            await activate_clinician(user["uid"])
            practice_id = invited["practice_id"]
            practice_role = invited["practice_role"]

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
                joined_at=datetime.now(timezone.utc),
            )
            practice_role = "owner"

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

    elif role == "client":
        # Determine which clinician to link this client to
        client_invite = None

        # Priority 1: invite token
        if body.invite_token:
            client_invite = await get_client_invitation_by_token(body.invite_token)

        # Priority 2: email-based invitation lookup
        if not client_invite and email:
            client_invite = await get_client_invitation_by_email(email)

        if client_invite:
            primary_clinician_uid = client_invite["clinician_firebase_uid"]
            practice_id = client_invite["practice_id"]
            await accept_client_invitation(client_invite["token"])
        elif body.primary_clinician_id:
            # Group practice picker — clinician chosen by client
            primary_clinician_uid = body.primary_clinician_id
            practice_id = practice_info.get("practice_id")
        elif practice_info["initialized"] and practice_info.get("practice_type") == "solo":
            # Solo practice — auto-link to owner
            pool = await get_pool()
            owner_row = await pool.fetchrow(
                """
                SELECT firebase_uid FROM clinicians
                WHERE practice_id = $1::uuid AND practice_role = 'owner' AND status = 'active'
                LIMIT 1
                """,
                practice_info["practice_id"],
            )
            if owner_row:
                primary_clinician_uid = owner_row["firebase_uid"]
            practice_id = practice_info.get("practice_id")
        else:
            # Group practice, no invite, no clinician chosen
            practice_id = practice_info.get("practice_id")

        # Create/update client record with primary clinician linkage
        await upsert_client(
            firebase_uid=user["uid"],
            email=email,
            full_name=body.display_name,
            primary_clinician_id=primary_clinician_uid,
        )

    await log_audit_event(
        user_id=user["uid"],
        action="registered",
        resource_type="user",
        resource_id=user_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={
            "role": role,
            "practice_id": practice_id,
            "practice_role": practice_role,
            "primary_clinician_uid": primary_clinician_uid,
        },
    )

    result = {"user_id": user_id, "role": role}
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
# Role switching
# ---------------------------------------------------------------------------

@router.post("/auth/switch-role")
async def switch_role(
    body: SwitchRoleRequest,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Switch between clinician and client roles.

    Only allowed when the user has no real data in their current role.
    Clinician→Client: deletes clinician record and solo practice.
    Client→Clinician: creates a new solo practice and clinician record.
    """
    if body.new_role not in ("clinician", "client"):
        raise HTTPException(400, "Role must be 'clinician' or 'client'")

    user_record = await get_user(user["uid"])
    if not user_record:
        raise HTTPException(404, "User not registered")

    current_role = user_record["role"]
    if current_role == body.new_role:
        raise HTTPException(400, f"Already in {body.new_role} role")

    # Check for existing data that prevents switching
    has_data = await check_user_has_data(user["uid"], current_role)
    if has_data:
        raise HTTPException(
            409,
            detail={
                "locked": True,
                "reason": (
                    "You have existing data as a "
                    f"{current_role} and cannot switch roles. "
                    "Please contact support if you need to change roles."
                ),
            },
        )

    practice_id = None
    practice_role = None

    # Clean up old role resources
    if current_role == "clinician":
        await delete_clinician_and_practice(user["uid"])

    # Set up new role resources
    if body.new_role == "clinician":
        email = user.get("email", "")
        display_name = user_record.get("display_name")
        practice_id = await create_practice(
            name=display_name or "My Practice",
            practice_type="solo",
        )
        from datetime import datetime, timezone
        await create_clinician(
            practice_id=practice_id,
            firebase_uid=user["uid"],
            email=email,
            clinician_name=display_name,
            practice_role="owner",
            status="active",
            joined_at=datetime.now(timezone.utc),
        )
        practice_role = "owner"

        # Link user to practice
        from db import get_pool
        pool = await get_pool()
        await pool.execute(
            "UPDATE users SET practice_id = $1::uuid, role = $2 WHERE firebase_uid = $3",
            practice_id,
            body.new_role,
            user["uid"],
        )
    else:
        # Switching to client — just update role
        from db import get_pool
        pool = await get_pool()
        await pool.execute(
            "UPDATE users SET role = $1 WHERE firebase_uid = $2",
            body.new_role,
            user["uid"],
        )

    await log_audit_event(
        user_id=user["uid"],
        action="switched_role",
        resource_type="user",
        resource_id=user_record["id"],
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={
            "from_role": current_role,
            "to_role": body.new_role,
            "practice_id": practice_id,
        },
    )

    result = {"role": body.new_role}
    if practice_id:
        result["practice_id"] = practice_id
        result["practice_role"] = practice_role
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
        "address_zip", "accepted_insurances", "timezone", "practice_type", "cash_only",
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
        await send_email(
            to=body.email,
            subject=f"You've been invited to join {practice_name} on Trellis",
            html_body=(
                f"<p>Hi{' ' + body.clinician_name if body.clinician_name else ''},</p>"
                f"<p>You've been invited to join <b>{practice_name}</b> on Trellis, "
                f"an AI-native behavioral health platform.</p>"
                f"<p>To accept this invitation, sign up at Trellis using this email "
                f"address ({body.email}). You'll be automatically linked to the practice.</p>"
                f"<p>— The Trellis Team</p>"
            ),
            clinician_uid=user["uid"],
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
