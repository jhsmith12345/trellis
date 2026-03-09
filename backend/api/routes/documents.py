"""Document signing endpoints.

HIPAA Access Control:
  - GET /documents/signing-status — authenticated user (own status) or clinician
  - GET /documents/packages/{id}  — enforce_client_owns_resource (client) or clinician
  - POST /documents/sign          — authenticated user, signs own documents only
  - Documents use SHA-256 content hashing to verify integrity
  - Signer IP, user-agent, and timestamp recorded for legal compliance
  - All reads and writes logged to audit_events
"""
import hashlib
import json
import logging
import os
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user, get_current_user_with_role, require_role, enforce_client_owns_resource

sys.path.insert(0, "../shared")
from db import (
    create_document_package,
    get_document_package,
    get_document_owner,
    update_package_status,
    create_document,
    sign_document,
    get_document,
    check_package_complete,
    upsert_stored_signature,
    get_stored_signature,
    get_client_document_signing_status,
    get_client,
    get_practice_profile,
    log_audit_event,
)
from mailer import send_email

logger = logging.getLogger(__name__)

router = APIRouter()

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# Template definitions: key → default title
TEMPLATES = {
    "financial_agreement": "Financial Agreement",
    "informed_consent": "Informed Consent for Treatment",
    "hipaa": "HIPAA Notice of Privacy Practices",
    "telehealth_consent": "Telehealth Informed Consent",
    "program_agreement": "Program Agreement",
    "release_of_info": "Release of Information",
}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _content_hash(content: dict) -> str:
    """SHA-256 of deterministically-serialized content."""
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Content builders per template key
# ---------------------------------------------------------------------------

def _build_content(
    template_key: str,
    client_name: str,
    financial_data: dict | None,
    client_data: dict | None = None,
    practice_data: dict | None = None,
) -> dict:
    """Build JSONB content for a document template.

    Populates with client profile data and practice profile data when available.
    """
    base = {"client_name": client_name, "date": "{{signing_date}}"}

    # Add client-specific data if available
    if client_data:
        if client_data.get("date_of_birth"):
            base["date_of_birth"] = client_data["date_of_birth"]
        if client_data.get("address_line1"):
            base["client_address"] = ", ".join(filter(None, [
                client_data.get("address_line1"),
                client_data.get("address_line2"),
                client_data.get("address_city"),
                f"{client_data.get('address_state', '')} {client_data.get('address_zip', '')}".strip(),
            ]))
        if client_data.get("phone"):
            base["client_phone"] = client_data["phone"]
        if client_data.get("email"):
            base["client_email"] = client_data["email"]
        # Insurance info for financial agreement
        if client_data.get("payer_name"):
            base["insurance_provider"] = client_data["payer_name"]
        if client_data.get("member_id"):
            base["policy_number"] = client_data["member_id"]
        if client_data.get("emergency_contact_name"):
            base["emergency_contact_name"] = client_data["emergency_contact_name"]
            base["emergency_contact_phone"] = client_data.get("emergency_contact_phone", "")
            base["emergency_contact_relationship"] = client_data.get("emergency_contact_relationship", "")

    # Add practice-specific data if available
    if practice_data:
        if practice_data.get("practice_name"):
            base["practice_name"] = practice_data["practice_name"]
        if practice_data.get("clinician_name"):
            base["clinician_name"] = practice_data["clinician_name"]
        if practice_data.get("credentials"):
            base["clinician_credentials"] = practice_data["credentials"]
        if practice_data.get("phone"):
            base["practice_phone"] = practice_data["phone"]
        if practice_data.get("email"):
            base["practice_email"] = practice_data["email"]
        if practice_data.get("address_line1"):
            base["practice_address"] = ", ".join(filter(None, [
                practice_data.get("address_line1"),
                practice_data.get("address_line2"),
                practice_data.get("address_city"),
                f"{practice_data.get('address_state', '')} {practice_data.get('address_zip', '')}".strip(),
            ]))
        if practice_data.get("license_number"):
            base["license_number"] = practice_data["license_number"]
        if practice_data.get("license_state"):
            base["license_state"] = practice_data["license_state"]
        if practice_data.get("npi"):
            base["npi"] = practice_data["npi"]
        if practice_data.get("session_rate"):
            base["session_rate"] = str(practice_data["session_rate"])
        if practice_data.get("intake_rate"):
            base["intake_rate"] = str(practice_data["intake_rate"])

    if template_key == "financial_agreement" and financial_data:
        return {**base, **financial_data}
    return base


# ---------------------------------------------------------------------------
# Auto-generate consent package (called from scheduling on assessment booking)
# ---------------------------------------------------------------------------

async def auto_generate_consent_package(
    client_id: str,
    client_email: str,
    client_name: str,
    clinician_uid: str,
) -> str | None:
    """Create a full consent document package for a client and send signing email.

    Called automatically when an assessment appointment is booked.
    Returns the package_id on success, or None on failure.
    """
    try:
        # Load client profile for template population
        client_data = await get_client(client_id)

        # Load practice profile for template population
        practice_data = await get_practice_profile(clinician_uid)

        # Build financial data from practice profile
        financial_data = {}
        if practice_data:
            if practice_data.get("session_rate"):
                financial_data["session_rate"] = str(practice_data["session_rate"])
            if practice_data.get("intake_rate"):
                financial_data["intake_rate"] = str(practice_data["intake_rate"])

        # Create the document package
        package_id = await create_document_package(
            client_id=client_id,
            created_by=clinician_uid,
            client_email=client_email,
            client_name=client_name,
            financial_data=financial_data or None,
        )

        # Create all 6 consent documents
        for i, (template_key, title) in enumerate(TEMPLATES.items()):
            content = _build_content(
                template_key=template_key,
                client_name=client_name,
                financial_data=financial_data or None,
                client_data=client_data,
                practice_data=practice_data,
            )
            await create_document(
                package_id=package_id,
                template_key=template_key,
                title=title,
                content=content,
                sort_order=i,
            )

        # Send signing email
        signing_url = f"{FRONTEND_URL}/sign/{package_id}"
        doc_count = len(TEMPLATES)
        practice_name = "Trellis"
        if practice_data and practice_data.get("practice_name"):
            practice_name = practice_data["practice_name"]

        html = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #fafaf9; padding: 24px;">
            <div style="background: #0f766e; padding: 24px; border-radius: 12px 12px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 20px;">Documents Ready for Signing</h1>
                <p style="color: #99f6e4; margin: 4px 0 0; font-size: 14px;">{practice_name}</p>
            </div>
            <div style="background: white; padding: 24px; border: 1px solid #e7e5e4; border-top: none;">
                <p style="color: #44403c; font-size: 16px; line-height: 1.6; margin: 0 0 8px;">
                    Hi {client_name},
                </p>
                <p style="color: #44403c; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                    Welcome! Your intake assessment has been scheduled. Before your session,
                    please review and sign <strong>{doc_count} document{'s' if doc_count != 1 else ''}</strong>.
                    This can be completed online at your convenience.
                </p>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="{signing_url}"
                       style="display: inline-block; background: #0f766e; color: white; font-weight: 600;
                              font-size: 16px; padding: 14px 32px; border-radius: 8px; text-decoration: none;">
                        Review &amp; Sign Documents
                    </a>
                </div>
                <p style="color: #78716c; font-size: 13px; line-height: 1.5; margin: 0;">
                    Please complete these documents before your appointment. If you have questions,
                    please contact your care coordinator. This link will remain active until all
                    documents are signed.
                </p>
            </div>
            <div style="padding: 16px; text-align: center; border-radius: 0 0 12px 12px; background: #f5f5f4; border: 1px solid #e7e5e4; border-top: none;">
                <p style="margin: 0; font-size: 13px; color: #78716c;">{practice_name}</p>
            </div>
        </div>
        """

        text = f"""Hi {client_name},

Welcome! Your intake assessment has been scheduled. Before your session, please review and sign {doc_count} document{'s' if doc_count != 1 else ''}.

Review & Sign: {signing_url}

Please complete these documents before your appointment. If you have questions, please contact your care coordinator.

— {practice_name}
"""

        await send_email(
            to=client_email,
            subject=f"Documents Ready for Signing — {practice_name}",
            html_body=html,
            text_body=text,
        )

        await update_package_status(package_id, "sent")

        await log_audit_event(
            user_id=clinician_uid,
            action="auto_generated_consent_package",
            resource_type="package",
            resource_id=package_id,
            metadata={
                "client_id": client_id,
                "document_count": doc_count,
                "trigger": "assessment_booking",
            },
        )

        # PHI-safe: log package ID and doc count only
        logger.info(
            "Auto-generated consent package %s (%d docs)",
            package_id, doc_count,
        )
        return package_id

    except Exception as e:
        logger.error(
            "Failed to auto-generate consent package for client %s: %s",
            client_id, e,
        )
        return None


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class DocumentSpec(BaseModel):
    template_key: str
    title: str | None = None
    content: dict | None = None


class CreatePackageRequest(BaseModel):
    client_id: str
    client_email: str
    client_name: str
    financial_data: dict | None = None
    documents: list[DocumentSpec]


class SignDocumentRequest(BaseModel):
    signature_data: str
    content: dict


class StoreSignatureRequest(BaseModel):
    signature_png: str


# ---------------------------------------------------------------------------
# Package endpoints
# ---------------------------------------------------------------------------

@router.post("/documents/packages")
async def create_package(
    body: CreatePackageRequest,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Create a document package with a list of documents. Clinician only."""
    package_id = await create_document_package(
        client_id=body.client_id,
        created_by=user["uid"],
        client_email=body.client_email,
        client_name=body.client_name,
        financial_data=body.financial_data,
    )

    # Load client + practice data for template population
    client_data = await get_client(body.client_id)
    practice_data = await get_practice_profile(user["uid"])

    doc_ids = []
    for i, spec in enumerate(body.documents):
        if spec.template_key not in TEMPLATES:
            raise HTTPException(400, f"Unknown template: {spec.template_key}")

        content = spec.content or _build_content(
            spec.template_key, body.client_name, body.financial_data,
            client_data=client_data, practice_data=practice_data,
        )
        title = spec.title or TEMPLATES[spec.template_key]

        doc_id = await create_document(
            package_id=package_id,
            template_key=spec.template_key,
            title=title,
            content=content,
            sort_order=i,
        )
        doc_ids.append(doc_id)

    await log_audit_event(
        user_id=user["uid"],
        action="created",
        resource_type="package",
        resource_id=package_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"document_count": len(doc_ids)},
    )

    return {"package_id": package_id, "document_ids": doc_ids}


@router.post("/documents/packages/{package_id}/send")
async def send_package(
    package_id: str,
    request: Request,
    user: dict = Depends(require_role("clinician")),
):
    """Send the signing email to the client. Clinician only."""
    pkg = await get_document_package(package_id)
    if not pkg:
        raise HTTPException(404, "Package not found")

    # Load practice name for email branding
    practice = await get_practice_profile(user["uid"])
    practice_name = "Trellis"
    if practice and practice.get("practice_name"):
        practice_name = practice["practice_name"]

    signing_url = f"{FRONTEND_URL}/sign/{package_id}"
    doc_count = len(pkg["documents"])

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #fafaf9; padding: 24px;">
        <div style="background: #0f766e; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 20px;">Documents Ready for Signing</h1>
            <p style="color: #99f6e4; margin: 4px 0 0; font-size: 14px;">{practice_name}</p>
        </div>
        <div style="background: white; padding: 24px; border: 1px solid #e7e5e4; border-top: none;">
            <p style="color: #44403c; font-size: 16px; line-height: 1.6; margin: 0 0 8px;">
                Hi {pkg['client_name']},
            </p>
            <p style="color: #44403c; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                You have <strong>{doc_count} document{'s' if doc_count != 1 else ''}</strong> to review and sign
                as part of your onboarding. Please click the button below to get started.
            </p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{signing_url}"
                   style="display: inline-block; background: #0f766e; color: white; font-weight: 600;
                          font-size: 16px; padding: 14px 32px; border-radius: 8px; text-decoration: none;">
                    Review &amp; Sign Documents
                </a>
            </div>
            <p style="color: #78716c; font-size: 13px; line-height: 1.5; margin: 0;">
                If you have questions, please contact your care coordinator. This link will remain active
                until all documents are signed.
            </p>
        </div>
        <div style="padding: 16px; text-align: center; border-radius: 0 0 12px 12px; background: #f5f5f4; border: 1px solid #e7e5e4; border-top: none;">
            <p style="margin: 0; font-size: 13px; color: #78716c;">{practice_name}</p>
        </div>
    </div>
    """

    text = f"""Hi {pkg['client_name']},

You have {doc_count} document{'s' if doc_count != 1 else ''} to review and sign.

Review & Sign: {signing_url}

If you have questions, please contact your care coordinator.

— {practice_name}
"""

    await send_email(
        to=pkg["client_email"],
        subject=f"Documents Ready for Signing — {practice_name}",
        html_body=html,
        text_body=text,
    )

    await update_package_status(package_id, "sent")

    await log_audit_event(
        user_id=user["uid"],
        action="sent",
        resource_type="package",
        resource_id=package_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"client_email": pkg["client_email"]},
    )

    return {"status": "sent"}


@router.get("/documents/packages/{package_id}")
async def get_package(
    package_id: str,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Load a package and its documents. Clients can only view their own."""
    pkg = await get_document_package(package_id)
    if not pkg:
        raise HTTPException(404, "Package not found")

    # Clients can only view packages that belong to them
    enforce_client_owns_resource(user, pkg.get("client_id"))

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="package",
        resource_id=package_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return pkg


# ---------------------------------------------------------------------------
# Document signing
# ---------------------------------------------------------------------------

@router.post("/documents/{doc_id}/sign")
async def sign_doc(
    doc_id: str,
    body: SignDocumentRequest,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Sign a single document. Clients can only sign their own."""
    doc = await get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    # Clients can only sign documents in packages that belong to them
    doc_owner = await get_document_owner(doc_id)
    enforce_client_owns_resource(user, doc_owner)

    if doc["status"] == "signed":
        raise HTTPException(400, "Document already signed")

    content_h = _content_hash(body.content)
    ip = _client_ip(request)
    ua = request.headers.get("user-agent", "")

    await sign_document(
        doc_id=doc_id,
        signature_data=body.signature_data,
        content_hash=content_h,
        signer_ip=ip,
        signer_user_agent=ua,
    )

    await log_audit_event(
        user_id=user["uid"],
        action="signed",
        resource_type="document",
        resource_id=doc_id,
        ip_address=ip,
        user_agent=ua,
        metadata={"content_hash": content_h, "template_key": doc["template_key"]},
    )

    # Check if package is complete
    package_id = doc["package_id"]
    if await check_package_complete(package_id):
        await update_package_status(package_id, "completed")
        await log_audit_event(
            user_id=user["uid"],
            action="completed",
            resource_type="package",
            resource_id=package_id,
            ip_address=ip,
            user_agent=ua,
        )
        return {"status": "signed", "package_complete": True}

    # Mark partially signed if first signature
    pkg = await get_document_package(package_id)
    if pkg and pkg["status"] == "sent":
        await update_package_status(package_id, "partially_signed")

    return {"status": "signed", "package_complete": False}


# ---------------------------------------------------------------------------
# Stored signatures
# ---------------------------------------------------------------------------

@router.get("/documents/signature")
async def get_signature(user: dict = Depends(get_current_user)):
    """Get the current user's stored signature."""
    sig = await get_stored_signature(user["uid"])
    if not sig:
        return {"signature_png": None}
    return {"signature_png": sig}


@router.post("/documents/signature")
async def store_signature(
    body: StoreSignatureRequest,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Store or update the current user's signature."""
    await upsert_stored_signature(user["uid"], body.signature_png)

    await log_audit_event(
        user_id=user["uid"],
        action="stored",
        resource_type="signature",
        resource_id=user["uid"],
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return {"status": "saved"}


# ---------------------------------------------------------------------------
# Document signing status (clinician portal)
# ---------------------------------------------------------------------------

@router.get("/documents/status/{client_id}")
async def get_client_doc_status(
    client_id: str,
    request: Request,
    user: dict = Depends(get_current_user_with_role),
):
    """Get document signing status for a specific client.

    Clinicians can view any client's status. Clients can only view their own.
    Returns {total, signed, pending, packages: [...]}.
    """
    enforce_client_owns_resource(user, client_id)

    status = await get_client_document_signing_status(client_id)

    await log_audit_event(
        user_id=user["uid"],
        action="viewed_doc_status",
        resource_type="document_status",
        resource_id=client_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    return status
