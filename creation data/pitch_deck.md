# SOR — Pitch Deck Brief

## For deck designer / presentation build-out

---

## Slide 1: Title

**SOR**
AI-Native Behavioral Health Platform

*We don't sell software licenses. We onboard practices into the age of AI.*

---

## Slide 2: The Problem

Behavioral health practices are drowning in admin and losing revenue at every step:

- **Clinicians spend 40-50% of their time on documentation**, not patients
- **Client drop-off during onboarding** — cold forms, phone tag, no-shows. Potential clients ghost because intake is friction-heavy
- **Revenue leaks everywhere** — slow insurance verification, coding errors, missed claim submissions, uncontested denials
- **Billing companies take 8-12% of collections** ($12,000-$18,000/year for a solo clinician) for work that's largely mechanical
- **EHR software is expensive and dumb** — $70-100/clinician/month for basic scheduling and notes, with AI features bolted on as $35+/month add-ons
- **Data is siloed** — intake system doesn't talk to notes, notes don't talk to billing, billing doesn't talk to clinical defense. Every handoff is a leak.

**The result: practices pay $13,000-$20,000/year per clinician in software and billing costs, and still lose revenue to inefficiency.**

---

## Slide 3: The Solution

**SOR is an AI-native operating system for behavioral health practices.**

It automates the entire lifecycle — from the first client conversation to the paid claim — on infrastructure the practice owns.

- Open-source EHR core (free for solo clinicians)
- Installs into the practice's own Google Cloud + Workspace
- AI agents handle intake, documentation, billing, compliance, and more
- Every data point feeds every other system — no silos, no handoffs, no leaks

> **"Other EHRs are adding AI features. We're building AI practices."**

---

## Slide 4: How It Works — The Flywheel

```
Client talks to AI intake agent (voice, multi-session, remembers everything)
    |
    v
Insurance card photo --> AI extracts --> instant eligibility verification (Stedi)
    |
    v
Intake booked automatically, Meet link generated
    |
    v
Session recorded + transcribed (individual or group)
    |
    v
AI generates clinical notes (SOAP/DAP/narrative) with full client context
    |
    v
Clinician reviews + signs with one click
    |
    v
Claim auto-submitted with correct codes
    |
    v
AI tracks claim status, auto-responds to denials with clinical justification
    |
    v
Payment posted, reconciled, dashboard updated
    |
    v
All data feeds back into smarter AI for the next session
```

**Every interaction makes the system smarter. Every automation compounds.**

---

## Slide 5: Product — The AI Agent Ecosystem

### Core Agents (included)

**Intake Agent**
- Voice-powered onboarding via Gemini Live — feels like talking to a person, not filling out forms
- Remembers past conversations across sessions — clients who ghost come back to a warm conversation, not a cold form
- Can console, coach, and re-engage over multiple touchpoints
- Handles insurance card extraction (photo to structured data)
- Instant VOB via Stedi, auto-books intake when verified

**Documentation Agent**
- Records sessions (individual + group) with purpose-built microphones
- Auto-transcribes and generates SOAP/DAP/narrative notes
- Full client context — intake history, prior sessions, treatment plans, insurance — produces richer notes than any human scribe
- Group session workflow: post-group AI debrief with clinician to disambiguate who said what, then generates individual progress notes for every participant
- Clinician reviews and signs — one click

**Billing Agent**
- Auto-submits claims on note signing
- Tracks submission status in real-time
- Auto-responds to denials with clinical justification (AI has the full record to defend treatment)
- Manual backup: generates billing documents for edge cases
- Dashboard: real-time claims pipeline, revenue, denial rates

**Scheduling Agent**
- Google Calendar integration with auto-generated Meet links
- Individual + recurring + group appointments
- Availability management, slot computation, booking flow

**Compliance Agent**
- HIPAA audit trail (append-only, every document access logged)
- SHA-256 content hashing on all signed documents
- Signer IP/UA captured at signing time

### Future Agents (service contracts / custom builds)

| Agent | Capability |
|---|---|
| Prior Authorization | Auto-generate and submit prior auth requests with clinical justification |
| Level of Care Assessment | AI-assisted assessment tools for clinicians, recommends IOP/PHP/residential |
| Treatment Planning | Generate individualized treatment plans from full client history |
| Outcome Tracking | Monitor client progress across sessions, flag stagnation or regression |
| Predictive Analytics | Forecast denial likelihood before submission, optimize coding |
| Client-Facing Agent | Between-session check-ins, crisis screening, psychoeducation, homework reminders |
| "Talk to Your Data" | Natural language queries over all practice data — no SQL, no report builder |

---

## Slide 6: Product — Client & Clinician Experience

### Client Portal
- AI voice intake (or traditional form — client chooses)
- Insurance card upload with AI extraction
- Sign onboarding documents (6 templates, e-signature, HIPAA-compliant)
- View/manage appointments
- Signing links work without login — zero friction for email-driven onboarding

### Clinician Portal
- Schedule view synced to Google Calendar
- Session recording controls
- Note review and signing workflow (draft -> review -> signed -> amended)
- Client history at a glance — every encounter, every data point
- Group management: enrollment, session tracking, attendance
- Level of care assessment tools
- Real-time billing dashboard

### Admin / BD Portal (future)
- Manage clinicians, set signing authority
- Create and send onboarding document packages
- Revenue dashboard, claims pipeline, denial tracking
- "Talk to your data" natural language interface

---

## Slide 7: Why GCP Is the Point

Every practice SOR onboards gets their own Google Cloud project. That's not just hosting — it's an **agentic AI sandbox**.

| GCP Capability | What It Enables |
|---|---|
| **Vertex AI** | Deploy custom models, fine-tune on the practice's own clinical data |
| **BigQuery** | Every encounter, claim, payment, denial becomes queryable history |
| **Cloud Run** | Spin up new AI agents for any workflow, scales to zero when idle |
| **Pub/Sub** | Event-driven automation (claim denied -> agent responds, payment posted -> ledger updates) |
| **Document AI** | Process any insurance document, EOB, referral, prior auth |
| **Gemini API** | Voice understanding, note generation, context compression, data analysis |
| **Google Workspace** | Native Calendar, Meet, Gmail, Drive integration — it's already their stack |
| **IAM + VPC** | Granular permissions, HIPAA-compliant by architecture |

**The practice doesn't need to know any of this on day one. But on day 300, when they ask "can the AI also handle prior authorizations?" — the answer is always yes.**

The infrastructure for every AI capability that will exist in the next 10 years is already installed.

---

## Slide 8: Group Session Notes — A Unique Capability

Raw group recordings with 8-12 participants produce unreliable individual notes. Speaker diarization fails with cross-talk, similar voices, and emotional speech. SOR solves this with a novel workflow:

```
1. Group session recorded via room microphone

2. AI transcribes + attempts speaker diarization

3. Post-session: AI has a structured debrief with the clinician
   "Tell me about Marcus's participation today"
   "What did Sarah share about her triggers?"
   "Was anyone notably quiet or disengaged?"

4. AI cross-references clinician input with transcript segments

5. Generates individual progress note for EACH client
   (using their full history for context)

6. Clinician reviews + signs each note
```

**Why this works:**
- Clinicians already do this mental review — SOR just captures it
- Clinician provides context AI can't infer (body language, engagement level, therapeutic significance)
- Captures clinical judgment in the record — matters for defensibility
- The debrief can be voice-powered too — clinician talks through the group on the drive home, AI generates all the notes

---

## Slide 9: The Math — Cost Comparison

### What practices pay today (solo clinician, $150K collections/year)

| Expense | Annual Cost |
|---|---|
| EHR software (SimplePractice/TherapyNotes) | $720 - $1,200 |
| AI note add-on | $420 |
| Clearinghouse (Waystar/Optum) | $200 - $600 |
| Billing company (8-12% of collections) | $12,000 - $18,000 |
| **Total** | **$13,340 - $20,220** |

### Competitor EHR per-seat pricing

| Platform | Per Clinician/Month | Notes |
|---|---|---|
| SimplePractice | $74 - $99 | Plus plan required for groups. AI notes $35/mo extra. ePrescribe $49/mo extra |
| TherapyNotes | $59 - $69 | $69 first clinician, $40 each additional |
| TheraNest (Ensora) | $39+ | Scales by caseload, gets expensive fast |
| ICANotes | $35 - $213 | Wide range by provider type |
| Kipu (IOP/inpatient) | $600+/mo base | Enterprise-only, custom quotes |
| Qualifacts/Netsmart | Not published | Enterprise sales, typically thousands/month |

### What SOR costs (solo clinician)

| Expense | Annual Cost |
|---|---|
| Google Workspace (1 seat) | $72 - $168 |
| GCP (Cloud Run + Cloud SQL) | $180 - $360 |
| Gemini API tokens | $60 - $180 |
| SOR RCM (3% of $150K) | $4,500 |
| **Total** | **$4,812 - $5,208** |

### The headline

> **$5,000/year vs $17,000/year. 71% cost reduction. More features. More automation. Their data. Their infrastructure.**

### At scale (5-clinician practice, $750K collections)

| | Current | SOR |
|---|---|---|
| Annual cost | $65,000 - $85,000 | $23,000 - $25,000 |
| **Savings** | | **$42,000 - $60,000/year** |

---

## Slide 10: Open Source Strategy

### The Model: Red Hat for Behavioral Health AI

The software is free. It runs on their infrastructure. **You cannot charge a monthly software fee — and you shouldn't try.** Instead, you make money on the things that actually require you.

**Open-source core (free)**
- Full EHR: intake, scheduling, notes, client portal, clinician portal
- Voice AI intake agent with multi-session memory
- Session recording + transcription + note generation
- Document signing (6 templates, e-signature, audit trail)
- Self-hostable with a single `terraform apply`
- Solo clinician gets everything they need at zero software cost

**Why open source wins:**
- **Trust** — practices see the code, own the infrastructure, control their PHI
- **Adoption** — zero-cost entry for solo clinicians (largest segment by provider count)
- **Community** — contributions improve the platform for everyone
- **Moat** — you maintain the canonical repo, ship fastest, and are the obvious vendor for everything beyond core
- **No enforcement headaches** — you never have to police licenses, gate features, or argue about seats

**The reality:** Linux is free. Red Hat made billions. The software is the distribution channel, not the product. The product is expertise and services.

---

## Slide 11: Revenue Model

### What you can't charge for (and shouldn't try)
- Monthly software license — they have the code, it's on their infra
- Per-seat fees — nothing to enforce
- Feature gating — open source means someone will fork and unlock it

### What you charge for: things that require YOU

```
Open Source Core (free)                      --> Adoption engine / marketing
  |
  +-- Onboarding (one-time, large)           --> Real work they can't DIY
  |
  +-- Managed hosting (monthly)              --> Service account into their GCP
  |
  +-- Support contracts (annual)             --> Troubleshooting, questions, guidance
  |
  +-- Customization (per engagement)         --> IOP/inpatient/custom agents
  |
  +-- Clearinghouse / RCM (% of collections) --> Recurring service revenue
  |
  +-- Hardware (session microphones)         --> Physical product
```

| Revenue Stream | Model | Why It's Enforceable |
|---|---|---|
| **Onboarding** | $5K - $25K one-time | Real work: GCP project setup, Workspace config, data migration from legacy EHR, staff training, go-live support. They can't easily DIY this. |
| **Managed Hosting** | $200 - $1,000/mo | Customer grants SOR a service account with IAM roles (Cloud Run Admin, Cloud SQL Admin, Monitoring Viewer) into their GCP project. SOR deploys updates, monitors health, manages backups, handles scaling, responds to incidents. If they stop paying, they revoke the service account — they keep everything, just manage it themselves. Not a software fee — it's DevOps-as-a-service delivered through a service account. |
| **Support Contract** | $500 - $2,000/mo (annual) | Troubleshooting, answering questions, guidance on workflows and best practices. Can be bundled with managed hosting or standalone for self-managed customers. |
| **Customization** | $5K - $50K+ per engagement | IOP/inpatient workflows, custom AI agents, state-specific compliance, integrations with their payers/systems. Bespoke work. |
| **Clearinghouse / RCM** | 2-4% of collections | This is a *service*, not software. Claims flow through your infrastructure. One config toggle to activate — path of least resistance. Switching clearinghouses is painful (re-credentialing, remapping payers, testing). |
| **Hardware (Microphones)** | $200 - $400/unit | Physical product. Purpose-built for therapy room recording + speaker diarization. |

### Revenue per customer type:

**Solo clinician (self-serve / free)**
- Revenue: $0
- Value: evangelist, community contributor, future upsell when they grow

**Solo clinician (assisted)**
- Onboarding: $5,000 one-time
- Managed hosting: $200/mo ($2,400/yr)
- RCM: 3% of $150K = $4,500/yr
- **Year 1: $11,900 | Year 2+: $6,900/yr**

**Small group practice (5 clinicians, $750K collections)**
- Onboarding: $15,000 one-time
- Managed hosting + support: $1,500/mo ($18K/yr)
- Customization: $10,000 (group workflows, custom templates)
- RCM: 3% of $750K = $22,500/yr
- **Year 1: $65,500 | Year 2+: $40,500/yr**

**IOP/Inpatient facility ($3M collections)**
- Onboarding: $25,000 one-time
- Managed hosting + support: $2,500/mo ($30K/yr)
- Customization: $50,000 (census, bed mgmt, program workflows, state reporting)
- RCM: 3% of $3M = $90,000/yr
- **Year 1: $195,000 | Year 2+: $120,000/yr**

### Why RCM is the real business

The onboarding and support are solid but linear — each customer requires work. The clearinghouse is where it compounds:
- It's a **service**, not software — you process claims, they pay per transaction
- The integration is baked into the open source code — one config toggle, path of least resistance
- Switching clearinghouses is painful (re-credentialing, payer remapping, testing)
- At 100 practices averaging $500K collections: **$1.5M/year in RCM revenue alone**
- As volume grows, payer data gets richer, denial prediction improves, service gets genuinely better

**The compounding effect:** a practice using SOR's RCM + your support contract + custom workflows built by your team has zero reason to leave. The software is free, but the ecosystem is irreplaceable.

---

## Slide 12: The Moat

1. **Canonical repo** — forks will exist, but you ship fastest, know the codebase best, and set the roadmap
2. **Clearinghouse lock-in** — trivial to activate with SOR, painful to DIY or migrate away from. Recurring revenue on every claim.
3. **Service expertise** — your team builds AI agents for behavioral health full-time. No competitor or freelancer matches that depth.
4. **Data flywheel** — every practice you onboard generates patterns (anonymized) that make the agents smarter for everyone
5. **Hardware integration** — purpose-built mics work best with the SOR recording pipeline
6. **Switching cost** — GCP project + Workspace + agents + workflows + historical data = deep roots. Switching means rebuilding everything.
7. **Network effects** — as clearinghouse volume grows, payer data gets richer, denial prediction improves, everyone benefits

---

## Slide 13: The Platform Stack (Visual)

```
+-----------------------------------------------------+
|              CUSTOM AI AGENTS                        |
|  Prior auth - Outcome tracking - Predictive analytics|
|  "Talk to your data" - Client-facing agent           |
+-----------------------------------------------------+
|              CORE AI AGENTS                          |
|  Intake - Documentation - Billing - Scheduling       |
|  Compliance - Group debrief                          |
+-----------------------------------------------------+
|              OPEN SOURCE EHR                         |
|  Client portal - Clinician portal - Documents        |
|  Signing - Templates - Audit trail                   |
+-----------------------------------------------------+
|              THEIR GCP + WORKSPACE                   |
|  Their data - Their infra - Their control            |
|  Vertex AI - BigQuery - Cloud Run - Gemini           |
+-----------------------------------------------------+
|              HARDWARE                                |
|  Session microphones - Speaker diarization           |
+-----------------------------------------------------+

     Free / OSS ..... Onboarding ..... Service $$ ..... Custom $$
     <---------------------------------------------------->
     Every layer makes the foundation more valuable
```

---

## Slide 14: What's Built Today

**Working product, not vaporware:**

- Landing page with auth (Firebase, Google sign-in + email/password)
- AI voice intake agent with multi-session memory (Gemini Live API)
- Insurance card AI extraction (Gemini Flash vision)
- Instant eligibility verification pipeline (Stedi-ready)
- Document signing (6 templates, e-signature, SHA-256 hashing, HIPAA audit trail)
- Scheduling with Google Calendar + Meet link generation
- Client data system with cross-feature context
- Cloud SQL (PostgreSQL) + Cloud Run infrastructure on GCP
- Terraform-ready IaC

**Live on Google Cloud. Demo-ready.**

---

## Slide 15: Roadmap

| Phase | What | Status |
|---|---|---|
| Platform core | Monorepo, auth, database, shared models | Done |
| Landing + onboarding | Public site, voice intake, form intake | Done |
| Client data | Insurance extraction, client profiles, VOB pipeline | Done |
| Documents | 6 templates, e-signature, audit trail, email delivery | Done |
| Scheduling | Availability, appointments, groups, Calendar/Meet | Done |
| Session recording | Record, transcribe, group debrief workflow | Next |
| AI notes + signing | Generate, review, sign, amend clinical notes | Next |
| Automated billing | Claims submission, tracking, denial management | Planned |
| Client portal v2 | Between-session AI, homework, progress tracking | Planned |
| Admin portal | Clinician management, dashboards, "talk to your data" | Planned |
| Hardware | Session microphone development | Planned |
| Open-source launch | Public repo, docs, terraform one-click deploy | Planned |

---

## Slide 16: How We Run — The AI-Native Company

**SOR practices what it preaches. The company itself runs on AI agents.**

This isn't hypothetical — it's the architecture for a solo operator (or very small team) to manage hundreds of customer environments, a billing pipeline, an open-source community, and a hardware product.

### Every company function, handled by an agent:

| Function | Agent Does | You Do |
|---|---|---|
| **Sales & Leads** | Scrapes directories (Psychology Today, SAMHSA, state licensing boards) for new practices. Drafts personalized outreach. Qualifies inbound leads via AI chat on the website. Books demos. Tracks pipeline in BigQuery. | Take demo calls with qualified leads. Close. |
| **Customer Onboarding** | Runs Terraform to spin up customer's GCP project. Configures Workspace (service account, APIs, Calendar delegation). Deploys SOR. Runs health checks. Ingests data exports from legacy EHR (SimplePractice CSV, TherapyNotes export), maps fields, loads into Cloud SQL. | Review flagged data mapping ambiguities. Welcome call. |
| **Customer Support** | AI chatbot with access to docs, codebase, and customer's Cloud Logging. Auto-resolves common issues. Reproduces bugs, checks logs, drafts fixes. Escalates only what it can't solve. | Handle the 10% of tickets that need a code change or judgment call. |
| **DevOps & Updates** | Cloud Build triggers on merge. Tests, deploys to staging, smoke tests, promotes to prod. Rolls out updates to all customer projects in batches. Monitors for regressions, auto-rolls back if errors spike. Watches CVE databases, auto-opens PRs for dependency patches. | Merge PRs. Review rollback alerts. |
| **Billing & Finance** | Calculates RCM % from claims data already in the system. Generates Stripe invoices. Sends payment reminders. Categorizes bank transactions via Plaid. Generates monthly P&L. Exports CPA-ready tax docs. | Review monthly financials. Approve large refunds. |
| **Legal & Compliance** | Auto-generates BAAs and service agreements from templates, populated per customer. Sends via DocuSign API. Tracks signature status. Runs automated HIPAA audits on customer environments (encryption, access logs, network config). | Sign your side. Review audit exceptions. |
| **Open Source Community** | Triages GitHub issues (labels, deduplicates, reproduces bugs, suggests fixes). Reviews PRs (runs tests, checks style, flags security issues). Generates release notes from commit history. Answers community questions from docs. | Final approval on PRs. Architectural decisions. |
| **Product Development** | You + Claude Code (already doing this). Agent writes tests, generates integration tests from API specs. Surfaces feature request patterns from support data. | Build features. Make product decisions. |
| **Hardware (Mics)** | Manages contract manufacturer orders based on demand forecasts. Tracks inventory via 3PL (ShipBob). Processes Shopify orders, generates shipping labels. Troubleshoots hardware issues via chat (firmware, pairing, placement). | Approve reorder quantities. Handle returns edge cases. |

### Your actual day:

```
MORNING (1 hour)
  Agent overnight report: 3 new leads qualified, 1 demo booked,
  5 support tickets auto-resolved, 1 needs your input,
  0 deployments failed, monthly revenue up 4%

  - Review the 1 support ticket (5 min)
  - Take the demo call (30 min)
  - Review 2 community PRs agent pre-approved (10 min)

AFTERNOON (4 hours)
  - Build features with Claude Code
  - Agent deploys your changes to staging, tests,
    promotes to prod across all customer environments

EVENING (5 min)
  - Agent summary: what shipped, pipeline status,
    customer health flags, revenue update
```

**80% of your time goes to building product. Agents handle the rest.**

### Internal systems to build (once each):

| System | What It Is | Build Effort |
|---|---|---|
| Customer provisioning pipeline | Terraform + scripts for end-to-end GCP setup | Build once, run forever |
| Multi-tenant management dashboard | Health, usage, billing, alerts across all customers | Cloud Monitoring + BigQuery + simple UI |
| Update orchestrator | Safe rollout of SOR updates to all customer projects | Cloud Build + gradual rollout logic |
| Billing engine | RCM % calculation, Stripe invoices, payment tracking | Stripe API + claims data already in system |
| Support agent | AI chatbot over docs + customer Cloud Logging | Gemini + RAG over docs |
| Sales/outreach agent | Lead scraping, email drafting, pipeline CRM | Gmail API + scraping + BigQuery |
| Legal doc generator | BAA/contract templates, auto-populate, e-sign | Templates + DocuSign API |
| Community bot | GitHub issue triage, PR review assist, release notes | GitHub API + Claude |

**None are massive builds. Each eliminates a full-time hire.**

---

## Slide 17: The Vision

**Today:** An AI-powered EHR that saves practices 70% on software and billing costs.

**Tomorrow:** The operating system for behavioral health — where every administrative task is handled by an AI agent, every clinical decision is informed by complete data, and every practice runs on infrastructure they own and control.

**The market is moving from "software tools" to "AI teammates."**
SOR is building the teammates — for its customers, and for itself.

> **We're not an EHR company. We're an AI transformation company that starts with behavioral health — and runs the same way.**

---

## Slide 18: Team

*(To be filled in)*

---

## Slide 19: The Ask

*(To be filled in — funding amount, use of funds, milestones)*

---

## Appendix: Key Data Points for Reference

**Market:**
- Behavioral health EHR market is growing as parity laws drive insurance coverage expansion
- Solo and small group practices are the largest segment by provider count
- Most are underserved by enterprise EHRs (Kipu, Netsmart, Qualifacts) and underwhelmed by simple tools (SimplePractice, TherapyNotes)

**Competitor pricing (sources):**
- SimplePractice: $49-$99/mo base, $74/clinician for groups, AI notes $35/mo extra (simplepractice.com/pricing)
- TherapyNotes: $59-$69/mo first clinician, $40 additional (choosingtherapy.com)
- TheraNest: $39+/mo, scales by caseload (choosingtherapy.com)
- ICANotes: $35-$213/mo by provider type (icanotes.com)
- Kipu: $600+/mo base, enterprise custom quotes (softwarefinder.com)

**Billing company costs:**
- Solo practices: 8-12% of collections (bestmedicalbilling.com)
- Multi-location: 4-7% of collections (bestmedicalbilling.com)
- Per-claim models: $3-$8/claim (emrguides.com)
- Behavioral health commands higher rates due to complex coding, modifiers, prior auths (medibillrcm.com)

**Clearinghouse fees:**
- Waystar: $0.11/claim, $0.04/remit, $0.14/eligibility (chartmaker.com)
- Optum/Change Healthcare: $0.25-$0.50/claim or $200-$800/mo (oneosevenrcm.com)
