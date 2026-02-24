"""Audit log viewer endpoint for HIPAA compliance.

Provides a read-only, paginated view of the audit_events table for
clinicians. The audit log is append-only — no UPDATE or DELETE
operations are permitted on audit_events.

HIPAA Access Control:
  - GET /audit-log — clinician-only (require_role("clinician"))
  - Read-only: no UPDATE or DELETE on audit_events (enforced at DB level)
  - Viewing the audit log itself is logged to audit_events

Endpoints:
  - GET /api/audit-log — paginated audit log with filters
"""
import sys
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request

from auth import require_practice_member

sys.path.insert(0, "../shared")
from db import get_pool, log_audit_event

router = APIRouter()


@router.get("/audit-log")
async def list_audit_events(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=10, le=200),
    action: str | None = Query(None),
    resource_type: str | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    user: dict = Depends(require_practice_member("owner")),
):
    """List audit events with pagination and filtering. Owner only.

    Query parameters:
      - page: Page number (default 1)
      - per_page: Items per page (default 50, max 200)
      - action: Filter by action type (e.g., 'viewed', 'signed', 'updated')
      - resource_type: Filter by resource type (e.g., 'clinical_note', 'client')
      - start_date: Filter events after this ISO date
      - end_date: Filter events before this ISO date

    Returns paginated audit events with total count for pagination controls.
    """
    pool = await get_pool()

    # Build WHERE clause dynamically
    conditions = []
    params: list = []
    idx = 1

    if action:
        conditions.append(f"action = ${idx}")
        params.append(action)
        idx += 1

    if resource_type:
        conditions.append(f"resource_type = ${idx}")
        params.append(resource_type)
        idx += 1

    if start_date:
        conditions.append(f"created_at >= ${idx}::timestamptz")
        params.append(start_date)
        idx += 1

    if end_date:
        conditions.append(f"created_at <= ${idx}::timestamptz")
        params.append(end_date)
        idx += 1

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    # Get total count
    count_query = f"SELECT COUNT(*) FROM audit_events {where_clause}"
    total = await pool.fetchval(count_query, *params)

    # Fetch paginated results
    offset = (page - 1) * per_page
    data_query = f"""
        SELECT id, user_id, action, resource_type, resource_id,
               ip_address, user_agent, metadata, created_at
        FROM audit_events
        {where_clause}
        ORDER BY created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([per_page, offset])

    rows = await pool.fetch(data_query, *params)

    events = [
        {
            "id": str(r["id"]),
            "user_id": r["user_id"],
            "action": r["action"],
            "resource_type": r["resource_type"],
            "resource_id": r["resource_id"],
            "ip_address": r["ip_address"],
            "user_agent": r["user_agent"],
            "metadata": r["metadata"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]

    # Get distinct actions and resource types for filter dropdowns
    actions = await pool.fetch(
        "SELECT DISTINCT action FROM audit_events ORDER BY action"
    )
    resource_types = await pool.fetch(
        "SELECT DISTINCT resource_type FROM audit_events ORDER BY resource_type"
    )

    await log_audit_event(
        user_id=user["uid"],
        action="viewed",
        resource_type="audit_log",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata={"page": page, "filters": {
            "action": action,
            "resource_type": resource_type,
            "start_date": start_date,
            "end_date": end_date,
        }},
    )

    return {
        "events": events,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
        "filters": {
            "actions": [r["action"] for r in actions],
            "resource_types": [r["resource_type"] for r in resource_types],
        },
    }
