# SOR EHR — Behavioral Health EHR/RCM Platform

## Overview
A behavioral health Electronic Health Record (EHR) and Revenue Cycle Management (RCM) platform. Features voice-powered clinical documentation via Gemini Live API integration.

## Tech Stack
- **Frontend:** React 18 + Vite + TypeScript (SPA, deployed to Cloud Run)
- **Backend API:** Python 3.12 + FastAPI (Cloud Run)
- **Voice Relay:** Python 3.12 + FastAPI WebSocket (Cloud Run) — Gemini Live real-time voice
- **Database:** Cloud SQL (PostgreSQL) with asyncpg + SQLAlchemy
- **Auth:** Firebase Auth
- **IaC:** Terraform
- **GCP Project:** `automations-486317`

## Directory Layout
```
ehr/
├── frontend/          # React + Vite SPA
├── backend/
│   ├── api/           # FastAPI REST API
│   ├── relay/         # Gemini Live voice relay (WebSocket)
│   └── shared/        # Shared Python models/enums
├── infra/terraform/   # GCP provisioning
├── db/migrations/     # SQL migrations
└── creation data/     # Planning docs
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
- Frontend proxies `/api` to the backend API and `/ws` to the relay
- Shared Python code lives in `backend/shared/` (Pydantic models, enums)
- Database migrations go in `db/migrations/` as numbered SQL files
