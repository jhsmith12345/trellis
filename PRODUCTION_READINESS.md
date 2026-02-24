# Trellis EHR — Production Readiness Report

Generated after full code audit, cleanup, and test suite creation (2026-02-23).

---

## Audit Summary

### What Was Done

| Phase | Description | Result |
|-------|-------------|--------|
| 0A: Frontend Build | TypeScript + Vite build verification | 1 unused import fixed |
| 0B: Backend API | Python import/dependency verification | Clean — no fixes needed |
| 0C: Backend Relay | Python import/dependency verification | 2 fixes (dep version pin, sys.path hardening) |
| 1D: Backend Cross-Module | Function signatures, DB schema, generator/mailer/gcal integration | 2 CHECK constraint bugs fixed, migration 011 created |
| 1E: Frontend Cross-Module | API URLs, response types, component props, naming | 9 type/API/naming fixes |
| 2F: Runtime Smoke Test | Start services, hit all endpoints | 3 runtime bugs fixed, 21/21 endpoints passing |
| 3: Backend Tests | pytest suite with 130+ tests across 21 files | Created, partially stabilized |
| 4: E2E Tests | Playwright suite with 21 spec files | Created, needs auth fixture tuning |
| 5: Makefile | test-build, test-backend, test-e2e targets | Done |

### Bugs Found & Fixed During Audit

#### Critical (would crash at runtime)
1. **asyncpg JSONB codec missing** — JSONB columns returned as strings, not dicts. Every endpoint that reads structured data from `encounters.data`, `clinical_notes.content`, etc. would crash with `AttributeError: 'str' object has no attribute 'get'`. Fixed by adding JSON codec to connection pool init in `db.py`.

2. **`encounters.status` CHECK violation in discharge** — `status="completed"` passed but schema requires `"complete"`. Every discharge attempt would fail with a PostgreSQL error. Fixed in `routes/clients.py`.

3. **`clinical_notes.format` CHECK violation** — `format='discharge'` not in original constraint `('SOAP','DAP','narrative')`. Discharge note creation would fail. Fixed with migration 011.

4. **asyncpg datetime type errors** — Raw ISO strings passed as `timestamptz` parameters. Scheduling endpoints would crash. Fixed by adding `datetime.fromisoformat()` conversion in 5 db.py functions.

#### High (wrong behavior)
5. **Stale GCP project defaults** — `config.py` defaults pointed to decommissioned project `automations-486317`. Both API and relay configs fixed to default to `trellis-mvp`.

6. **Stale DB defaults** — DB name/user defaulted to `ehr`/`ehr` instead of `trellis`/`postgres`. Fixed in API config.

7. **Frontend type mismatches** — `Appointment.type` missing `"individual_extended"`, `status` missing `"released"`, `ClientProfile` missing `status`/`discharged_at`, `BookingFlow` missing `cadence` parameter. All fixed in `types.ts` and components.

8. **"Stages of Recovery" branding** — 2 occurrences in `alerts.py` email templates. Fixed to "Trellis".

#### Low (code quality)
9. **Relay `sys.path` fragility** — Relative `"../shared"` paths break outside Makefile context. Fixed with absolute `pathlib`-based resolution.

10. **Dependency version pin conflict** — `google-auth==2.36.0` incompatible with `google-genai>=1.56.0`. Fixed to `>=2.36.0`.

11. **Unused imports** — `NoteSigningModal` in `TreatmentPlanEditorPage.tsx`, `CPT_DESCRIPTIONS` in `notes.py`. Removed/noted.

---

## What You Need To Do For Production

### 1. Apply Migration 011 (5 minutes)

Migration 011 was created but not applied to the database:

```bash
/opt/homebrew/opt/libpq/bin/psql "postgresql://postgres:<password>@34.172.69.164/trellis" \
  -f db/migrations/011_discharge_note_format.sql
```

### 2. Cloud SQL Security (30 minutes)

**Current state:** `0.0.0.0/0` authorized networks — the database is open to the internet.

```bash
# Remove public access
gcloud sql instances patch trellis-db \
  --authorized-networks="" \
  --project=trellis-mvp

# If using Cloud Run, enable private IP or Cloud SQL Auth Proxy
# Option A: Private IP (requires VPC connector on Cloud Run)
gcloud sql instances patch trellis-db \
  --network=default \
  --project=trellis-mvp

# Option B: Cloud SQL Auth Proxy (built into Cloud Run)
# Just use the connection name in DATABASE_URL and let Cloud Run handle it

# Enable SSL enforcement
gcloud sql instances patch trellis-db \
  --require-ssl \
  --project=trellis-mvp
```

### 3. Environment Variables for Production (15 minutes)

**API service** — must set in Cloud Run:
```
DATABASE_URL=           # Cloud SQL connection string (or use proxy)
GCP_PROJECT_ID=trellis-mvp
GOOGLE_APPLICATION_CREDENTIALS=  # Not needed on Cloud Run (uses default SA)
ALLOWED_ORIGINS=https://your-domain.com
CRON_SECRET=<generate-random-64-char>
# DO NOT set DEV_MODE
```

**Relay service** — must set in Cloud Run:
```
DATABASE_URL=           # Same Cloud SQL connection
GCP_PROJECT_ID=trellis-mvp
API_BASE_URL=https://api-service-url.run.app
ALLOWED_ORIGINS=https://your-domain.com
# DO NOT set DEV_MODE
```

**Frontend** — build args for Dockerfile:
```
VITE_FIREBASE_API_KEY=<from Firebase console>
VITE_FIREBASE_AUTH_DOMAIN=trellis-mvp.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=trellis-mvp
VITE_FIREBASE_STORAGE_BUCKET=trellis-mvp.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<from Firebase console>
VITE_FIREBASE_APP_ID=<from Firebase console>
```

### 4. Cloud Run Deployment (45 minutes)

All three Dockerfiles are production-ready. Deploy each:

```bash
# Build and deploy API
gcloud builds submit --tag gcr.io/trellis-mvp/trellis-api backend/
gcloud run deploy trellis-api \
  --image gcr.io/trellis-mvp/trellis-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances trellis-mvp:us-central1:trellis-db \
  --min-instances 0 \
  --max-instances 10 \
  --memory 512Mi \
  --set-env-vars "GCP_PROJECT_ID=trellis-mvp,ALLOWED_ORIGINS=https://your-domain.com,CRON_SECRET=<secret>"

# Build and deploy Relay
gcloud builds submit --tag gcr.io/trellis-mvp/trellis-relay backend/
gcloud run deploy trellis-relay \
  --image gcr.io/trellis-mvp/trellis-relay \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances trellis-mvp:us-central1:trellis-db \
  --min-instances 0 \
  --max-instances 5 \
  --memory 512Mi \
  --timeout 3600 \
  --set-env-vars "GCP_PROJECT_ID=trellis-mvp,API_BASE_URL=<api-service-url>"

# Build and deploy Frontend
gcloud builds submit --tag gcr.io/trellis-mvp/trellis-frontend frontend/ \
  --build-arg VITE_FIREBASE_API_KEY=<key> \
  --build-arg VITE_FIREBASE_AUTH_DOMAIN=trellis-mvp.firebaseapp.com \
  --build-arg VITE_FIREBASE_PROJECT_ID=trellis-mvp
gcloud run deploy trellis-frontend \
  --image gcr.io/trellis-mvp/trellis-frontend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --memory 256Mi
```

### 5. Domain & Load Balancer (30 minutes)

The frontend needs a load balancer to:
- Route `/api/*` to the API Cloud Run service
- Route `/ws/*` to the Relay Cloud Run service
- Route everything else to the Frontend Cloud Run service
- Terminate TLS with a managed certificate

```bash
# Create serverless NEGs for each service
gcloud compute network-endpoint-groups create trellis-api-neg \
  --region=us-central1 --network-endpoint-type=serverless \
  --cloud-run-service=trellis-api

gcloud compute network-endpoint-groups create trellis-relay-neg \
  --region=us-central1 --network-endpoint-type=serverless \
  --cloud-run-service=trellis-relay

gcloud compute network-endpoint-groups create trellis-frontend-neg \
  --region=us-central1 --network-endpoint-type=serverless \
  --cloud-run-service=trellis-frontend

# Then set up URL map, backend services, SSL cert, and forwarding rule
# (Use GCP Console for this — it's easier for the URL map routing rules)
```

### 6. Firebase Auth Production Config (15 minutes)

- [ ] Add your production domain to Firebase Auth > Settings > Authorized domains
- [ ] Enable only the auth providers you want (currently Google + Email/Password)
- [ ] Set up email templates in Firebase Console (password reset, email verification)
- [ ] Consider enabling email enumeration protection

### 7. CRON Jobs (15 minutes)

Several endpoints are designed for Cloud Scheduler:
- Reconfirmation reminders
- Appointment status updates

```bash
# Create Cloud Scheduler jobs
gcloud scheduler jobs create http trellis-reconfirmation \
  --schedule="0 9 * * *" \
  --uri="https://api-service-url/api/cron/send-reconfirmations" \
  --http-method=POST \
  --headers="X-Cron-Secret=<your-cron-secret>" \
  --time-zone="America/New_York"
```

### 8. Monitoring & Alerting (30 minutes)

- [ ] Set up Cloud Monitoring alerts for:
  - 5xx error rate > 1% over 5 minutes
  - Latency p99 > 5 seconds
  - Cloud SQL CPU > 80%
  - Cloud SQL storage > 80%
- [ ] Set up Cloud Logging sinks for audit trail retention (HIPAA requires 6 years)
- [ ] Enable Cloud Run request logging
- [ ] Set up uptime checks for `/api/health`

### 9. Backup Verification (15 minutes)

Cloud SQL automated backups should already be enabled, but verify:

```bash
gcloud sql instances describe trellis-db --format="value(settings.backupConfiguration)" --project=trellis-mvp
```

Ensure:
- Automated backups enabled
- PITR (point-in-time recovery) enabled
- Retention: at least 7 days (30 recommended for HIPAA)

---

## Security Checklist (Pre-Production)

| # | Item | Status | Priority |
|---|------|--------|----------|
| 1 | Remove `0.0.0.0/0` from Cloud SQL authorized networks | NOT DONE | **CRITICAL** |
| 2 | Ensure `DEV_MODE` is unset in production envs | NOT DONE | **CRITICAL** |
| 3 | Enable Cloud SQL SSL enforcement (`requireSsl: true`) | NOT DONE | HIGH |
| 4 | Set `CRON_SECRET` to strong random value | NOT DONE | HIGH |
| 5 | Set `ALLOWED_ORIGINS` to production domain only | NOT DONE | HIGH |
| 6 | Cloud Run max-instances limits for cost control | NOT DONE | MEDIUM |
| 7 | Cloud Armor / WAF in front of Cloud Run | NOT DONE | MEDIUM |
| 8 | VPC Service Controls for Cloud SQL | NOT DONE | MEDIUM |
| 9 | Cloud Monitoring alerts for auth failures + 5xx | NOT DONE | MEDIUM |
| 10 | Remove `sa-key.json` from any deployed artifacts | VERIFIED | OK |
| 11 | Verify `.gitignore` excludes `.env`, `sa-key.json` | VERIFIED | OK |

---

## Test Suite Status

### Backend (pytest)
- **Location:** `tests/backend/`
- **Files:** 21 test files + `conftest.py`
- **Tests:** ~130 tests covering all 12 route modules
- **Run:** `make test-backend` or `cd backend/api && python -m pytest ../../tests/backend/ -v`
- **Status:** Tests written, some need mock tuning (scheduling, notes, treatment plans rely on complex GCP mock setup). Auth, practice, intake, clients, documents tests pass.
- **Known issue:** The conftest needs to properly reset the DB connection pool between test runs since the JSONB codec is now configured on pool init.

### E2E (Playwright)
- **Location:** `tests/e2e/`
- **Files:** 21 spec files + auth fixture
- **Config:** `frontend/playwright.config.ts`
- **Run:** `make test-e2e` or `cd frontend && npx playwright test`
- **Status:** **81 passed, 7 skipped, 0 failed** (1.7 minutes)
- **Auth:** Real Firebase accounts (`e2e-clinician@test.trellis.dev`, `e2e-client@test.trellis.dev`) automated through the UI's AuthModal
- **Skipped tests:** Require specific DB state (existing notes, treatment plans, document packages) or long waits (session timeout). Each skip is documented.

### Build Verification
- **Run:** `make test-build`
- **Status:** Passes clean (TypeScript, Vite build, Python imports all verified)

---

## Known Functional Gaps

These are features not yet built (documented in CLAUDE.md "Known Dev Gaps"):

1. **DashboardPage is a stub** — shows "Coming soon" placeholder, not real metrics
2. **BookingFlow requires manual clinician UID** — no clinician directory/lookup
3. **No role-based routing** — client vs clinician destination is mode-based, not stored role
4. **Group therapy backend** — Frontend has group management UI but no backend API endpoints
5. **`requireReauth` hook unused** — signing modals handle re-auth inline instead
6. **No email verification** — Firebase accounts created without email verification step

---

## Recommended Production Launch Order

1. Apply migration 011
2. Lock down Cloud SQL (remove `0.0.0.0/0`, enable SSL)
3. Deploy API service to Cloud Run (with proper env vars, NO `DEV_MODE`)
4. Deploy Relay service to Cloud Run
5. Deploy Frontend to Cloud Run
6. Set up load balancer with URL routing + TLS cert
7. Add production domain to Firebase authorized domains
8. Set up Cloud Scheduler cron jobs
9. Set up monitoring and alerting
10. Verify backups and retention
11. Manual smoke test of full workflow: signup → intake → booking → session → note → billing
12. Go live
