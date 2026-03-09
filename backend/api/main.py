"""FastAPI backend for the Trellis EHR platform."""
import sys
from pathlib import Path as _Path

# Add shared module path BEFORE importing routes (works locally and in Docker)
_here = _Path(__file__).resolve().parent
sys.path.insert(0, str(_here / "shared"))          # Docker: /app/shared
sys.path.insert(0, str(_here.parent / "shared"))  # local dev: backend/shared

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import ALLOWED_ORIGINS
from db import close_pool
from request_logging import RequestLoggingMiddleware
from safe_logging import configure_safe_logging
from routes.intake import router as intake_router
from routes.documents import router as documents_router
from routes.scheduling import router as scheduling_router
from routes.clients import router as clients_router
from routes.practice import router as practice_router
from routes.sessions import router as sessions_router
from routes.notes import router as notes_router
from routes.assistant import router as assistant_router
from routes.treatment_plans import router as treatment_plans_router
from routes.billing import router as billing_router
from routes.authorizations import router as authorizations_router
from routes.credentialing import router as credentialing_router
from routes.audit import router as audit_router
from routes.health import router as health_router
from routes.google_oauth import router as google_oauth_router

# Configure PHI-safe logging before any other operations
configure_safe_logging()

app = FastAPI(title="Trellis EHR API", version="0.1.0")

# PHI-safe request logging middleware (logs method, path, status, duration — no PHI)
app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(intake_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(scheduling_router, prefix="/api")
app.include_router(clients_router, prefix="/api")
app.include_router(practice_router, prefix="/api")
app.include_router(sessions_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
app.include_router(assistant_router, prefix="/api")
app.include_router(treatment_plans_router, prefix="/api")
app.include_router(billing_router, prefix="/api")
app.include_router(authorizations_router, prefix="/api")
app.include_router(credentialing_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(health_router, prefix="/api")
app.include_router(google_oauth_router, prefix="/api")


@app.on_event("shutdown")
async def shutdown():
    await close_pool()


@app.get("/health")
def health():
    """Simple liveness probe (no dependency checks)."""
    return {"status": "ok"}
