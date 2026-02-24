# Trellis Setup Guide

Complete guide for deploying Trellis into your own GCP project and Google Workspace.

**Recommended:** Use the [Setup Wizard](wizard/index.html) for a guided, step-by-step experience. The wizard collects your configuration and generates a deployment script automatically.

This document covers the same steps for those who prefer a manual approach or need reference documentation.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Create GCP Project](#1-create-gcp-project)
3. [Sign BAA](#2-sign-business-associate-agreements)
4. [Enable APIs](#3-enable-required-apis)
5. [Create Service Account](#4-create-service-account)
6. [Domain-Wide Delegation](#5-enable-domain-wide-delegation)
7. [Configure Firebase Auth](#6-configure-firebase-auth)
8. [Set Up Cloud SQL](#7-set-up-cloud-sql)
9. [Deploy Services](#8-deploy-services)
10. [Configure Cloud Scheduler](#9-configure-cloud-scheduler)
11. [Custom Domain](#10-custom-domain--dns)
12. [Post-Deployment](#11-post-deployment-steps)
13. [Verify Installation](#12-verify-installation)
14. [First Login](#13-first-login--onboarding)
15. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Google Workspace**: Business Standard or higher (required for Meet recording and BAA)
- **Google Cloud account**: With billing enabled
- **Custom domain**: A domain you control (e.g., `app.yourpractice.com`)
- **gcloud CLI**: [Install](https://cloud.google.com/sdk/docs/install) and authenticate with `gcloud auth login`
- **Docker**: [Install](https://docs.docker.com/get-docker/) (for building container images locally, or use Cloud Build)
- **psql**: PostgreSQL client for running migrations (optional if using Cloud Shell)

**Estimated time:** 30-45 minutes

---

## 1. Create GCP Project

1. Go to [Google Cloud Console - Create Project](https://console.cloud.google.com/projectcreate).
2. Enter a project name (e.g., `trellis-yourpractice`).
3. Note the **Project ID** (lowercase, hyphens allowed).
4. Select your Google Workspace organization as the parent.
5. Click **Create**.

Enable billing:
1. Go to [Billing Console](https://console.cloud.google.com/billing).
2. Link a billing account to your new project.

Set your project as active:
```bash
gcloud config set project YOUR_PROJECT_ID
```

---

## 2. Sign Business Associate Agreements

HIPAA requires a BAA with Google before storing any patient data.

### Google Workspace BAA
1. Go to [Admin Console - Compliance](https://admin.google.com/ac/compliancecontrols).
2. Find "Google Workspace/Cloud Identity HIPAA BAA" and accept it.

### Google Cloud BAA
1. Go to [IAM & Admin - Settings](https://console.cloud.google.com/iam-admin/settings) in your project.
2. Accept the Google Cloud BAA.
3. Alternatively, visit the [Cloud BAA page](https://cloud.google.com/terms/baa).

---

## 3. Enable Required APIs

Run this command in Cloud Shell or your terminal:

```bash
gcloud services enable \
  sqladmin.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  firebase.googleapis.com \
  calendar-json.googleapis.com \
  drive.googleapis.com \
  gmail.googleapis.com \
  docs.googleapis.com \
  speech.googleapis.com \
  aiplatform.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  --project=YOUR_PROJECT_ID
```

**APIs enabled:**

| API | Purpose |
|-----|---------|
| Cloud SQL Admin | Database management |
| Cloud Run | Service hosting |
| Cloud Build | Container builds |
| Firebase | User authentication |
| Calendar | Appointment scheduling, Meet links |
| Drive | Recording storage, file management |
| Gmail | Email sending (confirmations, reminders) |
| Docs | Document generation |
| Speech-to-Text | Session transcription |
| Vertex AI | AI note generation, voice agent |
| Cloud Scheduler | Cron jobs |
| Secret Manager | Secure credential storage |

---

## 4. Create Service Account

The service account allows Trellis to access Google APIs on behalf of your Workspace user.

```bash
SA_NAME="trellis-backend"
PROJECT_ID="YOUR_PROJECT_ID"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Create service account
gcloud iam service-accounts create ${SA_NAME} \
  --display-name="Trellis Backend" \
  --project=${PROJECT_ID}

# Grant required roles
for role in \
  roles/cloudsql.client \
  roles/aiplatform.user \
  roles/run.admin \
  roles/iam.serviceAccountTokenCreator \
  roles/speech.client; do
  gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${role}"
done

# Download key file
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=${SA_EMAIL}
```

**Keep `sa-key.json` secure.** Never commit it to git. It will be uploaded to Secret Manager during deployment.

---

## 5. Enable Domain-Wide Delegation

Domain-wide delegation allows the service account to act on behalf of a Workspace user (sending emails, managing calendars, etc.).

### Enable on Service Account
1. Go to [IAM - Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts).
2. Click on the `trellis-backend` service account.
3. Under **Details**, expand **Advanced settings**.
4. Note the **Client ID** (numeric string).
5. Check **"Enable Google Workspace Domain-wide Delegation"** and save.

### Configure in Admin Console
1. Go to [Admin Console - Domain-wide Delegation](https://admin.google.com/ac/owl/domainwidedelegation).
2. Click **Add new**.
3. Enter the Client ID from step 4 above.
4. Add these OAuth scopes (comma-separated):

```
https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents
```

5. Click **Authorize**.

---

## 6. Configure Firebase Auth

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and select your GCP project.
3. Go to **Authentication** > **Sign-in method**.
4. Enable **Google** provider (set public-facing name to your practice name).
5. Enable **Email/Password** provider.
6. Go to **Project Settings** > **General**.
7. Scroll to "Your apps" and click the Web icon (`</>`) to register a web app.
8. Note the Firebase config values:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`

These values are needed for the frontend build.

---

## 7. Set Up Cloud SQL

```bash
PROJECT_ID="YOUR_PROJECT_ID"
REGION="us-central1"
DB_INSTANCE="trellis-db"
DB_NAME="trellis"
DB_USER="trellis"
DB_PASSWORD="YOUR_SECURE_PASSWORD"  # Generate a strong password

# Create instance (takes 5-10 minutes)
gcloud sql instances create ${DB_INSTANCE} \
  --project=${PROJECT_ID} \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=${REGION} \
  --storage-type=SSD \
  --storage-size=10GB \
  --storage-auto-increase \
  --backup \
  --backup-start-time=04:00 \
  --enable-point-in-time-recovery \
  --availability-type=zonal

# Create database
gcloud sql databases create ${DB_NAME} \
  --instance=${DB_INSTANCE} \
  --project=${PROJECT_ID}

# Create user
gcloud sql users create ${DB_USER} \
  --instance=${DB_INSTANCE} \
  --project=${PROJECT_ID} \
  --password=${DB_PASSWORD}
```

### Run Migrations

Temporarily authorize your IP to connect directly:

```bash
MY_IP=$(curl -s https://api.ipify.org)
gcloud sql instances patch ${DB_INSTANCE} \
  --project=${PROJECT_ID} \
  --authorized-networks="${MY_IP}/32" \
  --quiet

DB_IP=$(gcloud sql instances describe ${DB_INSTANCE} \
  --project=${PROJECT_ID} --format="value(ipAddresses[0].ipAddress)")

# Run all migrations
export PGPASSWORD=${DB_PASSWORD}
for f in db/migrations/*.sql; do
  echo "Applying $(basename $f)..."
  psql -h ${DB_IP} -U ${DB_USER} -d ${DB_NAME} -f "$f"
done
unset PGPASSWORD

# Remove temporary network access
gcloud sql instances patch ${DB_INSTANCE} \
  --project=${PROJECT_ID} \
  --clear-authorized-networks \
  --quiet
```

---

## 8. Deploy Services

Trellis consists of three Cloud Run services:

| Service | Description | Port |
|---------|-------------|------|
| `trellis-api` | FastAPI REST API | 8080 |
| `trellis-relay` | Gemini Live voice relay (WebSocket) | 8080 |
| `trellis-frontend` | React SPA (nginx) | 8080 |

### Store SA Key as Secret

```bash
gcloud secrets create sa-key \
  --project=${PROJECT_ID} \
  --replication-policy=automatic

gcloud secrets versions add sa-key \
  --project=${PROJECT_ID} \
  --data-file=sa-key.json

gcloud secrets add-iam-policy-binding sa-key \
  --project=${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

### Create Artifact Registry Repository

```bash
gcloud artifacts repositories create trellis \
  --project=${PROJECT_ID} \
  --location=${REGION} \
  --repository-format=docker
```

### Get Connection Name

```bash
DB_CONNECTION_NAME=$(gcloud sql instances describe ${DB_INSTANCE} \
  --project=${PROJECT_ID} --format="value(connectionName)")
```

### Deploy API

```bash
# Build
gcloud builds submit \
  --project=${PROJECT_ID} \
  --tag="${REGION}-docker.pkg.dev/${PROJECT_ID}/trellis/api:latest" \
  -f backend/api/Dockerfile \
  backend/

# Deploy
gcloud run deploy trellis-api \
  --project=${PROJECT_ID} \
  --region=${REGION} \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/trellis/api:latest" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --service-account=${SA_EMAIL} \
  --set-secrets="/app/sa-key.json=sa-key:latest" \
  --set-env-vars="\
GCP_PROJECT_ID=${PROJECT_ID},\
GCP_REGION=${REGION},\
DB_CONNECTION_NAME=${DB_CONNECTION_NAME},\
DB_NAME=${DB_NAME},\
DB_USER=${DB_USER},\
DB_PASSWORD=${DB_PASSWORD},\
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${DB_CONNECTION_NAME},\
SENDER_EMAIL=YOUR_SENDER_EMAIL,\
GOOGLE_APPLICATION_CREDENTIALS=/app/sa-key.json,\
CRON_SECRET=YOUR_CRON_SECRET,\
ALLOWED_ORIGINS=https://YOUR_DOMAIN" \
  --add-cloudsql-instances=${DB_CONNECTION_NAME}

API_URL=$(gcloud run services describe trellis-api \
  --project=${PROJECT_ID} --region=${REGION} \
  --format="value(status.url)")
```

### Deploy Relay

```bash
# Build
gcloud builds submit \
  --project=${PROJECT_ID} \
  --tag="${REGION}-docker.pkg.dev/${PROJECT_ID}/trellis/relay:latest" \
  -f backend/relay/Dockerfile \
  backend/

# Deploy
gcloud run deploy trellis-relay \
  --project=${PROJECT_ID} \
  --region=${REGION} \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/trellis/relay:latest" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5 \
  --timeout=3600 \
  --service-account=${SA_EMAIL} \
  --set-secrets="/app/sa-key.json=sa-key:latest" \
  --set-env-vars="\
GCP_PROJECT_ID=${PROJECT_ID},\
GCP_REGION=${REGION},\
DB_CONNECTION_NAME=${DB_CONNECTION_NAME},\
DB_NAME=${DB_NAME},\
DB_USER=${DB_USER},\
DB_PASSWORD=${DB_PASSWORD},\
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${DB_CONNECTION_NAME},\
SENDER_EMAIL=YOUR_SENDER_EMAIL,\
GOOGLE_APPLICATION_CREDENTIALS=/app/sa-key.json,\
API_BASE_URL=${API_URL},\
ALLOWED_ORIGINS=https://YOUR_DOMAIN" \
  --add-cloudsql-instances=${DB_CONNECTION_NAME}
```

### Deploy Frontend

```bash
# Build (inject Firebase config as build args)
gcloud builds submit \
  --project=${PROJECT_ID} \
  --tag="${REGION}-docker.pkg.dev/${PROJECT_ID}/trellis/frontend:latest" \
  -f frontend/Dockerfile \
  frontend/ \
  --build-arg="VITE_FIREBASE_API_KEY=YOUR_FIREBASE_API_KEY" \
  --build-arg="VITE_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT.firebaseapp.com" \
  --build-arg="VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID" \
  --build-arg="VITE_FIREBASE_STORAGE_BUCKET=YOUR_PROJECT.firebasestorage.app" \
  --build-arg="VITE_FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID" \
  --build-arg="VITE_FIREBASE_APP_ID=YOUR_APP_ID" \
  --build-arg="VITE_API_URL=${API_URL}" \
  --build-arg="VITE_WS_URL=${RELAY_URL}"

# Deploy
gcloud run deploy trellis-frontend \
  --project=${PROJECT_ID} \
  --region=${REGION} \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/trellis/frontend:latest" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=256Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5
```

---

## 9. Configure Cloud Scheduler

Set up automated cron jobs for background processing:

```bash
CRON_SECRET="YOUR_CRON_SECRET"

# Process Meet recordings (every 5 minutes)
gcloud scheduler jobs create http trellis-process-recordings \
  --project=${PROJECT_ID} \
  --location=${REGION} \
  --schedule="*/5 * * * *" \
  --uri="${API_URL}/api/cron/process-recordings" \
  --http-method=POST \
  --headers="X-Cron-Secret=${CRON_SECRET}" \
  --attempt-deadline=300s

# Send appointment reminders (every hour)
gcloud scheduler jobs create http trellis-send-reminders \
  --project=${PROJECT_ID} \
  --location=${REGION} \
  --schedule="0 * * * *" \
  --uri="${API_URL}/api/cron/send-reminders" \
  --http-method=POST \
  --headers="X-Cron-Secret=${CRON_SECRET}" \
  --attempt-deadline=120s

# Check reconfirmation windows (every hour)
gcloud scheduler jobs create http trellis-check-reconfirmations \
  --project=${PROJECT_ID} \
  --location=${REGION} \
  --schedule="0 * * * *" \
  --uri="${API_URL}/api/cron/check-reconfirmations" \
  --http-method=POST \
  --headers="X-Cron-Secret=${CRON_SECRET}" \
  --attempt-deadline=120s

# Detect no-shows (every 15 minutes)
gcloud scheduler jobs create http trellis-check-no-shows \
  --project=${PROJECT_ID} \
  --location=${REGION} \
  --schedule="*/15 * * * *" \
  --uri="${API_URL}/api/cron/check-no-shows" \
  --http-method=POST \
  --headers="X-Cron-Secret=${CRON_SECRET}" \
  --attempt-deadline=120s

# Unsigned document reminders (daily at 6 AM)
gcloud scheduler jobs create http trellis-check-unsigned-docs \
  --project=${PROJECT_ID} \
  --location=${REGION} \
  --schedule="0 6 * * *" \
  --uri="${API_URL}/api/cron/check-unsigned-docs" \
  --http-method=POST \
  --headers="X-Cron-Secret=${CRON_SECRET}" \
  --attempt-deadline=120s
```

---

## 10. Custom Domain + DNS

Map your custom domain to the frontend service:

```bash
gcloud run domain-mappings create \
  --project=${PROJECT_ID} \
  --region=${REGION} \
  --service=trellis-frontend \
  --domain=YOUR_DOMAIN
```

Then add a DNS record with your domain registrar:

| Type | Name | Value |
|------|------|-------|
| CNAME | `app` (or your subdomain) | `ghs.googlehosted.com` |

DNS propagation may take up to 24 hours. Cloud Run will automatically provision an SSL certificate.

---

## 11. Post-Deployment Steps

### Enable Meet Auto-Recording

1. Go to [Google Admin Console](https://admin.google.com).
2. Navigate to **Apps** > **Google Workspace** > **Google Meet**.
3. Under **Recording**, enable **"Allow recording"**.
4. Under **Auto-recording**, select **"Record all meetings automatically"**.

### Verify Cloud SQL Backups

Backups are enabled by default in the deployment script. Verify:

```bash
gcloud sql instances describe ${DB_INSTANCE} \
  --project=${PROJECT_ID} \
  --format="value(settings.backupConfiguration)"
```

### Restrict Cloud SQL Network Access

The deployment script configures Cloud SQL with private IP only. If you temporarily authorized your IP for migrations, verify it was removed:

```bash
gcloud sql instances describe ${DB_INSTANCE} \
  --project=${PROJECT_ID} \
  --format="value(settings.ipConfiguration.authorizedNetworks)"
```

This should return empty.

---

## 12. Verify Installation

Run the comprehensive health check:

```bash
curl -s -X POST ${API_URL}/api/health | python3 -m json.tool
```

Expected output:

```json
{
    "status": "ok",
    "checks": {
        "database": {"status": "ok", "message": "Connected to PostgreSQL", ...},
        "firebase": {"status": "ok", "message": "Firebase Auth connected", ...},
        "calendar": {"status": "ok", "message": "Calendar API accessible", ...},
        "gmail": {"status": "ok", "message": "Gmail API accessible", ...},
        "drive": {"status": "ok", "message": "Drive API accessible", ...},
        "speech_to_text": {"status": "ok", "message": "Speech-to-Text V2 API accessible", ...}
    },
    "elapsed_ms": 1234
}
```

All checks should show `"status": "ok"`. See [Troubleshooting](#troubleshooting) for common issues.

---

## 13. First Login + Onboarding

1. Visit `https://YOUR_DOMAIN` in your browser.
2. Click **"Clinician Login"** on the landing page.
3. Sign in with your Google Workspace account.
4. When prompted, select **"Clinician"** as your role.
5. Complete the 4-step practice profile setup:
   - **Step 1:** Practice name, clinician name, credentials
   - **Step 2:** License number, NPI, tax ID
   - **Step 3:** Contact info, address
   - **Step 4:** Accepted insurances, session rates
6. You will be redirected to the clinician dashboard.

Your Trellis instance is now ready to accept clients.

**For clients:** Share your Trellis URL. Clients visit the landing page, create an account, and can start the voice intake process immediately.

---

## Troubleshooting

### Database Connection Failed

**Symptom:** Health check shows database error.

**Checks:**
- Verify the `DATABASE_URL` environment variable on the API Cloud Run service.
- Ensure the Cloud SQL instance is running: `gcloud sql instances describe trellis-db`.
- Confirm the `--add-cloudsql-instances` flag was included in the deploy command.
- Check Cloud Run logs: `gcloud run services logs read trellis-api --region=REGION`.

### Firebase Auth Error

**Symptom:** Health check shows Firebase error, or users cannot log in.

**Checks:**
- Verify Firebase is enabled on your GCP project.
- Ensure `GOOGLE_APPLICATION_CREDENTIALS` env var points to the SA key in Cloud Run.
- Confirm Google and Email/Password sign-in providers are enabled in Firebase Console.
- Check that `VITE_FIREBASE_*` build args were set correctly when building the frontend.

### Calendar/Gmail/Drive API Errors

**Symptom:** Health check shows API access error for Calendar, Gmail, or Drive.

**Checks:**
- Verify domain-wide delegation is enabled on the service account.
- Confirm all four OAuth scopes are authorized in Admin Console.
- Ensure `SENDER_EMAIL` is set to a valid Workspace user on your domain.
- Check the service account key file is accessible at the configured path.

### Speech-to-Text API Error

**Symptom:** Health check shows Speech API error, recordings not transcribed.

**Checks:**
- Verify the Speech-to-Text API is enabled: `gcloud services list --filter="speech"`.
- Ensure the service account has the `roles/speech.client` role.
- Confirm `GCP_PROJECT_ID` env var is set correctly on the API service.

### Meet Recordings Not Processing

**Symptom:** Sessions complete but no transcripts appear.

**Checks:**
- Verify Meet auto-recording is enabled in Workspace Admin Console.
- Check that the Cloud Scheduler `process-recordings` job is running.
- Ensure the `CRON_SECRET` matches between Cloud Scheduler headers and the API env var.
- Check Drive for recordings: they should appear in the organizer's "Meet Recordings" folder.

### Custom Domain Not Working

**Symptom:** Domain shows error or does not resolve.

**Checks:**
- Verify DNS CNAME record: `dig YOUR_DOMAIN CNAME`.
- DNS propagation can take up to 24 hours.
- Check domain mapping status: `gcloud run domain-mappings describe --domain=YOUR_DOMAIN`.
- SSL certificate provisioning may take up to 15 minutes after DNS propagates.

### Cloud Run Service Errors

**General debugging:**

```bash
# View logs
gcloud run services logs read trellis-api --region=REGION --limit=50

# Check service status
gcloud run services describe trellis-api --region=REGION

# View environment variables
gcloud run services describe trellis-api --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)"
```

### Re-running Migrations

If migrations need to be re-applied (e.g., after a schema issue):

```bash
# Temporarily authorize your IP
MY_IP=$(curl -s https://api.ipify.org)
gcloud sql instances patch trellis-db \
  --authorized-networks="${MY_IP}/32" --quiet

# Connect and run migrations
DB_IP=$(gcloud sql instances describe trellis-db \
  --format="value(ipAddresses[0].ipAddress)")
PGPASSWORD=YOUR_DB_PASSWORD psql -h ${DB_IP} -U trellis -d trellis \
  -f db/migrations/MIGRATION_FILE.sql

# Remove IP authorization
gcloud sql instances patch trellis-db \
  --clear-authorized-networks --quiet
```

---

## Architecture Overview

```
Client Browser
    |
    |-- HTTPS --> Cloud Run: trellis-frontend (nginx, static React SPA)
    |                |
    |                |-- /api/* --> Cloud Run: trellis-api (FastAPI)
    |                |                |
    |                |                |-- Cloud SQL (PostgreSQL 15)
    |                |                |-- Firebase Auth (JWT verification)
    |                |                |-- Gmail API (email sending)
    |                |                |-- Calendar API (appointments, Meet)
    |                |                |-- Drive API (recordings)
    |                |                |-- Speech-to-Text (transcription)
    |                |                |-- Vertex AI / Gemini (note generation)
    |                |
    |                |-- /ws/* --> Cloud Run: trellis-relay (WebSocket)
    |                                |
    |                                |-- Gemini Live API (voice)
    |                                |-- Cloud SQL (encounters)
    |
Cloud Scheduler --> trellis-api/api/cron/* (background jobs)
```

All services run in your own GCP project. Patient data stays in your Cloud SQL instance.
