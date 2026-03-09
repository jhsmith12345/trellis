"""FastAPI billing service for the Trellis platform.

Centralized multi-tenant service handling Stedi (claims, ERA, eligibility)
and Stripe Connect (patient payments). EHR installations call this service
via HTTPS with API key authentication.
"""
import logging
import re
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import ALLOWED_ORIGINS
from db import get_pool, close_pool
from routes.claims import router as claims_router
from routes.denials import router as denials_router
from routes.eligibility import router as eligibility_router
from routes.era import router as era_router
from routes.payments import router as payments_router
from routes.accounts import router as accounts_router
from routes.communications import router as communications_router
from routes.signup import router as signup_router

# ---------------------------------------------------------------------------
# PHI-safe logging (same pattern as EHR API)
# ---------------------------------------------------------------------------

def _redact_phi(message: str) -> str:
    """Redact potential PHI patterns from a log message."""
    message = re.sub(
        r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
        '[REDACTED_EMAIL]',
        message,
    )
    return message


class _PHISafeFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        if isinstance(record.msg, str):
            record.msg = _redact_phi(record.msg)
        return super().format(record)


def _configure_safe_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_PHISafeFormatter(
        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)


# Configure PHI-safe logging before any other operations
_configure_safe_logging()

logger = logging.getLogger("trellis.billing")


# ---------------------------------------------------------------------------
# Request logging middleware (same pattern as EHR API)
# ---------------------------------------------------------------------------

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware that logs request metadata without PHI."""

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = str(uuid.uuid4())[:8]
        start = time.monotonic()

        forwarded = request.headers.get("x-forwarded-for")
        client_ip = forwarded.split(",")[0].strip() if forwarded else (
            request.client.host if request.client else "unknown"
        )

        request.state.request_id = request_id

        access_logger = logging.getLogger("trellis.billing.access")

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.monotonic() - start) * 1000)
            access_logger.error(
                "req=%s method=%s path=%s status=500 duration=%dms ip=%s",
                request_id, request.method, request.url.path, duration_ms, client_ip,
            )
            raise

        duration_ms = round((time.monotonic() - start) * 1000)
        status = response.status_code
        if status >= 500:
            log_fn = access_logger.error
        elif status >= 400:
            log_fn = access_logger.warning
        else:
            log_fn = access_logger.info

        log_fn(
            "req=%s method=%s path=%s status=%d duration=%dms ip=%s",
            request_id, request.method, request.url.path, status, duration_ms, client_ip,
        )

        response.headers["X-Request-ID"] = request_id
        return response


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Trellis Billing Service", version="0.1.0")

app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(claims_router, prefix="/billing")
app.include_router(denials_router, prefix="/billing")
app.include_router(eligibility_router, prefix="/billing")
app.include_router(era_router, prefix="/billing")
app.include_router(payments_router, prefix="/billing")
app.include_router(accounts_router, prefix="/billing")
app.include_router(communications_router, prefix="/billing")
app.include_router(signup_router, prefix="/billing")


@app.on_event("startup")
async def startup():
    await get_pool()
    logger.info("Billing service started")


@app.on_event("shutdown")
async def shutdown():
    await close_pool()
    logger.info("Billing service stopped")


@app.get("/health")
def health():
    """Simple liveness probe (no dependency checks)."""
    return {"status": "ok", "service": "billing"}
