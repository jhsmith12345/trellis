"""Shared async database layer using asyncpg.

Both the API and relay services import this module.
Requires DATABASE_URL env var (postgresql://...).
"""
import os
import logging

import asyncpg

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://ehr:@127.0.0.1:5432/ehr",
)


async def _init_connection(conn):
    """Set up JSONB codec so asyncpg returns Python dicts for JSONB columns."""
    import json as _json
    await conn.set_type_codec(
        'jsonb',
        encoder=_json.dumps,
        decoder=_json.loads,
        schema='pg_catalog',
    )
    await conn.set_type_codec(
        'json',
        encoder=_json.dumps,
        decoder=_json.loads,
        schema='pg_catalog',
    )


async def get_pool() -> asyncpg.Pool:
    """Get or create the connection pool."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL, min_size=2, max_size=10, init=_init_connection
        )
        logger.info("Database pool created")
    return _pool


async def close_pool():
    """Close the connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("Database pool closed")


# ---------------------------------------------------------------------------
# Users (roles)
# ---------------------------------------------------------------------------

async def upsert_user(firebase_uid: str, email: str, role: str, display_name: str | None = None) -> str:
    """Create or update a user record. Returns the user UUID."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO users (firebase_uid, email, role, display_name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (firebase_uid) DO UPDATE
            SET email = EXCLUDED.email, display_name = COALESCE(EXCLUDED.display_name, users.display_name)
        RETURNING id
        """,
        firebase_uid,
        email,
        role,
        display_name,
    )
    return str(row["id"])


async def get_user_role(firebase_uid: str) -> str | None:
    """Get a user's role by Firebase UID. Returns None if not found."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT role FROM users WHERE firebase_uid = $1",
        firebase_uid,
    )
    return row["role"] if row else None


async def get_user(firebase_uid: str) -> dict | None:
    """Get full user record by Firebase UID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM users WHERE firebase_uid = $1",
        firebase_uid,
    )
    if not r:
        return None
    return {
        "id": str(r["id"]),
        "firebase_uid": r["firebase_uid"],
        "email": r["email"],
        "role": r["role"],
        "display_name": r["display_name"],
        "created_at": r["created_at"].isoformat(),
    }


async def check_user_has_data(firebase_uid: str, role: str) -> bool:
    """Check if a user has real data in their current role that prevents switching."""
    pool = await get_pool()
    if role == "clinician":
        row = await pool.fetchrow(
            """
            SELECT (
                (SELECT count(*) FROM clients WHERE primary_clinician_id = $1) +
                (SELECT count(*) FROM encounters WHERE clinician_id = $1)
            ) AS total
            """,
            firebase_uid,
        )
    else:
        row = await pool.fetchrow(
            """
            SELECT (
                (SELECT count(*) FROM encounters WHERE client_id = $1) +
                (SELECT count(*) FROM appointments WHERE client_id = $1)
            ) AS total
            """,
            firebase_uid,
        )
    return row["total"] > 0 if row else False


async def delete_clinician_and_practice(firebase_uid: str) -> None:
    """Delete clinician record and solo practice if no other clinicians remain."""
    pool = await get_pool()
    # Get clinician's practice info
    clinician = await pool.fetchrow(
        "SELECT id, practice_id FROM clinicians WHERE firebase_uid = $1",
        firebase_uid,
    )
    if not clinician:
        return

    practice_id = str(clinician["practice_id"])

    # Delete the clinician record
    await pool.execute(
        "DELETE FROM clinicians WHERE firebase_uid = $1", firebase_uid
    )

    # Clear practice_id on the user record BEFORE deleting the practice
    # (users.practice_id FK must be cleared first)
    await pool.execute(
        "UPDATE users SET practice_id = NULL WHERE firebase_uid = $1",
        firebase_uid,
    )

    # If no other clinicians remain, delete the practice
    remaining = await pool.fetchval(
        "SELECT count(*) FROM clinicians WHERE practice_id = $1::uuid",
        practice_id,
    )
    if remaining == 0:
        await pool.execute(
            "DELETE FROM practices WHERE id = $1::uuid", practice_id
        )


# ---------------------------------------------------------------------------
# Practices
# ---------------------------------------------------------------------------

async def create_practice(name: str, practice_type: str = "solo", **kwargs) -> str:
    """Create a practice and return its UUID."""
    pool = await get_pool()
    allowed = {
        "tax_id", "npi", "phone", "email", "website",
        "address_line1", "address_line2", "city", "state", "zip",
        "accepted_insurances", "timezone",
    }
    fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}

    columns = ["name", "type"] + list(fields.keys())
    values = [name, practice_type]
    placeholders = ["$1", "$2"]

    for i, (key, val) in enumerate(fields.items(), 3):
        cast = "::text[]" if key == "accepted_insurances" else ""
        placeholders.append(f"${i}{cast}")
        values.append(val)

    cols_str = ", ".join(columns)
    placeholders_str = ", ".join(placeholders)

    row = await pool.fetchrow(
        f"INSERT INTO practices ({cols_str}) VALUES ({placeholders_str}) RETURNING id",
        *values,
    )
    return str(row["id"])


async def get_practice(practice_id: str) -> dict | None:
    """Get a practice by ID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM practices WHERE id = $1::uuid", practice_id
    )
    if not r:
        return None
    return _practice_to_dict(r)


async def update_practice(practice_id: str, **kwargs) -> None:
    """Update fields on a practice."""
    pool = await get_pool()
    allowed = {
        "name", "type", "tax_id", "npi", "phone", "email", "website",
        "address_line1", "address_line2", "city", "state", "zip",
        "accepted_insurances", "timezone", "sms_enabled",
    }
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return

    sets = []
    vals = []
    idx = 1
    for key, val in fields.items():
        cast = "::text[]" if key == "accepted_insurances" else ""
        sets.append(f"{key} = ${idx}{cast}")
        vals.append(val)
        idx += 1

    vals.append(practice_id)
    query = f"UPDATE practices SET {', '.join(sets)} WHERE id = ${idx}::uuid"
    await pool.execute(query, *vals)


def _practice_to_dict(r) -> dict:
    return {
        "id": str(r["id"]),
        "name": r["name"],
        "type": r["type"],
        "tax_id": r["tax_id"],
        "npi": r["npi"],
        "phone": r["phone"],
        "email": r["email"],
        "website": r["website"],
        "address_line1": r["address_line1"],
        "address_line2": r["address_line2"],
        "city": r["city"],
        "state": r["state"],
        "zip": r["zip"],
        "accepted_insurances": r["accepted_insurances"] or [],
        "timezone": r["timezone"],
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }


# ---------------------------------------------------------------------------
# Practice Billing Settings
# ---------------------------------------------------------------------------

async def get_practice_billing_settings(practice_id: str) -> dict | None:
    """Get billing service settings for a practice."""
    pool = await get_pool()
    r = await pool.fetchrow(
        """
        SELECT billing_api_key, billing_service_url,
               billing_auto_submit, billing_last_poll_at
        FROM practices WHERE id = $1::uuid
        """,
        practice_id,
    )
    if not r:
        return None
    return {
        "billing_api_key": r["billing_api_key"],
        "billing_service_url": r["billing_service_url"],
        "billing_auto_submit": r["billing_auto_submit"] or False,
        "billing_last_poll_at": r["billing_last_poll_at"].isoformat() if r["billing_last_poll_at"] else None,
    }


async def update_practice_billing_settings(practice_id: str, **fields) -> dict | None:
    """Update billing service settings on a practice.

    Allowed fields: billing_api_key, billing_service_url,
    billing_auto_submit, billing_last_poll_at.
    """
    pool = await get_pool()
    allowed = {
        "billing_api_key", "billing_service_url",
        "billing_auto_submit", "billing_last_poll_at",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return await get_practice_billing_settings(practice_id)

    sets = []
    vals = []
    idx = 1
    for key, val in updates.items():
        sets.append(f"{key} = ${idx}")
        vals.append(val)
        idx += 1
    vals.append(practice_id)
    query = f"UPDATE practices SET {', '.join(sets)} WHERE id = ${idx}::uuid"
    await pool.execute(query, *vals)
    return await get_practice_billing_settings(practice_id)


async def get_practices_with_billing() -> list[dict]:
    """Get all practices that have billing service configured (for polling)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, billing_api_key, billing_service_url,
               billing_auto_submit, billing_last_poll_at
        FROM practices
        WHERE billing_api_key IS NOT NULL
          AND billing_service_url IS NOT NULL
        """
    )
    results = []
    for r in rows:
        results.append({
            "id": str(r["id"]),
            "billing_api_key": r["billing_api_key"],
            "billing_service_url": r["billing_service_url"],
            "billing_auto_submit": r["billing_auto_submit"] or False,
            "billing_last_poll_at": r["billing_last_poll_at"].isoformat() if r["billing_last_poll_at"] else None,
        })
    return results


# ---------------------------------------------------------------------------
# Clinicians
# ---------------------------------------------------------------------------

async def create_clinician(
    practice_id: str,
    firebase_uid: str,
    email: str,
    **kwargs,
) -> str:
    """Create a clinician and return its UUID."""
    pool = await get_pool()
    allowed = {
        "clinician_name", "credentials", "license_number", "license_state",
        "npi", "specialties", "bio", "session_rate", "intake_rate",
        "sliding_scale", "sliding_scale_min", "default_session_duration",
        "intake_duration", "practice_role", "status", "invited_at", "joined_at",
    }
    fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}

    columns = ["practice_id", "firebase_uid", "email"] + list(fields.keys())
    values = [practice_id, firebase_uid, email]
    placeholders = ["$1::uuid", "$2", "$3"]

    for i, (key, val) in enumerate(fields.items(), 4):
        cast = ""
        if key == "specialties":
            cast = "::text[]"
        elif key in ("session_rate", "intake_rate", "sliding_scale_min"):
            cast = "::numeric"
        elif key in ("invited_at", "joined_at"):
            cast = "::timestamptz"
        placeholders.append(f"${i}{cast}")
        values.append(val)

    cols_str = ", ".join(columns)
    placeholders_str = ", ".join(placeholders)

    row = await pool.fetchrow(
        f"INSERT INTO clinicians ({cols_str}) VALUES ({placeholders_str}) RETURNING id",
        *values,
    )
    return str(row["id"])


async def get_clinician(firebase_uid: str) -> dict | None:
    """Get a clinician by Firebase UID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM clinicians WHERE firebase_uid = $1",
        firebase_uid,
    )
    if not r:
        return None
    return _clinician_to_dict(r)


async def get_clinician_by_id(clinician_uuid: str) -> dict | None:
    """Get a clinician by its UUID primary key."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM clinicians WHERE id = $1::uuid",
        clinician_uuid,
    )
    if not r:
        return None
    return _clinician_to_dict(r)


async def get_clinician_by_email(email: str) -> dict | None:
    """Get a clinician by email (for invitation lookup during registration)."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM clinicians WHERE email = $1",
        email,
    )
    if not r:
        return None
    return _clinician_to_dict(r)


async def get_practice_clinicians(practice_id: str) -> list[dict]:
    """List all clinicians in a practice."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM clinicians
        WHERE practice_id = $1::uuid
        ORDER BY practice_role DESC, clinician_name
        """,
        practice_id,
    )
    return [_clinician_to_dict(r) for r in rows]


async def update_clinician(firebase_uid: str, **kwargs) -> None:
    """Update a clinician record."""
    pool = await get_pool()
    allowed = {
        "clinician_name", "credentials", "license_number", "license_state",
        "npi", "specialties", "bio", "session_rate", "intake_rate",
        "sliding_scale", "sliding_scale_min", "default_session_duration",
        "intake_duration", "practice_role", "status", "email",
    }
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return

    sets = []
    vals = []
    idx = 1
    for key, val in fields.items():
        cast = ""
        if key == "specialties":
            cast = "::text[]"
        elif key in ("session_rate", "intake_rate", "sliding_scale_min"):
            cast = "::numeric"
        sets.append(f"{key} = ${idx}{cast}")
        vals.append(val)
        idx += 1

    vals.append(firebase_uid)
    query = f"UPDATE clinicians SET {', '.join(sets)} WHERE firebase_uid = ${idx}"
    await pool.execute(query, *vals)


async def invite_clinician(practice_id: str, email: str, invited_by: str) -> str:
    """Create an invited clinician record. Returns the clinician UUID."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO clinicians (practice_id, firebase_uid, email, status, invited_at, practice_role)
        VALUES ($1::uuid, $2, $3, 'invited', now(), 'clinician')
        RETURNING id
        """,
        practice_id,
        f"pending_{email}",  # Placeholder until they register
        email,
    )
    return str(row["id"])


async def activate_clinician(firebase_uid: str) -> None:
    """Activate an invited clinician (set status=active, joined_at=now())."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE clinicians
        SET status = 'active', joined_at = now(), firebase_uid = $1
        WHERE firebase_uid = $1
        """,
        firebase_uid,
    )


async def deactivate_clinician(firebase_uid: str) -> None:
    """Deactivate a clinician."""
    pool = await get_pool()
    await pool.execute(
        "UPDATE clinicians SET status = 'deactivated' WHERE firebase_uid = $1",
        firebase_uid,
    )


def _clinician_to_dict(r) -> dict:
    return {
        "id": str(r["id"]),
        "practice_id": str(r["practice_id"]),
        "firebase_uid": r["firebase_uid"],
        "email": r["email"],
        "clinician_name": r["clinician_name"],
        "credentials": r["credentials"],
        "license_number": r["license_number"],
        "license_state": r["license_state"],
        "npi": r["npi"],
        "specialties": r["specialties"] or [],
        "bio": r["bio"],
        "session_rate": float(r["session_rate"]) if r["session_rate"] else None,
        "intake_rate": float(r["intake_rate"]) if r["intake_rate"] else None,
        "sliding_scale": r["sliding_scale"],
        "sliding_scale_min": float(r["sliding_scale_min"]) if r["sliding_scale_min"] else None,
        "default_session_duration": r["default_session_duration"],
        "intake_duration": r["intake_duration"],
        "practice_role": r["practice_role"],
        "status": r["status"],
        "invited_at": r["invited_at"].isoformat() if r["invited_at"] else None,
        "joined_at": r["joined_at"].isoformat() if r["joined_at"] else None,
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
        "google_email": r["google_email"] if "google_email" in r.keys() else None,
        "google_connected": bool(r["google_refresh_token_enc"]) if "google_refresh_token_enc" in r.keys() else False,
        "google_connected_at": r["google_connected_at"].isoformat() if "google_connected_at" in r.keys() and r["google_connected_at"] else None,
    }


# ---------------------------------------------------------------------------
# Clinician OAuth Token Storage
# ---------------------------------------------------------------------------

async def store_clinician_oauth(
    firebase_uid: str,
    encrypted_token: bytes,
    google_email: str,
    scopes: list[str],
) -> None:
    """Store encrypted OAuth refresh token for a clinician."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE clinicians
        SET google_refresh_token_enc = $1,
            google_email = $2,
            google_scopes = $3::text[],
            google_connected_at = now(),
            google_disconnected_at = NULL
        WHERE firebase_uid = $4
        """,
        encrypted_token,
        google_email,
        scopes,
        firebase_uid,
    )


async def clear_clinician_oauth(firebase_uid: str) -> None:
    """Clear stored OAuth token and mark as disconnected."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE clinicians
        SET google_refresh_token_enc = NULL,
            google_scopes = NULL,
            google_disconnected_at = now()
        WHERE firebase_uid = $1
        """,
        firebase_uid,
    )


async def get_clinician_oauth(firebase_uid: str) -> dict | None:
    """Get OAuth token data for a clinician by Firebase UID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        """
        SELECT google_refresh_token_enc, google_email, google_scopes,
               google_connected_at, email
        FROM clinicians WHERE firebase_uid = $1
        """,
        firebase_uid,
    )
    if not r:
        return None
    return {
        "google_refresh_token_enc": r["google_refresh_token_enc"],
        "google_email": r["google_email"],
        "google_scopes": r["google_scopes"],
        "google_connected_at": r["google_connected_at"],
        "email": r["email"],
    }


async def get_clinician_oauth_by_email(email: str) -> dict | None:
    """Get OAuth token data for a clinician by their email address."""
    pool = await get_pool()
    r = await pool.fetchrow(
        """
        SELECT google_refresh_token_enc, google_email, google_scopes,
               google_connected_at, email, firebase_uid
        FROM clinicians WHERE email = $1
        """,
        email,
    )
    if not r:
        return None
    return {
        "google_refresh_token_enc": r["google_refresh_token_enc"],
        "google_email": r["google_email"],
        "google_scopes": r["google_scopes"],
        "google_connected_at": r["google_connected_at"],
        "email": r["email"],
        "firebase_uid": r["firebase_uid"],
    }


# ---------------------------------------------------------------------------
# Practice Profile (backward compatibility — reads from new tables)
# ---------------------------------------------------------------------------

_PRACTICE_PROFILE_FIELDS = {
    "practice_name", "clinician_name", "credentials", "license_number",
    "license_state", "npi", "tax_id", "specialties", "bio", "phone", "email",
    "website", "address_line1", "address_line2", "address_city", "address_state",
    "address_zip", "accepted_insurances", "session_rate", "intake_rate",
    "sliding_scale", "sliding_scale_min", "default_session_duration",
    "intake_duration", "timezone",
}


async def upsert_practice_profile(clinician_uid: str, **kwargs) -> str:
    """Create or update the practice profile.

    Writes to BOTH the legacy practice_profile table AND the new
    practices + clinicians tables for forward compatibility.
    Returns the practice_profile UUID.
    """
    pool = await get_pool()
    fields = {k: v for k, v in kwargs.items() if k in _PRACTICE_PROFILE_FIELDS and v is not None}

    if not fields:
        # Just ensure the row exists
        row = await pool.fetchrow(
            """
            INSERT INTO practice_profile (clinician_uid, clinician_name)
            VALUES ($1, $2)
            ON CONFLICT (clinician_uid) DO UPDATE SET updated_at = now()
            RETURNING id
            """,
            clinician_uid,
            kwargs.get("clinician_name", ""),
        )
        return str(row["id"])

    # Build dynamic upsert for legacy table
    columns = ["clinician_uid"] + list(fields.keys())
    values = [clinician_uid]
    placeholders = ["$1"]
    set_parts = []

    for i, (key, val) in enumerate(fields.items(), 2):
        cast = ""
        if key in ("specialties", "accepted_insurances"):
            cast = "::text[]"
        elif key in ("session_rate", "intake_rate", "sliding_scale_min"):
            cast = "::numeric"
        placeholders.append(f"${i}{cast}")
        set_parts.append(f"{key} = EXCLUDED.{key}")
        values.append(val)

    cols_str = ", ".join(columns)
    placeholders_str = ", ".join(placeholders)
    set_str = ", ".join(set_parts)

    query = f"""
        INSERT INTO practice_profile ({cols_str})
        VALUES ({placeholders_str})
        ON CONFLICT (clinician_uid) DO UPDATE SET {set_str}
        RETURNING id
    """
    row = await pool.fetchrow(query, *values)

    # Also write to new tables
    _PRACTICE_LEVEL = {
        "practice_name": "name", "tax_id": "tax_id", "phone": "phone",
        "email": "email", "website": "website",
        "address_line1": "address_line1", "address_line2": "address_line2",
        "address_city": "city", "address_state": "state", "address_zip": "zip",
        "accepted_insurances": "accepted_insurances", "timezone": "timezone",
    }
    _CLINICIAN_LEVEL = {
        "clinician_name", "credentials", "license_number", "license_state",
        "npi", "specialties", "bio", "session_rate", "intake_rate",
        "sliding_scale", "sliding_scale_min", "default_session_duration",
        "intake_duration",
    }

    # Update practice if clinician has one
    clinician = await get_clinician(clinician_uid)
    if clinician:
        practice_updates = {}
        for old_key, new_key in _PRACTICE_LEVEL.items():
            if old_key in fields:
                practice_updates[new_key] = fields[old_key]
        if practice_updates:
            await update_practice(clinician["practice_id"], **practice_updates)

        clinician_updates = {k: v for k, v in fields.items() if k in _CLINICIAN_LEVEL}
        if clinician_updates:
            await update_clinician(clinician_uid, **clinician_updates)

    return str(row["id"])


async def get_practice_profile(clinician_uid: str | None = None) -> dict | None:
    """Get the practice profile by reading from new practices + clinicians tables.

    Returns the same dict shape as the old practice_profile table for backward
    compatibility. Falls back to legacy table if new tables are empty.
    """
    pool = await get_pool()

    # Try new tables first
    if clinician_uid:
        r = await pool.fetchrow(
            """
            SELECT c.*, p.name AS practice_name, p.tax_id, p.npi AS practice_npi,
                   p.phone AS practice_phone, p.email AS practice_email,
                   p.website AS practice_website,
                   p.address_line1 AS practice_address_line1,
                   p.address_line2 AS practice_address_line2,
                   p.city AS practice_city, p.state AS practice_state,
                   p.zip AS practice_zip, p.accepted_insurances,
                   p.timezone, p.type AS practice_type,
                   p.sms_enabled
            FROM clinicians c
            JOIN practices p ON p.id = c.practice_id
            WHERE c.firebase_uid = $1
            """,
            clinician_uid,
        )
    else:
        r = await pool.fetchrow(
            """
            SELECT c.*, p.name AS practice_name, p.tax_id, p.npi AS practice_npi,
                   p.phone AS practice_phone, p.email AS practice_email,
                   p.website AS practice_website,
                   p.address_line1 AS practice_address_line1,
                   p.address_line2 AS practice_address_line2,
                   p.city AS practice_city, p.state AS practice_state,
                   p.zip AS practice_zip, p.accepted_insurances,
                   p.timezone, p.type AS practice_type,
                   p.sms_enabled
            FROM clinicians c
            JOIN practices p ON p.id = c.practice_id
            WHERE c.practice_role = 'owner' AND c.status = 'active'
            LIMIT 1
            """
        )

    if r:
        return {
            "id": str(r["id"]),
            "clinician_uid": r["firebase_uid"],
            "clinician_email": r["email"],
            "practice_name": r["practice_name"],
            "clinician_name": r["clinician_name"],
            "credentials": r["credentials"],
            "license_number": r["license_number"],
            "license_state": r["license_state"],
            "npi": r["npi"],
            "tax_id": r["tax_id"],
            "specialties": r["specialties"] or [],
            "bio": r["bio"],
            "phone": r["practice_phone"],
            "email": r["practice_email"],
            "website": r["practice_website"],
            "address_line1": r["practice_address_line1"],
            "address_line2": r["practice_address_line2"],
            "address_city": r["practice_city"],
            "address_state": r["practice_state"],
            "address_zip": r["practice_zip"],
            "accepted_insurances": r["accepted_insurances"] or [],
            "session_rate": float(r["session_rate"]) if r["session_rate"] else None,
            "intake_rate": float(r["intake_rate"]) if r["intake_rate"] else None,
            "sliding_scale": r["sliding_scale"],
            "sliding_scale_min": float(r["sliding_scale_min"]) if r["sliding_scale_min"] else None,
            "default_session_duration": r["default_session_duration"],
            "intake_duration": r["intake_duration"],
            "timezone": r["timezone"],
            "practice_type": r["practice_type"],
            "practice_id": str(r["practice_id"]),
            "practice_role": r["practice_role"],
            "sms_enabled": r.get("sms_enabled") or False,
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }

    # Fallback to legacy table
    if clinician_uid:
        r = await pool.fetchrow(
            "SELECT * FROM practice_profile WHERE clinician_uid = $1",
            clinician_uid,
        )
    else:
        r = await pool.fetchrow("SELECT * FROM practice_profile LIMIT 1")

    if not r:
        return None

    return {
        "id": str(r["id"]),
        "clinician_uid": r["clinician_uid"],
        "practice_name": r["practice_name"],
        "clinician_name": r["clinician_name"],
        "credentials": r["credentials"],
        "license_number": r["license_number"],
        "license_state": r["license_state"],
        "npi": r["npi"],
        "tax_id": r["tax_id"],
        "specialties": r["specialties"] or [],
        "bio": r["bio"],
        "phone": r["phone"],
        "email": r["email"],
        "website": r["website"],
        "address_line1": r["address_line1"],
        "address_line2": r["address_line2"],
        "address_city": r["address_city"],
        "address_state": r["address_state"],
        "address_zip": r["address_zip"],
        "accepted_insurances": r["accepted_insurances"] or [],
        "session_rate": float(r["session_rate"]) if r["session_rate"] else None,
        "intake_rate": float(r["intake_rate"]) if r["intake_rate"] else None,
        "sliding_scale": r["sliding_scale"],
        "sliding_scale_min": float(r["sliding_scale_min"]) if r["sliding_scale_min"] else None,
        "default_session_duration": r["default_session_duration"],
        "intake_duration": r["intake_duration"],
        "timezone": r["timezone"],
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }


# ---------------------------------------------------------------------------
# Encounters
# ---------------------------------------------------------------------------

async def create_encounter(
    client_id: str,
    encounter_type: str,
    source: str,
    clinician_id: str | None = None,
    transcript: str = "",
    data: dict | None = None,
    duration_sec: int | None = None,
    status: str = "draft",
) -> str:
    """Insert an encounter and return its UUID."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO encounters (client_id, clinician_id, type, source, transcript, data, duration_sec, status)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
        RETURNING id
        """,
        client_id,
        clinician_id,
        encounter_type,
        source,
        transcript,
        __to_json(data),
        duration_sec,
        status,
    )
    return str(row["id"])


async def update_encounter(
    encounter_id: str,
    transcript: str | None = None,
    data: dict | None = None,
    duration_sec: int | None = None,
    status: str | None = None,
) -> None:
    """Update fields on an existing encounter."""
    pool = await get_pool()
    sets = []
    vals = []
    idx = 1

    if transcript is not None:
        sets.append(f"transcript = ${idx}")
        vals.append(transcript)
        idx += 1
    if data is not None:
        sets.append(f"data = ${idx}::jsonb")
        vals.append(__to_json(data))
        idx += 1
    if duration_sec is not None:
        sets.append(f"duration_sec = ${idx}")
        vals.append(duration_sec)
        idx += 1
    if status is not None:
        sets.append(f"status = ${idx}")
        vals.append(status)
        idx += 1

    if not sets:
        return

    vals.append(encounter_id)
    query = f"UPDATE encounters SET {', '.join(sets)} WHERE id = ${idx}::uuid"
    await pool.execute(query, *vals)


async def get_client_transcripts(client_id: str, limit: int = 20) -> list[dict]:
    """Fetch recent encounter transcripts for a client, oldest first."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, type, source, transcript, data, created_at
        FROM encounters
        WHERE client_id = $1 AND transcript != ''
        ORDER BY created_at DESC
        LIMIT $2
        """,
        client_id,
        limit,
    )
    # Return oldest-first for chronological context injection
    results = [
        {
            "id": str(r["id"]),
            "type": r["type"],
            "source": r["source"],
            "transcript": r["transcript"],
            "data": r["data"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]
    results.reverse()
    return results


# ---------------------------------------------------------------------------
# Document Packages
# ---------------------------------------------------------------------------

async def create_document_package(
    client_id: str,
    created_by: str,
    client_email: str,
    client_name: str,
    financial_data: dict | None = None,
) -> str:
    """Create a document package and return its UUID."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO document_packages (client_id, created_by, client_email, client_name, financial_data)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING id
        """,
        client_id,
        created_by,
        client_email,
        client_name,
        __to_json(financial_data),
    )
    return str(row["id"])


async def get_document_package(package_id: str) -> dict | None:
    """Fetch a package and all its documents."""
    pool = await get_pool()
    pkg = await pool.fetchrow(
        "SELECT * FROM document_packages WHERE id = $1::uuid",
        package_id,
    )
    if not pkg:
        return None

    docs = await pool.fetch(
        "SELECT * FROM documents WHERE package_id = $1::uuid ORDER BY sort_order, created_at",
        package_id,
    )

    return {
        "id": str(pkg["id"]),
        "client_id": pkg["client_id"],
        "created_by": pkg["created_by"],
        "client_email": pkg["client_email"],
        "client_name": pkg["client_name"],
        "financial_data": pkg["financial_data"],
        "status": pkg["status"],
        "sent_at": pkg["sent_at"].isoformat() if pkg["sent_at"] else None,
        "completed_at": pkg["completed_at"].isoformat() if pkg["completed_at"] else None,
        "created_at": pkg["created_at"].isoformat(),
        "updated_at": pkg["updated_at"].isoformat(),
        "documents": [
            {
                "id": str(d["id"]),
                "package_id": str(d["package_id"]),
                "template_key": d["template_key"],
                "title": d["title"],
                "content": d["content"],
                "status": d["status"],
                "signature_data": d["signature_data"],
                "content_hash": d["content_hash"],
                "signed_at": d["signed_at"].isoformat() if d["signed_at"] else None,
                "sort_order": d["sort_order"],
            }
            for d in docs
        ],
    }


async def update_package_status(package_id: str, status: str) -> None:
    """Update package status, setting sent_at/completed_at as appropriate."""
    pool = await get_pool()
    extra = ""
    if status == "sent":
        extra = ", sent_at = now()"
    elif status == "completed":
        extra = ", completed_at = now()"
    await pool.execute(
        f"UPDATE document_packages SET status = $1{extra} WHERE id = $2::uuid",
        status,
        package_id,
    )


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

async def create_document(
    package_id: str,
    template_key: str,
    title: str,
    content: dict,
    sort_order: int = 0,
) -> str:
    """Insert a document into a package and return its UUID."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO documents (package_id, template_key, title, content, sort_order)
        VALUES ($1::uuid, $2, $3, $4::jsonb, $5)
        RETURNING id
        """,
        package_id,
        template_key,
        title,
        __to_json(content),
        sort_order,
    )
    return str(row["id"])


async def sign_document(
    doc_id: str,
    signature_data: str,
    content_hash: str,
    signer_ip: str,
    signer_user_agent: str,
) -> None:
    """Mark a document as signed with metadata."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE documents
        SET status = 'signed',
            signature_data = $1,
            content_hash = $2,
            signer_ip = $3,
            signer_user_agent = $4,
            signed_at = now()
        WHERE id = $5::uuid
        """,
        signature_data,
        content_hash,
        signer_ip,
        signer_user_agent,
        doc_id,
    )


async def get_document(doc_id: str) -> dict | None:
    """Fetch a single document by ID."""
    pool = await get_pool()
    d = await pool.fetchrow("SELECT * FROM documents WHERE id = $1::uuid", doc_id)
    if not d:
        return None
    return {
        "id": str(d["id"]),
        "package_id": str(d["package_id"]),
        "template_key": d["template_key"],
        "title": d["title"],
        "content": d["content"],
        "status": d["status"],
        "signature_data": d["signature_data"],
        "content_hash": d["content_hash"],
        "signed_at": d["signed_at"].isoformat() if d["signed_at"] else None,
        "sort_order": d["sort_order"],
    }


async def check_package_complete(package_id: str) -> bool:
    """Return True if all documents in the package are signed."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending
        FROM documents
        WHERE package_id = $1::uuid
        """,
        package_id,
    )
    return row["pending"] == 0


# ---------------------------------------------------------------------------
# Stored Signatures
# ---------------------------------------------------------------------------

async def upsert_stored_signature(user_id: str, signature_png: str) -> None:
    """Store or update a user's signature."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO stored_signatures (user_id, signature_png)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET signature_png = $2, updated_at = now()
        """,
        user_id,
        signature_png,
    )


async def get_stored_signature(user_id: str) -> str | None:
    """Get a user's stored signature PNG (base64), or None."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT signature_png FROM stored_signatures WHERE user_id = $1",
        user_id,
    )
    return row["signature_png"] if row else None


# ---------------------------------------------------------------------------
# Audit Events
# ---------------------------------------------------------------------------

async def log_audit_event(
    user_id: str | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    metadata: dict | None = None,
) -> None:
    """Insert an audit event (append-only)."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO audit_events (user_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        """,
        user_id,
        action,
        resource_type,
        resource_id,
        ip_address,
        user_agent,
        __to_json(metadata),
    )


# ---------------------------------------------------------------------------
# Clinician Availability
# ---------------------------------------------------------------------------

async def replace_clinician_availability(
    clinician_id: str,
    clinician_email: str,
    windows: list[dict],
) -> None:
    """Bulk replace a clinician's availability windows."""
    from datetime import time as _time

    pool = await get_pool()
    rows = []
    for w in windows:
        st = w["start_time"]
        et = w["end_time"]
        if isinstance(st, str):
            parts = st.split(":")
            st = _time(int(parts[0]), int(parts[1]))
        if isinstance(et, str):
            parts = et.split(":")
            et = _time(int(parts[0]), int(parts[1]))
        rows.append((clinician_id, clinician_email, w["day_of_week"], st, et))

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM clinician_availability WHERE clinician_id = $1",
                clinician_id,
            )
            if rows:
                await conn.executemany(
                    """
                    INSERT INTO clinician_availability
                        (clinician_id, clinician_email, day_of_week, start_time, end_time)
                    VALUES ($1, $2, $3, $4::time, $5::time)
                    """,
                    rows,
                )


async def get_clinician_availability(clinician_id: str) -> list[dict]:
    """Get a clinician's availability windows."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, day_of_week, start_time, end_time, is_active
        FROM clinician_availability
        WHERE clinician_id = $1 AND is_active = true
        ORDER BY day_of_week, start_time
        """,
        clinician_id,
    )
    return [
        {
            "id": str(r["id"]),
            "day_of_week": r["day_of_week"],
            "start_time": r["start_time"].strftime("%H:%M"),
            "end_time": r["end_time"].strftime("%H:%M"),
            "is_active": r["is_active"],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------

async def create_appointment(
    client_id: str,
    client_email: str,
    client_name: str,
    clinician_id: str,
    clinician_email: str,
    appt_type: str,
    scheduled_at: str,
    duration_minutes: int,
    created_by: str,
    meet_link: str | None = None,
    calendar_event_id: str | None = None,
    recurrence_id: str | None = None,
    cadence: str = "weekly",
    modality: str = "telehealth",
) -> str:
    """Create an appointment and return its UUID."""
    from datetime import datetime as _dt
    pool = await get_pool()
    _scheduled = _dt.fromisoformat(scheduled_at) if isinstance(scheduled_at, str) else scheduled_at
    row = await pool.fetchrow(
        """
        INSERT INTO appointments
            (client_id, client_email, client_name, clinician_id, clinician_email,
             type, scheduled_at, duration_minutes, created_by,
             meet_link, calendar_event_id, recurrence_id, cadence, modality)
        VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11, $12::uuid, $13, $14)
        RETURNING id
        """,
        client_id,
        client_email,
        client_name,
        clinician_id,
        clinician_email,
        appt_type,
        _scheduled,
        duration_minutes,
        created_by,
        meet_link,
        calendar_event_id,
        recurrence_id,
        cadence,
        modality,
    )
    return str(row["id"])


def _appointment_to_dict(r) -> dict:
    """Convert an appointment record to dict."""
    d = {
        "id": str(r["id"]),
        "client_id": r["client_id"],
        "client_email": r["client_email"],
        "client_name": r["client_name"],
        "clinician_id": r["clinician_id"],
        "clinician_email": r["clinician_email"],
        "type": r["type"],
        "scheduled_at": r["scheduled_at"].isoformat(),
        "duration_minutes": r["duration_minutes"],
        "status": r["status"],
        "meet_link": r["meet_link"],
        "calendar_event_id": r["calendar_event_id"],
        "recurrence_id": str(r["recurrence_id"]) if r["recurrence_id"] else None,
        "encounter_id": str(r["encounter_id"]) if r["encounter_id"] else None,
        "created_by": r["created_by"],
        "cancelled_at": r["cancelled_at"].isoformat() if r["cancelled_at"] else None,
        "cancelled_reason": r["cancelled_reason"],
        "created_at": r["created_at"].isoformat(),
    }
    # Reconfirmation fields (added in migration 006)
    for field in ("reconfirmation_token", "reconfirmation_sent_at",
                  "reconfirmation_response", "reconfirmation_responded_at",
                  "released_at", "cadence", "reminder_sent_at"):
        try:
            val = r[field]
            if field == "reconfirmation_token":
                d[field] = str(val) if val else None
            elif hasattr(val, "isoformat"):
                d[field] = val.isoformat() if val else None
            else:
                d[field] = val
        except (KeyError, IndexError):
            pass
    # Recording fields (added in migration 007)
    for field in ("recording_file_id", "recording_status",
                  "recording_error", "recording_processed_at"):
        try:
            val = r[field]
            if hasattr(val, "isoformat"):
                d[field] = val.isoformat() if val else None
            else:
                d[field] = val
        except (KeyError, IndexError):
            pass
    return d


async def get_appointments(
    start_date: str,
    end_date: str,
    client_id: str | None = None,
    clinician_id: str | None = None,
) -> list[dict]:
    """Fetch appointments in a date range, optionally filtered."""
    from datetime import datetime as _dt
    pool = await get_pool()
    query = """
        SELECT * FROM appointments
        WHERE scheduled_at >= $1::timestamptz
          AND scheduled_at < $2::timestamptz
          AND status != 'cancelled'
    """
    # asyncpg requires datetime objects for timestamptz params
    _start = _dt.fromisoformat(start_date) if isinstance(start_date, str) else start_date
    _end = _dt.fromisoformat(end_date) if isinstance(end_date, str) else end_date
    params: list = [_start, _end]
    idx = 3
    if client_id:
        query += f" AND client_id = ${idx}"
        params.append(client_id)
        idx += 1
    if clinician_id:
        query += f" AND clinician_id = ${idx}"
        params.append(clinician_id)
        idx += 1
    query += " ORDER BY scheduled_at"
    rows = await pool.fetch(query, *params)
    return [_appointment_to_dict(r) for r in rows]


async def get_appointment(appointment_id: str) -> dict | None:
    """Fetch a single appointment by ID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM appointments WHERE id = $1::uuid", appointment_id
    )
    if not r:
        return None
    return _appointment_to_dict(r)


async def update_appointment_status(
    appointment_id: str,
    status: str,
    cancelled_reason: str | None = None,
) -> None:
    """Update appointment status; sets cancelled_at if cancelling."""
    pool = await get_pool()
    if status == "cancelled":
        await pool.execute(
            """
            UPDATE appointments
            SET status = $1, cancelled_at = now(), cancelled_reason = $2
            WHERE id = $3::uuid
            """,
            status,
            cancelled_reason,
            appointment_id,
        )
    else:
        await pool.execute(
            "UPDATE appointments SET status = $1 WHERE id = $2::uuid",
            status,
            appointment_id,
        )


async def cancel_recurring_series(recurrence_id: str) -> int:
    """Cancel all future scheduled appointments in a recurring series."""
    pool = await get_pool()
    result = await pool.execute(
        """
        UPDATE appointments
        SET status = 'cancelled', cancelled_at = now(), cancelled_reason = 'Series ended'
        WHERE recurrence_id = $1::uuid
          AND status = 'scheduled'
          AND scheduled_at > now()
        """,
        recurrence_id,
    )
    # asyncpg returns "UPDATE N"
    return int(result.split()[-1])


async def get_booked_slots(
    clinician_id: str, start_date: str, end_date: str
) -> list[dict]:
    """Get booked appointment slots for a clinician in a date range.

    Only 'scheduled' appointments count as booked.  Released, cancelled,
    completed, and no-show appointments are excluded so their slots become
    available again.
    """
    from datetime import datetime as _dt
    pool = await get_pool()
    _start = _dt.fromisoformat(start_date) if isinstance(start_date, str) else start_date
    _end = _dt.fromisoformat(end_date) if isinstance(end_date, str) else end_date
    rows = await pool.fetch(
        """
        SELECT scheduled_at, duration_minutes
        FROM appointments
        WHERE clinician_id = $1
          AND scheduled_at >= $2::timestamptz
          AND scheduled_at < $3::timestamptz
          AND status = 'scheduled'
        ORDER BY scheduled_at
        """,
        clinician_id,
        _start,
        _end,
    )
    return [
        {
            "start": r["scheduled_at"].isoformat(),
            "duration_minutes": r["duration_minutes"],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

_CLIENT_FIELDS = {
    "email", "full_name", "preferred_name", "pronouns", "date_of_birth",
    "phone", "address_line1", "address_line2", "address_city", "address_state",
    "address_zip", "emergency_contact_name", "emergency_contact_phone",
    "emergency_contact_relationship", "payer_name", "member_id", "group_number",
    "insurance_data", "intake_completed_at", "documents_completed_at",
    "status", "discharged_at", "primary_clinician_id",
    "sex", "payer_id", "default_modality",
    "secondary_payer_name", "secondary_payer_id", "secondary_member_id",
    "secondary_group_number", "filing_deadline_days", "sms_opt_in",
}


async def upsert_client(firebase_uid: str, email: str, **kwargs) -> str:
    """Insert or update a client profile. Returns the client UUID."""
    pool = await get_pool()

    # Filter to allowed fields
    fields = {k: v for k, v in kwargs.items() if k in _CLIENT_FIELDS and v is not None}

    # Build SET clause for ON CONFLICT UPDATE
    set_parts = ["email = EXCLUDED.email"]
    for key in fields:
        if key == "insurance_data":
            set_parts.append(f"{key} = EXCLUDED.{key}")
        elif key in ("intake_completed_at", "documents_completed_at"):
            set_parts.append(f"{key} = COALESCE(clients.{key}, EXCLUDED.{key})")
        else:
            set_parts.append(f"{key} = EXCLUDED.{key}")

    # Build INSERT columns/values
    columns = ["firebase_uid", "email"] + list(fields.keys())
    placeholders = []
    values = [firebase_uid, email]
    for i, col in enumerate(columns, 1):
        if col == "insurance_data":
            placeholders.append(f"${i}::jsonb")
        elif col == "date_of_birth":
            placeholders.append(f"${i}::date")
        elif col in ("intake_completed_at", "documents_completed_at", "discharged_at"):
            placeholders.append(f"${i}::timestamptz")
        else:
            placeholders.append(f"${i}")

    for key in fields:
        val = fields[key]
        if key == "insurance_data":
            values.append(__to_json(val) if isinstance(val, dict) else val)
        elif key == "date_of_birth" and isinstance(val, str):
            from datetime import date as _date
            values.append(_date.fromisoformat(val))
        elif key in ("intake_completed_at", "documents_completed_at", "discharged_at") and isinstance(val, str):
            from datetime import datetime as _datetime
            values.append(_datetime.fromisoformat(val))
        else:
            values.append(val)

    cols_str = ", ".join(columns)
    placeholders_str = ", ".join(placeholders)
    set_str = ", ".join(set_parts)

    query = f"""
        INSERT INTO clients ({cols_str})
        VALUES ({placeholders_str})
        ON CONFLICT (firebase_uid) DO UPDATE SET {set_str}
        RETURNING id
    """

    row = await pool.fetchrow(query, *values)
    return str(row["id"])


async def get_client(firebase_uid: str) -> dict | None:
    """Fetch a client profile by Firebase UID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM clients WHERE firebase_uid = $1", firebase_uid
    )
    if not r:
        return None
    return _client_full_to_dict(r)


async def get_all_clients(clinician_uid: str | None = None, is_owner: bool = True) -> list[dict]:
    """Fetch all clients with summary info for the client list view.

    Includes document signing status (total/signed/pending) per client.
    If is_owner is False and clinician_uid is set, only returns clients
    assigned to that clinician.
    """
    pool = await get_pool()
    where_clause = ""
    params: list = []
    if clinician_uid and not is_owner:
        where_clause = "WHERE c.primary_clinician_id = $1"
        params = [clinician_uid]

    rows = await pool.fetch(
        f"""
        SELECT c.*,
               (SELECT scheduled_at FROM appointments
                WHERE client_id = c.firebase_uid AND status = 'scheduled' AND scheduled_at > now()
                ORDER BY scheduled_at LIMIT 1) AS next_appointment,
               (SELECT scheduled_at FROM appointments
                WHERE client_id = c.firebase_uid AND status = 'completed'
                ORDER BY scheduled_at DESC LIMIT 1) AS last_session,
               COALESCE((SELECT COUNT(*)
                FROM documents d JOIN document_packages dp ON dp.id = d.package_id
                WHERE dp.client_id = c.firebase_uid), 0) AS docs_total,
               COALESCE((SELECT COUNT(*)
                FROM documents d JOIN document_packages dp ON dp.id = d.package_id
                WHERE dp.client_id = c.firebase_uid AND d.status = 'signed'), 0) AS docs_signed
        FROM clients c
        {where_clause}
        ORDER BY c.full_name NULLS LAST, c.created_at
        """,
        *params,
    )
    result = []
    for r in rows:
        d = {
            "id": str(r["id"]),
            "firebase_uid": r["firebase_uid"],
            "email": r["email"],
            "full_name": r["full_name"],
            "preferred_name": r["preferred_name"],
            "phone": r["phone"],
            "status": r["status"],
            "payer_name": r["payer_name"],
            "next_appointment": r["next_appointment"].isoformat() if r["next_appointment"] else None,
            "last_session": r["last_session"].isoformat() if r["last_session"] else None,
            "intake_completed_at": r["intake_completed_at"].isoformat() if r["intake_completed_at"] else None,
            "created_at": r["created_at"].isoformat(),
            "docs_total": r["docs_total"],
            "docs_signed": r["docs_signed"],
        }
        try:
            d["primary_clinician_id"] = r["primary_clinician_id"]
        except (KeyError, IndexError):
            pass
        result.append(d)
    return result


async def update_client(firebase_uid: str, **kwargs) -> None:
    """Update specific fields on a client profile."""
    pool = await get_pool()
    fields = {k: v for k, v in kwargs.items() if k in _CLIENT_FIELDS}
    if not fields:
        return

    sets = []
    vals = []
    idx = 1
    for key, val in fields.items():
        if key == "insurance_data":
            sets.append(f"{key} = ${idx}::jsonb")
            vals.append(__to_json(val) if isinstance(val, dict) else val)
        elif key == "date_of_birth":
            sets.append(f"{key} = ${idx}::date")
            vals.append(val)
        elif key in ("intake_completed_at", "documents_completed_at", "discharged_at"):
            sets.append(f"{key} = ${idx}::timestamptz")
            vals.append(val)
        else:
            sets.append(f"{key} = ${idx}")
            vals.append(val)
        idx += 1

    vals.append(firebase_uid)
    query = f"UPDATE clients SET {', '.join(sets)} WHERE firebase_uid = ${idx}"
    await pool.execute(query, *vals)


async def update_client_insurance(
    firebase_uid: str,
    insurance_data: dict,
    payer_name: str | None = None,
    member_id: str | None = None,
    group_number: str | None = None,
) -> None:
    """Convenience function to update insurance fields on a client."""
    kwargs: dict = {"insurance_data": insurance_data}
    if payer_name is not None:
        kwargs["payer_name"] = payer_name
    if member_id is not None:
        kwargs["member_id"] = member_id
    if group_number is not None:
        kwargs["group_number"] = group_number
    await update_client(firebase_uid, **kwargs)


# ---------------------------------------------------------------------------
# Treatment Plans
# ---------------------------------------------------------------------------

async def create_treatment_plan(
    client_id: str,
    diagnoses: list | None = None,
    goals: list | None = None,
    presenting_problems: str | None = None,
    review_date: str | None = None,
    source_encounter_id: str | None = None,
    previous_version_id: str | None = None,
    clinician_id: str | None = None,
) -> str:
    """Create a treatment plan and return its UUID. Auto-increments version."""
    pool = await get_pool()

    # Get next version number
    row = await pool.fetchrow(
        "SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM treatment_plans WHERE client_id = $1",
        client_id,
    )
    next_version = row["next_ver"]

    row = await pool.fetchrow(
        """
        INSERT INTO treatment_plans
            (client_id, version, diagnoses, goals, presenting_problems,
             review_date, source_encounter_id, previous_version_id, clinician_id)
        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::date, $7::uuid, $8::uuid, $9)
        RETURNING id
        """,
        client_id,
        next_version,
        __to_json(diagnoses or []),
        __to_json(goals or []),
        presenting_problems,
        review_date,
        source_encounter_id,
        previous_version_id,
        clinician_id,
    )
    return str(row["id"])


async def get_treatment_plan(plan_id: str) -> dict | None:
    """Fetch a single treatment plan by ID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM treatment_plans WHERE id = $1::uuid", plan_id
    )
    if not r:
        return None
    return _treatment_plan_to_dict(r)


async def get_active_treatment_plan(client_id: str) -> dict | None:
    """Get the latest non-superseded treatment plan for a client."""
    pool = await get_pool()
    r = await pool.fetchrow(
        """
        SELECT * FROM treatment_plans
        WHERE client_id = $1 AND status != 'superseded'
        ORDER BY version DESC
        LIMIT 1
        """,
        client_id,
    )
    if not r:
        return None
    return _treatment_plan_to_dict(r)


async def update_treatment_plan(plan_id: str, **kwargs) -> None:
    """Update fields on a treatment plan."""
    pool = await get_pool()
    allowed = {"diagnoses", "goals", "presenting_problems", "review_date", "status", "signed_by", "signed_at"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return

    sets = []
    vals = []
    idx = 1
    for key, val in fields.items():
        if key in ("diagnoses", "goals"):
            sets.append(f"{key} = ${idx}::jsonb")
            vals.append(__to_json(val))
        elif key == "review_date":
            sets.append(f"{key} = ${idx}::date")
            vals.append(val)
        elif key == "signed_at":
            sets.append(f"{key} = ${idx}::timestamptz")
            vals.append(val)
        else:
            sets.append(f"{key} = ${idx}")
            vals.append(val)
        idx += 1

    vals.append(plan_id)
    query = f"UPDATE treatment_plans SET {', '.join(sets)} WHERE id = ${idx}::uuid"
    await pool.execute(query, *vals)


def _treatment_plan_to_dict(r) -> dict:
    d = {
        "id": str(r["id"]),
        "client_id": r["client_id"],
        "version": r["version"],
        "diagnoses": r["diagnoses"],
        "goals": r["goals"],
        "presenting_problems": r["presenting_problems"],
        "review_date": r["review_date"].isoformat() if r["review_date"] else None,
        "status": r["status"],
        "signed_by": r["signed_by"],
        "signed_at": r["signed_at"].isoformat() if r["signed_at"] else None,
        "source_encounter_id": str(r["source_encounter_id"]) if r["source_encounter_id"] else None,
        "previous_version_id": str(r["previous_version_id"]) if r["previous_version_id"] else None,
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }
    # Optional fields added by later migrations
    for field in ("content_hash", "signature_data", "clinician_id"):
        try:
            d[field] = r[field]
        except (KeyError, IndexError):
            pass
    try:
        d["pdf_data_exists"] = r["pdf_data"] is not None
    except (KeyError, IndexError):
        d["pdf_data_exists"] = False
    return d


async def get_treatment_plan_versions(client_id: str) -> list[dict]:
    """Get all treatment plan versions for a client, newest first."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM treatment_plans
        WHERE client_id = $1
        ORDER BY version DESC
        """,
        client_id,
    )
    return [_treatment_plan_to_dict(r) for r in rows]


async def supersede_treatment_plan(plan_id: str) -> None:
    """Mark a treatment plan as superseded (replaced by a new version)."""
    pool = await get_pool()
    await pool.execute(
        "UPDATE treatment_plans SET status = 'superseded' WHERE id = $1::uuid",
        plan_id,
    )


async def sign_treatment_plan(
    plan_id: str,
    signed_by: str,
    signed_at: str,
    content_hash: str,
    signature_data: str,
    pdf_data: bytes | None = None,
) -> None:
    """Sign and lock a treatment plan with signature, hash, and optional PDF."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE treatment_plans
        SET status = 'signed',
            signed_by = $1,
            signed_at = $2::timestamptz,
            content_hash = $3,
            signature_data = $4,
            pdf_data = $5
        WHERE id = $6::uuid
        """,
        signed_by,
        signed_at,
        content_hash,
        signature_data,
        pdf_data,
        plan_id,
    )


async def get_treatment_plans_due_for_review(
    days_ahead: int = 14,
    clinician_uid: str | None = None,
    is_owner: bool = True,
) -> list[dict]:
    """Find treatment plans with review dates approaching within the next N days.

    Non-owners see only their own treatment plans.
    """
    pool = await get_pool()
    where_extra = ""
    params: list = [days_ahead]
    if clinician_uid and not is_owner:
        where_extra = " AND tp.clinician_id = $2"
        params.append(clinician_uid)

    rows = await pool.fetch(
        f"""
        SELECT tp.*, c.full_name AS client_name, c.id AS client_uuid
        FROM treatment_plans tp
        JOIN clients c ON c.firebase_uid = tp.client_id
        WHERE tp.status IN ('signed', 'draft', 'review')
          AND tp.review_date IS NOT NULL
          AND tp.review_date <= now()::date + $1 * interval '1 day'
          AND tp.review_date >= now()::date - interval '7 day'{where_extra}
        ORDER BY tp.review_date ASC
        """,
        *params,
    )
    result = []
    for r in rows:
        d = _treatment_plan_to_dict(r)
        d["client_name"] = r["client_name"]
        d["client_uuid"] = str(r["client_uuid"])
        result.append(d)
    return result


# ---------------------------------------------------------------------------
# Reconfirmation & Cron helpers
# ---------------------------------------------------------------------------

async def set_reconfirmation_sent(appointment_id: str, token: str) -> None:
    """Mark that a reconfirmation email was sent for an appointment."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE appointments
        SET reconfirmation_token = $1::uuid,
            reconfirmation_sent_at = now()
        WHERE id = $2::uuid
        """,
        token,
        appointment_id,
    )


async def get_appointment_by_reconfirmation_token(token: str) -> dict | None:
    """Fetch an appointment by its reconfirmation token."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM appointments WHERE reconfirmation_token = $1::uuid",
        token,
    )
    if not r:
        return None
    return _appointment_to_dict(r)


async def record_reconfirmation_response(
    appointment_id: str, response: str
) -> None:
    """Record the client's reconfirmation response."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE appointments
        SET reconfirmation_response = $1,
            reconfirmation_responded_at = now()
        WHERE id = $2::uuid
        """,
        response,
        appointment_id,
    )


async def release_appointment(appointment_id: str) -> None:
    """Release an appointment slot (expired reconfirmation)."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE appointments
        SET status = 'released',
            released_at = now()
        WHERE id = $1::uuid
        """,
        appointment_id,
    )


async def get_expired_reconfirmations() -> list[dict]:
    """Find appointments where reconfirmation was sent >24h ago with no response."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM appointments
        WHERE reconfirmation_sent_at IS NOT NULL
          AND reconfirmation_response IS NULL
          AND status = 'scheduled'
          AND reconfirmation_sent_at < now() - interval '24 hours'
        ORDER BY scheduled_at
        """
    )
    return [_appointment_to_dict(r) for r in rows]


async def get_upcoming_appointments_for_reminders(hours_ahead: int = 24) -> list[dict]:
    """Find scheduled appointments within the next N hours that haven't had a reminder sent."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM appointments
        WHERE status = 'scheduled'
          AND scheduled_at > now()
          AND scheduled_at <= now() + $1 * interval '1 hour'
          AND reminder_sent_at IS NULL
        ORDER BY scheduled_at
        """,
        hours_ahead,
    )
    return [_appointment_to_dict(r) for r in rows]


async def mark_reminder_sent(appointment_id: str) -> None:
    """Mark that a reminder email has been sent for an appointment."""
    pool = await get_pool()
    await pool.execute(
        "UPDATE appointments SET reminder_sent_at = now() WHERE id = $1::uuid",
        appointment_id,
    )


async def mark_sms_reminder_sent(appointment_id: str) -> None:
    """Mark that an SMS reminder has been sent for an appointment."""
    pool = await get_pool()
    await pool.execute(
        "UPDATE appointments SET sms_reminder_sent_at = now() WHERE id = $1::uuid",
        appointment_id,
    )


async def get_client_sms_info(firebase_uid: str) -> dict | None:
    """Get phone + sms_opt_in for a client. Lightweight query for the reminder cron."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT phone, sms_opt_in FROM clients WHERE firebase_uid = $1",
        firebase_uid,
    )
    if not r:
        return None
    return {"phone": r["phone"], "sms_opt_in": r["sms_opt_in"] or False}


async def get_past_due_appointments() -> list[dict]:
    """Find appointments where scheduled time + duration has passed but status is still 'scheduled'."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM appointments
        WHERE status = 'scheduled'
          AND scheduled_at + (duration_minutes || ' minutes')::interval < now()
        ORDER BY scheduled_at
        """
    )
    return [_appointment_to_dict(r) for r in rows]


async def get_next_appointment_in_series(recurrence_id: str, after_date: str) -> dict | None:
    """Get the next scheduled appointment in a recurring series after a given date."""
    from datetime import datetime as _dt
    pool = await get_pool()
    _after = _dt.fromisoformat(after_date) if isinstance(after_date, str) else after_date
    r = await pool.fetchrow(
        """
        SELECT * FROM appointments
        WHERE recurrence_id = $1::uuid
          AND status = 'scheduled'
          AND scheduled_at > $2::timestamptz
        ORDER BY scheduled_at
        LIMIT 1
        """,
        recurrence_id,
        _after,
    )
    if not r:
        return None
    return _appointment_to_dict(r)


async def reschedule_appointment(
    appointment_id: str,
    new_scheduled_at: str,
    new_meet_link: str | None = None,
    new_calendar_event_id: str | None = None,
) -> None:
    """Reschedule an appointment to a new time, optionally updating Calendar/Meet info."""
    from datetime import datetime as _dt
    pool = await get_pool()
    _new_dt = _dt.fromisoformat(new_scheduled_at) if isinstance(new_scheduled_at, str) else new_scheduled_at
    await pool.execute(
        """
        UPDATE appointments
        SET scheduled_at = $1::timestamptz,
            meet_link = COALESCE($2, meet_link),
            calendar_event_id = COALESCE($3, calendar_event_id)
        WHERE id = $4::uuid
        """,
        _new_dt,
        new_meet_link,
        new_calendar_event_id,
        appointment_id,
    )


# ---------------------------------------------------------------------------
# Document Signing Status
# ---------------------------------------------------------------------------

async def get_client_document_signing_status(client_id: str) -> dict:
    """Get document signing status summary for a client.

    Returns {total: int, signed: int, pending: int, packages: list[dict]}.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT dp.id AS package_id, dp.status AS package_status,
               dp.created_at AS package_created_at,
               COUNT(d.id) AS total_docs,
               COUNT(d.id) FILTER (WHERE d.status = 'signed') AS signed_docs,
               COUNT(d.id) FILTER (WHERE d.status = 'pending') AS pending_docs
        FROM document_packages dp
        JOIN documents d ON d.package_id = dp.id
        WHERE dp.client_id = $1
        GROUP BY dp.id
        ORDER BY dp.created_at DESC
        """,
        client_id,
    )
    total = sum(r["total_docs"] for r in rows)
    signed = sum(r["signed_docs"] for r in rows)
    pending = sum(r["pending_docs"] for r in rows)

    packages = [
        {
            "package_id": str(r["package_id"]),
            "status": r["package_status"],
            "total": r["total_docs"],
            "signed": r["signed_docs"],
            "pending": r["pending_docs"],
            "created_at": r["package_created_at"].isoformat(),
        }
        for r in rows
    ]

    return {"total": total, "signed": signed, "pending": pending, "packages": packages}


async def get_unsigned_docs_count(client_id: str) -> int:
    """Return the number of unsigned documents across all packages for a client."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT COUNT(*) AS cnt
        FROM documents d
        JOIN document_packages dp ON dp.id = d.package_id
        WHERE dp.client_id = $1 AND d.status = 'pending'
        """,
        client_id,
    )
    return row["cnt"] if row else 0


async def get_appointments_with_unsigned_docs(hours_ahead: int = 24) -> list[dict]:
    """Find upcoming appointments (within hours_ahead) where the client has unsigned documents.

    Returns appointments joined with unsigned doc counts for the unsigned docs
    alert before session feature.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT a.*,
               (SELECT COUNT(*)
                FROM documents d
                JOIN document_packages dp ON dp.id = d.package_id
                WHERE dp.client_id = a.client_id AND d.status = 'pending'
               ) AS unsigned_doc_count
        FROM appointments a
        WHERE a.status = 'scheduled'
          AND a.scheduled_at > now()
          AND a.scheduled_at <= now() + $1 * interval '1 hour'
          AND (SELECT COUNT(*)
               FROM documents d
               JOIN document_packages dp ON dp.id = d.package_id
               WHERE dp.client_id = a.client_id AND d.status = 'pending'
              ) > 0
        ORDER BY a.scheduled_at
        """,
        hours_ahead,
    )
    result = []
    for r in rows:
        d = _appointment_to_dict(r)
        d["unsigned_doc_count"] = r["unsigned_doc_count"]
        result.append(d)
    return result


async def get_clients_signing_summary(clinician_uid: str | None = None) -> list[dict]:
    """Get document signing summary for all clients that have document packages.

    Returns list of {client_id, total, signed, pending} for use in the client list.
    Optionally scoped by clinician via clients.primary_clinician_id.
    """
    pool = await get_pool()
    where_extra = ""
    params: list = []
    if clinician_uid:
        where_extra = " WHERE c.primary_clinician_id = $1"
        params = [clinician_uid]

    rows = await pool.fetch(
        f"""
        SELECT dp.client_id,
               COUNT(d.id) AS total_docs,
               COUNT(d.id) FILTER (WHERE d.status = 'signed') AS signed_docs,
               COUNT(d.id) FILTER (WHERE d.status = 'pending') AS pending_docs
        FROM document_packages dp
        JOIN documents d ON d.package_id = dp.id
        {"JOIN clients c ON c.firebase_uid = dp.client_id" if clinician_uid else ""}
        {where_extra}
        GROUP BY dp.client_id
        """,
        *params,
    )
    return [
        {
            "client_id": r["client_id"],
            "total": r["total_docs"],
            "signed": r["signed_docs"],
            "pending": r["pending_docs"],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Ownership lookups (for row-level access control)
# ---------------------------------------------------------------------------

async def get_package_owner(package_id: str) -> str | None:
    """Return the client_id (firebase_uid) that owns a document package, or None."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT client_id FROM document_packages WHERE id = $1::uuid",
        package_id,
    )
    return row["client_id"] if row else None


async def get_document_owner(doc_id: str) -> str | None:
    """Return the client_id (firebase_uid) that owns a document (via its package)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT dp.client_id
        FROM documents d
        JOIN document_packages dp ON dp.id = d.package_id
        WHERE d.id = $1::uuid
        """,
        doc_id,
    )
    return row["client_id"] if row else None


async def get_appointment_client(appointment_id: str) -> str | None:
    """Return the client_id (firebase_uid) that an appointment belongs to."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT client_id FROM appointments WHERE id = $1::uuid",
        appointment_id,
    )
    return row["client_id"] if row else None


async def get_encounter_client(encounter_id: str) -> str | None:
    """Return the client_id (firebase_uid) that an encounter belongs to."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT client_id FROM encounters WHERE id = $1::uuid",
        encounter_id,
    )
    return row["client_id"] if row else None


# ---------------------------------------------------------------------------
# Client Detail (by UUID id)
# ---------------------------------------------------------------------------

async def get_client_by_id(client_uuid: str) -> dict | None:
    """Fetch a client profile by its UUID primary key (not firebase_uid)."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM clients WHERE id = $1::uuid", client_uuid
    )
    if not r:
        return None
    return _client_full_to_dict(r)


def _client_full_to_dict(r) -> dict:
    """Convert a full client record to dict."""
    d = {
        "id": str(r["id"]),
        "firebase_uid": r["firebase_uid"],
        "email": r["email"],
        "full_name": r["full_name"],
        "preferred_name": r["preferred_name"],
        "pronouns": r["pronouns"],
        "date_of_birth": r["date_of_birth"].isoformat() if r["date_of_birth"] else None,
        "phone": r["phone"],
        "address_line1": r["address_line1"],
        "address_line2": r["address_line2"],
        "address_city": r["address_city"],
        "address_state": r["address_state"],
        "address_zip": r["address_zip"],
        "emergency_contact_name": r["emergency_contact_name"],
        "emergency_contact_phone": r["emergency_contact_phone"],
        "emergency_contact_relationship": r["emergency_contact_relationship"],
        "payer_name": r["payer_name"],
        "member_id": r["member_id"],
        "group_number": r["group_number"],
        "payer_id": r.get("payer_id"),
        "sex": r.get("sex"),
        "default_modality": r.get("default_modality", "telehealth"),
        "secondary_payer_name": r.get("secondary_payer_name"),
        "secondary_payer_id": r.get("secondary_payer_id"),
        "secondary_member_id": r.get("secondary_member_id"),
        "secondary_group_number": r.get("secondary_group_number"),
        "filing_deadline_days": r.get("filing_deadline_days", 90),
        "insurance_data": r["insurance_data"],
        "status": r["status"],
        "intake_completed_at": r["intake_completed_at"].isoformat() if r["intake_completed_at"] else None,
        "documents_completed_at": r["documents_completed_at"].isoformat() if r["documents_completed_at"] else None,
        "discharged_at": r["discharged_at"].isoformat() if r["discharged_at"] else None,
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }
    try:
        d["sms_opt_in"] = r["sms_opt_in"] or False
    except (KeyError, IndexError):
        d["sms_opt_in"] = False
    try:
        d["primary_clinician_id"] = r["primary_clinician_id"]
    except (KeyError, IndexError):
        pass
    return d


# ---------------------------------------------------------------------------
# Encounters (client-scoped list)
# ---------------------------------------------------------------------------

async def get_client_encounters(client_id: str, limit: int = 50) -> list[dict]:
    """Fetch all encounters for a client (by firebase_uid), newest first."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, client_id, clinician_id, type, source, transcript,
               data, duration_sec, status, created_at, updated_at
        FROM encounters
        WHERE client_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        """,
        client_id,
        limit,
    )
    return [
        {
            "id": str(r["id"]),
            "client_id": r["client_id"],
            "clinician_id": r["clinician_id"],
            "type": r["type"],
            "source": r["source"],
            "transcript": r["transcript"][:200] if r["transcript"] else "",
            "data": r["data"],
            "duration_sec": r["duration_sec"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Clinical Notes (client-scoped list)
# ---------------------------------------------------------------------------

async def get_client_notes(client_id: str, limit: int = 50) -> list[dict]:
    """Fetch clinical notes for a client (via encounters table join), newest first."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT cn.id, cn.encounter_id, cn.format, cn.content, cn.flags,
               cn.signed_by, cn.signed_at, cn.status, cn.created_at, cn.updated_at,
               e.type AS encounter_type, e.source AS encounter_source
        FROM clinical_notes cn
        JOIN encounters e ON e.id = cn.encounter_id
        WHERE e.client_id = $1
        ORDER BY cn.created_at DESC
        LIMIT $2
        """,
        client_id,
        limit,
    )
    return [
        {
            "id": str(r["id"]),
            "encounter_id": str(r["encounter_id"]),
            "format": r["format"],
            "content": r["content"],
            "flags": r["flags"],
            "signed_by": r["signed_by"],
            "signed_at": r["signed_at"].isoformat() if r["signed_at"] else None,
            "status": r["status"],
            "encounter_type": r["encounter_type"],
            "encounter_source": r["encounter_source"],
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Client Appointments (all, not just date-ranged)
# ---------------------------------------------------------------------------

async def get_client_appointments(client_id: str, limit: int = 50) -> list[dict]:
    """Fetch all appointments for a client (by firebase_uid), newest first."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM appointments
        WHERE client_id = $1
        ORDER BY scheduled_at DESC
        LIMIT $2
        """,
        client_id,
        limit,
    )
    return [_appointment_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Unsigned Notes (clinician dashboard)
# ---------------------------------------------------------------------------

async def get_unsigned_notes(clinician_uid: str | None = None, is_owner: bool = True) -> list[dict]:
    """Fetch clinical notes with status 'draft' or 'review', with client info.

    Returns notes joined with encounter + client data for the unsigned notes
    dashboard widget. Non-owners see only notes for their own clients.
    """
    pool = await get_pool()
    where_extra = ""
    params: list = []
    if clinician_uid and not is_owner:
        where_extra = " AND cn.clinician_id = $1"
        params = [clinician_uid]

    rows = await pool.fetch(
        f"""
        SELECT cn.id, cn.encounter_id, cn.format, cn.status, cn.created_at, cn.updated_at,
               cn.clinician_id,
               e.client_id, e.type AS encounter_type,
               c.full_name AS client_name, c.id AS client_uuid
        FROM clinical_notes cn
        JOIN encounters e ON e.id = cn.encounter_id
        LEFT JOIN clients c ON c.firebase_uid = e.client_id
        WHERE cn.status IN ('draft', 'review'){where_extra}
        ORDER BY cn.created_at DESC
        """,
        *params,
    )
    return [
        {
            "id": str(r["id"]),
            "encounter_id": str(r["encounter_id"]),
            "format": r["format"],
            "status": r["status"],
            "encounter_type": r["encounter_type"],
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "client_uuid": str(r["client_uuid"]) if r["client_uuid"] else None,
            "clinician_id": r["clinician_id"],
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Session Recording Pipeline
# ---------------------------------------------------------------------------

async def get_completed_appointments_needing_recording(
    lookback_hours: int = 12,
    grace_minutes: int = 60,
) -> list[dict]:
    """Find completed or recently-past appointments that need recording processing.

    Returns appointments where:
    - Status is 'completed' or was scheduled and end time + grace period has passed
    - recording_status is NULL (never processed) or 'pending'
    - Has a calendar_event_id (so we can look up the recording)
    - Was scheduled within the last `lookback_hours`

    The grace period (default 60 min) gives time for sessions that run over
    and for Meet to finalize recordings in Drive before we start polling.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM appointments
        WHERE calendar_event_id IS NOT NULL
          AND (recording_status IS NULL OR recording_status = 'pending')
          AND scheduled_at > now() - $1 * interval '1 hour'
          AND (
            status = 'completed'
            OR (status = 'scheduled'
                AND scheduled_at + (duration_minutes || ' minutes')::interval
                    + $2 * interval '1 minute' < now())
          )
        ORDER BY scheduled_at DESC
        """,
        lookback_hours,
        grace_minutes,
    )
    return [_appointment_to_dict(r) for r in rows]


async def update_appointment_recording(
    appointment_id: str,
    recording_file_id: str | None = None,
    recording_status: str | None = None,
    recording_error: str | None = None,
    encounter_id: str | None = None,
) -> None:
    """Update recording-related fields on an appointment."""
    pool = await get_pool()
    sets = []
    vals = []
    idx = 1

    if recording_file_id is not None:
        sets.append(f"recording_file_id = ${idx}")
        vals.append(recording_file_id)
        idx += 1
    if recording_status is not None:
        sets.append(f"recording_status = ${idx}")
        vals.append(recording_status)
        idx += 1
        if recording_status in ("completed", "failed"):
            sets.append("recording_processed_at = now()")
    if recording_error is not None:
        sets.append(f"recording_error = ${idx}")
        vals.append(recording_error)
        idx += 1
    if encounter_id is not None:
        sets.append(f"encounter_id = ${idx}::uuid")
        vals.append(encounter_id)
        idx += 1

    if not sets:
        return

    vals.append(appointment_id)
    query = f"UPDATE appointments SET {', '.join(sets)} WHERE id = ${idx}::uuid"
    await pool.execute(query, *vals)


async def get_appointments_by_recording_status(
    status: str,
    limit: int = 100,
    clinician_id: str | None = None,
) -> list[dict]:
    """Get appointments with a specific recording status, optionally filtered by clinician."""
    pool = await get_pool()
    where_extra = ""
    params: list = [status, limit]
    if clinician_id:
        where_extra = " AND clinician_id = $3"
        params.append(clinician_id)

    rows = await pool.fetch(
        f"""
        SELECT * FROM appointments
        WHERE recording_status = $1{where_extra}
        ORDER BY scheduled_at DESC
        LIMIT $2
        """,
        *params,
    )
    return [_appointment_to_dict(r) for r in rows]


async def get_appointment_by_calendar_event(calendar_event_id: str) -> dict | None:
    """Find an appointment by its Google Calendar event ID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM appointments WHERE calendar_event_id = $1",
        calendar_event_id,
    )
    if not r:
        return None
    return _appointment_to_dict(r)


async def get_appointment_by_meet_link(meet_link: str) -> dict | None:
    """Find an appointment by its Meet link (or partial match on meeting code)."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM appointments WHERE meet_link = $1",
        meet_link,
    )
    if not r:
        return None
    return _appointment_to_dict(r)


# ---------------------------------------------------------------------------
# Recording Configuration
# ---------------------------------------------------------------------------

async def get_recording_config(clinician_id: str) -> dict | None:
    """Get recording configuration for a clinician."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM recording_config WHERE clinician_id = $1",
        clinician_id,
    )
    if not r:
        return None
    return {
        "id": str(r["id"]),
        "clinician_id": r["clinician_id"],
        "delete_after_transcription": r["delete_after_transcription"],
        "auto_process": r["auto_process"],
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }


async def upsert_recording_config(
    clinician_id: str,
    delete_after_transcription: bool = True,
    auto_process: bool = True,
) -> str:
    """Create or update recording config. Returns the config UUID."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO recording_config (clinician_id, delete_after_transcription, auto_process)
        VALUES ($1, $2, $3)
        ON CONFLICT (clinician_id) DO UPDATE
            SET delete_after_transcription = EXCLUDED.delete_after_transcription,
                auto_process = EXCLUDED.auto_process
        RETURNING id
        """,
        clinician_id,
        delete_after_transcription,
        auto_process,
    )
    return str(row["id"])


# ---------------------------------------------------------------------------
# Discharge Workflow
# ---------------------------------------------------------------------------

async def get_future_appointments(client_id: str) -> list[dict]:
    """Get all future scheduled appointments for a client (by firebase_uid).

    Used by the discharge workflow to cancel upcoming appointments.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM appointments
        WHERE client_id = $1
          AND status = 'scheduled'
          AND scheduled_at > now()
        ORDER BY scheduled_at
        """,
        client_id,
    )
    return [_appointment_to_dict(r) for r in rows]


async def get_client_recurrence_ids(client_id: str) -> list[str]:
    """Get distinct recurrence IDs for a client's active recurring series."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT DISTINCT recurrence_id
        FROM appointments
        WHERE client_id = $1
          AND recurrence_id IS NOT NULL
          AND status = 'scheduled'
          AND scheduled_at > now()
        """,
        client_id,
    )
    return [str(r["recurrence_id"]) for r in rows]


async def discharge_client(firebase_uid: str) -> None:
    """Set a client's status to discharged with timestamp."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE clients
        SET status = 'discharged',
            discharged_at = now()
        WHERE firebase_uid = $1
        """,
        firebase_uid,
    )


async def get_client_full_encounters(client_id: str) -> list[dict]:
    """Fetch ALL encounters for a client with FULL transcripts (for discharge summary).

    Unlike get_client_encounters which truncates transcripts to 200 chars,
    this returns complete transcripts needed for AI summary generation.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, client_id, clinician_id, type, source, transcript,
               data, duration_sec, status, created_at, updated_at
        FROM encounters
        WHERE client_id = $1
        ORDER BY created_at ASC
        """,
        client_id,
    )
    return [
        {
            "id": str(r["id"]),
            "client_id": r["client_id"],
            "clinician_id": r["clinician_id"],
            "type": r["type"],
            "source": r["source"],
            "transcript": r["transcript"] or "",
            "data": r["data"],
            "duration_sec": r["duration_sec"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


async def get_client_full_notes(client_id: str) -> list[dict]:
    """Fetch ALL clinical notes for a client with full content (for discharge summary).

    Returns notes in chronological order (oldest first) for AI context.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT cn.id, cn.encounter_id, cn.format, cn.content, cn.flags,
               cn.signed_by, cn.signed_at, cn.status, cn.created_at, cn.updated_at,
               e.type AS encounter_type, e.source AS encounter_source
        FROM clinical_notes cn
        JOIN encounters e ON e.id = cn.encounter_id
        WHERE e.client_id = $1
        ORDER BY cn.created_at ASC
        """,
        client_id,
    )
    return [
        {
            "id": str(r["id"]),
            "encounter_id": str(r["encounter_id"]),
            "format": r["format"],
            "content": r["content"],
            "flags": r["flags"],
            "signed_by": r["signed_by"],
            "signed_at": r["signed_at"].isoformat() if r["signed_at"] else None,
            "status": r["status"],
            "encounter_type": r["encounter_type"],
            "encounter_source": r["encounter_source"],
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


async def get_unsigned_notes_for_client(client_id: str) -> list[dict]:
    """Get unsigned (draft/review) clinical notes for a specific client.

    Used by discharge status check to warn about outstanding notes.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT cn.id, cn.format, cn.status, cn.created_at,
               e.type AS encounter_type
        FROM clinical_notes cn
        JOIN encounters e ON e.id = cn.encounter_id
        WHERE e.client_id = $1
          AND cn.status IN ('draft', 'review')
        ORDER BY cn.created_at DESC
        """,
        client_id,
    )
    return [
        {
            "id": str(r["id"]),
            "format": r["format"],
            "status": r["status"],
            "encounter_type": r["encounter_type"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Authorizations
# ---------------------------------------------------------------------------

def _authorization_to_dict(r) -> dict:
    """Convert an authorization database record to a response dict."""
    return {
        "id": str(r["id"]),
        "client_id": r["client_id"],
        "clinician_id": r["clinician_id"],
        "payer_name": r["payer_name"],
        "auth_number": r["auth_number"],
        "authorized_sessions": r["authorized_sessions"],
        "sessions_used": r["sessions_used"],
        "cpt_codes": r["cpt_codes"],
        "diagnosis_codes": r["diagnosis_codes"],
        "start_date": r["start_date"].isoformat() if r["start_date"] else None,
        "end_date": r["end_date"].isoformat() if r["end_date"] else None,
        "status": r["status"],
        "notes": r["notes"],
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }


async def create_authorization(
    client_id: str,
    clinician_id: str,
    payer_name: str,
    auth_number: str | None = None,
    authorized_sessions: int | None = None,
    cpt_codes: list | None = None,
    diagnosis_codes: list | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    notes: str | None = None,
) -> dict:
    """Create an authorization and return the full record."""
    from datetime import date as _date
    pool = await get_pool()
    _start = _date.fromisoformat(start_date) if isinstance(start_date, str) else start_date
    _end = _date.fromisoformat(end_date) if isinstance(end_date, str) else end_date
    row = await pool.fetchrow(
        """
        INSERT INTO authorizations
            (client_id, clinician_id, payer_name, auth_number, authorized_sessions,
             cpt_codes, diagnosis_codes, start_date, end_date, notes)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::date, $9::date, $10)
        RETURNING *
        """,
        client_id,
        clinician_id,
        payer_name,
        auth_number,
        authorized_sessions,
        __to_json(cpt_codes),
        __to_json(diagnosis_codes),
        _start,
        _end,
        notes,
    )
    return _authorization_to_dict(row)


async def get_authorization(auth_id: str) -> dict | None:
    """Fetch a single authorization by ID."""
    pool = await get_pool()
    r = await pool.fetchrow(
        "SELECT * FROM authorizations WHERE id = $1::uuid", auth_id
    )
    if not r:
        return None
    return _authorization_to_dict(r)


async def get_client_authorizations(client_id: str) -> list[dict]:
    """Fetch all authorizations for a client, newest first."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM authorizations
        WHERE client_id = $1
        ORDER BY created_at DESC
        """,
        client_id,
    )
    return [_authorization_to_dict(r) for r in rows]


async def get_active_authorization(
    client_id: str, cpt_code: str | None = None
) -> dict | None:
    """Find an active authorization for a client, optionally filtered by CPT code.

    Prefers auths that match the CPT code, then any active auth.
    Only returns auths where sessions_used < authorized_sessions (or unlimited).
    """
    pool = await get_pool()
    from datetime import date as _date
    today = _date.today()

    # Try to find one matching the CPT code first
    if cpt_code:
        row = await pool.fetchrow(
            """
            SELECT * FROM authorizations
            WHERE client_id = $1
              AND status = 'active'
              AND start_date <= $2
              AND end_date >= $2
              AND (cpt_codes IS NULL OR cpt_codes @> $3::jsonb)
              AND (authorized_sessions IS NULL OR sessions_used < authorized_sessions)
            ORDER BY end_date ASC
            LIMIT 1
            """,
            client_id,
            today,
            __to_json([cpt_code]),
        )
        if row:
            return _authorization_to_dict(row)

    # Fallback: any active auth for the client
    row = await pool.fetchrow(
        """
        SELECT * FROM authorizations
        WHERE client_id = $1
          AND status = 'active'
          AND start_date <= $2
          AND end_date >= $2
          AND (authorized_sessions IS NULL OR sessions_used < authorized_sessions)
        ORDER BY end_date ASC
        LIMIT 1
        """,
        client_id,
        today,
    )
    if not row:
        return None
    return _authorization_to_dict(row)


async def update_authorization(auth_id: str, **fields) -> dict | None:
    """Update fields on an authorization. Returns the updated record."""
    from datetime import date as _date
    pool = await get_pool()
    allowed = {
        "payer_name", "auth_number", "authorized_sessions", "cpt_codes",
        "diagnosis_codes", "start_date", "end_date", "status", "notes",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return await get_authorization(auth_id)

    sets = []
    vals = []
    idx = 1
    for key, val in updates.items():
        if key in ("cpt_codes", "diagnosis_codes"):
            sets.append(f"{key} = ${idx}::jsonb")
            vals.append(__to_json(val))
        elif key in ("start_date", "end_date"):
            sets.append(f"{key} = ${idx}::date")
            vals.append(_date.fromisoformat(val) if isinstance(val, str) else val)
        else:
            sets.append(f"{key} = ${idx}")
            vals.append(val)
        idx += 1

    sets.append("updated_at = now()")
    vals.append(auth_id)
    query = f"UPDATE authorizations SET {', '.join(sets)} WHERE id = ${idx}::uuid RETURNING *"
    row = await pool.fetchrow(query, *vals)
    if not row:
        return None
    return _authorization_to_dict(row)


async def increment_auth_sessions_used(auth_id: str) -> dict | None:
    """Atomically increment sessions_used. Sets status='exhausted' if limit reached."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE authorizations
        SET sessions_used = sessions_used + 1,
            status = CASE
                WHEN authorized_sessions IS NOT NULL
                     AND sessions_used + 1 >= authorized_sessions
                THEN 'exhausted'
                ELSE status
            END,
            updated_at = now()
        WHERE id = $1::uuid
        RETURNING *
        """,
        auth_id,
    )
    if not row:
        return None
    return _authorization_to_dict(row)


async def delete_authorization(auth_id: str) -> bool:
    """Delete an authorization. Returns True if deleted."""
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM authorizations WHERE id = $1::uuid", auth_id
    )
    return result == "DELETE 1"


async def get_expiring_authorizations(days: int = 14) -> list[dict]:
    """Get active authorizations expiring within N days."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT a.*, c.full_name AS client_name, c.id AS client_uuid
        FROM authorizations a
        LEFT JOIN clients c ON c.firebase_uid = a.client_id
        WHERE a.status = 'active'
          AND a.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1 * INTERVAL '1 day'
        ORDER BY a.end_date ASC
        """,
        days,
    )
    results = []
    for r in rows:
        d = _authorization_to_dict(r)
        d["client_name"] = r["client_name"]
        d["client_uuid"] = str(r["client_uuid"]) if r["client_uuid"] else None
        results.append(d)
    return results


async def get_low_session_authorizations(remaining: int = 3) -> list[dict]:
    """Get active authorizations with N or fewer sessions remaining."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT a.*, c.full_name AS client_name, c.id AS client_uuid
        FROM authorizations a
        LEFT JOIN clients c ON c.firebase_uid = a.client_id
        WHERE a.status = 'active'
          AND a.authorized_sessions IS NOT NULL
          AND (a.authorized_sessions - a.sessions_used) <= $1
          AND (a.authorized_sessions - a.sessions_used) > 0
          AND a.end_date >= CURRENT_DATE
        ORDER BY (a.authorized_sessions - a.sessions_used) ASC
        """,
        remaining,
    )
    results = []
    for r in rows:
        d = _authorization_to_dict(r)
        d["client_name"] = r["client_name"]
        d["client_uuid"] = str(r["client_uuid"]) if r["client_uuid"] else None
        results.append(d)
    return results


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def __to_json(data):
    """Prepare data for asyncpg JSONB params.

    With the JSONB codec configured on the pool (see _init_connection),
    asyncpg handles serialization automatically, so we just pass through
    the Python object (dict/list). Returns None for None values.
    """
    if data is None:
        return None
    return data


# ---------------------------------------------------------------------------
# Practice status & client invitations
# ---------------------------------------------------------------------------

async def is_practice_initialized() -> dict:
    """Check if any practice exists. Returns initialization status + practice info."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, name, type FROM practices ORDER BY created_at ASC LIMIT 1"
    )
    if not row:
        return {"initialized": False}
    return {
        "initialized": True,
        "practice_name": row["name"],
        "practice_id": str(row["id"]),
        "practice_type": row["type"],
    }


async def create_client_invitation(
    practice_id: str, clinician_uid: str, email: str, token: str,
    intake_mode: str = "standard",
) -> str:
    """Insert a client invitation. Returns the invitation UUID."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO client_invitations (practice_id, clinician_firebase_uid, email, token, intake_mode)
        VALUES ($1::uuid, $2, $3, $4, $5)
        RETURNING id
        """,
        practice_id,
        clinician_uid,
        email,
        token,
        intake_mode,
    )
    return str(row["id"])


async def get_client_invitation_by_token(token: str) -> dict | None:
    """Look up a pending, non-expired invitation by token. Joins practice + clinician names."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT ci.id, ci.practice_id, ci.clinician_firebase_uid, ci.email,
               ci.token, ci.status, ci.expires_at, ci.created_at,
               ci.intake_mode,
               p.name AS practice_name,
               c.clinician_name
        FROM client_invitations ci
        JOIN practices p ON p.id = ci.practice_id
        LEFT JOIN clinicians c ON c.firebase_uid = ci.clinician_firebase_uid
            AND c.status = 'active'
        WHERE ci.token = $1
          AND ci.status = 'pending'
          AND ci.expires_at > now()
        """,
        token,
    )
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "practice_id": str(row["practice_id"]),
        "clinician_firebase_uid": row["clinician_firebase_uid"],
        "email": row["email"],
        "token": row["token"],
        "practice_name": row["practice_name"],
        "clinician_name": row["clinician_name"],
        "intake_mode": row["intake_mode"],
    }


async def get_client_invitation_by_email(email: str) -> dict | None:
    """Look up the most recent pending, non-expired invitation by email."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT ci.id, ci.practice_id, ci.clinician_firebase_uid, ci.email,
               ci.token, ci.status, ci.expires_at,
               ci.intake_mode,
               p.name AS practice_name,
               c.clinician_name
        FROM client_invitations ci
        JOIN practices p ON p.id = ci.practice_id
        LEFT JOIN clinicians c ON c.firebase_uid = ci.clinician_firebase_uid
            AND c.status = 'active'
        WHERE ci.email = $1
          AND ci.status = 'pending'
          AND ci.expires_at > now()
        ORDER BY ci.created_at DESC
        LIMIT 1
        """,
        email,
    )
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "practice_id": str(row["practice_id"]),
        "clinician_firebase_uid": row["clinician_firebase_uid"],
        "email": row["email"],
        "token": row["token"],
        "practice_name": row["practice_name"],
        "clinician_name": row["clinician_name"],
        "intake_mode": row["intake_mode"],
    }


async def accept_client_invitation(token: str) -> None:
    """Mark an invitation as accepted."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE client_invitations
        SET status = 'accepted', accepted_at = now()
        WHERE token = $1
        """,
        token,
    )


async def get_active_practice_clinicians(practice_id: str) -> list[dict]:
    """Return public-facing info for active clinicians in a practice."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, firebase_uid, clinician_name, credentials, specialties, bio
        FROM clinicians
        WHERE practice_id = $1::uuid AND status = 'active'
        ORDER BY practice_role = 'owner' DESC, clinician_name ASC
        """,
        practice_id,
    )
    return [
        {
            "id": str(r["id"]),
            "firebase_uid": r["firebase_uid"],
            "clinician_name": r["clinician_name"],
            "credentials": r["credentials"],
            "specialties": r["specialties"],
            "bio": r["bio"],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Credentialing — Payer Enrollments
# ---------------------------------------------------------------------------

def _cred_payer_to_dict(r) -> dict:
    return {
        "id": str(r["id"]),
        "practice_id": str(r["practice_id"]),
        "clinician_id": r["clinician_id"],
        "payer_name": r["payer_name"],
        "payer_id": r["payer_id"],
        "status": r["status"],
        "provider_relations_phone": r["provider_relations_phone"],
        "provider_relations_email": r["provider_relations_email"],
        "provider_relations_fax": r["provider_relations_fax"],
        "portal_url": r["portal_url"],
        "application_submitted_at": r["application_submitted_at"].isoformat() if r["application_submitted_at"] else None,
        "credentialed_at": r["credentialed_at"].isoformat() if r["credentialed_at"] else None,
        "effective_date": r["effective_date"].isoformat() if r["effective_date"] else None,
        "expiration_date": r["expiration_date"].isoformat() if r["expiration_date"] else None,
        "denied_at": r["denied_at"].isoformat() if r["denied_at"] else None,
        "denial_reason": r["denial_reason"],
        "recredential_reminder_days": r["recredential_reminder_days"],
        "required_documents": r["required_documents"],
        "contracted_rates": r["contracted_rates"],
        "notes": r["notes"],
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }


async def create_credentialing_payer(
    practice_id: str,
    clinician_id: str,
    payer_name: str,
    **kwargs,
) -> dict:
    """Create a credentialing payer enrollment record."""
    pool = await get_pool()

    # Build optional columns
    extra_cols = ""
    extra_vals = ""
    params = [practice_id, clinician_id, payer_name]
    idx = 4

    allowed = (
        "payer_id", "status", "provider_relations_phone", "provider_relations_email",
        "provider_relations_fax", "portal_url", "effective_date", "expiration_date",
        "recredential_reminder_days", "required_documents", "contracted_rates", "notes",
        "denial_reason",
    )
    for key in allowed:
        if key in kwargs and kwargs[key] is not None:
            extra_cols += f", {key}"
            val = kwargs[key]
            if key in ("effective_date", "expiration_date"):
                extra_vals += f", ${idx}::date"
            elif key in ("required_documents", "contracted_rates"):
                extra_vals += f", ${idx}::jsonb"
                val = __to_json(val)
            else:
                extra_vals += f", ${idx}"
            params.append(val)
            idx += 1

    row = await pool.fetchrow(
        f"""
        INSERT INTO credentialing_payers (practice_id, clinician_id, payer_name{extra_cols})
        VALUES ($1::uuid, $2, $3{extra_vals})
        RETURNING *
        """,
        *params,
    )
    return _cred_payer_to_dict(row)


async def get_credentialing_payer(payer_id: str) -> dict | None:
    """Get a single credentialing payer record."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM credentialing_payers WHERE id = $1::uuid", payer_id,
    )
    return _cred_payer_to_dict(row) if row else None


async def list_credentialing_payers(
    practice_id: str,
    clinician_id: str | None = None,
    status: str | None = None,
) -> list[dict]:
    """List credentialing payer records for a practice."""
    pool = await get_pool()
    query = "SELECT * FROM credentialing_payers WHERE practice_id = $1::uuid"
    params: list = [practice_id]
    idx = 2

    if clinician_id:
        query += f" AND clinician_id = ${idx}"
        params.append(clinician_id)
        idx += 1
    if status:
        query += f" AND status = ${idx}"
        params.append(status)
        idx += 1

    query += " ORDER BY updated_at DESC"
    rows = await pool.fetch(query, *params)
    return [_cred_payer_to_dict(r) for r in rows]


async def update_credentialing_payer(payer_id: str, **fields) -> dict | None:
    """Update a credentialing payer record. Returns updated record or None."""
    pool = await get_pool()

    allowed = (
        "payer_name", "payer_id", "status", "provider_relations_phone",
        "provider_relations_email", "provider_relations_fax", "portal_url",
        "application_submitted_at", "credentialed_at", "effective_date",
        "expiration_date", "denied_at", "denial_reason", "recredential_reminder_days",
        "required_documents", "contracted_rates", "notes",
    )

    sets = []
    vals = []
    idx = 1
    for key, val in fields.items():
        if key not in allowed:
            continue
        if key in ("effective_date", "expiration_date"):
            sets.append(f"{key} = ${idx}::date")
        elif key in ("application_submitted_at", "credentialed_at", "denied_at"):
            sets.append(f"{key} = ${idx}::timestamptz")
        elif key in ("required_documents", "contracted_rates"):
            sets.append(f"{key} = ${idx}::jsonb")
            val = __to_json(val)
        else:
            sets.append(f"{key} = ${idx}")
        vals.append(val)
        idx += 1

    if not sets:
        return await get_credentialing_payer(payer_id)

    sets.append(f"updated_at = now()")
    vals.append(payer_id)
    query = f"UPDATE credentialing_payers SET {', '.join(sets)} WHERE id = ${idx}::uuid RETURNING *"
    row = await pool.fetchrow(query, *vals)
    return _cred_payer_to_dict(row) if row else None


async def delete_credentialing_payer(payer_id: str) -> bool:
    """Delete a credentialing payer record."""
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM credentialing_payers WHERE id = $1::uuid", payer_id,
    )
    return result == "DELETE 1"


async def get_expiring_credentials(practice_id: str, days_ahead: int = 90) -> list[dict]:
    """Get credentialing payers with credentials expiring within N days."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM credentialing_payers
        WHERE practice_id = $1::uuid
          AND status = 'credentialed'
          AND expiration_date IS NOT NULL
          AND expiration_date <= CURRENT_DATE + $2 * INTERVAL '1 day'
        ORDER BY expiration_date ASC
        """,
        practice_id, days_ahead,
    )
    return [_cred_payer_to_dict(r) for r in rows]


async def get_stale_applications(practice_id: str, days_stale: int = 30) -> list[dict]:
    """Get credentialing payers with applications pending longer than N days."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM credentialing_payers
        WHERE practice_id = $1::uuid
          AND status IN ('application_submitted', 'pending')
          AND application_submitted_at IS NOT NULL
          AND application_submitted_at <= now() - $2 * INTERVAL '1 day'
        ORDER BY application_submitted_at ASC
        """,
        practice_id, days_stale,
    )
    return [_cred_payer_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Credentialing — Documents
# ---------------------------------------------------------------------------

def _cred_doc_to_dict(r, include_file: bool = False) -> dict:
    d = {
        "id": str(r["id"]),
        "payer_id": str(r["payer_id"]) if r["payer_id"] else None,
        "practice_id": str(r["practice_id"]),
        "clinician_id": r["clinician_id"],
        "document_type": r["document_type"],
        "file_name": r["file_name"],
        "mime_type": r["mime_type"],
        "file_size_bytes": r["file_size_bytes"],
        "extracted_data": r["extracted_data"],
        "expiration_date": r["expiration_date"].isoformat() if r["expiration_date"] else None,
        "issue_date": r["issue_date"].isoformat() if r["issue_date"] else None,
        "issuing_authority": r["issuing_authority"],
        "document_number": r["document_number"],
        "verified": r["verified"],
        "notes": r["notes"],
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }
    if include_file and r.get("file_data"):
        import base64
        d["file_data_b64"] = base64.b64encode(r["file_data"]).decode()
    return d


async def create_credentialing_document(
    practice_id: str,
    clinician_id: str,
    document_type: str,
    file_name: str,
    mime_type: str,
    file_data: bytes,
    payer_id: str | None = None,
    **kwargs,
) -> dict:
    """Create a credentialing document record."""
    pool = await get_pool()

    extra_cols = ""
    extra_vals = ""
    params = [practice_id, clinician_id, document_type, file_name, mime_type, file_data, len(file_data)]
    idx = 8

    if payer_id:
        extra_cols += ", payer_id"
        extra_vals += f", ${idx}::uuid"
        params.append(payer_id)
        idx += 1

    optional = ("extracted_data", "expiration_date", "issue_date", "issuing_authority", "document_number", "notes")
    for key in optional:
        if key in kwargs and kwargs[key] is not None:
            extra_cols += f", {key}"
            val = kwargs[key]
            if key in ("expiration_date", "issue_date"):
                extra_vals += f", ${idx}::date"
            elif key == "extracted_data":
                extra_vals += f", ${idx}::jsonb"
                val = __to_json(val)
            else:
                extra_vals += f", ${idx}"
            params.append(val)
            idx += 1

    row = await pool.fetchrow(
        f"""
        INSERT INTO credentialing_documents
            (practice_id, clinician_id, document_type, file_name, mime_type, file_data, file_size_bytes{extra_cols})
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7{extra_vals})
        RETURNING *
        """,
        *params,
    )
    return _cred_doc_to_dict(row)


async def get_credentialing_document(doc_id: str) -> dict | None:
    """Get a credentialing document (metadata only, no file data)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """SELECT id, payer_id, practice_id, clinician_id, document_type, file_name, mime_type,
                  file_size_bytes, extracted_data, expiration_date, issue_date, issuing_authority,
                  document_number, verified, notes, created_at, updated_at
           FROM credentialing_documents WHERE id = $1::uuid""",
        doc_id,
    )
    return _cred_doc_to_dict(row) if row else None


async def get_credentialing_document_file(doc_id: str) -> dict | None:
    """Get a credentialing document including file data for download."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM credentialing_documents WHERE id = $1::uuid", doc_id,
    )
    return _cred_doc_to_dict(row, include_file=True) if row else None


async def list_credentialing_documents(
    practice_id: str,
    clinician_id: str | None = None,
    payer_id: str | None = None,
    document_type: str | None = None,
) -> list[dict]:
    """List credentialing documents (metadata only)."""
    pool = await get_pool()
    query = """SELECT id, payer_id, practice_id, clinician_id, document_type, file_name, mime_type,
                      file_size_bytes, extracted_data, expiration_date, issue_date, issuing_authority,
                      document_number, verified, notes, created_at, updated_at
               FROM credentialing_documents WHERE practice_id = $1::uuid"""
    params: list = [practice_id]
    idx = 2

    if clinician_id:
        query += f" AND clinician_id = ${idx}"
        params.append(clinician_id)
        idx += 1
    if payer_id:
        query += f" AND payer_id = ${idx}::uuid"
        params.append(payer_id)
        idx += 1
    if document_type:
        query += f" AND document_type = ${idx}"
        params.append(document_type)
        idx += 1

    query += " ORDER BY created_at DESC"
    rows = await pool.fetch(query, *params)
    return [_cred_doc_to_dict(r) for r in rows]


async def update_credentialing_document(doc_id: str, **fields) -> dict | None:
    """Update a credentialing document metadata."""
    pool = await get_pool()
    allowed = (
        "payer_id", "document_type", "extracted_data", "expiration_date",
        "issue_date", "issuing_authority", "document_number", "verified", "notes",
    )
    sets = []
    vals = []
    idx = 1
    for key, val in fields.items():
        if key not in allowed:
            continue
        if key in ("expiration_date", "issue_date"):
            sets.append(f"{key} = ${idx}::date")
        elif key == "extracted_data":
            sets.append(f"{key} = ${idx}::jsonb")
            val = __to_json(val)
        elif key == "payer_id":
            sets.append(f"{key} = ${idx}::uuid")
        else:
            sets.append(f"{key} = ${idx}")
        vals.append(val)
        idx += 1

    if not sets:
        return await get_credentialing_document(doc_id)

    sets.append("updated_at = now()")
    vals.append(doc_id)
    row = await pool.fetchrow(
        f"UPDATE credentialing_documents SET {', '.join(sets)} WHERE id = ${idx}::uuid RETURNING *",
        *vals,
    )
    return _cred_doc_to_dict(row) if row else None


async def delete_credentialing_document(doc_id: str) -> bool:
    """Delete a credentialing document."""
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM credentialing_documents WHERE id = $1::uuid", doc_id,
    )
    return result == "DELETE 1"


# ---------------------------------------------------------------------------
# Credentialing — Timeline Events
# ---------------------------------------------------------------------------

async def create_credentialing_timeline_event(
    payer_id: str,
    event_type: str,
    description: str,
    created_by: str | None = None,
    metadata: dict | None = None,
) -> dict:
    """Create a timeline event for a credentialing payer."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO credentialing_timeline_events (payer_id, event_type, description, created_by, metadata)
        VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
        RETURNING *
        """,
        payer_id, event_type, description, created_by, __to_json(metadata),
    )
    return {
        "id": str(row["id"]),
        "payer_id": str(row["payer_id"]),
        "event_type": row["event_type"],
        "description": row["description"],
        "metadata": row["metadata"],
        "created_by": row["created_by"],
        "created_at": row["created_at"].isoformat(),
    }


async def list_credentialing_timeline_events(payer_id: str) -> list[dict]:
    """List timeline events for a credentialing payer, newest first."""
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT * FROM credentialing_timeline_events
           WHERE payer_id = $1::uuid
           ORDER BY created_at DESC""",
        payer_id,
    )
    return [
        {
            "id": str(r["id"]),
            "payer_id": str(r["payer_id"]),
            "event_type": r["event_type"],
            "description": r["description"],
            "metadata": r["metadata"],
            "created_by": r["created_by"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]
