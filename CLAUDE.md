# Trellis — AI-Native Behavioral Health EHR

## My Deployment
<!-- Claude: Update this section as you complete each setup phase. This is the source of truth for this installation. -->

| Key | Value |
|-----|-------|
| GCP Project ID | _(not yet configured)_ |
| Region | _(not yet configured)_ |
| Cloud SQL IP | _(not yet configured)_ |
| DB Password | _(not yet configured)_ |
| Service Account | _(not yet configured)_ |
| Firebase Project | _(not yet configured)_ |
| Firebase API Key | _(not yet configured)_ |
| Firebase Auth Domain | _(not yet configured)_ |
| OAuth Client ID | _(not yet configured)_ |
| OAuth Redirect URI | _(not yet configured)_ |
| Encryption Key | _(not yet configured)_ |
| CRON Secret | _(not yet configured)_ |
| Cloud Run API URL | _(not yet configured)_ |
| Cloud Run Relay URL | _(not yet configured)_ |
| Cloud Run Frontend URL | _(not yet configured)_ |
| Custom Domain | _(not yet configured)_ |
| Workspace (telehealth) | _(yes/no — not yet configured)_ |

---

## Setup Instructions

When a user says "Set up Trellis" or similar, follow these phases in order. After completing each phase, update the "My Deployment" table above with any values you generated. Run commands directly where possible — ask the user only when you need manual steps (Console UI, copy-pasting config values, etc.).

**IMPORTANT — Assume the user is a non-technical clinician.** They are therapists, not developers. They will not understand .env files, YAML, JSON, or config syntax. Never ask them to manually edit any file. When you need values (Firebase config, OAuth secrets, etc.), ask them to paste the values into the terminal conversation. Then YOU create and write all config files silently. Keep explanations simple and jargon-free. If something fails, don't dump a stack trace — explain what went wrong in plain English and fix it.

### PHASE 0 — GCP CLI & Project
- Verify `gcloud` is installed: `gcloud --version`
- Authenticate if needed: `gcloud auth login` (opens browser — tell user to sign in with the same Google account they used for GCP Console)
- Set the active project: `gcloud config set project <PROJECT_ID>`
- Verify: `gcloud config get-value project`
- Update the "My Deployment" table with the project ID and region

### PHASE 1 — Enable APIs
```bash
gcloud services enable \
  sqladmin.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com \
  firebase.googleapis.com \
  calendar-json.googleapis.com \
  drive.googleapis.com \
  gmail.googleapis.com \
  docs.googleapis.com \
  speech.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com
```

### PHASE 2 — Cloud SQL Database
- Create instance:
```bash
gcloud sql instances create trellis-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --backup-start-time=03:00 \
  --backup-location=us
```
- Generate a strong DB password (random 24+ chars) and set it:
```bash
gcloud sql users set-password postgres --instance=trellis-db --password=<GENERATED_PASSWORD>
```
- Create the database:
```bash
gcloud sql databases create trellis --instance=trellis-db
```
- Get the instance IP:
```bash
gcloud sql instances describe trellis-db --format='value(ipAddresses[0].ipAddress)'
```
- Authorize the user's current IP for access:
```bash
MY_IP=$(curl -s ifconfig.me)
gcloud sql instances patch trellis-db --authorized-networks=$MY_IP/32
```
- Apply all migrations from `db/migrations/` in order (001 through 027):
```bash
for f in db/migrations/*.sql; do
  echo "Applying $f..."
  PGPASSWORD="<DB_PASSWORD>" psql "host=<CLOUD_SQL_IP> dbname=trellis user=postgres" -f "$f"
done
```
- Note: `psql` may be keg-only on macOS — try `PATH="/opt/homebrew/opt/libpq/bin:$PATH"` if not found
- Verify tables: `\dt` should show ~28 tables
- Update "My Deployment" table with DB IP and password

### PHASE 3 — Service Account
```bash
# Create
gcloud iam service-accounts create trellis-backend \
  --display-name="Trellis Backend"

# Grant roles
PROJECT_ID=$(gcloud config get-value project)
SA_EMAIL="trellis-backend@${PROJECT_ID}.iam.gserviceaccount.com"

for role in roles/cloudsql.client roles/aiplatform.user roles/run.admin roles/iam.serviceAccountTokenCreator roles/speech.client; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role"
done

# Download key (for local dev — Cloud Run uses workload identity)
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=$SA_EMAIL
```
- Verify `sa-key.json` is in `.gitignore`
- Update "My Deployment" table with SA email

### PHASE 4 — Firebase Authentication
- Add Firebase to the project:
```bash
firebase projects:addfirebase $(gcloud config get-value project)
```
- If `firebase` CLI isn't available, tell the user to go to https://console.firebase.google.com and add their project
- Tell the user to enable these sign-in providers in Firebase Console → Authentication → Sign-in method:
  - **Google** (required)
  - **Email/Password** (required)
- Walk the user through getting their Firebase web config from Firebase Console → Project Settings → Your apps → Web app:
  - They need: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`
- Update "My Deployment" table with Firebase config values

### PHASE 5 — Google OAuth (per-user account connection)
- Walk the user through creating an OAuth 2.0 Client ID:
  1. Go to GCP Console → APIs & Services → Credentials → Create Credentials → OAuth client ID
  2. Application type: **Web application**
  3. Name: "Trellis"
  4. Authorized redirect URIs: add `http://localhost:8080/api/google/callback` (for dev) and the Cloud Run API URL + `/api/google/callback` (for prod, add later)
  5. Copy the Client ID and Client Secret
- Generate a Fernet encryption key for OAuth token storage:
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```
- Update "My Deployment" table with OAuth Client ID and encryption key

### PHASE 6 — Environment Files
Generate any remaining secrets:
```bash
# CRON_SECRET
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Create `backend/api/.env`:
```
DATABASE_URL=postgresql://postgres:<DB_PASSWORD>@<CLOUD_SQL_IP>:5432/trellis
GCP_PROJECT_ID=<PROJECT_ID>
GOOGLE_APPLICATION_CREDENTIALS=<absolute path to sa-key.json>

GOOGLE_OAUTH_CLIENT_ID=<from Phase 5>
GOOGLE_OAUTH_CLIENT_SECRET=<from Phase 5>
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8080/api/google/callback
OAUTH_TOKEN_ENCRYPTION_KEY=<from Phase 5>
FRONTEND_BASE_URL=http://localhost:5173
CRON_SECRET=<generated above>
```
**DO NOT** add `DEV_MODE=1` — it bypasses JWT verification and must never be set in production.

Create `backend/relay/.env`:
```
DATABASE_URL=postgresql://postgres:<DB_PASSWORD>@<CLOUD_SQL_IP>:5432/trellis
GCP_PROJECT_ID=<PROJECT_ID>
GOOGLE_APPLICATION_CREDENTIALS=<absolute path to sa-key.json>
ALLOWED_ORIGINS=http://localhost:5173
```

Create `frontend/.env`:
```
VITE_FIREBASE_API_KEY=<from Phase 4>
VITE_FIREBASE_AUTH_DOMAIN=<PROJECT_ID>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<PROJECT_ID>
VITE_FIREBASE_STORAGE_BUCKET=<PROJECT_ID>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<from Phase 4>
VITE_FIREBASE_APP_ID=<from Phase 4>
```

### PHASE 7 — Local Verification
```bash
make install    # Install all dependencies
make dev        # Start API (8080), Relay (8081), Frontend (5173)
```
- Verify http://localhost:5173 loads the login page
- If anything fails, check logs and troubleshoot before proceeding

### PHASE 8 — Build & Deploy to Cloud Run
Build and deploy all 3 services. Use the service account for API and relay.

**API:**
```bash
gcloud run deploy trellis-api \
  --source=backend/api \
  --region=us-central1 \
  --allow-unauthenticated \
  --service-account=$SA_EMAIL \
  --add-cloudsql-instances=${PROJECT_ID}:us-central1:trellis-db \
  --memory=512Mi --cpu=1 --timeout=3600 \
  --min-instances=0 --max-instances=10 \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID},GOOGLE_OAUTH_CLIENT_ID=<id>,GOOGLE_OAUTH_CLIENT_SECRET=<secret>,GOOGLE_OAUTH_REDIRECT_URI=<prod redirect>,OAUTH_TOKEN_ENCRYPTION_KEY=<key>,FRONTEND_BASE_URL=<prod url>,ALLOWED_ORIGINS=<prod url>,CRON_SECRET=<secret>"
```

**Relay:**
```bash
gcloud run deploy trellis-relay \
  --source=backend/relay \
  --region=us-central1 \
  --allow-unauthenticated \
  --service-account=$SA_EMAIL \
  --add-cloudsql-instances=${PROJECT_ID}:us-central1:trellis-db \
  --memory=512Mi --cpu=1 --timeout=3600 \
  --min-instances=0 --max-instances=5 \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID},ALLOWED_ORIGINS=<prod url>"
```

**Frontend:**
```bash
gcloud run deploy trellis-frontend \
  --source=frontend \
  --region=us-central1 \
  --allow-unauthenticated \
  --memory=256Mi --cpu=0.5 --timeout=900 \
  --min-instances=0 --max-instances=3
```

- Note: Frontend needs `VITE_*` vars set as build args or in `.env.production` before building
- Record all three Cloud Run URLs in "My Deployment" table
- Update CORS origins and OAuth redirect URIs to use the production URLs

### PHASE 9 — Domain & SSL (optional)
- Ask the user: "Do you want a custom domain, or are the Cloud Run URLs fine?"
- If **no custom domain**: the Cloud Run URLs work as-is (they include free HTTPS). Just make sure OAuth redirect URI and CORS origins point to the Cloud Run frontend URL.
- If **custom domain**: set up a load balancer with URL map routing:
  - `/api/*` → trellis-api
  - `/ws/*` → trellis-relay
  - Default → trellis-frontend
  - Managed SSL certificate for the domain
  - HTTP → HTTPS redirect

### PHASE 10 — Domain-Wide Delegation (Workspace users only)
- Ask: "Do you use Google Workspace and want telehealth with Meet auto-recording?"
- If **no**: skip entirely — the in-app session recorder handles in-person sessions. Free Google accounts work fine.
- If **yes**:
  - Enable domain-wide delegation on the service account
  - Get the SA's unique/client ID: `gcloud iam service-accounts describe $SA_EMAIL --format='value(uniqueId)'`
  - Walk user through Google Workspace Admin Console → Security → API Controls → Domain-wide Delegation:
    - Add new client ID
    - Scopes: `https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents`
  - Update "My Deployment" table: Workspace = yes

### PHASE 11 — HIPAA BAA
- Walk the user through signing the Google Cloud BAA:
  1. GCP Console → select the **organization** (not project)
  2. Go to Cloud Overview → BAA section (or search "Business Associate Agreement")
  3. Review and sign
- Run through the Deployment Security Checklist (see below)

### PHASE 12 — Cloud Scheduler (CRON jobs)
```bash
# Appointment reconfirmation reminders (daily 9am)
gcloud scheduler jobs create http trellis-reconfirmation \
  --location=us-central1 \
  --schedule="0 9 * * *" \
  --uri="<API_URL>/api/cron/send-reconfirmations" \
  --http-method=POST \
  --headers="X-Cron-Secret=<CRON_SECRET>" \
  --time-zone="America/New_York"
```
- Only create Meet recording fetch job if Workspace/delegation is enabled (Phase 10)

### PHASE 12b — SMS Reminders (optional)
- Ask: "Would you like to enable text message appointment reminders?"
- If **yes**:
  - Tell the user to sign up at https://telnyx.com/sign-up
  - They need to: create an account, buy a phone number, and get their API key from the Telnyx dashboard
  - Once they have the API key and phone number, they can enter them in Trellis: Settings → Practice → SMS Reminders
  - Or paste the values into the terminal and you can call the API directly:
    ```bash
    curl -X PUT "<API_URL>/api/sms/settings" \
      -H "Authorization: Bearer <firebase_token>" \
      -H "Content-Type: application/json" \
      -d '{"telnyx_api_key": "<key>", "telnyx_from_number": "+15551234567", "sms_enabled": true}'
    ```
  - Create the SMS reminder cron job:
    ```bash
    gcloud scheduler jobs create http trellis-sms-reminders \
      --location=us-central1 \
      --schedule="0 9 * * *" \
      --uri="<API_URL>/api/cron/send-reminders" \
      --http-method=POST \
      --headers="X-Cron-Secret=<CRON_SECRET>" \
      --time-zone="America/New_York"
    ```
  - Send a test SMS from the settings page to verify it works
- If **no**: skip — email reminders still work without SMS

### PHASE 13 — Branding & Landing Page (optional)
Once Trellis is fully deployed and working, offer to customize the look and feel. This is a fun, creative step — take your time with it.

- Ask the user: "Would you like to customize Trellis with your practice's branding? You can share your website URL, a logo, or screenshots of designs you like."
- If they share a URL or images, use them as design inspiration
- **Safe files to edit for branding** (don't touch anything else during this phase):
  - `frontend/src/index.css` — Tailwind theme, CSS variables, colors, fonts
  - `frontend/src/components/LandingPage.tsx` — public-facing landing/marketing page
  - `frontend/src/components/ClinicianShell.tsx` — app shell header/sidebar (logo, practice name)
  - `frontend/src/components/ClientShell.tsx` — client portal shell
  - `frontend/public/` — logo files, favicon, Open Graph images
- Iterate with the user — show them what you changed, ask for feedback, refine. This is a back-and-forth design process.
- Keep the core UI layout and functionality intact — only change colors, fonts, logos, and the landing page content
- If the user wants to revert, `git checkout` will restore everything instantly

**Note:** This step can use more API credits than the infrastructure phases since design is iterative. If the user is on a subscription plan, let them know they can always come back to this in a future session.

### Final Step
Do a final update to the "My Deployment" table with all values. Confirm everything is filled in. The user now has a fully deployed Trellis instance and this CLAUDE.md serves as the complete reference for any future Claude Code session.

---

## Overview
Open-source EHR/RCM platform for solo behavioral health therapists. Automates the full workflow: client intake via AI voice agent → scheduling → session recording → note generation → billing document generation. Works with any Google account; Google Workspace only required for telehealth/Meet auto-recording.

## Tech Stack
- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS v4 + React Router v7
- **Backend API:** Python 3.12 + FastAPI (port 8080)
- **Voice Relay:** Python 3.12 + FastAPI WebSocket (port 8081) — Gemini Live real-time voice
- **Database:** Cloud SQL PostgreSQL 15 with asyncpg
- **Auth:** Firebase Auth (JS SDK v11 frontend, firebase-admin backend)
- **AI:** Gemini Live (voice), Gemini 2.5 Flash (vision, compression, note generation)
- **Integrations:** Google Calendar, Meet, Docs, Drive, Gmail (per-user OAuth, SA delegation fallback)

## Directory Layout
```
trellis-ehr/
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
├── db/migrations/         # Numbered SQL migration files (001-027)
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

## CLI Access
You have permission to use `gcloud` and `firebase` CLIs directly. The user should already be authenticated via `gcloud auth login` (Phase 0).

### Database (Cloud SQL)
```bash
# Connect to the database (use values from "My Deployment" table)
PGPASSWORD="<DB_PASSWORD>" psql "host=<CLOUD_SQL_IP> dbname=trellis user=postgres"
```
Note: `psql` may be keg-only on macOS — use `PATH="/opt/homebrew/opt/libpq/bin:$PATH"` if not found.

### Firebase Auth (via gcloud REST API)
```bash
ACCESS_TOKEN=$(gcloud auth print-access-token)
PROJECT_ID=$(gcloud config get-value project)

# List all Firebase Auth users
curl -s "https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=100" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID"
```

## Key Conventions
- Backend services are independent Python apps (not a shared virtualenv)
- Each service has its own `requirements.txt` and `Dockerfile`
- Frontend proxies `/api` to backend API and `/ws` to relay via Vite config
- Shared Python code in `backend/shared/` (db operations, models, integrations)
- Database migrations in `db/migrations/` as numbered SQL files
- Env vars loaded from `.env` files per service (frontend, api, relay)
- `DEV_MODE=1` bypasses JWT verification — **never set in production**

## Architecture Decisions

### Database Schema (27 migrations)
- **`encounters`** — universal transcript/interaction table. Types: intake, portal, clinical, group. JSONB `data` column for type-specific structured data.
- **`clinical_notes`** — formal notes (SOAP/DAP/narrative) derived from encounters. Signing workflow: draft → review → signed → amended.
- **`clients`** — central client profile. Firebase UID, demographics, contact, insurance fields.
- **`document_packages` / `documents`** — onboarding paperwork with e-signature. SHA-256 content hashing.
- **`audit_events`** — append-only HIPAA audit log (no UPDATE/DELETE).
- **`clinician_availability` / `appointments`** — scheduling with Calendar event IDs, Meet links, recurrence.
- **`recurring_groups` / group_enrollments / group_sessions / group_attendance`** — group therapy.

### Voice Relay
- Intake-only. Audio is pass-through (browser ↔ Gemini), not recorded or stored.
- Gemini Live transcribes both sides in real-time.
- Context injection: prior transcripts loaded from encounters table. Raw if <50K tokens, compressed via Gemini Flash if >50K.
- Mid-session compression at ~100K tokens: pause, compress, reopen Gemini Live. Browser WebSocket stays open.
- Gemini Live tool calling: `get_available_slots` and `book_appointment` tools.

### Email Sending
- Gmail API via per-user OAuth or service account domain-wide delegation (Workspace only)
- Sender address: the clinician's connected Google email, or a delegated Workspace address

### asyncpg JSONB Pattern
- Must configure JSONB codec on pool init (`_init_connection` in db.py)
- Without codec, asyncpg returns JSONB as strings, not dicts

## HIPAA Technical Safeguards

### Access Controls (45 CFR 164.312(a))
- Firebase Auth (Google + Email/Password). All API endpoints require valid Firebase JWT.
- Role-based access: `users.role` (clinician/client). `require_role()` middleware.
- Row-level access: Clients can only access their own records.
- Re-authentication: Sensitive actions require re-auth via `useReauth` hook (5-min cache).

### Session Security (45 CFR 164.312(a)(2)(iii))
- 15-minute inactivity timeout with 13-minute warning modal.
- Firebase ID tokens expire after 1 hour with auto-refresh.

### Encryption (45 CFR 164.312(a)(2)(iv), 164.312(e))
- At rest: Cloud SQL AES-256 (Google-managed).
- In transit: Cloud Run HTTPS, Firebase TLS, Cloud SQL SSL.
- OAuth tokens: Fernet encryption at rest in DB.

### Audit Logging (45 CFR 164.312(b))
- `audit_events` table: append-only, records all PHI access.
- PHI-safe logging: `backend/shared/safe_logging.py` redacts PHI from application logs.
- Request logging: method, path, status, duration, IP — no bodies or auth values.

### Data Integrity (45 CFR 164.312(c)(2))
- SHA-256 content hashing on signed clinical notes and documents.
- Signed notes are immutable; amendments create new records.

### Backup & Recovery (45 CFR 164.308(a)(7))
- Cloud SQL automated daily backups with 7-day retention and PITR.

### Deployment Security Checklist
- [ ] Remove `0.0.0.0/0` from Cloud SQL — restrict to Cloud Run + user IP
- [ ] Ensure `DEV_MODE` is unset in all production environments
- [ ] Enable Cloud SQL SSL enforcement (`requireSsl: true`)
- [ ] `CRON_SECRET` set to a strong random value
- [ ] Cloud Run min-instances=0, max-instances=10
- [ ] Configure Cloud Armor WAF in front of Cloud Run
- [ ] Set up Cloud Monitoring alerts for failed auth and 5xx errors
