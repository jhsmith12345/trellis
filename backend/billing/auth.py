"""API key authentication for the billing service.

EHR installations authenticate via X-API-Key header. The key is hashed
with SHA-256 and looked up in the billing_accounts table.

This is server-to-server authentication — no Firebase/JWT involved.
"""
import hashlib
import logging

from fastapi import HTTPException, Request

from db import get_account_by_api_key

logger = logging.getLogger(__name__)


def _hash_api_key(raw_key: str) -> str:
    """SHA-256 hash an API key for storage/lookup."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


async def require_api_key(request: Request) -> dict:
    """FastAPI dependency that validates the X-API-Key header.

    Returns the billing_accounts record dict for the authenticated account.
    Raises 401 if the key is missing/invalid, 403 if the account is inactive.
    """
    api_key = request.headers.get("X-API-Key", "")
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")

    key_hash = _hash_api_key(api_key)
    account = await get_account_by_api_key(key_hash)

    if not account:
        logger.warning("Invalid API key attempt (prefix=%s)", api_key[:8])
        raise HTTPException(status_code=401, detail="Invalid API key")

    if account["status"] != "active":
        logger.warning(
            "API key for inactive account id=%s status=%s",
            account["id"], account["status"],
        )
        raise HTTPException(
            status_code=403,
            detail=f"Account is {account['status']}",
        )

    return account


def require_permission(permission: str):
    """FastAPI dependency factory that checks a specific permission on the account.

    Usage in a route:
        @router.post("/claims/submit")
        async def submit(account = Depends(require_permission("billing"))):
            ...

    Raises 403 if the account doesn't have the required permission enabled.
    """
    async def _check(request: Request) -> dict:
        account = await require_api_key(request)
        permissions = account.get("permissions") or {}
        if not permissions.get(permission):
            logger.warning(
                "Permission denied: account %s lacks '%s' permission",
                account["id"], permission,
            )
            raise HTTPException(
                status_code=403,
                detail=f"Your plan does not include {permission}. Upgrade at trellis.health/signup",
            )
        return account

    return _check
