# Trellis Billing Build-Out Plan

## Current State Summary

**What exists today:**
- Superbill auto-generation on note signing (PDF stored in DB)
- Superbill status tracking: `generated → submitted → paid → outstanding`
- Superbill PDF download + email to client (for OON reimbursement)
- Clinician billing dashboard with filtering and summary stats
- Client billing page (view own superbills, download PDFs)
- Practice profile with group/individual NPI, Tax ID, address
- Client insurance fields: `payer_name`, `member_id`, `group_number`, `insurance_data` (JSONB)
- CPT code mapping: 90791, 90832, 90834, 90837, 90846, 90847
- Diagnosis codes pulled from active treatment plan
- Group practice support: billing provider (practice NPI) vs rendering provider (clinician NPI)

**What does NOT exist:**
- CMS-1500 or 837P claim format generation
- Electronic claim submission
- Eligibility/benefits verification
- ERA/835 payment posting
- Denial management
- Patient payment processing
- CPT modifiers
- Line-item payment tracking

---

## Architecture: Two-Tier Billing Model

```
┌─────────────────────────────────────────────────────────────┐
│                    TRELLIS EHR (Open-Source)                 │
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌───────────────────────┐   │
│  │ Superbill│──▶│  Claim   │──▶│  Free Tier Outputs    │   │
│  │ (exists) │   │  Review  │   │  • CMS-1500 PDF       │   │
│  └──────────┘   │  Screen  │   │  • 837P EDI file      │   │
│                 └────┬─────┘   │  • Manual status track │   │
│                      │         └───────────────────────┘   │
│                      │                                      │
│                      │  if billing service active            │
│                      ▼                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Paid Tier UI (in open-source repo)                  │   │
│  │  • One-click submit        • ERA/payment view        │   │
│  │  • Live claim status       • Denial management       │   │
│  │  • Patient payment links   • Financial reports       │   │
│  └──────────────────────┬───────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────┘
                          │ API calls
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              TRELLIS BILLING SERVICE (Paid/Hosted)           │
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐   │
│  │  Stedi   │   │  Stripe  │   │  Business Logic      │   │
│  │  837P TX │   │  Connect │   │  • Denial engine      │   │
│  │  835 RX  │   │  Payments│   │  • Auto-statements    │   │
│  │  270/271 │   │  Payouts │   │  • Revenue analytics  │   │
│  └──────────┘   └──────────┘   └──────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Free Tier — Claim Document Generation

**Goal:** Clinicians can generate industry-standard claim documents from existing superbill data and manually track billing status. No external integrations required.

### Module 1A: CMS-1500 PDF Generator
**Priority:** High | **Depends on:** Nothing (existing data sufficient)

**Backend:**
- [ ] `backend/shared/cms1500_pdf.py` — New file
  - `generate_cms1500_pdf(superbill_data, client, practice, clinician) → bytes`
  - Render standard CMS-1500 form layout (33 boxes)
  - Map existing data to CMS-1500 fields:
    - Box 1: Medicare/Medicaid/Other (from `payer_name`)
    - Box 1a: Insured's ID (`member_id`)
    - Box 2: Patient name (`full_name`)
    - Box 3: Patient DOB, Sex (`date_of_birth`)
    - Box 4: Insured's name (same as patient for now)
    - Box 5: Patient address (`address_*` fields)
    - Box 6: Patient relationship (default "Self")
    - Box 11: Group number (`group_number`)
    - Box 11c: Insurance plan name (`payer_name`)
    - Box 21: ICD-10 codes (from `diagnosis_codes`)
    - Box 24A: Date of service
    - Box 24B: Place of service (11=Office, 02=Telehealth)
    - Box 24D: CPT code
    - Box 24E: Diagnosis pointer
    - Box 24F: Charges (`fee`)
    - Box 24J: Rendering provider NPI (`clinician.npi`)
    - Box 25: Federal Tax ID (`practice.tax_id`)
    - Box 26: Patient account number (client UUID or short ID)
    - Box 28: Total charge
    - Box 31: Signature of physician
    - Box 32: Service facility (practice address)
    - Box 33: Billing provider (practice name, NPI, address)

- [ ] Add route: `GET /api/superbills/{id}/cms1500` → returns CMS-1500 PDF
- [ ] Add route: `GET /api/superbills/{id}/cms1500/data` → returns structured JSON of all CMS-1500 field values (useful for debugging / display)

**Data gaps to address:**
- [ ] Add `place_of_service` field to superbills or derive from appointment (in-person vs telehealth)
  - Check if appointments table has a `modality` or `location_type` field
  - If not, add to superbill generation logic: if appointment has Meet link → POS=02, else POS=11
- [ ] Add `patient_relationship_to_insured` to clients table (default "Self")
- [ ] Add `patient_sex` to clients table (required for CMS-1500 Box 3)
  - Migration: `ALTER TABLE clients ADD COLUMN sex TEXT;` (M/F/Unknown)

**Frontend:**
- [ ] Add "Download CMS-1500" button to superbill actions in `BillingPage.tsx`
- [ ] Add "Download CMS-1500" option in superbill detail view

**Files touched:**
- New: `backend/shared/cms1500_pdf.py`
- Edit: `backend/api/routes/billing.py` (new routes)
- Edit: `frontend/src/pages/BillingPage.tsx` (new button)
- New: `db/migrations/013_billing_fields.sql` (if new columns needed)

---

### Module 1B: 837P EDI File Generator
**Priority:** High | **Depends on:** Module 1A (same data mapping)

**Backend:**
- [ ] `backend/shared/edi_837p.py` — New file
  - `generate_837p(superbill_data, client, practice, clinician) → str`
  - Generate ANSI X12 837P Professional claim format
  - Segments needed:
    - ISA/GS (interchange/functional group headers)
    - ST (transaction set header — 837)
    - BHT (beginning of hierarchical transaction)
    - HL loops:
      - 2000A: Billing provider (practice)
      - 2010AA: Billing provider name/address/NPI
      - 2000B: Subscriber (patient/insured)
      - 2010BA: Subscriber name/address/member ID
      - 2010BB: Payer name/ID
      - 2300: Claim information (POS, total charge, diagnosis codes)
      - 2400: Service line (CPT, date, charge, diagnosis pointer)
    - SE/GE/IEA (trailers)
  - Use Stedi's EDI format spec as reference
  - Payer IDs: will need a lookup table or manual entry (Module 1C)

- [ ] Add route: `GET /api/superbills/{id}/edi837` → returns 837P text file
- [ ] Add route: `POST /api/superbills/batch-edi837` → multiple superbills in one 837P file

**Data gaps to address:**
- [ ] Payer ID mapping — clearinghouses need electronic payer IDs, not just names
  - Option A: Add `payer_id` field to clients table alongside `payer_name`
  - Option B: Create `payers` lookup table with name→ID mapping
  - Option C: Let clinician enter payer ID manually on claim review screen
  - **Decision needed:** Which approach? Option C is simplest for MVP.

**Frontend:**
- [ ] Add "Download 837P" button to superbill actions in `BillingPage.tsx`
- [ ] Batch export: select multiple superbills → download combined 837P

**Files touched:**
- New: `backend/shared/edi_837p.py`
- Edit: `backend/api/routes/billing.py` (new routes)
- Edit: `frontend/src/pages/BillingPage.tsx` (new buttons)

---

### Module 1C: Claim Review Screen
**Priority:** High | **Depends on:** Modules 1A, 1B

**Frontend:**
- [ ] New page: `frontend/src/pages/ClaimReviewPage.tsx`
  - Route: `/billing/claims/{superbill_id}/review`
  - Triggered after note signing (link from success toast or redirect)
  - Also accessible from billing dashboard row actions
  - **Layout:**
    - Left panel: editable claim fields grouped by CMS-1500 sections
      - Patient info (read-only, links to client profile)
      - Insurance info (editable: payer name, payer ID, member ID, group #)
      - Service details (editable: CPT code dropdown, modifiers, POS, units)
      - Diagnosis codes (editable: reorder, add/remove, search ICD-10)
      - Provider info (read-only)
      - Charges (editable: fee override)
    - Right panel: live CMS-1500 preview (or summary card)
  - **Actions:**
    - "Download CMS-1500 PDF" button
    - "Download 837P" button
    - "Mark as Submitted" (updates status)
    - "Save Changes" (persists edits to superbill)
  - **ICD-10 search:** typeahead search component for diagnosis codes
    - Backend route: `GET /api/icd10/search?q=...` → returns matching codes
    - Data source: bundled ICD-10-CM code list (static JSON or DB table)

**Backend:**
- [ ] `PATCH /api/superbills/{id}` — Update superbill fields (CPT, diagnosis, fee, POS, payer info)
  - Only allowed for superbills in `generated` status
  - Regenerate PDF after updates
  - Audit log the changes
- [ ] `GET /api/icd10/search?q={query}` — ICD-10 code search
  - Static file or DB table with ICD-10-CM codes
  - Return: `[{code: "F32.1", description: "Major depressive disorder, single episode, moderate"}, ...]`
  - Limit to mental health range (F01-F99) by default, with option to search all

**Data:**
- [ ] Source ICD-10-CM code list (CMS publishes annually, public domain)
  - Option A: JSON file in `backend/shared/data/icd10_mental_health.json`
  - Option B: DB table populated by migration
  - **Recommendation:** JSON file for simplicity, filter F01-F99 codes

**Files touched:**
- New: `frontend/src/pages/ClaimReviewPage.tsx`
- New: `frontend/src/components/billing/ICD10Search.tsx`
- New: `backend/shared/data/icd10_mental_health.json`
- Edit: `backend/api/routes/billing.py` (PATCH route, ICD-10 search route)
- Edit: `frontend/src/App.tsx` or router config (new route)

---

### Module 1D: Enhanced Billing Dashboard
**Priority:** Medium | **Depends on:** Modules 1A-1C

**Frontend enhancements to `BillingPage.tsx`:**
- [ ] Date range filter (date submitted, date of service)
- [ ] "Date Submitted" and "Date Paid" columns
- [ ] A/R aging buckets: Current (0-30), 31-60, 61-90, 90+ days
  - Color-coded badges on each row
  - Summary section showing totals per aging bucket
- [ ] Batch actions: select multiple → mark as submitted / download 837P
- [ ] Quick stats row: claims this month, collections this month, avg days to payment

**Backend:**
- [ ] Add `date_submitted` and `date_paid` columns to superbills table
  - Auto-set `date_submitted` when status changes to `submitted`
  - Auto-set `date_paid` when status changes to `paid`
- [ ] `GET /api/superbills/summary` — Enhanced summary endpoint
  - A/R aging buckets with totals
  - Monthly collections
  - Average days to payment
- [ ] `PATCH /api/superbills/batch-status` — Batch status update

**Migration:**
- [ ] `ALTER TABLE superbills ADD COLUMN date_submitted TIMESTAMPTZ;`
- [ ] `ALTER TABLE superbills ADD COLUMN date_paid TIMESTAMPTZ;`

**Files touched:**
- Edit: `frontend/src/pages/BillingPage.tsx`
- Edit: `backend/api/routes/billing.py`
- New: `db/migrations/013_billing_enhancements.sql` (or combined with 1A migration)

---

### Module 1E: Patient Statement PDF
**Priority:** Medium | **Depends on:** Nothing

**Backend:**
- [ ] `backend/shared/patient_statement_pdf.py` — New file
  - `generate_patient_statement(client, superbills, practice) → bytes`
  - Client-facing document showing:
    - Practice header / branding
    - Client name and address
    - Statement date and account number
    - Table of services: Date | Description | Charges | Payments | Adjustments | Balance
    - Total balance due
    - Payment instructions (if applicable)
    - Practice contact info
- [ ] Route: `POST /api/clients/{client_id}/statement` → generates statement PDF for date range
  - Query params: `from_date`, `to_date`
  - Aggregates superbills for period
- [ ] Route: `POST /api/clients/{client_id}/statement/email` → email statement to client

**Frontend:**
- [ ] Add "Generate Statement" button to client billing tab
- [ ] Add "Generate Statements" bulk action to billing dashboard (select clients)

**Files touched:**
- New: `backend/shared/patient_statement_pdf.py`
- Edit: `backend/api/routes/billing.py` (new routes)
- Edit: `frontend/src/pages/BillingPage.tsx` or client detail page

---

## Phase 2: Paid Tier — Trellis Billing Service (Hosted Infrastructure)

**Goal:** Fully automated revenue cycle — electronic claim submission, payment posting, patient collections. Clinician pays per-claim or subscription fee.

### Module 2A: Billing Service API (Your Infrastructure)
**Priority:** High | **Depends on:** Phase 1 complete

**New service:** Separate hosted API (not in open-source repo)
- [ ] Service scaffolding: FastAPI or similar
- [ ] Auth: API key per practice + webhook signing
- [ ] Endpoints:
  - `POST /claims/submit` — Accept claim data, submit via Stedi
  - `GET /claims/{id}/status` — Claim status from Stedi
  - `POST /eligibility/verify` — 270/271 eligibility check via Stedi
  - `GET /era/{id}` — ERA/835 details
  - `POST /webhooks/stedi` — Receive Stedi callbacks
  - `POST /webhooks/stripe` — Receive Stripe payment events
  - `POST /payments/create-link` — Generate Stripe payment link
  - `GET /practices/{id}/dashboard` — Aggregate billing analytics

**Database (billing service's own DB):**
- [ ] `billing_accounts` — practice registration, API keys, Stripe Connect account ID
- [ ] `submitted_claims` — claim data, Stedi claim ID, status history
- [ ] `eras` — received ERA/835 data, parsed line items
- [ ] `patient_payments` — Stripe payment intent IDs, amounts, status
- [ ] `billing_events` — event log for debugging/audit

---

### Module 2B: Stedi Integration — Claim Submission (837P)
**Priority:** High | **Depends on:** Module 2A

- [ ] Stedi account setup and API credentials
- [ ] Map EHR superbill data → Stedi's 837P claim API format
- [ ] Handle Stedi's claim validation responses (errors, warnings)
- [ ] Claim status polling or webhook handling
- [ ] Claim acknowledgment (999/277) processing
- [ ] Resubmission workflow for rejected claims

---

### Module 2C: Stedi Integration — ERA/835 Processing
**Priority:** High | **Depends on:** Module 2B

- [ ] Receive ERA/835 files from Stedi (webhook or polling)
- [ ] Parse ERA into structured data:
  - Payment amounts per service line
  - Adjustment reason codes (CO, PR, OA groups)
  - Patient responsibility (deductible, coinsurance, copay)
  - Denial reason codes
- [ ] Auto-post payments to EHR:
  - Call EHR API to update superbill `amount_paid` and `status`
  - Create payment ledger entries
- [ ] Calculate patient responsibility after insurance
- [ ] Trigger patient statement/payment link generation

---

### Module 2D: Stedi Integration — Eligibility Verification (270/271)
**Priority:** Medium | **Depends on:** Module 2A

- [ ] Submit 270 eligibility inquiry via Stedi
- [ ] Parse 271 eligibility response:
  - Active/inactive coverage
  - Plan details (copay, deductible, coinsurance)
  - Deductible remaining
  - Out-of-pocket max remaining
  - Prior auth requirements
  - Mental health specific benefits
- [ ] Cache results (valid for session/day)
- [ ] Surface via EHR API for frontend display

---

### Module 2E: Stripe Connect — Payment Platform
**Priority:** High | **Depends on:** Module 2A

- [ ] Stripe Connect platform account setup
- [ ] Practice onboarding flow:
  - Create Connected Account (Standard or Express)
  - Handle KYC/identity verification
  - Configure payout schedule
  - Set platform fee (percentage or fixed per claim)
- [ ] Payment link generation:
  - Stripe Checkout session per patient balance
  - Include line items from ERA patient responsibility
  - Support partial payments
- [ ] Webhook handling:
  - `payment_intent.succeeded` → update payment status
  - `payout.paid` → confirm clinician received funds
  - `account.updated` → track onboarding status
- [ ] Refund handling

---

### Module 2F: Denial Management Engine
**Priority:** Medium | **Depends on:** Module 2C

- [ ] Parse denial reason codes from ERA (CARC/RARC codes)
- [ ] Categorize denials:
  - Missing/invalid info (fixable)
  - Medical necessity (appeal needed)
  - Authorization required (prior auth)
  - Timely filing (may be unrecoverable)
  - Duplicate claim
- [ ] Suggest corrections based on denial code
- [ ] Enable resubmission through Stedi
- [ ] Track denial rates by payer, CPT code, reason

---

### Module 2G: Automated Patient Communications
**Priority:** Medium | **Depends on:** Modules 2C, 2E

- [ ] Auto-generate patient statement after ERA processes
- [ ] Email statement with Stripe payment link
- [ ] Payment reminder schedule (7 days, 30 days, 60 days)
- [ ] Payment confirmation email
- [ ] Configurable communication templates

---

## Phase 2 Frontend (In Open-Source EHR Repo)

### Module 2H: Billing Service Onboarding
**Priority:** High | **Depends on:** Module 2A, 2E

**Frontend:**
- [ ] New page: `frontend/src/pages/BillingServicePage.tsx`
  - Route: `/settings/billing-service`
  - "Activate Trellis Billing" CTA when not connected
  - Steps: 1) Create account → 2) Connect Stripe → 3) Configure preferences
  - Status dashboard when connected (account status, payout info)
- [ ] Stripe Connect onboarding embed (Express or hosted)
- [ ] Billing service settings (auto-submit claims, payment reminders, etc.)

**Backend (EHR side):**
- [ ] Store billing service API key in practice settings
- [ ] Store Stripe Connect account ID
- [ ] Migration: Add `billing_service_*` columns to practices table

---

### Module 2I: One-Click Claim Submission
**Priority:** High | **Depends on:** Module 2H

**Frontend:**
- [ ] Replace/augment "Download CMS-1500" with "Submit Claim" button when billing service is active
- [ ] Submit button on claim review page sends to billing service API
- [ ] Real-time status badge updates (submitted → acknowledged → adjudicated → paid)
- [ ] Submission error display with Stedi validation messages

**Backend (EHR side):**
- [ ] `POST /api/superbills/{id}/submit` — proxy to billing service
- [ ] `GET /api/superbills/{id}/claim-status` — fetch status from billing service
- [ ] Webhook endpoint to receive status updates from billing service

---

### Module 2J: ERA/Payment Posting View
**Priority:** High | **Depends on:** Module 2C

**Frontend:**
- [ ] New component: `ERADetailView.tsx`
  - Shows what insurance paid per line item
  - Adjustment codes with plain-English descriptions
  - Patient responsibility breakdown (deductible, copay, coinsurance)
  - Denial indicators with reason
- [ ] Payment posting summary on billing dashboard
- [ ] Auto-reconciled payments highlighted vs manual

---

### Module 2K: Denial Management UI
**Priority:** Medium | **Depends on:** Module 2F

**Frontend:**
- [ ] Denied claims queue with filtering
- [ ] Denial detail view: reason code, description, suggested action
- [ ] "Correct and Resubmit" workflow
- [ ] Denial analytics: by payer, by code, trend over time

---

### Module 2L: Patient Payment Tracking
**Priority:** Medium | **Depends on:** Module 2E, 2G

**Frontend:**
- [ ] Patient balance view per client
- [ ] Payment link status (sent, viewed, paid)
- [ ] Payment history with Stripe receipts
- [ ] Outstanding balances report

---

### Module 2M: Eligibility Check UI
**Priority:** Medium | **Depends on:** Module 2D

**Frontend:**
- [ ] "Verify Eligibility" button on client profile
- [ ] Pre-session eligibility check prompt
- [ ] Coverage details display:
  - Active/inactive badge
  - Copay amount
  - Deductible: used / remaining
  - Out-of-pocket: used / remaining
  - Mental health specific benefits
  - Prior auth requirements
- [ ] Eligibility history log

---

### Module 2N: Financial Reports
**Priority:** Low | **Depends on:** Modules 2C, 2E

**Frontend:**
- [ ] New page: `frontend/src/pages/FinancialReportsPage.tsx`
- [ ] Reports:
  - Collections by payer (pie chart + table)
  - Collections by CPT code
  - Monthly revenue trend (line chart)
  - A/R aging (0-30, 31-60, 61-90, 90+)
  - Payer mix analysis
  - Denial rate by payer
  - Average days to payment by payer
  - Year-to-date summary

---

## Dependency Graph

```
Phase 1 (Free Tier):
  1A (CMS-1500 PDF) ──┐
                       ├──▶ 1C (Claim Review Screen) ──▶ 1D (Enhanced Dashboard)
  1B (837P EDI) ───────┘
  1E (Patient Statement) ── independent

Phase 2 (Paid Tier):
  2A (Billing Service API) ──┬──▶ 2B (Stedi Claims) ──▶ 2C (ERA/835) ──▶ 2F (Denial Engine)
                             │                                           │
                             ├──▶ 2D (Eligibility)                       ├──▶ 2G (Auto Comms)
                             │                                           │
                             └──▶ 2E (Stripe Connect) ──────────────────┘

  Phase 2 Frontend (depends on corresponding backend modules):
  2H (Onboarding) ──▶ 2I (One-Click Submit) ──▶ 2J (ERA View) ──▶ 2K (Denial UI)
                  ──▶ 2L (Payment Tracking)
                  ──▶ 2M (Eligibility UI)
                  ──▶ 2N (Financial Reports)
```

---

## Suggested Build Order

| Order | Module | Description | Est. Complexity |
|-------|--------|-------------|-----------------|
| 1 | **1A** | CMS-1500 PDF generator | Medium |
| 2 | **1B** | 837P EDI generator | Medium |
| 3 | **1C** | Claim review screen + ICD-10 search | Medium-High |
| 4 | **1E** | Patient statement PDF | Low |
| 5 | **1D** | Enhanced billing dashboard | Medium |
| 6 | **2A** | Billing service API scaffolding | Medium |
| 7 | **2E** | Stripe Connect setup | Medium |
| 8 | **2H** | Billing service onboarding UI | Medium |
| 9 | **2B** | Stedi claim submission | Medium-High |
| 10 | **2I** | One-click submit UI | Low |
| 11 | **2D** | Eligibility verification | Medium |
| 12 | **2M** | Eligibility UI | Low-Medium |
| 13 | **2C** | ERA/835 processing | High |
| 14 | **2J** | ERA/payment view | Medium |
| 15 | **2F** | Denial management engine | Medium |
| 16 | **2K** | Denial management UI | Medium |
| 17 | **2G** | Automated patient comms | Medium |
| 18 | **2L** | Patient payment tracking UI | Low-Medium |
| 19 | **2N** | Financial reports | Medium |

---

## Migration Tracking

| Migration # | Module | Description |
|-------------|--------|-------------|
| 013 | 1A, 1D | `place_of_service`, `date_submitted`, `date_paid` on superbills; `sex` on clients |
| 014 | 2H | `billing_service_api_key`, `stripe_connect_account_id` on practices |

---

## Open Decisions

1. **Payer ID mapping** — How to map insurance company names to electronic payer IDs for 837P?
   - Option A: Manual entry on claim review screen (simplest)
   - Option B: Payer lookup table with Stedi's payer directory
   - Option C: Both (lookup with manual override)

2. **Superbill = Claim?** — Should superbills BE claims (add fields to existing table) or should claims be a separate entity wrapping superbills?
   - Current leaning: Superbills ARE the claim record. Add fields as needed. Avoid table proliferation.

3. **Place of service detection** — Derive from appointment (has Meet link = telehealth) or let clinician set it?
   - Recommendation: Auto-detect from Meet link presence, allow override on claim review.

4. **CPT modifiers** — Support in Phase 1 or defer?
   - Recommendation: Add `modifiers` JSONB field to superbills in Phase 1, but only build modifier selection UI when needed.

5. **Billing service hosting** — Where to host the paid tier service?
   - Options: Same GCP project, separate GCP project, separate cloud provider
   - Recommendation: Separate GCP project for clean separation of billing service from EHR.

6. **Pricing model** — Per-claim fee, monthly subscription, or hybrid?
   - TBD — business decision, doesn't affect technical build.
