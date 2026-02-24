# Trellis MVP — Solo Therapist Workflow

The MVP is a complete end-to-end workflow for an individual therapist: client intake → scheduling → session → documentation → billing docs → discharge. No clearinghouse integration (manual portal submission for MVP, Stedi planned shortly after). Open source, self-hosted in therapist's own GCP project + Google Workspace.

### End-to-End Flow
1. Therapist deploys Trellis via configuration wizard → deployment script
2. Therapist logs in, sets up practice profile (name, NPI, rates, insurance, availability)
3. Client visits Trellis URL, creates account
4. Client does voice intake (demographics, insurance check, presenting concerns)
5. Voice agent books intake appointment, emails confirmations to both parties
6. Consent docs auto-generated at booking, emailed to client for signing before session
7. Meet session auto-records, transcript generated via Speech-to-Text with diarization
8. AI generates intake assessment note → clinician reviews/edits/signs in portal
9. AI generates treatment plan from intake → clinician reviews/signs
10. Superbill auto-generated from signed note
11. Client self-schedules recurring sessions from portal
12. Each ongoing session: auto-record → transcript → progress note → sign → superbill
13. Reconfirmation emails after each session (confirm / change / cancel next)
14. Clinician discharges client when treatment concludes

---

## Component 1: Auth + Database Schema
**Status: 100% done**

What exists:
- Firebase Auth (Google + Email/Password) on trellis-mvp
- 5 migrations applied: encounters, documents, scheduling, clients, c1_completion
- [x] `practice_profile` table (clinician + practice info combined for solo MVP: name, specialties, accepted insurances, rates, bio, NPI, tax ID, address, phone, license info, timezone, session durations)
- [x] `treatment_plans` table (versioned, diagnoses JSONB, goals/objectives JSONB, signing workflow, linked to encounters + previous versions)
- [x] `users` table with stored role (clinician vs client) — `require_role()` middleware enforces in backend
- [x] `POST /api/auth/register` + `GET /api/auth/me` endpoints for role registration
- [x] `GET/PUT /api/practice-profile` endpoints (PUT is clinician-only via role check)
- [x] `GET /api/clients` endpoint (clinician-only) with next appointment + last session subqueries
- [x] Migration dropped group therapy tables (`recurring_groups`, `group_enrollments`, `group_sessions`, `group_attendance`)
- [x] Removed all group therapy code from API routes and db.py
- [x] Added `status` (active/discharged/inactive) and `discharged_at` columns to clients table
- [x] Role-aware routing: AuthProvider resolves role via `GET /api/auth/me`, RoleSelector component for unregistered users, ClinicianRoute/ProtectedRoute guards
- [x] Removed group therapy references from frontend (Groups tab removed from SchedulePage, GroupManager no longer rendered)
- [x] Row-level access control: `get_current_user_with_role()` + `enforce_client_owns_resource()` middleware in auth.py, ownership lookup helpers in db.py. All endpoints enforce that clients can only access their own records (appointments, documents, packages, schedule). Clinician-only endpoints (package creation/sending, availability management, series cancellation) use `require_role("clinician")`. Self-scoping endpoints (`/clients/me`, `/intake`, signatures) use authenticated UID directly.
- `clinical_notes` table exists but no API routes touch it

---

## Component 2: Clinician Portal — Practice Profile + Availability
**Status: 100% done**

What exists:
- Availability CRUD (scheduling API endpoints — group therapy endpoints removed)
- Calendar sync via gcal.py
- SchedulePage with availability editor, week calendar, booking flow (now inside ClinicianShell sidebar layout)
- [x] Practice profile API: `GET/PUT /api/practice-profile` with full field set (clinician-only write)
- [x] Client list API: `GET /api/clients` with next appointment + last session (clinician-only)
- [x] Practice profile setup frontend — 4-step onboarding wizard at `/setup` (practice info → credentials → contact/address → insurance & rates), saves via `PUT /api/practice-profile`
- [x] Clinician onboarding flow — first login → role selection → practice profile setup
- [x] Dashboard at `/dashboard` — today's schedule widget (from `GET /api/schedule`), upcoming this week, quick actions (clients/schedule/settings), weekly stats
- [x] Dashboard replaces "coming soon" stub
- [x] Client list page at `/clients` — searchable table (name, status badges, phone, insurance, next appt, last session), click → client detail
- [x] Practice profile settings page at `/settings/practice` — editable form pre-populated from `GET /api/practice-profile`, same fields as onboarding
- [x] ClinicianShell — sidebar layout with nav links (Dashboard, Clients, Schedule, Settings) wrapping all clinician routes
- [x] `useApi` hook — generic authenticated GET/PUT/POST wrapper
- [x] `PracticeProfile` and `ClientListItem` TypeScript types
- [x] Full client detail view at `/clients/:clientId` — client info header (name, status badge, contact, insurance, emergency contact), consent documents progress, encounters list, clinical notes list, treatment plan summary, appointments (upcoming + past with Meet links), superbills placeholder (C11), discharge button placeholder (C13)
- [x] Backend client detail endpoints (clinician-only, row-level access): `GET /api/clients/{id}` (full profile), `GET /api/clients/{id}/encounters`, `GET /api/clients/{id}/notes`, `GET /api/clients/{id}/treatment-plan`, `GET /api/clients/{id}/appointments`
- [x] Dashboard: unsigned notes queue widget — queries `GET /api/notes/unsigned` (clinician-only), shows count badge + list with client name, note format, date, status (draft/review), links to client detail page. Empty state shows "All notes signed" when no unsigned notes exist.

---

## Component 3: Landing Page
**Status: 100% done**

What exists:
- [x] Trellis-branded landing page (hero, how it works, features, footer CTA) — rebranded from "Stages of Recovery"
- [x] Auth modal (Google + email/password) — closes on success, role-aware routing handles navigation
- [x] Client "Get Started" CTA → auth modal → RoleSelector → onboarding flow
- [x] Clinician Login CTA → auth modal → RoleSelector → dashboard
- [x] HTML title updated to "Trellis"
- [x] Testimonials section removed (practice-specific, will be customizable post-MVP)
- [x] Feature cards updated to reflect platform capabilities (voice intake, scheduling, notes & billing)
- [x] OnboardingPage nav headers updated to "Trellis"
- [x] Document templates populated dynamically from `practice_profile` data (no hardcoded practice names)

---

## Component 4: Client Account + Voice Agent
**Status: 100% done**

What exists:
- [x] Client auth (Firebase)
- [x] Voice intake agent (Gemini Live, WebSocket, AudioWorklet)
- [x] Persistent context across sessions (encounters table, context injection, compression)
- [x] Insurance card extraction via Gemini vision
- [x] Intake form (demographics, emergency contact, clinical info)
- [x] Agent knows accepted insurance list (reads from practice_profile at session start via relay -> API HTTP call)
- [x] Agent tells client if their insurance is accepted or offers cash pay (rates from practice_profile injected into system prompt)
- [x] Agent reads available slots and offers them conversationally (Gemini Live tool calling: `get_available_slots` tool → relay makes HTTP call to scheduling API → formats slots for conversational presentation)
- [x] Agent books directly: creates Calendar event + appointment record when client picks a slot (Gemini Live `book_appointment` tool → relay calls `POST /api/appointments` → Calendar event + Meet link created)
- [x] Appointment created with "intake assessment" (90791) metadata (type: "assessment", duration from practice_profile intake_duration)
- [x] Confirmation email sent to clinician with client metadata (demographics, insurance, presenting concerns from full transcript) so clinician can review and recommend different level of care if needed
- [x] Confirmation email sent to client with appointment details (date, time, Meet link, what to expect)
- [x] WebSocket auth fixed: relay validates JWT signatures via firebase-admin SDK (HIPAA requirement). DEV_MODE bypass matches API service pattern. Token UID verified against claimed clientId.

---

## Component 5: Appointment System + Reconfirmation
**Status: 100% done**

What exists:
- [x] Appointments with metadata, Calendar sync, Meet links
- [x] Recurring series (4 instances with recurrence_id at configurable cadence)
- [x] Slot computation (availability minus booked)
- [x] Cancel/complete/no-show status updates
- [x] Group therapy endpoints removed — individual appointments only
- [x] Appointment type metadata drives downstream behavior — types: assessment (90791), individual (90834), individual_extended (90837) with CPT codes, display names; set at booking time, determines note type and doc triggers downstream
- [x] Reconfirmation email sent when Meet ends (`POST /api/appointments/{id}/reconfirmation`) with three action links:
  - Confirm next appointment (`GET /api/reconfirmation/{token}/confirm` — keeps the recurring slot)
  - Change appointment (`POST /api/reconfirmation/{token}/change` — pick a different time, creates new Calendar event)
  - Cancel next week (`GET /api/reconfirmation/{token}/cancel` — skip one instance, series continues)
- [x] Reconfirmation info endpoint (`GET /api/reconfirmation/{token}/info`) for frontend change flow
- [x] Recurring cadence: weekly (default), biweekly, monthly — configurable per booking via `cadence` field
- [x] 24-hour reconfirmation window: reconfirmation_sent_at, reconfirmation_response, reconfirmation_responded_at tracked on appointments; token-based action links
- [x] Cloud Scheduler endpoint: `POST /api/cron/check-reconfirmations` — finds expired reconfirmations (>24h no response), deletes Calendar events, releases slots (status='released')
- [x] Cloud Scheduler endpoint: `POST /api/cron/send-reminders` — sends reminder emails 24h before each session with Meet link, tracks reminder_sent_at
- [x] Cloud Scheduler endpoint: `POST /api/cron/check-no-shows` — marks appointments as no_show when scheduled time + duration has passed and status is still 'scheduled'
- [x] Cron endpoints authenticated via X-Cron-Secret header (shared secret, configurable via CRON_SECRET env var)
- [x] Released slots appear in available hours automatically (get_booked_slots only counts status='scheduled', so released/cancelled/no-show appointments free their slots)
- [x] No-show auto-detection: time-based check via cron (scheduled_at + duration_minutes < now() and status='scheduled')
- [x] No-show status visible in clinician portal — appointments list includes no_show status (billing/note handling deferred to clinician's discretion)
- [x] Migration 006: reconfirmation fields (token, sent_at, response, responded_at, released_at), cadence column, reminder_sent_at, expanded type/status constraints
- [x] Email templates: styled HTML + plain text for both reconfirmation and reminder emails

---

## Component 6: Session Recording + Transcription
**Status: 100% done**

What exists:
- [x] Auto-enable recording documented as Workspace Admin deployment step (Meet auto-recording is org-wide, not per-event via Calendar API). Documentation in gcal.py module docstring covers: Admin Console → Apps → Google Workspace → Google Meet → Recording settings.
- [x] Session detection via cron-based polling: `POST /api/cron/process-recordings` runs every 5 minutes via Cloud Scheduler, finds completed/past-due appointments and searches Drive for recordings. This is the MVP approach — simpler and more reliable than Meet REST API webhooks or Drive push notifications.
- [x] Recording-to-appointment matching: searches Drive for recent video files, matches to appointments via Calendar event metadata (meeting code from conferenceData) or event summary in recording filename. Uses `get_meet_recording_for_event()` in gcal.py with multi-strategy matching.
- [x] Google Speech-to-Text V2 pipeline with speaker diarization (Chirp 2 model): `transcribe_recording()` in sessions.py handles both inline (<10MB) and batch (>10MB) transcription with automatic routing. Speaker diarization configured for 2 speakers (clinician + client). Output formatted as labeled transcript (`Speaker 1: ... Speaker 2: ...`).
- [x] Transcript stored as encounter (type=clinical, source=voice) with JSONB metadata: appointment_id, appointment_type, recording_file_id, duration_sec, speaker_count, word_count, transcription_source.
- [x] Encounter linked to appointment record via `encounter_id` FK. Appointment status auto-updated to 'completed' after successful transcription.
- [x] Configurable post-transcription cleanup: `recording_config` table stores per-clinician preferences (delete_after_transcription default true, auto_process default true). Recording deleted from Drive after transcription by default to minimize PHI storage.
- [x] Post-transcription reconfirmation: after recording is processed for a recurring appointment, automatically triggers reconfirmation email flow (C5) for the next appointment in the series.
- [x] Recording pipeline status tracking: `recording_status` column on appointments (pending/processing/completed/failed/skipped) with `recording_error` for failure diagnostics. `recording_file_id` stores Drive file ID.
- [x] Manual processing: `POST /api/sessions/process/{appointment_id}` (clinician-only) for retrying failed recordings or manually triggering when auto-process is disabled.
- [x] Recording status dashboard: `GET /api/sessions/recording-status` returns appointments grouped by recording status (completed/processing/failed/pending).
- [x] Recording config API: `GET/PUT /api/sessions/config` for clinician to configure delete-after-transcription and auto-process preferences.
- [x] Transcript viewer: `GET /api/sessions/{appointment_id}/transcript` returns the encounter transcript for a processed session (clinician sees all, clients see only their own).
- [x] Migration 007: recording_file_id, recording_status, recording_error, recording_processed_at columns on appointments; recording_config table; indexes for cron polling.
- [x] Dependencies added: google-cloud-speech, google-cloud-storage, google-api-python-client, google-auth in API requirements.txt.
- [x] All endpoints follow existing auth patterns (cron secret for cron, require_role for clinician-only, row-level access for clients). Full HIPAA audit logging on all recording operations.

---

## Component 7: Consent Doc Generation + Email at Booking
**Status: 100% done**

What exists:
- [x] 6 document templates (React components) dynamically populated from practice_profile
- [x] Full signing flow (signature canvas, stored signatures, one-click reuse)
- [x] Signing page with inline auth gate (works from email links)
- [x] Gmail API email delivery with dynamic practice name branding
- [x] SHA-256 content hashing, HIPAA audit logging
- [x] Auto-trigger when intake appointment (assessment/90791) is booked: generates consent package with all 6 documents, populates with client data + practice_profile, sends signing email automatically
- [x] Client signs consent docs before the session (signing page works from emailed links, reminder emails prompt completion)
- [x] Runtime template population from client profile + practice_profile: client name, DOB, address, phone, email, insurance info, emergency contact + clinician name, credentials, practice address, license info, rates, NPI
- [x] Clinician can see signing status from portal: client list shows "X/Y signed" badge per client, client detail page shows progress bar + per-package status breakdown, `GET /api/documents/status/{client_id}` endpoint
- [x] Unsigned docs alert before session: dedicated cron endpoint `POST /api/cron/check-unsigned-docs` sends client reminder email with signing link (24h before) and clinician alert email (2h before session) if docs remain unsigned
- [x] 24h reminder emails (C5 cron) include unsigned document count and signing link when applicable
- [x] Document package emails use dynamic practice name from practice_profile (no hardcoded names)

---

## Component 8: AI Note Generation
**Status: 100% done**

Notes live in Cloud SQL (HIPAA-compliant). Clinician views/edits in the Trellis portal — no Google Docs dependency.

What exists:
- [x] Transcript → Gemini 2.5 Flash with appointment metadata determining note type. Note generation service at `backend/shared/note_generator.py` with carefully crafted clinical prompts. Appointment type drives format: assessment → biopsychosocial, individual/individual_extended → SOAP or DAP.
- [x] Intake assessment (90791): comprehensive biopsychosocial assessment including identifying info, presenting problem, HPI, psychiatric/substance/medical/family/social history, Mental Status Examination, DSM-5 diagnostic impressions with ICD-10 codes, risk assessment, treatment recommendations, clinical summary.
- [x] Progress note (90834/90837): SOAP format (Subjective, Objective, Assessment, Plan) with treatment plan goal progress tracking. Also supports DAP format (Data, Assessment, Plan). Clinician preference or appointment type determines format.
- [x] Generated note stored in `clinical_notes` table (draft status). Links to source encounter via encounter_id. Note format stored (SOAP/DAP/narrative). Supports regeneration with clinician feedback.
- [x] In-app note viewer/editor in clinician portal at `/notes/:noteId`. Structured section-based editor (textarea per section for MVP — TipTap/Lexical in C9). Shows note format label, status badge, client info, metadata. Supports save, status transitions (draft ↔ review), regeneration. Source transcript viewable in side panel.
- [x] Unsigned notes queue on dashboard links to note editor. Dashboard widget links directly to `/notes/{id}` for each unsigned note. Client detail page notes section links to editor. "Generate Note" button on encounters with transcripts in client detail page.
- [x] Each note links back to its source encounter/transcript. Note editor shows encounter type, source, date, duration. "View Transcript" toggle displays the full source transcript alongside the note for reference.
- [x] API endpoints: `POST /api/notes/generate` (generate from encounter), `GET /api/notes/{id}` (full note with encounter data), `PUT /api/notes/{id}` (update content/status), `GET /api/notes/unsigned` (dashboard widget). All clinician-only with HIPAA audit logging.
- [x] Auto-generation support: `POST /api/notes/generate` can be called from session processing pipeline or manually from the client detail page "Generate Note" button on any encounter with a transcript.

### Practice-Wide AI Assistant (Portal RAG)
- [x] Gemini 2.5 Flash-powered assistant in a chat side panel in clinician portal. Accessible from "AI Assistant" button in ClinicianShell sidebar. Slide-over panel with conversation history, suggested queries, clear conversation.
- [x] Read-only for MVP — answers questions about practice data, no actions (actions are post-MVP). System prompt explicitly restricts to data-based answers only, no clinical advice.
- [x] Practice-wide scope: queries across all clients, encounters, clinical notes, treatment plans, appointments. Context-aware — detects mentioned client names and loads their detailed data. Keyword-aware — detects question topics (medications, unsigned notes, appointments, treatment plans) and queries relevant data.
- [x] Returns contextualized answers based on database query results. Conversation history maintained client-side and sent with each request (last 10 messages).
- [x] Has read-only access to Cloud SQL (encounters, clinical_notes, clients, treatment_plans, appointments) via structured database queries in `backend/api/routes/assistant.py`.
- [x] Example queries: "What medications has Client X mentioned?", "Which clients have treatment plan reviews due?", "Summarize my schedule this week". Suggested queries shown in empty state.
- [x] `POST /api/assistant/chat` endpoint: takes message + conversation history, queries relevant data, sends to Gemini for contextualized answer, returns response. Clinician-only with audit logging.

---

## Component 9: Note Signing + Locking
**Status: 100% done**

Notes are reviewed and signed entirely within the Trellis portal using an in-app TipTap rich text editor. Structured sections (SOAP/DAP/biopsychosocial headers) with inline editing. Familiar EHR-style workflow — no Google Docs dependency.

What exists:
- [x] In-app rich text note editor (TipTap) with structured SOAP/DAP/biopsychosocial section templates. Per-section editor with toolbar supporting bold, italic, underline, headings (H3/H4), bullet lists, ordered lists. Content stored as HTML. `frontend/src/components/notes/SectionEditor.tsx`.
- [x] Clinician reviews AI-generated note, edits inline as needed. TipTap editors are editable in draft/review status, read-only when signed. Full toolbar with formatting controls.
- [x] "Sign Note" button in note editor header: saves pending changes, opens signing modal with stored signature (one-click reuse from consent doc signing pattern) or draw-new-signature canvas. On sign: locks note (status -> signed), records signed_at timestamp and signed_by, computes SHA-256 content hash, stores signature data. `POST /api/notes/{id}/sign` endpoint.
- [x] PDF generated on sign (stored as bytea in clinical_notes.pdf_data). Professional clinical PDF with practice header (name, address, NPI, credentials), client info, note content with section headers, rendered signature image, signed timestamp, content hash for verification. Uses fpdf2. "Download PDF" button on signed notes. `GET /api/notes/{id}/pdf` endpoint. `backend/shared/note_pdf.py`.
- [x] Audit events logged: signing event (who signed, when, content hash, note_id, client_id, encounter_id, pdf_generated), PDF download events, amendment creation events, all view/update events. All to audit_events table (HIPAA compliance).
- [x] clinical_notes status: draft -> review -> signed -> amended. Signed notes are immutable (editor becomes read-only). Signed note info banner shows signature image, signed_by, signed_at, content_hash. Amendment workflow: "Amend Note" button on signed notes creates a NEW clinical_notes record with amendment_of FK pointing to original. Amendment has its own draft -> sign cycle. Original note remains unchanged (status updated to 'amended'). Amendment history displayed on note view with links to original and all amendments. `POST /api/notes/{id}/amend`, `GET /api/notes/{id}/amendments` endpoints. `frontend/src/components/notes/AmendmentHistory.tsx`.
- [x] Signed note triggers billing doc generation (Component 11): billing_trigger audit event logged after signing with metadata (trigger: note_signed, note_format, client_id, encounter_id, content_hash, awaiting: superbill_generation). C11 can query this for pending superbill generation.
- [x] Migration 008_note_signing.sql: added content_hash, amendment_of (self-referencing FK), signature_data, pdf_data (bytea) columns to clinical_notes. Indexes for amendment lookups and signed note queries.
- [x] Stored signature reuse: `GET /api/notes/signing/signature` endpoint fetches clinician's stored signature. Signing auto-updates stored signature via `upsert_stored_signature`. Reuses SignatureCanvas and SignatureConfirm components from consent doc signing (C7). `frontend/src/components/notes/NoteSigningModal.tsx`.
- [x] TipTap CSS styles in `frontend/src/index.css` for editor and read-only content rendering.
- [x] `useApi.getBlob()` method added for binary PDF download support.

---

## Component 10: Treatment Plan Generation
**Status: 100% done**

What exists:
- [x] `treatment_plans` table (diagnoses/ICD-10 JSONB, goals/objectives JSONB, interventions, target dates, review schedule, status, versioning, linked to encounters + previous versions)
- [x] Treatment plan CRUD in db.py (create, get, get_active, update with auto-versioning)
- [x] Full AI-generated draft after intake assessment is signed (from intake note + encounter data). When a biopsychosocial assessment (narrative/90791) note is signed, a treatment plan is automatically generated via Gemini 2.5 Flash. Generates DSM-5 diagnoses with ICD-10 codes, SMART treatment goals with measurable objectives, evidence-based interventions, target dates, and review schedule. `backend/shared/treatment_plan_generator.py`.
- [x] In-app treatment plan editor at `/treatment-plans/:planId`. Structured editors for diagnoses (add/remove ICD-10 codes with type/rank), goals with measurable objectives (add/remove/edit with status tracking), and interventions (add/remove per goal). TipTap rich text editor for presenting problems section (reuses `SectionEditor` from C9). Review date picker. `frontend/src/pages/TreatmentPlanEditorPage.tsx`.
- [x] Clinician review + edit + sign workflow. Same signing flow as notes (C9): draft -> review -> signed -> locked. Reuses stored signature (one-click reuse) and signature canvas from consent doc signing. SHA-256 content hashing, HIPAA audit logging. `POST /api/treatment-plans/{id}/sign` endpoint. Signing modal adapted for treatment plans.
- [x] PDF generated on sign. Professional treatment plan PDF with practice header, client info, diagnoses table, goals with objectives and interventions, review schedule, clinician signature, content hash. Stored as bytea. `GET /api/treatment-plans/{id}/pdf` for download. `backend/shared/treatment_plan_pdf.py`.
- [x] "Update Treatment Plan" button available from client detail page and treatment plan editor. AI regenerates/updates based on all encounters + notes since last version via `POST /api/treatment-plans/update/{id}`. Creates a new version (auto-versioning), previous version preserved as superseded.
- [x] Treatment plan versioning display. Version history panel on treatment plan editor shows all versions with version number, status, dates, links to view previous versions (read-only). Current vs historical version indicator. `GET /api/treatment-plans/client/{id}/versions` endpoint.
- [x] Treatment plan feeds into progress note generation. `note_generator.py` injects active treatment plan context (diagnoses, goals, objectives, presenting problems) into SOAP/DAP/narrative prompts. `notes.py` route fetches active treatment plan via `get_active_treatment_plan()` before generating notes.
- [x] Treatment plan feeds into billing docs. `get_active_treatment_plan()` API returns diagnoses with ICD-10 codes for C11 superbill generation. `GET /api/clients/{id}/treatment-plan` endpoint available.
- [x] Tracked in clinician portal. Client detail page treatment plan section enhanced with: status badge, version indicator, diagnoses list, goal count, review date, "Open in Editor" link, "Update Plan (AI)" button, "Generate Treatment Plan (AI)" button (when no plan exists). Dashboard: "Treatment Plans Due for Review" widget showing plans with review dates approaching within 14 days. `GET /api/treatment-plans/due-for-review` endpoint.
- [x] Migration 009: `content_hash`, `signature_data`, `pdf_data` columns on `treatment_plans` for signing workflow. Indexes for status and review date lookups.
- [x] API endpoints: `POST /api/treatment-plans/generate`, `POST /api/treatment-plans/update/{id}`, `GET /api/treatment-plans/{id}`, `PUT /api/treatment-plans/{id}`, `POST /api/treatment-plans/{id}/sign`, `GET /api/treatment-plans/{id}/pdf`, `GET /api/treatment-plans/client/{id}/versions`, `GET /api/treatment-plans/due-for-review`, `GET /api/treatment-plans/signing/signature`. All clinician-only with HIPAA audit logging. `backend/api/routes/treatment_plans.py`.

---

## Component 11: Billing Document Generation
**Status: 100% done**

Superbill is the core billing document for MVP. CMS-1500 PDF deferred (payer portals have their own web forms). No clearinghouse integration for MVP.

What exists:
- [x] Signed note triggers automatic superbill generation (PDF). When a clinical note is signed via `POST /api/notes/{id}/sign`, a superbill is auto-generated with CPT code, diagnosis codes, fee, and PDF. The signing response includes `superbill_generated` and `superbill_id`. Superbill generation failure does not block note signing.
- [x] Superbill includes: client info (name, DOB, address, phone, email, insurance), provider info (NPI, tax ID, license, credentials, address), date of service, CPT code (from appointment type: 90791/90834/90837), diagnosis codes (ICD-10 from active treatment plan), fee (from practice_profile rates), amount paid/owed with balance calculation.
- [x] All data sourced from: client record (insurance info — payer, member ID, group number), appointment metadata (CPT code via type mapping), treatment plan (diagnosis codes via `get_active_treatment_plan()`), practice_profile (NPI, tax ID, address, license, rates).
- [x] Superbill PDF stored in Cloud SQL (pdf_data BYTEA on superbills table) and linked to appointment + clinical note via FKs. Professional two-column PDF with practice header, provider/patient info sections, service details table, ICD-10 diagnosis table, fee totals, signature line. `backend/shared/superbill_pdf.py` using fpdf2.
- [x] "Download Superbill" available from clinician portal per session — PDF download button on billing page table rows and client detail superbills section. `GET /api/superbills/{id}/pdf` endpoint returns PDF as binary download.
- [x] Claim data summary view in portal — dedicated Billing page at `/billing` with filterable superbill list showing date, client, service (CPT code + description), diagnosis codes, fee, paid amount, status. Summary cards show total billed, total paid, and outstanding balance. Each row links to client detail. `GET /api/superbills` endpoint with optional status filter.
- [x] Clinician portal tracks billing status per session: generated / submitted / paid / outstanding. Status dropdown on each superbill row in billing table. `PATCH /api/superbills/{id}/status` endpoint for status updates with amount_paid tracking. Status badges color-coded (blue/amber/green/red).
- [x] Cash-pay/OON: clinician can email superbill directly to client for out-of-network reimbursement. `POST /api/superbills/{id}/email` endpoint sends styled HTML email with PDF attachment via Gmail API. Email button on billing page rows. `send_email_with_attachment()` function added to mailer.py for PDF attachments.
- [x] Manual payment tracking: clinician can mark sessions as paid/unpaid to track outstanding balances. "Mark as Paid" auto-sets amount_paid to fee amount. Per-client balance tracking via `GET /api/superbills/client/{id}` with `client_balance` summary (total_billed, total_paid, outstanding). Global summary on billing page.
- [x] Superbill generation also serves as fallback for payers not supported by Stedi (see Post-MVP).
- [x] `superbills` table with id, client_id, appointment_id (FK), note_id (FK), clinician_id, date_of_service, cpt_code, cpt_description, diagnosis_codes (JSONB), fee, amount_paid, status, pdf_data (BYTEA), timestamps. Migration 010_superbills.sql with indexes on client_id, clinician_id, note_id, status, date_of_service.
- [x] "Billing" nav item added to ClinicianShell sidebar (between Schedule and Settings). `/billing` route added to App.tsx.
- [x] Client detail page superbills section wired up — shows list with date, CPT code, amount, status badge, download button. Links to billing page. Replaces placeholder.
- [x] All endpoints clinician-only via `require_role("clinician")`. HIPAA audit logging on all superbill operations (generation, view, PDF download, status update, email).
- [x] `useApi.patch()` method added for PATCH request support.
- [x] API endpoints: `POST /api/superbills/generate`, `GET /api/superbills`, `GET /api/superbills/client/{id}`, `GET /api/superbills/{id}`, `GET /api/superbills/{id}/pdf`, `PATCH /api/superbills/{id}/status`, `POST /api/superbills/{id}/email`. `backend/api/routes/billing.py`.

---

## Component 12: Client Portal
**Status: 100% done**

What exists:
- [x] Client auth + onboarding flow (insurance upload, voice/form intake)
- [x] Voice agent access
- [x] Signing page for consent documents
- [x] ClientShell layout component — sidebar nav on desktop, bottom nav on mobile. Navigation: Home, Appointments, Documents, Billing. User info and logout. `frontend/src/components/ClientShell.tsx`
- [x] Client Dashboard at `/client/dashboard` — next upcoming appointment with date/time/Meet link/"Join Session" button, documents needing signature (count + link), pending reconfirmation actions, quick action buttons (appointments, documents, billing, voice intake). `frontend/src/pages/client/ClientDashboardPage.tsx`
- [x] Upcoming appointments view at `/client/appointments` — all upcoming appointments with date, time, type, Meet link, "Join" button. Past appointments section (last 10). Cancel appointment from portal.
- [x] Self-scheduling: client can book sessions from available slots in the portal. Shows session type (assessment/individual), loads available time slots from clinician's availability, client picks a slot, appointment created with Calendar event + Meet link. Uses existing `GET /api/appointments/slots` and `POST /api/appointments` endpoints.
- [x] Recurring series setup: after first session, client picks cadence (weekly/biweekly/monthly) and preferred time from available slots. Creates 4 recurring appointments at chosen cadence. Dedicated "Recurring" tab in appointments page.
- [x] Reconfirmation action (in-app): pending reconfirmations shown on dashboard and appointments page. Client can confirm or skip/cancel directly from the portal without needing email links. Backend endpoints: `GET /api/appointments/my/pending-reconfirmations`, `POST /api/appointments/my/{id}/confirm`, `POST /api/appointments/my/{id}/cancel`. `backend/api/routes/scheduling.py`
- [x] Documents to sign: pending consent forms listed with "Sign Now" links to signing page, progress bar showing signed/total count. `frontend/src/pages/client/ClientDocumentsPage.tsx`
- [x] Signed document archive: view previously signed consent form packages with completion status and "View" links.
- [x] Superbill archive at `/client/billing` — list of superbills with date of service, CPT code, fee, payment status, diagnosis codes. Download superbill PDFs for insurance reimbursement. Balance summary (total billed, paid, outstanding). Backend endpoints: `GET /api/superbills/my`, `GET /api/superbills/my/{id}/pdf`. `backend/api/routes/billing.py`, `frontend/src/pages/client/ClientBillingPage.tsx`
- [x] Mobile-responsive layout: bottom navigation on mobile (fixed, safe-area aware), sidebar on desktop. Touch-friendly buttons (min 44px tap targets), responsive grid layouts, overflow scrolling. All client pages use `px-4 md:px-8` padding pattern, `max-w-3xl mx-auto` content width.
- [x] App.tsx routing: all client routes under `/client/*` prefix, guarded with `ClientRoute` (requires client role). Role-based redirect: `/` redirects clinicians to `/dashboard` and clients to `/client/dashboard`. Client routes wrapped in ClientShell layout. `frontend/src/App.tsx`
- [x] Row-level access control enforced on all client-accessible endpoints — clients can only access their own records (appointments, documents, superbills). Uses existing `enforce_client_owns_resource` pattern from C1.

---

## Component 13: Discharge Workflow
**Status: 100% done**

Simple discharge — no special appointment type or client packet for MVP.

What exists:
- [x] "Discharge Client" button on client detail page in clinician portal. Red-styled action button in the client actions section. Shows "Discharged [date]" badge when already discharged. Opens multi-step discharge confirmation modal.
- [x] Pre-discharge status check: `GET /api/clients/{id}/discharge-status` returns unsigned notes count, future appointments count, recurring series count, and completed sessions count. Shown in confirmation modal so clinician can review before proceeding.
- [x] AI-generated discharge summary from full treatment history using Gemini 2.5 Flash. `backend/shared/discharge_generator.py` generates structured JSON with 8 sections: reason for treatment, course of treatment, progress toward goals, diagnoses at discharge, discharge recommendations, medications at discharge, risk assessment, clinical summary. Uses all encounters, clinical notes, treatment plan, and appointment history as context. Fallback to placeholder content if AI generation fails.
- [x] Discharge summary stored as a clinical note (format=discharge) with its own encounter (type=clinical, source=clinician). Same review/sign flow as other notes — created as draft, clinician reviews in note editor, signs via standard signing workflow. Note editor supports discharge format with all 8 sections. `NoteEditorPage.tsx` updated with `FORMAT_SECTIONS.discharge` and `FORMAT_LABELS.discharge`.
- [x] Cancel all future appointments + delete Calendar events. Discharge endpoint iterates all future scheduled appointments, deletes Calendar events via `delete_calendar_event()`, sets appointment status to 'cancelled'. Also ends all active recurring series by setting `series_cancelled=TRUE` on recurrence IDs.
- [x] Final superbill check: pre-discharge status includes unsigned notes count. Clinician is warned in modal if there are unsigned notes (which would generate superbills when signed). Outstanding session billing handled through existing note signing -> superbill auto-generation pipeline.
- [x] Client status updated to 'discharged' with `discharged_at` timestamp via `discharge_client()` in db.py.
- [x] Client portal shows discharged state:
  - Dashboard: "Your treatment has concluded" banner with discharge date, read-only records section (documents + billing), voice intake and appointments quick actions hidden. `ClientDashboardPage.tsx`
  - Appointments: discharged info banner, "Book Session" and "Recurring" tabs hidden, "Book a session" link removed from empty upcoming state, past appointment history remains visible. `ClientAppointmentsPage.tsx`
  - Documents: discharged info banner, "Needs Your Signature" section hidden, subtitle changed to read-only messaging, signed documents archive remains viewable. `ClientDocumentsPage.tsx`
  - Billing: fully functional — superbill viewing and PDF download remain available for insurance reimbursement. `ClientBillingPage.tsx`
- [x] Comprehensive HIPAA audit logging at every discharge step: appointment cancellations (per appointment), series endings (per series), discharge summary generation, encounter creation, note creation, client status update. All logged to `audit_events` table with actor, action, resource details, and metadata.
- [x] Multi-step discharge modal UX in clinician portal: "confirm" step (warning, pre-discharge summary, optional reason textarea) -> "processing" step (spinner with progress) -> "complete" step (success summary with cancelled appointment count, ended series count, link to review discharge note). `ClientDetailPage.tsx`
- [x] Discharge reason captured and stored in encounter JSONB data and clinical note content metadata.
- [x] `POST /api/clients/{id}/discharge` endpoint (clinician-only) orchestrates the full multi-step discharge process atomically. Returns note_id, encounter_id, cancelled appointment count, ended series count, completed sessions count.
- [x] Backend database functions in db.py: `get_future_appointments()`, `get_client_recurrence_ids()`, `discharge_client()`, `get_client_full_encounters()`, `get_client_full_notes()`, `get_unsigned_notes_for_client()`.

---

## Build Order Dependencies

```
1. Auth + Schema (roles, practice_profile, drop group tables)
│
├→ 2. Clinician Portal (practice profile setup, dashboard, client list)
│     ├→ 3. Landing Page (simple Trellis branding)
│     └→ 4. Voice Agent (insurance check, slot booking, confirmations)
│           ├→ 7. Consent Docs (auto-generated at booking, client signs before session)
│           └→ 5. Reconfirmation System (post-session emails, reminders, no-show detection)
│
├→ 6. Session Recording + Transcription (auto-record, STT, diarization)
│     └→ 8. AI Note Generation + Portal RAG (in-app editor, Claude Agent SDK assistant)
│           └→ 9. Note Signing (TipTap/Lexical editor, sign + lock, PDF export)
│                 ├→ 10. Treatment Plans (AI draft at intake, update anytime)
│                 └→ 11. Billing Docs (superbill generation, payment tracking)
│
├→ 12. Client Portal (self-scheduling, reconfirmation, docs, superbills)
├→ 13. Discharge (simple: discharge button, AI summary, close series)
├→ 14. HIPAA Safeguards (access controls, audit logging, session timeout, encryption, PHI-safe logs) ✓
└→ 15. Deployment Wizard (static web app, step-by-step, generates deploy script)
```

**Notes:**
- Component 14 (HIPAA) is cross-cutting — should be implemented alongside each component, not as a separate phase
- Component 15 (Deployment) can be built in parallel once the architecture stabilizes
- Component 12 (Client Portal) builds incrementally as backend features land

---

## Component 14: HIPAA Technical Safeguards
**Status: 100% done**

Trellis is open-source software that therapists install into their own GCP project + Google Workspace. The therapist signs their own BAA with Google. Trellis must be fully HIPAA-compliant within that self-hosted model.

**PHI boundary:** All PHI lives exclusively in Cloud SQL + Google Drive. No PHI in logs, local files, or caches.

**Roles:** Two roles for MVP (clinician + client), schema designed to support staff roles later.

What exists:

### Access Controls
- [x] Stored role on user records (clinician vs client) — `users` table + `require_role()` middleware enforces in backend
- [x] Backend middleware that checks role on every request and rejects unauthorized access (`require_role()` dependency)
- [x] Row-level access control: all API endpoints enforce that clients can only access their own records (`enforce_client_owns_resource()` + `get_current_user_with_role()` in auth.py, ownership lookups in db.py)
- [x] Clinician access scoped to their own installation's data — inherent in self-hosted model (single-tenant: one Cloud SQL instance per practice). All queries run against the practice's own database. HIPAA access control comments added to all route files documenting the access model.
- [x] Force re-authentication for sensitive actions: `useReauth` hook + `ReauthProvider` context + `ReauthModal` component. Supports Google popup and email/password re-auth. 5-minute cache prevents excessive prompts. Used for note signing, practice profile changes, discharge. `frontend/src/hooks/useReauth.ts`, `frontend/src/components/ReauthProvider.tsx`, `frontend/src/components/ReauthModal.tsx`.

### Session Security
- [x] 15-minute fixed inactivity timeout with warning at 13 minutes, auto-logout at 15. `useSessionTimeout` hook tracks mouse, keyboard, touch, scroll events. Warning modal shows countdown. Auto-logout clears Firebase auth and redirects to `/`. Integrated into both ClinicianShell and ClientShell. `frontend/src/hooks/useSessionTimeout.ts`, `frontend/src/components/SessionTimeoutWarning.tsx`.
- [x] Secure session tokens: Firebase Auth issues 1-hour ID tokens. Frontend `getIdToken()` auto-refreshes. Backend `verify_id_token()` validates signature, expiry, and issuer on every request. DEV_MODE bypass clearly documented as dev-only.

### Encryption
- [x] Cloud SQL encryption at rest: Google-managed AES-256 encryption enabled by default on all Cloud SQL instances. All data on disk encrypted transparently.
- [x] HTTPS-only: Cloud Run enforces HTTPS with managed TLS certificates. WebSocket connections use wss:// in production. Firebase Auth SDK uses TLS for all operations.
- [x] Database connections use SSL (Cloud SQL Proxy or direct SSL). Voice relay audio is pass-through to Gemini Live API via TLS (not stored).
- [x] Documented in CLAUDE.md "HIPAA Technical Safeguards" section with deployment checklist.

### Audit Logging
- [x] Comprehensive audit logging: all reads AND writes of PHI logged to `audit_events` table. Every route file audited and logging added to all endpoints that access PHI (intake submission, practice profile views, availability views, appointment listings, session transcripts, superbill listings, note amendments). `backend/api/routes/*.py` — all 10 route files have complete audit coverage.
- [x] Audit events record: user_id, action, resource_type, resource_id, ip_address, user_agent, metadata (JSONB), created_at.
- [x] Audit log is append-only: no UPDATE or DELETE operations permitted on `audit_events` table (enforced at application level, documented for DB-level enforcement in deployment).
- [x] Audit log viewer in clinician portal at `/settings/audit-log`. Paginated table with timestamp, user, action, resource type, IP address, details. Filterable by action type, resource type, date range. Read-only. Accessible from settings sub-navigation (Profile | Audit Log tabs). `backend/api/routes/audit.py`, `frontend/src/pages/AuditLogPage.tsx`.
- [x] Viewing the audit log itself is recorded as an audit event.

### PHI-Safe Logging
- [x] All application logging statements audited across entire codebase — no PHI in stdout/stderr. Fixed PHI leaks in: alerts.py (client names), mailer.py (email addresses), booking_emails.py (client names, emails), billing.py (recipient emails), gemini_session.py (tool call args, tool results), documents.py (client IDs).
- [x] PHI-safe logging utility: `backend/shared/safe_logging.py` — `PHISafeFormatter` with email redaction regex as safety net. `configure_safe_logging()` configures root logger with safe formatter. Applied to both API and relay services.
- [x] PHI-safe request logging middleware: `backend/shared/request_logging.py` — `RequestLoggingMiddleware` logs method, path, status, duration, client IP. Does NOT log request/response bodies, query parameters, or authorization header values. X-Request-ID header for debugging. Applied to both API and relay services.

### Backup & Recovery
- [x] Cloud SQL automated daily backups enabled by default with 7-day retention. Point-in-time recovery (PITR) via WAL archiving. Recovery via GCP Console or gcloud CLI.
- [x] Backup encryption: GCP default AES-256 encryption on all backup data.
- [x] Documented in CLAUDE.md "HIPAA Technical Safeguards" section under Backup & Recovery and Deployment Security Checklist.

### Data Integrity
- [x] SHA-256 content hashing on all signed documents: clinical notes (`content_hash` on `clinical_notes`), treatment plans (`content_hash` on `treatment_plans`), consent documents (`content_hash` on `documents`). Hash computed at signing time from canonical JSON.
- [x] Immutable signed notes: signed clinical notes cannot be edited (status check blocks UPDATE). Amendments create new records with `amendment_of` FK referencing original. Original note status updated to 'amended' but content preserved. Same pattern for treatment plans (superseded, not modified).
- [x] Signer metadata: signature PNG, signer IP, user-agent, timestamp stored on all signed records for legal compliance.

---

## Component 15: Deployment + Distribution
**Status: 100% done**

Therapists install Trellis into their own GCP project and Google Workspace. The repo includes both a step-by-step guide (open source) and a configuration wizard. A paid service offering will also help therapists through the process.

**Deployment model:** Configuration wizard walkthrough → deployment script.

The wizard walks the therapist through manual prerequisites one at a time (create GCP project, enable APIs, sign BAA, enable Workspace delegation, etc.). At each step, they paste back the resulting info (project ID, service account email, etc.). Once all prerequisites are gathered, the wizard generates a deployment script that provisions everything automatically.

What exists:
- [x] Static web app wizard (hosted on GitHub Pages) — no local install needed to start. Self-contained HTML/CSS/JS app at `wizard/` directory (`wizard/index.html`, `wizard/style.css`, `wizard/wizard.js`). Modern, clean UI with Trellis branding, progress indicators, step-by-step navigation, input validation, and deployment script generation.
- [x] Each wizard step: instruction + relevant links → therapist completes in GCP console → pastes result back into wizard. 9 steps total with clear instructions, external links, gcloud commands, and confirmation checkboxes.
- [x] Wizard steps include:
  1. Welcome + overview of what will be set up
  2. Create GCP project + enable billing (instructions, Project ID input with format validation)
  3. Sign Google Workspace BAA (instructions for both Workspace and Cloud BAAs with links)
  4. Enable required APIs (complete gcloud command with all 12 APIs listed, visual API grid)
  5. Create service account + download key (gcloud commands for SA creation, role grants, key download)
  6. Enable domain-wide delegation (step-by-step instructions, all 4 OAuth scopes, sender email input)
  7. Configure Firebase Auth (Google + Email/Password providers, all 5 Firebase config value inputs)
  8. Set up custom domain + DNS records (domain input, auto-generated DB password + cron secret)
  9. Review configuration summary + generate/download deployment script
- [x] Wizard validates inputs at each step where possible: Project ID format validation (regex), service account email format (.iam.gserviceaccount.com), Firebase API key prefix (AIza), Messaging Sender ID numeric check, domain format validation, email format validation, required field checks with inline error messages.
- [x] Wizard generates a deployment script (gcloud CLI) that provisions: Cloud SQL instance (PostgreSQL 15, backups enabled, PITR, auto-increase storage), runs all migrations, builds and deploys Cloud Run services (API + relay + frontend) via Cloud Build + Artifact Registry, configures secrets via Secret Manager, sets up 5 Cloud Scheduler jobs (process-recordings, send-reminders, check-reconfirmations, check-no-shows, check-unsigned-docs), enables automated backups, configures HTTPS-only on Cloud Run, maps custom domain, runs post-deployment health check.
- [x] Generated script is downloadable + copyable — therapist runs it in Cloud Shell or local terminal. Download button saves `deploy.sh`, copy button copies to clipboard, preview accordion shows full script. Script includes color output, preflight checks, error handling (`set -euo pipefail`), and detailed post-deployment instructions.
- [x] Step-by-step setup guide in repo (`SETUP.md`) for those who prefer fully manual installation. Comprehensive guide covering: prerequisites, all setup steps with commands, architecture overview diagram, post-deployment verification, first-login onboarding, and detailed troubleshooting section (database, Firebase, APIs, recordings, domain, Cloud Run debugging, re-running migrations).
- [x] Dockerfiles for all three services: `backend/api/Dockerfile` (Python 3.12, non-root user, health check, 2 workers), `backend/relay/Dockerfile` (Python 3.12, non-root user, health check, single worker for WebSocket), `frontend/Dockerfile` (multi-stage: Node 20 build → nginx 1.27 serve, SPA routing, security headers, gzip, asset caching, Firebase config via build args).
- [x] Post-deployment health check endpoint (`POST /api/health`) that verifies: DB connection (pool connectivity + PostgreSQL version), Firebase Auth configuration (SDK initialization + user listing), Google Calendar API access (calendarList via delegation), Gmail API access (profile via delegation), Drive API access (file listing via delegation), Speech-to-Text V2 API access (recognizer listing). Returns per-check status with descriptive messages and overall status (ok/degraded/warning) with elapsed time. `backend/api/routes/health.py`, registered in `main.py`.
- [x] First-launch onboarding: after deployment, clinician's first login triggers role selection via `RoleSelector` component (AuthProvider detects unregistered user), then redirects to dashboard where "Complete your practice profile" banner prompts setup via practice profile settings page. Full flow: deploy → visit domain → clinician login → role selection → dashboard → practice profile setup → ready to accept clients.

---

## Post-MVP (Not in scope but planned)
- **Stedi clearinghouse integration** (auto-submit claims) — planned for shortly after MVP. Superbill generation serves as fallback for unsupported payers.
- Instant eligibility/VOB verification (via Stedi)
- Multi-clinician / group practice support
- Group therapy features (tables removed from MVP)
- Admin portal
- Payment processing / client ledger
- RBAC (roles beyond client/clinician)
- Landing page customization (branding, colors, therapist-specific content)
- SMS/push notifications
- Voice agent for ongoing client interactions (virtual receptionist)
- Phone-based voice agent (Twilio integration)
