"""Firebase Auth middleware (placeholder)."""
from fastapi import Depends, HTTPException, Request


async def get_current_user(request: Request):
    """Verify Firebase ID token from Authorization header.

    TODO: Implement Firebase Admin SDK token verification.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")

    # TODO: verify with firebase_admin.auth.verify_id_token()
    raise HTTPException(status_code=501, detail="Auth not yet implemented")
