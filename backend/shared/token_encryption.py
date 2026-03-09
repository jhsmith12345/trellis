"""Fernet encryption for OAuth refresh tokens.

Satisfies HIPAA encryption-at-rest for stored OAuth credentials.
Uses OAUTH_TOKEN_ENCRYPTION_KEY env var (Fernet key).
"""
import os
import logging

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_ENCRYPTION_KEY = os.getenv("OAUTH_TOKEN_ENCRYPTION_KEY", "")


def _get_fernet() -> Fernet:
    if not _ENCRYPTION_KEY:
        raise RuntimeError(
            "OAUTH_TOKEN_ENCRYPTION_KEY env var not set. "
            "Generate one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    return Fernet(_ENCRYPTION_KEY.encode() if isinstance(_ENCRYPTION_KEY, str) else _ENCRYPTION_KEY)


def encrypt_token(plaintext: str) -> bytes:
    """Encrypt a refresh token string, returning ciphertext bytes."""
    return _get_fernet().encrypt(plaintext.encode("utf-8"))


def decrypt_token(ciphertext: bytes) -> str:
    """Decrypt ciphertext bytes back to the refresh token string."""
    try:
        return _get_fernet().decrypt(ciphertext).decode("utf-8")
    except InvalidToken:
        logger.error("Failed to decrypt OAuth token — key mismatch or corrupted data")
        raise
