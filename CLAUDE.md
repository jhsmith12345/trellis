# Trellis — AI-Native Behavioral Health Platform

## Overview
Open-source EHR/RCM platform for solo behavioral health therapists. Automates the full workflow: client intake via AI voice agent → scheduling → session recording → note generation → billing document generation. Installs into the practice's own Google Workspace + GCP.

## GCP / Infrastructure
- **GCP Project:** `trellis-mvp` (org: hansmith.com)
- **Service Account:** `trellis-backend@trellis-mvp.iam.gserviceaccount.com`
- **SA Key:** `sa-key.json` (gitignored)
- **Cloud SQL:** `trellis-db` (PostgreSQL 15, db-f1-micro, us-central1) — IP `34.172.69.164`
- **Database:** `trellis`, user `postgres`
- **Firebase:** `trellis-mvp` project, Google + Email/Password auth enabled
- **Domain-wide delegation:** Gmail send, Calendar, Docs, Drive scopes
- **Workspace:** hansmith.com (Business Standard for Meet recording)

## Tech Stack
- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS v4 + React Router v7
- **Backend API:** Python 3.12 + FastAPI (port 8080)
- **Voice Relay:** Python 3.12 + FastAPI WebSocket (port 8081) — Gemini Live real-time voice
- **Database:** Cloud SQL PostgreSQL 15 with asyncpg
- **Auth:** Firebase Auth (JS SDK v11 frontend, firebase-admin backend)
- **AI:** Gemini Live (voice), Gemini 3 Flash (vision, compression, note generation)
- **Integrations:** Google Calendar, Meet, Docs, Drive, Gmail (all via service account delegation)

## Directory Layout
```
ehr/
├── frontend/              # React + Vite SPA
│   └── src/
│       ├── pages/         # Route-level page components
│       ├── components/    # Shared + feature components
│       ├── hooks/         # Custom React hooks (auth, API wrappers)
│       ├── templates/     # Document templates (consent forms, etc.)
│       └── lib/           # Firebase config, utilities
├── backend/
│   ├── api/               # FastAPI REST API
│   │   └── routes/        # Route modules (intake, documents, scheduling, clients)
│   ├── relay/             # Gemini Live voice relay (WebSocket)
│   └── shared/            # Shared Python: db.py, models.py, gcal.py, mailer.py, vision.py, alerts.py
├── db/migrations/         # Numbered SQL migration files
└── creation data/         # Planning docs, pitch deck
```

## Dev Commands
```bash
make install          # Install all dependencies
make dev-frontend     # Vite dev server on :5173
make dev-api          # API server on :8080
make dev-relay        # Voice relay on :8081
make dev              # Run all three
```

## Key Conventions
- Backend services are independent Python apps (not a shared virtualenv)
- Each service has its own `requirements.txt` and `Dockerfile`
- Frontend proxies `/api` to backend API and `/ws` to relay via Vite config
- Shared Python code in `backend/shared/` (db operations, models, integrations)
- Database migrations in `db/migrations/` as numbered SQL files
- `psql` is keg-only on this machine — use `/opt/homebrew/opt/libpq/bin/psql`
- Env vars loaded from `.env` files per service (frontend, api, relay)
- `DEV_MODE=1` in API `.env` bypasses JWT signature verification — never set in production

## Architecture Decisions

### Database Schema (4 migrations applied)
- **`encounters`** — universal transcript/interaction table. Types: intake, portal, clinical, group. Sources: voice, form, chat, clinician. JSONB `data` column for type-specific structured data. This is the AI context pipeline's source.
- **`clinical_notes`** — formal notes (SOAP/DAP/narrative) derived from encounters. Signing workflow: draft → review → signed → amended. FK to encounters.
- **`clients`** — central client profile. Firebase UID (unique), demographics, contact, address, emergency contact, insurance fields + extraction JSONB, status timestamps.
- **`document_packages` / `documents`** — onboarding paperwork bundles with e-signature. SHA-256 content hashing, signer IP/UA, stored signatures for one-click reuse.
- **`audit_events`** — append-only HIPAA audit log (no UPDATE/DELETE).
- **`clinician_availability` / `appointments`** — scheduling with Calendar event IDs, Meet links, recurrence support.
- **`recurring_groups` / group_enrollments / group_sessions / group_attendance`** — group therapy management.

### Voice Relay
- Intake-only. Audio is pass-through (browser ↔ Gemini), not recorded or stored.
- Gemini Live transcribes both sides in real-time.
- Context injection: prior transcripts loaded from encounters table. Raw if <50K tokens, compressed via Gemini 3 Flash if >50K.
- Mid-session compression at ~100K token estimate: pause, compress, reopen Gemini Live. Browser WebSocket stays open.
- Practice profile injection: accepted insurances, rates, clinician info loaded at session start.
- Gemini Live tool calling: `get_available_slots` and `book_appointment` tools. Relay intercepts tool calls and makes HTTP requests to API service.
- Booking confirmation emails sent to both clinician (with intake transcript) and client (with appointment details + Meet link).
- Firebase JWT verification via firebase-admin SDK (auth.py module).

### Email Sending
- Gmail API via service account domain-wide delegation
- Sender address configurable (currently needs to be a Workspace user on hansmith.com)

## HIPAA Technical Safeguards (Component 14)

### Access Controls (45 CFR 164.312(a))
- **Authentication:** Firebase Auth (Google + Email/Password). All API endpoints require valid Firebase JWT in Authorization header.
- **Role-based access:** Stored role on `users` table (clinician/client). `require_role()` middleware enforces role checks. `get_current_user_with_role()` resolves role for mixed endpoints.
- **Row-level access:** Clients can only access their own records. `enforce_client_owns_resource()` validates resource ownership. Appointment listing forces `client_id = user.uid` for non-clinicians.
- **Clinician-only routes:** Clinical notes, treatment plans, billing, audit log, client detail views, session recordings, AI assistant — all require `require_role("clinician")`.
- **Re-authentication:** Sensitive actions (signing notes, changing practice profile, discharging clients) require re-authentication via `useReauth` hook. 5-minute cache prevents excessive prompts.

### Session Security (45 CFR 164.312(a)(2)(iii))
- **Inactivity timeout:** 15-minute fixed timeout with 13-minute warning modal (`useSessionTimeout` hook). Tracks mouse, keyboard, touch, scroll events. Auto-logout clears Firebase auth and redirects to login.
- **Token expiry:** Firebase ID tokens expire after 1 hour. Frontend `getIdToken()` auto-refreshes. Backend verifies token on every request.
- **DEV_MODE bypass:** `DEV_MODE=1` skips JWT signature verification (dev only). Clearly logged as warning. Must be unset in production.

### Encryption (45 CFR 164.312(a)(2)(iv), 164.312(e))
- **At rest:** Cloud SQL PostgreSQL 15 uses Google-managed AES-256 encryption by default. All data on disk is encrypted transparently. No application-level configuration needed.
- **In transit:** Cloud Run enforces HTTPS-only with managed TLS certificates. Firebase Auth SDK uses TLS for all auth operations. Database connections use SSL (Cloud SQL Proxy or direct SSL). Vite dev proxy forwards to localhost services.
- **Voice relay:** WebSocket connections upgraded from HTTPS (wss:// in production). Audio data is pass-through to Gemini Live API (not stored). Gemini API connections use TLS.

### Audit Logging (45 CFR 164.312(b))
- **audit_events table:** Append-only (no UPDATE/DELETE operations). Records: user_id, action, resource_type, resource_id, ip_address, user_agent, metadata (JSONB), created_at.
- **Coverage:** All PHI reads and writes across all routes are logged. Actions include: viewed, listed, created, updated, signed, discharged, uploaded, generated, etc.
- **Audit log viewer:** Clinician-only page at `/settings/audit-log`. Paginated, filterable by action type, resource type, and date range. Read-only.
- **Request logging:** PHI-safe request logging middleware (`RequestLoggingMiddleware`) on both API and relay services. Logs: request ID, method, path, status, duration, client IP. Does NOT log: request/response bodies, query parameters, authorization values.

### PHI-Safe Logging (45 CFR 164.312(c))
- **Safe logging utility:** `backend/shared/safe_logging.py` provides `PHISafeFormatter` that redacts email addresses and other PHI patterns from log messages as a safety net.
- **No PHI in logs:** All `logger.*` calls audited. Client names, email addresses, insurance details, clinical content, and tool call arguments are excluded from application logs.
- **Request metadata only:** Request logging middleware logs operational metadata (method, path, status, duration, IP) without PHI.

### Data Integrity (45 CFR 164.312(c)(2))
- **Content hashing:** SHA-256 hashes computed on clinical note content and treatment plan content at signing time. Stored in `content_hash` column for integrity verification.
- **Signed document immutability:** Signed clinical notes cannot be edited (`status in (signed, amended)` blocks updates). Amendments create new records; originals are preserved. Document packages use SHA-256 content hashing.
- **Signer metadata:** Signature data (PNG), signer IP, user-agent, and timestamp stored for legal compliance on both clinical notes and consent documents.

### Backup & Recovery (45 CFR 164.308(a)(7))
- **Cloud SQL automated backups:** Enabled by default on Cloud SQL instances. Daily automated backups with 7-day retention. Point-in-time recovery (PITR) available within retention window.
- **WAL archiving:** Cloud SQL PostgreSQL uses WAL-based PITR for continuous protection.
- **Recovery:** Restore from automated backup or PITR via GCP Console or gcloud CLI.

### Deployment Security Checklist (Pre-Production)
- [ ] Remove `0.0.0.0/0` from Cloud SQL authorized networks — restrict to Cloud Run CIDR
- [ ] Ensure `DEV_MODE` is unset in all production environments
- [ ] Enable Cloud SQL SSL enforcement (`requireSsl: true`)
- [ ] Set `CRON_SECRET` to a strong random value for Cloud Scheduler endpoints
- [ ] Enable Cloud Run min-instances=0, max-instances=10 for cost control
- [ ] Configure Cloud Armor or equivalent WAF in front of Cloud Run
- [ ] Enable VPC Service Controls for Cloud SQL access
- [ ] Set up Cloud Monitoring alerts for failed auth attempts and 5xx errors

## Known Dev Gaps
- **Cloud SQL open to internet** — `0.0.0.0/0` authorized networks. Restrict before prod.
- **WebSocket auth** — relay now validates Firebase JWT signatures via firebase-admin SDK. DEV_MODE bypass available for local development.
- **No role-based routing** — client vs clinician destination based on auth modal mode, not stored role.
- **DashboardPage is a stub** — "Coming soon" placeholder.
- **BookingFlow requires manual clinician UID entry** — no clinician directory.
