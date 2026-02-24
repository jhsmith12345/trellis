"""Tests for document package and signing endpoints."""
import pytest
from conftest import clinician_headers, client_headers


async def _register_clinician(client):
    await client.post(
        "/api/auth/register",
        json={"role": "clinician"},
        headers=clinician_headers(),
    )


async def _register_client(client):
    await client.post(
        "/api/auth/register",
        json={"role": "client"},
        headers=client_headers(),
    )


async def _create_package(client):
    """Create a document package and return the response data."""
    resp = await client.post(
        "/api/documents/packages",
        json={
            "client_id": "test-client-1",
            "client_email": "client@example.com",
            "client_name": "Test Client",
            "documents": [
                {"template_key": "informed_consent"},
                {"template_key": "hipaa"},
            ],
        },
        headers=clinician_headers(),
    )
    return resp


async def test_create_package(client):
    """POST /api/documents/packages creates package with documents."""
    await _register_clinician(client)
    resp = await _create_package(client)
    assert resp.status_code == 200
    data = resp.json()
    assert "package_id" in data
    assert len(data["document_ids"]) == 2


async def test_get_package(client):
    """GET /api/documents/packages/{id} returns package with documents."""
    await _register_clinician(client)
    create_resp = await _create_package(client)
    pkg_id = create_resp.json()["package_id"]

    resp = await client.get(
        f"/api/documents/packages/{pkg_id}",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == pkg_id
    assert len(data["documents"]) == 2
    assert data["status"] == "draft"


async def test_send_package(client, sent_emails):
    """POST /api/documents/packages/{id}/send sends signing email."""
    await _register_clinician(client)
    create_resp = await _create_package(client)
    pkg_id = create_resp.json()["package_id"]

    resp = await client.post(
        f"/api/documents/packages/{pkg_id}/send",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "sent"
    assert len(sent_emails) >= 1
    assert sent_emails[-1]["to"] == "client@example.com"


async def test_sign_document(client):
    """POST /api/documents/{doc_id}/sign signs a document."""
    await _register_clinician(client)
    await _register_client(client)
    create_resp = await _create_package(client)
    doc_id = create_resp.json()["document_ids"][0]

    # Sign the document (as the client who owns it)
    resp = await client.post(
        f"/api/documents/{doc_id}/sign",
        json={
            "signature_data": "data:image/png;base64,fakeSignature",
            "content": {"client_name": "Test Client"},
        },
        headers=client_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "signed"


async def test_sign_already_signed_document(client):
    """POST /api/documents/{doc_id}/sign returns 400 for already signed."""
    await _register_clinician(client)
    await _register_client(client)
    create_resp = await _create_package(client)
    doc_id = create_resp.json()["document_ids"][0]

    # Sign once
    await client.post(
        f"/api/documents/{doc_id}/sign",
        json={
            "signature_data": "data:image/png;base64,fakeSignature",
            "content": {"client_name": "Test Client"},
        },
        headers=client_headers(),
    )
    # Sign again
    resp = await client.post(
        f"/api/documents/{doc_id}/sign",
        json={
            "signature_data": "data:image/png;base64,fakeSignature",
            "content": {"client_name": "Test Client"},
        },
        headers=client_headers(),
    )
    assert resp.status_code == 400


async def test_stored_signature_workflow(client):
    """POST/GET /api/documents/signature stores and retrieves a signature."""
    await _register_client(client)
    # Store
    resp = await client.post(
        "/api/documents/signature",
        json={"signature_png": "data:image/png;base64,testSig123"},
        headers=client_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "saved"

    # Retrieve
    resp = await client.get("/api/documents/signature", headers=client_headers())
    assert resp.status_code == 200
    assert resp.json()["signature_png"] == "data:image/png;base64,testSig123"


async def test_get_package_not_found(client):
    """GET /api/documents/packages/{bad_id} returns 404."""
    await _register_clinician(client)
    resp = await client.get(
        "/api/documents/packages/00000000-0000-0000-0000-000000000000",
        headers=clinician_headers(),
    )
    assert resp.status_code == 404


async def test_document_signing_status(client):
    """GET /api/documents/status/{client_id} returns status summary."""
    await _register_clinician(client)
    await _create_package(client)

    resp = await client.get(
        "/api/documents/status/test-client-1",
        headers=clinician_headers(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data
    assert "signed" in data
    assert "pending" in data
