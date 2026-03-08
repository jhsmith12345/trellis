# US Healthcare Insurance Billing Reference for Behavioral Health

A comprehensive developer reference covering terminology, processes, code systems, and concepts for building outpatient behavioral health billing software.

---

## Table of Contents

1. [The Full Claim Lifecycle](#1-the-full-claim-lifecycle)
2. [EDI Transaction Types](#2-edi-transaction-types)
3. [CMS-1500 (HCFA) Claim Form Fields](#3-cms-1500-hcfa-claim-form-fields)
4. [Code Systems](#4-code-systems)
   - [CPT Codes (Behavioral Health)](#41-cpt-codes-behavioral-health)
   - [ICD-10-CM Diagnosis Codes](#42-icd-10-cm-diagnosis-codes-f-codes)
   - [Place of Service Codes](#43-place-of-service-pos-codes)
   - [Modifier Codes](#44-modifier-codes)
   - [Revenue Codes](#45-revenue-codes)
   - [Claim Adjustment Reason Codes (CARCs) and RARCs](#46-claim-adjustment-reason-codes-carcs-and-rarcs)
   - [Claim Status Category Codes](#47-claim-status-category-codes)
   - [Service Type Codes](#48-service-type-codes)
   - [Taxonomy Codes](#49-taxonomy-codes-for-behavioral-health)
5. [Key Entities and Roles](#5-key-entities-and-roles)
6. [Insurance Concepts](#6-insurance-concepts)
7. [Provider Identifiers](#7-provider-identifiers)
8. [Payer Identifiers](#8-payer-identifiers)
9. [Denial Management](#9-denial-management)
10. [Credentialing vs Enrollment vs Transaction Enrollment](#10-credentialing-vs-enrollment-vs-transaction-enrollment)
11. [Behavioral Health Specific](#11-behavioral-health-specific)

---

## 1. The Full Claim Lifecycle

The revenue cycle management (RCM) process from patient contact to final payment:

### Phase 1: Pre-Appointment

1. **Scheduling** -- Patient books appointment.
2. **Eligibility Verification (EDI 270/271)** -- Before the appointment, verify the patient's insurance is active and covers the planned service. Query returns: member ID, coverage dates, copay amount, deductible status, coinsurance percentage, out-of-pocket max progress, and whether behavioral health benefits are carved out to a separate payer.
3. **Prior Authorization (EDI 278)** -- If required by the payer, submit a prior authorization request. Some payers require auth for initial psychiatric evaluations, psychological testing, or after a certain number of therapy sessions (e.g., after 6 or 12 sessions). Document the authorization number -- it must appear on the claim.
4. **Benefits Verification** -- Record the patient's specific benefit details: copay amount, coinsurance percentage, deductible remaining, in-network vs out-of-network status, session limits, and whether a referral is needed.

### Phase 2: Patient Check-In (Point of Care)

5. **Demographics Collection** -- Capture patient name (exactly as on insurance card), date of birth, address, phone, insurance ID, group number, subscriber information. If patient is a dependent, collect subscriber details.
6. **Insurance Card Capture** -- Front and back of insurance card. Back often has claims submission address and payer phone numbers.
7. **Copay Collection** -- Collect copay at time of service if known. Record payment method and amount.
8. **Consent and Assignments** -- Patient signs assignment of benefits (authorizing insurer to pay provider directly) and financial responsibility acknowledgment.

### Phase 3: Service Delivery and Documentation

9. **Session Delivery** -- Provide the clinical service (therapy, evaluation, etc.).
10. **Clinical Documentation** -- Document the session with start/stop times (critical for CPT code selection), diagnosis, treatment interventions, and clinical rationale. The note must support medical necessity.
11. **Charge Entry** -- Map the session to the correct CPT code based on time, select appropriate ICD-10 diagnosis code(s), apply modifiers (telehealth, add-on codes), and set the place of service.

### Phase 4: Claim Creation and Scrubbing

12. **Claim Generation** -- Populate all CMS-1500 fields (or 837P electronic equivalent): patient demographics, insurance info, diagnosis codes, procedure codes, dates of service, charges, rendering provider NPI, billing provider NPI, place of service, authorization number.
13. **Claim Scrubbing** -- Validate the claim for completeness and accuracy before submission. Check for: valid NPI, active CPT/ICD codes, matching diagnosis-to-procedure logic, timely filing compliance, duplicate claim detection, required modifiers present.
14. **Clearinghouse Submission (EDI 837P)** -- Submit the electronic claim to the clearinghouse. The clearinghouse performs additional validation and routes the claim to the correct payer.

### Phase 5: Clearinghouse and Payer Processing

15. **Clearinghouse Acknowledgment (999/TA1)** -- The clearinghouse returns a 999 (functional acknowledgment) confirming receipt. A TA1 (interchange acknowledgment) confirms the envelope was valid.
16. **Claim Acknowledgment (277CA)** -- The payer returns a 277CA indicating whether the claim was accepted into their adjudication system, accepted with errors, or rejected. Rejected claims must be corrected and resubmitted.
17. **Adjudication** -- The payer processes the claim: verifies member eligibility, checks benefits, applies contractual adjustments, determines allowed amount, applies deductible/copay/coinsurance, checks for coordination of benefits, and makes a payment determination.

### Phase 6: Payment and Reconciliation

18. **Remittance Advice (EDI 835 / ERA)** -- The payer returns the Electronic Remittance Advice with payment details: amount paid, adjustments (with CARC/RARC codes explaining each), patient responsibility amounts, and check/EFT information.
19. **Payment Posting** -- Post the payer payment to the patient's account. Reconcile each line item: paid amount, contractual adjustment (write-off for in-network), patient responsibility (deductible, copay, coinsurance).
20. **Secondary Billing** -- If the patient has secondary insurance, generate and submit a claim to the secondary payer with the primary payer's EOB/ERA attached showing what was paid and adjusted.
21. **Patient Statement** -- Generate and send a statement to the patient for their remaining balance (deductible, copay, coinsurance). Include clear breakdown of charges, insurance payments, and adjustments.
22. **Patient Payment Collection** -- Collect patient responsibility. Offer payment methods (credit card, payment plan, etc.).

### Phase 7: Denial Management and Follow-Up

23. **Claim Status Inquiry (EDI 276/277)** -- If payment is not received within expected timeframe (typically 30-45 days), query claim status.
24. **Denial Work** -- For denied claims, review CARC/RARC codes, determine if the claim should be corrected and resubmitted or formally appealed. Track appeal deadlines.
25. **Aging and Collections** -- Monitor accounts receivable aging (30/60/90/120+ days). Escalate aged balances. Consider write-offs for uncollectible amounts per financial policy.

---

## 2. EDI Transaction Types

All healthcare EDI transactions follow the ANSI X12 standard and are mandated by HIPAA.

### HIPAA-Mandated Transactions

| Transaction | Name | Direction | Purpose |
|---|---|---|---|
| **270** | Eligibility Inquiry | Provider/Clearinghouse -> Payer | Ask if a patient has active coverage and what benefits they have for a specific service type |
| **271** | Eligibility Response | Payer -> Provider/Clearinghouse | Returns coverage status, copay, deductible, coinsurance, coverage dates, plan details, carve-out info |
| **276** | Claim Status Inquiry | Provider/Clearinghouse -> Payer | Ask about the current status of a previously submitted claim |
| **277** | Claim Status Response | Payer -> Provider/Clearinghouse | Returns claim status using Claim Status Category Codes (accepted, denied, pending, etc.) |
| **277CA** | Claim Acknowledgment | Payer/Clearinghouse -> Provider | Acknowledges receipt of an 837 claim; reports whether it was accepted into adjudication, accepted with errors, or rejected (pre-adjudication validation) |
| **278** | Prior Authorization Request/Response | Bidirectional | Request and receive approval for services that require prior authorization |
| **837P** | Professional Claim | Provider -> Payer (via Clearinghouse) | Submit outpatient/professional claims (equivalent of CMS-1500). The "P" = Professional. Also 837I (Institutional/UB-04) and 837D (Dental) |
| **835** | Electronic Remittance Advice (ERA) | Payer -> Provider | Payment explanation: what was paid, denied, adjusted, and why (CARC/RARC codes). Electronic version of the EOB |
| **275** | Additional Information | Provider -> Payer | Submit additional documentation (attachments) to support a claim -- solicited (in response to payer request) or unsolicited |
| **820** | Premium Payment | Sponsor -> Payer | Health plan premium payment order to a financial institution |
| **834** | Benefit Enrollment | Sponsor/TPA -> Payer | Enroll/disenroll members in health plans; communicate enrollment changes |
| **999** | Implementation Acknowledgment | Receiver -> Sender | Confirms that an EDI file was received and was syntactically valid (or reports syntax errors) |
| **TA1** | Interchange Acknowledgment | Receiver -> Sender | Confirms the interchange envelope (ISA/IEA) was received and valid |

### 837P File Structure (Developer Reference)

The 837P follows a hierarchical loop structure:

```
ISA  -- Interchange Control Header (sender/receiver IDs, date, control number)
  GS  -- Functional Group Header (application sender/receiver, version)
    ST  -- Transaction Set Header (transaction type = 837, control number)
      BHT -- Beginning of Hierarchical Transaction
      Loop 1000A -- Submitter Name (who is sending the claim)
      Loop 1000B -- Receiver Name (who is receiving the claim)
      Loop 2000A -- Billing Provider Hierarchical Level
        Loop 2010AA -- Billing Provider Name/Address/NPI/Tax ID
        Loop 2010AB -- Pay-To Provider (if different from billing)
        Loop 2000B -- Subscriber Hierarchical Level
          Loop 2010BA -- Subscriber Name/Demographics
          Loop 2010BB -- Payer Name/Address/Payer ID
          Loop 2000C -- Patient Hierarchical Level (if patient != subscriber)
            Loop 2010CA -- Patient Name/Demographics
            Loop 2300 -- Claim Information
              CLM -- Claim details (charge amount, POS, frequency code)
              DTP -- Date segments (service date, admission date)
              HI -- Diagnosis codes (ICD-10)
              REF -- Reference numbers (prior auth, referral)
              Loop 2310A -- Referring Provider
              Loop 2310B -- Rendering Provider (if different from billing)
              Loop 2320 -- Other Subscriber Info (secondary insurance/COB)
              Loop 2400 -- Service Line Detail (one per CPT code)
                SV1 -- Professional service (CPT, modifiers, charge, units)
                DTP -- Service date for this line
                REF -- Line-level reference numbers
    SE  -- Transaction Set Trailer
  GE  -- Functional Group Trailer
IEA -- Interchange Control Trailer
```

**Delimiters:** Segments separated by `~`, elements by `*`, sub-elements by `:`.

### 835 ERA Structure (Key Segments)

```
ISA/GS/ST -- Envelope headers
  BPR -- Financial information (payment amount, payment method, EFT details)
  TRN -- Reassociation trace number (links ERA to payment)
  REF -- Receiver identification
  DTM -- Production date
  Loop 1000A -- Payer Identification
  Loop 1000B -- Payee Identification
  Loop 2000 -- Header Number (one per claim)
    CLP -- Claim Payment Information (claim ID, status, charged, paid, patient responsibility)
    Loop 2100 -- Claim Supplemental Information
      NM1 -- Patient/Subscriber/Provider names
      DTM -- Claim dates
    Loop 2110 -- Service Payment Information (one per service line)
      SVC -- Service identification (CPT, charged, paid)
      DTM -- Service dates
      CAS -- Claim Adjustment Segment (group code + CARC + amount)
      REF -- Line-level references
SE/GE/IEA -- Envelope trailers
```

---

## 3. CMS-1500 (HCFA) Claim Form Fields

The CMS-1500 is maintained by the National Uniform Claim Committee (NUCC). The electronic equivalent is the 837P. The form has 33 numbered boxes organized into four sections.

### Section 1: Patient and Insurance Information (Boxes 1-13)

| Box | Field | Description | Notes |
|---|---|---|---|
| 1 | Insurance Type | Medicare, Medicaid, TRICARE, CHAMPVA, Group Health Plan, FECA, Other | Check one |
| 1a | Insured's ID Number | Policy/member ID from insurance card | Must match payer records exactly |
| 2 | Patient's Name | Last, First, Middle | Must match insurance card |
| 3 | Patient's Birth Date / Sex | DOB (MM/DD/YYYY) and gender | Used for eligibility matching |
| 4 | Insured's Name | Policyholder name (if different from patient) | For dependents |
| 5 | Patient's Address | Street, city, state, ZIP, phone | |
| 6 | Patient Relationship to Insured | Self, Spouse, Child, Other | Determines subscriber vs dependent |
| 7 | Insured's Address | Policyholder address (if different) | |
| 8 | Reserved | NUCC Use | Formerly patient status |
| 9 | Other Insured's Name | Secondary insurance policyholder | For COB |
| 9a | Other Insured's Policy/Group Number | Secondary policy number | |
| 9d | Insurance Plan Name or Program Name | Secondary plan name | |
| 10 | Is Patient's Condition Related To | Employment, auto accident, other accident | Affects liability/workers comp |
| 10d | Claim Codes | Reserved for NUCC use | |
| 11 | Insured's Policy Group or FECA Number | Group number from insurance card | |
| 11a | Insured's Date of Birth / Sex | Policyholder DOB/sex | |
| 11b | Other Claim ID | Secondary claim identifier | |
| 11c | Insurance Plan Name or Program Name | Primary plan name | |
| 11d | Is There Another Health Benefit Plan? | Yes/No | Triggers COB processing |
| 12 | Patient's or Authorized Person's Signature | Authorization to release medical info | "Signature on File" (SOF) accepted |
| 13 | Insured's or Authorized Person's Signature | Assignment of benefits | Authorizes direct payment to provider |

### Section 2: Condition and Treatment Context (Boxes 14-23)

| Box | Field | Description | Notes |
|---|---|---|---|
| 14 | Date of Current Illness/Injury/Pregnancy | Onset date | Often N/A for behavioral health |
| 15 | Other Date | Related illness date | Rarely used in BH |
| 16 | Dates Patient Unable to Work | From/To | For disability claims |
| 17 | Name of Referring Provider | Referring physician/provider name | Required if referred |
| 17a | Other ID of Referring Provider | Non-NPI identifier | Rarely used now |
| 17b | NPI of Referring Provider | 10-digit NPI | Required if Box 17 populated |
| 18 | Hospitalization Dates | Admission/discharge dates | N/A for outpatient BH |
| 19 | Additional Claim Information | Reserved field for various payer requirements | Payer-specific use |
| 20 | Outside Lab? | Whether outside lab charges apply | N/A for BH |
| 21 | Diagnosis or Nature of Illness | ICD-10-CM codes (up to 12, labeled A-L) | Primary diagnosis first; F-codes for MH |
| 22 | Resubmission Code | Original reference number for corrected claims | Frequency code 7 = replacement, 8 = void |
| 23 | Prior Authorization Number | Auth number from payer | Must match payer records |

### Section 3: Service Line Detail (Boxes 24A-24J)

Up to 6 service lines per form. Each line represents one CPT/HCPCS code.

| Box | Field | Description | Notes |
|---|---|---|---|
| 24A | Date(s) of Service (From/To) | Service date(s) | Same date for single-session therapy |
| 24B | Place of Service | 2-digit POS code | 11=Office, 02=Telehealth non-home, 10=Telehealth home |
| 24C | EMG | Emergency indicator | Y/N |
| 24D | Procedures, Services, or Supplies | CPT/HCPCS code + up to 4 modifiers | e.g., 90834 95 (telehealth psychotherapy) |
| 24E | Diagnosis Pointer | Letters A-L pointing to Box 21 diagnoses | Links procedure to diagnosis |
| 24F | Charges | Fee for this line item | Provider's full fee (not contracted rate) |
| 24G | Days or Units | Number of units | Usually 1 for therapy sessions |
| 24H | EPSDT Family Plan | Early/Periodic Screening, Diagnosis, Treatment | Medicaid pediatric only |
| 24I | ID Qualifier | Qualifier for rendering provider | NPI = blank or "ZZ" |
| 24J | Rendering Provider ID | NPI of provider who performed the service | Required if different from billing provider |

### Section 4: Provider and Billing Information (Boxes 25-33)

| Box | Field | Description | Notes |
|---|---|---|---|
| 25 | Federal Tax ID Number | EIN or SSN of billing entity | EIN for practices, SSN for sole proprietors |
| 26 | Patient's Account Number | Provider's internal patient/claim ID | Used on ERA for reconciliation |
| 27 | Accept Assignment? | Whether provider accepts allowed amount as payment in full | Yes for in-network; No for OON |
| 28 | Total Charge | Sum of all line item charges | |
| 29 | Amount Paid | Amount already collected (copay, prior payment) | |
| 30 | Reserved | NUCC use | |
| 31 | Signature of Physician or Supplier | Provider attestation | "Signature on File" accepted |
| 32 | Service Facility Location | Address where services were rendered | If different from billing address |
| 32a | Service Facility NPI | NPI of service location | |
| 33 | Billing Provider Info & Ph# | Name, address, phone of billing entity | |
| 33a | Billing Provider NPI | NPI of billing provider/organization | Type 2 NPI for groups |
| 33b | Other ID | Non-NPI billing identifier | Payer-specific legacy IDs |

---

## 4. Code Systems

### 4.1 CPT Codes (Behavioral Health)

CPT (Current Procedural Terminology) codes are maintained by the AMA. Updated annually. All behavioral health CPT codes are in the 908xx-909xx range.

#### Psychiatric Diagnostic Evaluation

| Code | Description | Typical Duration | Notes |
|---|---|---|---|
| **90791** | Psychiatric Diagnostic Evaluation (no medical services) | 45-60 min | Initial intake/assessment. No prescribing. Used by therapists (LCSW, LMFT, LPC, psychologists). |
| **90792** | Psychiatric Diagnostic Evaluation with Medical Services | 45-60 min | Includes medication evaluation. Used by psychiatrists, NPs, PAs with prescribing authority. |

#### Individual Psychotherapy

| Code | Description | Time Range | Notes |
|---|---|---|---|
| **90832** | Psychotherapy, 30 minutes | 16-37 minutes | Lowest reimbursement. Some payers question medical necessity for short sessions. |
| **90834** | Psychotherapy, 45 minutes | 38-52 minutes | **Most commonly billed code.** Standard therapy session. |
| **90837** | Psychotherapy, 60 minutes | 53+ minutes | Higher reimbursement but some payers require documentation of medical necessity for extended sessions. |

#### Crisis Psychotherapy

| Code | Description | Notes |
|---|---|---|
| **90839** | Psychotherapy for Crisis, first 60 minutes | Patient must be in a state of acute crisis. Document the crisis clearly. |
| **90840** | Psychotherapy for Crisis, each additional 30 minutes | **Add-on code** to 90839. Cannot be billed alone. |

#### Family/Couples Therapy

| Code | Description | Notes |
|---|---|---|
| **90846** | Family Psychotherapy without Patient Present | Treatment of the family system. Patient (identified client) is NOT in the room. |
| **90847** | Family/Couples Psychotherapy with Patient Present | Conjoint therapy. Patient participates in the session. |

#### Group Therapy

| Code | Description | Notes |
|---|---|---|
| **90853** | Group Psychotherapy | Billed per patient per session. Typically 6-12 members. |

#### Add-On Codes

| Code | Description | Notes |
|---|---|---|
| **90785** | Interactive Complexity | Add-on for sessions requiring communication beyond typical (e.g., interpreter, third-party involvement, emotional distress affecting communication). Can be added to 90791, 90792, 90832, 90834, 90837, 90839, 90853. |
| **90833** | Psychotherapy, 30 min, add-on to E/M | Add-on to E/M code when psychotherapy is performed with medication management. |
| **90836** | Psychotherapy, 45 min, add-on to E/M | Add-on to E/M code. Used by prescribers doing therapy + med management in same visit. |
| **90838** | Psychotherapy, 60 min, add-on to E/M | Add-on to E/M code. |

#### Psychological Testing

| Code | Description | Notes |
|---|---|---|
| **96130** | Psychological testing evaluation, first hour | Interpretation and report writing (face-to-face with patient). |
| **96131** | Psychological testing evaluation, each additional hour | Add-on to 96130. |
| **96136** | Psychological/neuropsychological testing, first 30 min | Test administration by physician/psychologist. |
| **96137** | Psychological/neuropsychological testing, each additional 30 min | Add-on to 96136. |
| **96138** | Psychological testing administration by technician, first 30 min | When a trained technician administers tests. |
| **96139** | Psychological testing administration by technician, each additional 30 min | Add-on to 96138. |

#### Other Relevant Codes

| Code | Description |
|---|---|
| **99213** | E/M Office Visit, Established Patient, Low Complexity (15-29 min) -- used for med management |
| **99214** | E/M Office Visit, Established Patient, Moderate Complexity (30-39 min) |
| **99215** | E/M Office Visit, Established Patient, High Complexity (40-54 min) |
| **90882** | Environmental intervention (e.g., case management calls on behalf of patient) |
| **90887** | Interpretation/explanation of results to family (no patient present) |

#### Documentation Requirements

- **Always document start and stop times** (e.g., "Session start 2:00 PM, end 2:48 PM -- 48 minutes" supports 90834).
- Time must be face-to-face psychotherapy time (not documentation time).
- For crisis codes (90839/90840), document the nature of the crisis.
- For 90846, document why the patient was not present and how treatment serves the patient.

### 4.2 ICD-10-CM Diagnosis Codes (F-Codes)

ICD-10-CM (International Classification of Diseases, 10th Revision, Clinical Modification) codes are updated annually on October 1. Mental health diagnoses fall primarily in the F01-F99 range.

#### F-Code Category Structure

| Range | Category | Common Examples |
|---|---|---|
| **F10-F19** | Substance Use Disorders | F10.20 Alcohol dependence uncomplicated, F11.20 Opioid dependence uncomplicated, F12.10 Cannabis abuse uncomplicated |
| **F20-F29** | Schizophrenia & Psychotic Disorders | F20.0 Paranoid schizophrenia, F25.0 Schizoaffective disorder bipolar type |
| **F30-F39** | Mood (Affective) Disorders | F31.x Bipolar disorders, F32.x Major depressive disorder single episode, F33.x Major depressive disorder recurrent, F34.1 Dysthymic disorder |
| **F40-F48** | Anxiety & Stress-Related Disorders | F40.10 Social anxiety disorder, F41.0 Panic disorder, F41.1 Generalized anxiety disorder, F42.x OCD, F43.10 PTSD, F43.20-F43.25 Adjustment disorders |
| **F50-F59** | Behavioral Syndromes | F50.0x Anorexia nervosa, F50.2 Bulimia nervosa, F51.0x Insomnia disorders |
| **F60-F69** | Personality Disorders | F60.3 Borderline personality disorder, F60.2 Antisocial personality disorder |
| **F80-F89** | Developmental Disorders | F84.0 Autistic disorder |
| **F90-F98** | Childhood/Adolescent Disorders | F90.0 ADHD predominantly inattentive, F90.1 ADHD predominantly hyperactive-impulsive, F90.2 ADHD combined type |

#### Most Commonly Billed F-Codes in Outpatient BH

| Code | Description |
|---|---|
| F32.1 | Major depressive disorder, single episode, moderate |
| F32.2 | Major depressive disorder, single episode, severe without psychotic features |
| F33.0 | Major depressive disorder, recurrent, mild |
| F33.1 | Major depressive disorder, recurrent, moderate |
| F41.1 | Generalized anxiety disorder |
| F41.0 | Panic disorder |
| F41.9 | Anxiety disorder, unspecified |
| F43.10 | Post-traumatic stress disorder, unspecified |
| F43.21 | Adjustment disorder with depressed mood |
| F43.22 | Adjustment disorder with anxiety |
| F43.23 | Adjustment disorder with mixed anxiety and depressed mood |
| F34.1 | Dysthymic disorder (persistent depressive disorder) |
| F31.xx | Bipolar disorders (multiple sub-codes for episode type and severity) |
| F42.2 | Mixed obsessional thoughts and acts (OCD) |
| F90.0 | ADHD, predominantly inattentive |

#### Z-Codes Used in Behavioral Health

Z-codes describe factors influencing health status and are sometimes used as secondary diagnoses:

| Code | Description |
|---|---|
| Z63.0 | Problems in relationship with spouse or partner |
| Z56.9 | Unspecified problems related to employment |
| Z60.0 | Problems related to adjustment to life-cycle transitions |
| Z65.9 | Problem related to unspecified psychosocial circumstances |
| Z91.89 | Other specified personal risk factors, not elsewhere classified |
| Z71.1 | Person with feared health complaint in whom no diagnosis is made |

**Important:** Many payers will not reimburse for Z-codes as primary diagnoses. Always list a clinical F-code as the primary diagnosis.

#### ICD-10 Code Structure

Format: `Letter + 2 digits + . + 1-4 additional characters`

Example: **F33.1**
- F = Mental and behavioral disorders chapter
- 33 = Major depressive disorder, recurrent
- .1 = Moderate severity

Codes must be coded to the highest level of specificity. Using an unspecified code (e.g., F32.9 vs F32.1) may trigger denials.

### 4.3 Place of Service (POS) Codes

Two-digit codes entered in CMS-1500 Box 24B identifying where services were rendered.

#### POS Codes Relevant to Outpatient Behavioral Health

| Code | Name | Description | When to Use |
|---|---|---|---|
| **02** | Telehealth Provided Other than in Patient's Home | Location where services are provided via real-time telecommunications when patient is NOT at home | Patient at a satellite office, hospital, school, etc. for telehealth session |
| **10** | Telehealth Provided in Patient's Home | Telehealth services when patient is in their home | Most common telehealth POS for BH. Patient at home on video call |
| **11** | Office | Provider's office | **Most common POS for in-person outpatient BH** |
| **12** | Home | Patient's home (in-person) | Home-based therapy visits |
| **03** | School | Educational facility | School-based therapy |
| **04** | Homeless Shelter | Shelter for homeless individuals | |
| **13** | Assisted Living Facility | | |
| **14** | Group Home | | |
| **19** | Off Campus-Outpatient Hospital | | |
| **22** | On Campus-Outpatient Hospital | | |
| **31** | Skilled Nursing Facility | | |
| **32** | Nursing Facility | | |
| **33** | Custodial Care Facility | | |
| **49** | Independent Clinic | Freestanding facility not part of a hospital | |
| **50** | Federally Qualified Health Center | FQHC | |
| **52** | Psychiatric Facility -- Partial Hospitalization | | |
| **53** | Community Mental Health Center | CMHC | |
| **57** | Non-residential Substance Abuse Treatment Facility | | |
| **71** | State or Local Public Health Clinic | | |
| **72** | Rural Health Clinic | | |
| **99** | Other Place of Service | | |

**Telehealth Rule:** For telehealth sessions, use POS 02 or 10 (NOT 11). Some payers reimburse POS 10 at a lower rate than POS 02 or 11. Always check payer-specific policies.

### 4.4 Modifier Codes

Modifiers are 2-character codes appended to CPT codes in Box 24D to provide additional information.

#### Telehealth Modifiers

| Modifier | Description | Usage |
|---|---|---|
| **95** | Synchronous Telemedicine Service | Most widely accepted telehealth modifier. Indicates real-time audio/video. **Use this as default for commercial payers.** |
| **GT** | Via Interactive Audio and Video Telecommunications Systems | Legacy telehealth modifier. Being phased out by most payers in favor of 95. Still required by some Medicaid programs. |
| **93** | Synchronous Telemedicine Service via Audio-Only | Audio-only telephone sessions. Coverage varies significantly by payer. Some payers reimburse at lower rate. |
| **GQ** | Via Asynchronous Telecommunications System | Store-and-forward telehealth. Rarely used in BH. |
| **FQ** | Service provided using audio-only communication technology | CMS modifier for Medicare audio-only services. |

#### Provider/Supervision Modifiers

| Modifier | Description | Usage |
|---|---|---|
| **HO** | Master's Level Clinician | Required by some state Medicaid plans to identify clinician credential level. |
| **HN** | Bachelor's Level Clinician | Medicaid-specific. |
| **AH** | Clinical Psychologist | Identifies rendering provider type. |
| **AJ** | Clinical Social Worker | Identifies rendering provider type. |

#### Service Modifiers

| Modifier | Description | Usage |
|---|---|---|
| **25** | Significant, Separately Identifiable E/M Service | When E/M and therapy are billed together on same day by same provider. |
| **59** | Distinct Procedural Service | Indicates a procedure is distinct from another performed on the same day. |
| **XE** | Separate Encounter | Subset of 59; indicates service was in a separate encounter. |
| **76** | Repeat Procedure by Same Physician | Same procedure repeated same day. |
| **77** | Repeat Procedure by Another Physician | |
| **22** | Increased Procedural Services | Service required substantially more work than typical. |
| **52** | Reduced Services | Service was reduced or eliminated at physician's discretion. |

#### Place of Service Modifiers

| Modifier | Description | Usage |
|---|---|---|
| **SL** | State-mandated service | |
| **SA** | Nurse Practitioner with Physician | |
| **HJ** | Employee Assistance Program (EAP) | **Required on all EAP claims** (e.g., Optum EAP). |

#### COB/Secondary Claim Modifiers

When billing secondary insurance, the primary payer's payment information is included in the claim.

### 4.5 Revenue Codes

Revenue codes are 4-digit codes used primarily on institutional claims (UB-04/837I). For outpatient professional BH billing (CMS-1500/837P), revenue codes are generally NOT required. However, they are relevant for:

- Hospital-based outpatient behavioral health programs
- Partial hospitalization programs (PHP)
- Intensive outpatient programs (IOP)
- Community mental health centers billing on UB-04

| Code Range | Description |
|---|---|
| **0510** | General clinic |
| **0513** | Psychiatric clinic |
| **0515** | Outpatient psychiatric facility - psychiatry |
| **0517** | Outpatient psychiatric facility - group therapy |
| **0900** | Behavioral health treatments/services - general |
| **0901** | Electroshock treatment |
| **0903** | Individual therapy |
| **0904** | Group therapy |
| **0905** | Family therapy |
| **0906** | Bio-feedback |
| **0907** | Hypnosis |
| **0914** | Individual therapy - psychiatrist |
| **0915** | Individual therapy - psychologist |
| **0916** | Individual therapy - social worker |
| **0917** | Individual therapy - other/registered nurse |
| **0918** | Individual therapy - counselor |
| **0919** | Individual therapy - other |
| **0944** | Activity therapy |
| **0945** | Intensive outpatient - psychiatric |

### 4.6 Claim Adjustment Reason Codes (CARCs) and RARCs

CARCs and RARCs appear on the 835/ERA to explain why a claim was paid differently than billed. Maintained by X12 and the Washington Publishing Company (WPC).

#### Group Codes (Prefix)

The group code preceding the CARC number determines financial responsibility:

| Group | Name | Meaning | Action |
|---|---|---|---|
| **CO** | Contractual Obligation | Contractual write-off. Provider cannot collect from patient. | Write off the amount. |
| **PR** | Patient Responsibility | Patient owes this amount. | Bill the patient. |
| **OA** | Other Adjustments | Neither CO nor PR apply clearly. | Investigate; often a payer processing artifact. |
| **PI** | Payer Initiated Reductions | Payer believes this is not the patient's responsibility. | May need to appeal or write off. |
| **CR** | Corrections and Reversals | Correction to a previously adjudicated claim. | Reverse and repost. |

#### Common CARCs

| Code | Description | Typical Cause | Action |
|---|---|---|---|
| **1** | Deductible amount | Patient hasn't met deductible | Bill patient (PR-1) |
| **2** | Coinsurance amount | Patient's coinsurance share | Bill patient (PR-2) |
| **3** | Copay amount | Patient copay | Bill patient (PR-3) |
| **4** | Procedure code inconsistent with modifier or missing modifier | Wrong/missing modifier | Correct and resubmit |
| **5** | Service not covered by plan | Plan exclusion | Appeal or bill patient |
| **6** | Procedure/revenue code incidental to primary procedure | Bundled service | Write off if CO |
| **16** | Claim/service lacks information or has submission errors | Missing/invalid data | Correct and resubmit |
| **18** | Exact duplicate claim | Duplicate submission | No action (already paid) |
| **22** | Coordination of benefits adjustment | COB applied | Bill secondary payer |
| **23** | Payment adjusted: charges covered under capitation | Capitated plan | Write off |
| **24** | Charges covered under capitation agreement | Same as 23 | Write off |
| **27** | Expenses incurred after coverage terminated | Patient no longer covered | Bill patient or write off |
| **29** | Time limit for filing has expired | Missed timely filing | Appeal with proof of timely filing |
| **45** | Charges exceed fee schedule/maximum allowable | Billed above allowed amount | CO: write off. PR: bill patient |
| **50** | Not medically necessary | Payer deems service not needed | Appeal with clinical documentation |
| **96** | Non-covered charge | Benefit exclusion | Bill patient or appeal |
| **97** | Benefit included in another service | Bundling | Write off |
| **109** | Claim not covered by this payer | Wrong payer | Resubmit to correct payer |
| **119** | Benefit maximum for this time period has been reached | Session limit exceeded | Bill patient |
| **150** | Payer deems service not a medical necessity | Medical necessity denial | Appeal |
| **167** | Diagnosis is not covered | Payer doesn't cover this diagnosis | May appeal under parity laws |
| **197** | Precertification/authorization/notification absent | Missing prior auth | Obtain retroactive auth or appeal |
| **204** | Service not covered under patient's benefit plan | Plan exclusion | |
| **226** | Submission/billing error | Various data issues | Correct and resubmit |
| **242** | Service exceeded payer's limitation | Quantity/frequency limit | Appeal or bill patient |
| **252** | Adjustment per service/procedure frequency limitations | Too many units/sessions | |

#### Common RARCs

| Code | Description |
|---|---|
| **M51** | Missing/incomplete/invalid procedure code |
| **M76** | Missing/incomplete/invalid diagnosis code |
| **MA01** | Patient not eligible for benefits on DOS |
| **MA04** | Secondary payment cannot be determined without primary EOB |
| **MA130** | Claim must indicate the actual date of service |
| **N362** | Missing/incomplete/invalid rendering provider primary identifier |
| **N479** | Missing/incomplete/invalid charge amount |
| **N657** | Service not payable with other service on same date |

### 4.7 Claim Status Category Codes

Used in 277 transactions to report claim status. Defined by X12.

| Code | Description |
|---|---|
| **A0** | Forwarded to another entity (payer forwarded claim) |
| **A1** | Acknowledgment: Receipt of claim |
| **A2** | Accepted into adjudication system |
| **A3** | Rejected as unprocessable (data errors) |
| **A4** | Not found (claim not on file) |
| **A5** | Split or merged (claim was combined or divided) |
| **A6** | Not applicable (used for request acknowledgment) |
| **A7** | Acknowledgment: not applicable |
| **A8** | Rejected for relational field in error |
| **E0** | Response not possible -- error on submitted request |
| **F0** | Finalized -- payer's internal adjudication processes are complete |
| **F1** | Finalized -- denied |
| **F2** | Finalized -- revised (claim has been adjusted) |
| **F3** | Finalized -- forwarded |
| **F3F** | Finalized -- forwarded with balance due |
| **F4** | Finalized -- adjudication complete, awaiting payment |
| **P0** | Pending -- payer adjudication in progress |
| **P1** | Pending -- payer adjudication, additional information requested |
| **P2** | Pending -- payer adjudication, under review |
| **P3** | Pending -- waiting on COB |
| **P4** | Pending -- patient responsibility |
| **R0-R16** | Request for additional information (various types) |
| **D0** | Data search unsuccessful (no match found) |

### 4.8 Service Type Codes

Used in 270/271 eligibility transactions to identify what type of benefits are being queried or returned.

| Code | Description | Behavioral Health Relevance |
|---|---|---|
| **30** | Health Benefit Plan Coverage | General plan coverage inquiry |
| **MH** | Mental Health | **Primary STC for behavioral health eligibility** |
| **A7** | Psychiatric | Psychiatric services specifically |
| **A8** | Psychiatric - Inpatient | |
| **A9** | Psychiatric - Outpatient | |
| **AJ** | Substance Abuse | |
| **AK** | Substance Abuse - Facility | |
| **AL** | Substance Abuse - Outpatient | |
| **CF** | Mental Health Provider - Outpatient | Outpatient MH services |
| **1** | Medical Care | General medical |
| **3** | Consultation | |
| **4** | Diagnostic X-Ray | |
| **5** | Diagnostic Lab | |
| **7** | Other Medical | |
| **33** | Chiropractic | |
| **47** | Hospital | |
| **48** | Hospital - Inpatient | |
| **50** | Hospital - Outpatient | |
| **86** | Emergency Services | |
| **88** | Pharmacy | |
| **98** | Professional (Physician) Visit - Office | |
| **UC** | Individual | |

### 4.9 Taxonomy Codes for Behavioral Health

Taxonomy codes are 10-character alphanumeric codes maintained by the NUCC that identify provider type, classification, and specialization. Reported on claims and used in NPI registration.

| Code | Provider Type | Used By |
|---|---|---|
| **101YM0800X** | Counselor - Mental Health | Licensed Professional Counselors (LPC/LMHC) |
| **101YP2500X** | Counselor - Professional | Licensed Professional Clinical Counselors (LPCC) |
| **101YS0200X** | Counselor - School | School Counselors |
| **101YA0400X** | Counselor - Addiction (Substance Abuse) | Licensed Substance Abuse Counselors |
| **103TC0700X** | Psychologist - Clinical | Licensed Clinical Psychologists (PhD/PsyD) |
| **103TP0016X** | Psychologist - Prescribing (Medical) | Psychologists with prescribing authority |
| **103TP2701X** | Psychologist - Group Clinical | |
| **103T00000X** | Psychologist | General psychologist |
| **104100000X** | Social Worker | General social worker |
| **1041C0700X** | Social Worker - Clinical | **Licensed Clinical Social Workers (LCSW)** |
| **106H00000X** | Marriage & Family Therapist | **Licensed Marriage & Family Therapists (LMFT)** |
| **106S00000X** | Behavior Technician | RBT/Behavior Technician |
| **163WP0808X** | Registered Nurse - Psychiatric/Mental Health | Psychiatric NPs (often use this) |
| **364SP0808X** | Clinical Nurse Specialist - Psychiatric/Mental Health | |
| **2084P0800X** | Psychiatrist | Allopathic physician - psychiatry |
| **2084P0804X** | Psychiatrist - Addictionology | Addiction psychiatry |
| **2084P0805X** | Psychiatrist - Child & Adolescent | Child/adolescent psychiatry |
| **261QM0801X** | Clinic/Center - Mental Health (including CMHC) | Community Mental Health Centers |
| **261QR0405X** | Clinic/Center - Rehabilitation, Substance Abuse | Substance abuse treatment centers |
| **273R00000X** | Psychiatric Residential Treatment Facility | |
| **283Q00000X** | Psychiatric Hospital | |
| **322D00000X** | Residential Treatment Facility - Mental Health | |

---

## 5. Key Entities and Roles

### Provider Types

| Role | Description | CMS-1500 Location |
|---|---|---|
| **Billing Provider** | The entity submitting the claim and receiving payment. May be a group practice, clinic, or individual. Identified by NPI (often Type 2 for organizations). | Box 33, 33a |
| **Rendering Provider** | The individual clinician who directly performed the service. Must be credentialed with the payer. | Box 24J |
| **Referring Provider** | The provider who referred the patient for services. Required by some payers, especially for specialist referrals. | Box 17, 17b |
| **Pay-To Provider** | The entity that receives payment if different from the billing provider. Used when payments go to a management company or lockbox. | 837P Loop 2010AB |
| **Supervising Provider** | The provider supervising a non-independently-licensed clinician (e.g., pre-licensed therapist). Some payers require this on claims. | |
| **Ordering Provider** | The provider who ordered a service (labs, tests). Rarely applicable in outpatient BH. | |

**Solo Practice Note:** For solo practitioners, the billing provider and rendering provider are often the same person, using the same NPI. If the solo practitioner has both a Type 1 (individual) and Type 2 (organizational) NPI, the Type 2 goes in Box 33a and Type 1 in Box 24J.

### Patient/Subscriber Roles

| Role | Description |
|---|---|
| **Subscriber** | The person who holds the insurance policy (policyholder). Typically the employee enrolled in employer-sponsored coverage. The subscriber is "Self" in the relationship field. |
| **Insured** | Often used interchangeably with subscriber. The person whose name is on the policy. |
| **Dependent** | A person covered under the subscriber's policy: spouse, child, domestic partner, etc. The patient is the dependent; the subscriber/insured is the policyholder. |
| **Patient** | The person receiving services. May be the subscriber OR a dependent. |
| **Guarantor** | The person financially responsible for the patient's account. May be the patient, subscriber, or a third party. |

### Organizational Roles

| Entity | Description |
|---|---|
| **Clearinghouse** | An intermediary that receives claims from providers, validates/scrubs them, reformats if needed, and routes them to the correct payer. Also routes ERAs/835s back to providers. Examples: Availity, Change Healthcare (Optum), Trizetto, Office Ally, Claim.MD. Clearinghouses charge per-claim fees (typically $0.25-$0.50/claim). |
| **TPA (Third Party Administrator)** | Administers health plans on behalf of self-insured employers. TPAs process claims, manage networks, and handle enrollment but do NOT assume insurance risk. The employer funds the plan; the TPA administers it. Claims are submitted to the TPA, not the employer. |
| **Payer** | The insurance company or entity financially responsible for paying claims. Includes commercial insurers (Aetna, BCBS, Cigna, UHC), government programs (Medicare, Medicaid), and TPAs acting on behalf of self-funded plans. |
| **Plan** | A specific benefits package within a payer. One payer may have many plans (PPO, HMO, POS, EPO, HDHP) with different benefits, networks, copays, and deductibles. |
| **Network** | The group of providers who have contracted with a payer at negotiated rates. Networks can span multiple plans. |
| **Plan Sponsor** | The employer or organization that funds and sponsors a health plan for its employees. |
| **Pharmacy Benefit Manager (PBM)** | Administers prescription drug benefits. Separate from medical billing but relevant for psychiatric medication. |

---

## 6. Insurance Concepts

### In-Network vs Out-of-Network

| Aspect | In-Network | Out-of-Network |
|---|---|---|
| **Contract** | Provider has a signed contract with the payer agreeing to negotiated rates | No contract. Provider sets own fees. |
| **Allowed Amount** | Determined by contract (negotiated/contracted rate) | Determined by payer's out-of-network fee schedule (often based on UCR -- Usual, Customary, and Reasonable) |
| **Balance Billing** | **Prohibited.** Provider must accept allowed amount as payment in full. Write off the difference between billed charges and allowed amount. | **Permitted** (except emergency services under the No Surprises Act). Provider can bill patient for the difference between charges and payer payment. |
| **Patient Cost** | Lower copay/coinsurance, lower deductible | Higher copay/coinsurance, higher (or separate) deductible |
| **Claim Submission** | Provider submits directly to payer | Provider may give superbill to patient who submits to own insurer, OR provider can submit directly |
| **Credentialing** | Required. Must complete credentialing and enrollment. | Not required. |

### Financial Terms

| Term | Definition |
|---|---|
| **Billed Amount / Charges** | The provider's full fee for a service, as listed in their fee schedule. This is NOT what the provider expects to be paid (it's always higher than the allowed amount). |
| **Allowed Amount** | The maximum amount a payer will pay for a covered service. Determined by contract (in-network) or UCR tables (out-of-network). Also called "eligible amount," "negotiated rate," or "approved amount." |
| **Contracted Rate** | The specific rate agreed upon between an in-network provider and a payer. This IS the allowed amount for in-network claims. |
| **Fee Schedule** | A complete list of fees for services. Providers maintain their own fee schedules. Payers (especially Medicare) publish fee schedules. Medicare uses the MPFS (Medicare Physician Fee Schedule) based on RBRVS (Resource-Based Relative Value Scale). |
| **UCR (Usual, Customary, and Reasonable)** | A methodology for determining the allowed amount for out-of-network claims. Based on what providers in the same geographic area typically charge. |
| **Deductible** | The amount the patient must pay out-of-pocket before insurance begins paying. Resets annually (usually January 1). Individual and family deductibles may differ. In-network and out-of-network deductibles are usually separate. |
| **Copay (Copayment)** | A fixed dollar amount the patient pays per visit (e.g., $25 per therapy session). Collected at time of service. Does NOT apply to deductible in most plans (but does count toward OOP max). |
| **Coinsurance** | A percentage of the allowed amount the patient pays after the deductible is met (e.g., 20%). The payer pays the remaining percentage (e.g., 80%). |
| **Out-of-Pocket Maximum (OOP Max)** | The most the patient pays in a plan year. Includes deductible, copays, and coinsurance. Once reached, the plan pays 100% of covered services. ACA sets annual OOP max limits. |
| **Premium** | Monthly payment for insurance coverage. NOT included in OOP max. |
| **Contractual Adjustment / Write-Off** | The difference between the billed amount and the allowed amount for in-network claims. Provider must write this off (CO adjustment). Cannot collect from patient. |
| **Patient Responsibility** | The portion of the allowed amount the patient owes: deductible + copay + coinsurance. Appears as PR adjustments on ERA. |
| **Assignment of Benefits (AOB)** | Patient authorization for the payer to pay the provider directly instead of reimbursing the patient. |

### Payment Calculation Example

```
Provider's billed charge:     $200.00
Payer's allowed amount:        $150.00  (contracted rate)
Contractual adjustment:        -$50.00  (CO-45: provider writes off)

Deductible remaining:          $100.00  (patient hasn't met deductible)
Applied to deductible:         -$100.00 (PR-1: patient pays)

Remaining after deductible:    $50.00
Coinsurance (patient 20%):     -$10.00  (PR-2: patient pays)
Payer pays (80%):              $40.00

Summary:
  Payer pays:           $40.00
  Patient owes:         $110.00  ($100 deductible + $10 coinsurance)
  Provider writes off:  $50.00   (contractual adjustment)
  Total:                $200.00
```

### Coordination of Benefits (COB)

When a patient has two or more insurance plans:

1. **Determine Primary vs Secondary:**
   - The plan where you are the subscriber (employee) is primary.
   - The plan where you are a dependent (spouse's plan) is secondary.
   - **Birthday Rule** (for children): The parent whose birthday falls earlier in the calendar year is primary. NOT based on age.
   - Medicare + employer plan: If employer has 20+ employees, employer plan is primary. Under 20 employees, Medicare is primary.
   - Medicaid is **always** the payer of last resort (secondary/tertiary to all other coverage).
   - Medicare + Medicaid ("dual eligible"): Medicare is primary, Medicaid is secondary.

2. **Billing Process:**
   - Submit claim to primary payer first.
   - Wait for primary ERA/EOB.
   - Submit claim to secondary payer with primary's payment information attached (the primary ERA/EOB).
   - Secondary pays up to their allowed amount minus what primary already paid.
   - Between both payers, total payment usually cannot exceed the provider's billed charges.

3. **Timely Filing for Secondary:**
   - Clock usually starts from the date of primary payer determination (when primary ERA is received), NOT the date of service.
   - Varies by payer (30-365 days from primary determination).

### Superbill vs CMS-1500

| Aspect | Superbill | CMS-1500 |
|---|---|---|
| **Purpose** | Itemized receipt given to the patient | Formal claim submitted to payer |
| **Who submits** | Patient submits to their insurer | Provider submits to payer (or via clearinghouse) |
| **Format** | Flexible format, provider-designed | Standardized red-ink form (or 837P electronic equivalent) |
| **Used for** | **Out-of-network billing**, patient self-pay with insurance | **In-network billing**, all direct-to-payer submissions |
| **Contains** | Provider info, patient info, DOS, CPT codes, ICD-10 codes, charges, provider NPI, Tax ID | All of the above plus much more detail (33 boxes of structured data) |

### EOB vs ERA

| Aspect | EOB (Explanation of Benefits) | ERA (Electronic Remittance Advice) |
|---|---|---|
| **Recipient** | **Patient** (from payer) | **Provider** (from payer) |
| **Format** | Paper document mailed to patient | Electronic EDI 835 file |
| **Purpose** | Explains to patient what insurance paid/denied and what they owe | Provides provider with payment details, adjustments, and CARC/RARC codes for posting |
| **Delivery** | US Mail, 2-3 weeks | Electronic, near-instant upon payment release |
| **System integration** | None (patient-facing) | Imports into billing system for automated payment posting |

### Timely Filing Limits

The deadline by which a claim must be submitted to the payer after the date of service. Missing the deadline results in automatic denial with no patient responsibility.

| Payer | Typical Limit |
|---|---|
| Medicare | 12 months (1 calendar year) from DOS |
| Medicaid | Varies by state (90 days to 12 months) |
| Aetna | 90 days (in-network), 180 days (out-of-network) |
| Anthem/BCBS | 90-180 days (varies by plan) |
| Cigna | 90 days |
| UnitedHealthcare | 90 days (in-network), 180 days (out-of-network) |
| Humana | 90 days |

**For corrected claims and appeals:** Different (usually longer) timely filing limits apply. Always check the specific payer's policy.

**For secondary claims:** Timely filing usually starts from the date of primary payer determination, not the date of service.

### Clean Claim

A "clean claim" has no defects, errors, or missing information that would prevent timely processing. It includes:

- All required fields populated correctly
- Valid and active CPT/ICD-10 codes
- Correct patient demographics matching payer records
- Valid NPI and Tax ID
- Authorization number (if required)
- Appropriate modifiers
- No duplicate claim issues
- Required supporting documentation included

**Legal requirements:** Many states mandate payers to pay clean claims within 30-45 days. Medicare requires 99% of clean claims from practitioners to be paid within 90 days. ERISA plans (employer-sponsored) must pay within 30 days.

### Prior Authorization / Pre-Certification

| Term | Description |
|---|---|
| **Prior Authorization (PA)** | Payer's advance approval that a service is medically necessary and will be covered. Required BEFORE the service is rendered. Without it, claims may be denied. |
| **Pre-Certification** | Often used interchangeably with prior authorization. Some payers distinguish: pre-certification confirms benefits exist; prior authorization confirms medical necessity. |
| **Concurrent Review** | Ongoing review during a course of treatment. Payer reviews whether continued treatment is necessary (e.g., after initial authorized sessions are used). |
| **Retrospective Review** | Review of medical necessity AFTER services are provided. Used for emergency situations where prior auth was not possible. |

**Behavioral Health PA Triggers:**
- Initial psychiatric evaluation (some payers)
- Psychological testing (most payers)
- After X number of therapy sessions (varies: 6, 12, 20 sessions)
- Intensive outpatient program (IOP)
- Partial hospitalization program (PHP)
- Higher levels of care

---

## 7. Provider Identifiers

### NPI (National Provider Identifier)

A HIPAA-mandated, unique 10-digit identifier for healthcare providers. Assigned by CMS through the NPPES (National Plan and Provider Enumeration System).

| Type | Description | Who Gets It | Example Usage |
|---|---|---|---|
| **Type 1 (Individual)** | Assigned to individual providers (persons) | Individual therapists, psychiatrists, psychologists, etc. | Box 24J (rendering provider), Box 17b (referring provider) |
| **Type 2 (Organization)** | Assigned to organizations/groups | Group practices, clinics, hospitals, CMHCs | Box 33a (billing provider), Box 32a (service facility) |

- **NPIs never expire** and are not reassigned.
- A solo practitioner may have both a Type 1 (as an individual) and a Type 2 (as their practice entity).
- NPI is free to obtain. Apply at https://nppes.cms.hhs.gov/
- NPI does NOT convey billing privileges. Must separately credential and enroll with each payer.
- NPIs are public record and searchable in the NPI Registry.

### Tax ID / EIN

| Identifier | Description |
|---|---|
| **EIN (Employer Identification Number)** | IRS-assigned 9-digit number for business entities. Used on claims (Box 25) when billing under a group practice or business entity. Format: XX-XXXXXXX. |
| **SSN (Social Security Number)** | Used on claims only if billing as a sole proprietor without a separate EIN. Less common; EIN preferred for privacy. |

### Taxonomy Code

A 10-character alphanumeric code (see Section 4.9) that describes the provider's type, classification, and area of specialization. Required on:

- NPI registration (NPPES)
- CAQH profile
- Many payer enrollment applications
- Some claims (depending on payer requirements)

### CAQH

The **Council for Affordable Quality Healthcare** operates the CAQH Provider Data Portal (formerly CAQH ProView), a centralized credentialing profile system.

| Aspect | Details |
|---|---|
| **Purpose** | Centralized repository of provider credentialing data. Eliminates redundant paperwork across multiple payers. |
| **CAQH ID** | Unique identifier assigned to each provider in the system. |
| **Who uses it** | Over 2 million healthcare providers; most major health plans pull credentialing data from CAQH. |
| **Information stored** | Education, training, licensure, malpractice history, practice addresses, hospital affiliations, DEA, NPI, Tax ID, work history, references, liability insurance. |
| **Attestation** | Providers must re-attest every **120 days** that their information is current and accurate. Failure to attest can delay or block credentialing. |
| **Cost** | Free for providers. Payers pay for access. |
| **Process** | Provider registers at proview.caqh.org, completes profile, authorizes specific payers to access their data. Payers then pull the data for their credentialing review. |

---

## 8. Payer Identifiers

### Payer ID / Trading Partner ID

| Identifier | Description |
|---|---|
| **Payer ID** | A unique identifier (typically 5-9 characters, alphanumeric) assigned to each payer for EDI transaction routing. Used in the 837P to tell the clearinghouse where to send the claim. Different from the insurer's name. |
| **Trading Partner ID (TPID)** | Used to identify entities for direct EDI connections (SFTP). The TPID is assigned when a provider establishes a Trading Partner Agreement with a payer or clearinghouse. |
| **NAIC Code** | National Association of Insurance Commissioners code. Some claim forms use NAIC codes to identify payers. |

### How Payers Are Identified in EDI

In an 837P transaction, the payer is identified in **Loop 2010BB** (Payer Name):

- **NM1 segment**: Payer name and Payer ID
- **N3/N4 segments**: Payer address (claims mailing address)
- **REF segment**: Additional payer identifiers

**Important:** One insurance company may have MULTIPLE Payer IDs for different products, states, or plan types. For example, UnitedHealthcare has different Payer IDs for UHC Commercial, UHC Medicare Advantage, Optum Behavioral Health, etc. The clearinghouse maintains a payer list mapping Payer IDs to routing information.

### Common Payer IDs (Examples)

| Payer | Example Payer ID |
|---|---|
| Aetna | 60054 |
| Anthem BCBS | Various by state |
| Cigna | 62308 |
| UnitedHealthcare | 87726 |
| Humana | 61101 |
| Medicare (National) | CMS (varies by MAC/region) |
| Medicaid | Varies by state |
| Optum (Behavioral Health) | 68069 |

**Payer ID databases** are maintained by clearinghouses and updated regularly. Your billing software needs a searchable payer directory.

---

## 9. Denial Management

### Denial vs Rejection

| Type | Description | Action |
|---|---|---|
| **Rejection** | Claim could not be processed due to data errors (missing/invalid fields). Claim never entered the adjudication system. | Correct errors and **resubmit** (not an appeal). |
| **Denial** | Claim was processed (adjudicated) and payment was refused, partially or fully. | **Appeal** the denial or submit a corrected claim, depending on reason. |

### Common Denial Reasons in Behavioral Health

| Category | Examples | Frequency |
|---|---|---|
| **Eligibility/Coverage** | Patient not eligible on DOS, coverage terminated, wrong payer, wrong member ID | ~25% of denials |
| **Authorization** | Missing/invalid prior authorization, services exceeded authorized units | ~20% of denials |
| **Medical Necessity** | Payer deems service not medically necessary based on submitted documentation | ~15% of denials |
| **Coding Errors** | Invalid/outdated CPT or ICD-10 codes, missing modifiers, diagnosis-procedure mismatch | ~15% of denials |
| **Duplicate Claim** | Same service billed twice | ~10% of denials |
| **Timely Filing** | Claim submitted after payer's filing deadline | ~5% of denials |
| **Credentialing** | Provider not credentialed or enrolled with payer | ~5% of denials |
| **Coordination of Benefits** | Primary/secondary payer confusion, missing COB information | ~5% of denials |

### Corrected Claims vs Appeals

| Approach | When to Use | How |
|---|---|---|
| **Corrected Claim** | The original claim had errors (wrong code, wrong patient info, missing modifier, wrong payer). The claim needs to be fixed and resubmitted. | Resubmit with frequency code **7** (replacement) in Box 22 and include the original claim number (ICN/DCN). Some payers use frequency code **8** to void a claim. |
| **Appeal** | The claim was adjudicated correctly based on what was submitted, but you disagree with the decision (e.g., medical necessity denial, benefit limitation you contest). | Submit a formal appeal letter with supporting documentation (clinical notes, medical necessity argument, parity law citations). Follow payer's appeal process and deadlines. |

### Appeal Levels

1. **First-Level Appeal (Reconsideration)** -- Submit to payer within 60-180 days of denial (payer-specific). Include appeal letter + supporting clinical documentation.
2. **Second-Level Appeal** -- If first appeal denied. Submit additional documentation. Some payers allow peer-to-peer review (provider speaks directly with payer's medical director).
3. **External Review (Independent Review)** -- For medical necessity denials after internal appeals are exhausted. An independent third-party reviews the case. Required by ACA for all plans.
4. **State Insurance Commissioner Complaint** -- File complaint with state DOI for payer non-compliance.
5. **Legal Action** -- Last resort. ERISA governs employer-sponsored plans (federal court). State law governs fully insured plans (state court).

### Mental Health Parity

The **Mental Health Parity and Addiction Equity Act (MHPAEA)** requires that insurance plans offering MH/SUD benefits provide them at parity with medical/surgical benefits:

- Copays, deductibles, and coinsurance for MH cannot be more restrictive than for medical.
- Session limits, prior auth requirements, and other treatment limitations must be comparable.
- Non-quantitative treatment limitations (NQTLs) like medical necessity criteria, prior auth processes, and network adequacy must be applied no more restrictively to MH than to medical/surgical.

**Use parity in appeals:** If a BH claim is denied for reasons that would not apply to a comparable medical claim, cite MHPAEA in the appeal.

---

## 10. Credentialing vs Enrollment vs Transaction Enrollment

### Provider Credentialing

| Aspect | Details |
|---|---|
| **What** | Verification of a provider's qualifications: education, training, licensure, board certification, malpractice history, work history, DEA registration, background checks. |
| **Who does it** | Payers, hospitals, and credentialing verification organizations (CVOs). |
| **Purpose** | Determines if the provider is qualified to participate in a network. |
| **Timeline** | 60-180 days (highly variable). |
| **Re-credentialing** | Required every 2-3 years. |
| **Key tool** | CAQH profile (centralized data source for most payer credentialing). |
| **Outputs** | Provider is accepted or rejected from the payer's network. |

### Provider Enrollment (Payer Enrollment)

| Aspect | Details |
|---|---|
| **What** | The process of registering with a specific payer to become an approved provider who can submit claims and receive reimbursement. |
| **Prerequisite** | Credentialing must be completed first (payer verifies qualifications before granting billing privileges). |
| **Purpose** | Establishes the provider-payer relationship: contracted rates, billing permissions, effective date. |
| **Per-payer** | Must enroll separately with each payer (Medicare, Medicaid, each commercial payer). |
| **Outputs** | Provider receives: effective date, provider number (some payers), contracted rate schedule, billing instructions. |
| **Medicare/Medicaid** | Enrollment via PECOS (Medicare) or state Medicaid portal. These are regulatory enrollments, not just contracts. |
| **Timeline** | 90-270 days from application to billing authorization (total process including credentialing). |

### Transaction Enrollment (EDI Enrollment)

| Aspect | Details |
|---|---|
| **What** | The process of setting up electronic transaction capability with a payer or clearinghouse. Separate from provider/payer enrollment. |
| **Purpose** | Authorizes the provider (or their billing system/clearinghouse) to send/receive specific EDI transactions (837, 835, 270/271, 276/277) with a specific payer. |
| **Process** | Submit a Trading Partner Agreement (TPA) and EDI Registration Form to the payer. Establish connectivity (via clearinghouse, direct connect, or web portal). |
| **Prerequisites** | Provider must already be enrolled with the payer. |
| **Types** | Enrollment for: claim submission (837), eligibility inquiry (270/271), claim status (276/277), ERA receipt (835), EFT (electronic funds transfer). |
| **EFT Enrollment** | Separate enrollment to receive payments via electronic funds transfer (ACH) instead of paper checks. Linked to ERA via the TRN (trace number) in the 835. |

### The Full Sequence

```
1. Obtain NPI (NPPES)
2. Create CAQH profile
3. Apply for credentialing with payer (payer reviews CAQH data)
4. Upon approval, complete payer enrollment (sign contract, agree to rates)
5. Complete EDI/transaction enrollment (set up electronic claim submission)
6. Complete EFT enrollment (set up electronic payment receipt)
7. Begin submitting claims
```

---

## 11. Behavioral Health Specific

### Telehealth Billing for Behavioral Health

Telehealth is a major modality for behavioral health, especially post-COVID. Permanent telehealth flexibilities vary by payer and state.

#### Billing Telehealth Correctly

1. **CPT Code**: Same codes as in-person (90791, 90834, 90837, etc.). No special telehealth CPT codes for psychotherapy.
2. **Modifier**: Append **95** (most commercial payers) or **GT** (some Medicaid plans). For audio-only: **93** or **FQ**.
3. **Place of Service**: **POS 10** (patient at home) or **POS 02** (patient at non-home location). Do NOT use POS 11 for telehealth.
4. **Documentation**: Note that the session was conducted via telehealth, the technology used (audio/video platform), that both audio and video were used (or audio-only if applicable), patient location/state, and provider location/state.
5. **Reimbursement**: Many payers reimburse telehealth at the same rate as in-person (telehealth parity). Some pay POS 10 at a slightly reduced rate. Audio-only (modifier 93) is often reimbursed at a lower rate or not at all.
6. **Interstate Licensing**: Provider must be licensed in the state where the patient is located at the time of service. Some states have telehealth-specific registrations. PSYPACT (for psychologists) and ASWB mobility initiatives are expanding interstate practice.

### Session Length and CPT Code Selection

This is one of the most critical billing decisions in outpatient BH:

| Actual Time (Face-to-Face) | Correct CPT Code | Common Mistake |
|---|---|---|
| 16-37 minutes | 90832 (30 min) | Billing 90834 for a 35-minute session |
| 38-52 minutes | 90834 (45 min) | Billing 90837 for a 50-minute session |
| 53+ minutes | 90837 (60 min) | Billing 90837 for a 45-minute session |
| Under 16 minutes | Generally not billable | Attempting to bill 90832 |

**Key Rules:**
- Time is **face-to-face psychotherapy time** only. Documentation time does not count.
- Must document start and stop times in the clinical note.
- If session runs 37 minutes, it is 90832, NOT 90834.
- If session runs 52 minutes, it is 90834, NOT 90837.
- There is no "rounding up." The time ranges are strict.
- Some payers audit 90837 more closely and may require justification for extended sessions.

### Incident-To Billing

Incident-to billing allows services performed by a non-physician provider (e.g., pre-licensed therapist, intern) to be billed under a supervising physician's NPI at the physician's rate.

| Requirement | Details |
|---|---|
| **Setting** | Office/clinic only. NOT allowed in hospitals or SNFs. |
| **Initial visit** | The billing practitioner (physician, psychologist, NP, PA) must see the patient first and establish the diagnosis and treatment plan. |
| **Supervision** | General supervision (billing provider directs care and is available, but does not need to be in the room or even on-site during the encounter). Some services still require direct supervision. |
| **Treatment plan** | Follow-up visits must stay within the established treatment plan. If a new problem arises, the billing practitioner must reassess. |
| **Who can bill** | Psychiatrists, clinical psychologists, NPs, PAs, CNSs, CNMs. |
| **Who provides service** | Non-independently-licensed providers working under the billing provider. |
| **Claim appears as** | The billing provider's NPI and credentials -- the payer sees it as if the billing provider performed the service. |
| **Risk** | Significant compliance risk if requirements are not met. Audits can result in recoupment and penalties. |

### Behavioral Health Carve-Out Plans

Many insurance plans "carve out" behavioral health benefits to a separate specialty company:

| Primary Insurer | BH Carve-Out Company | Notes |
|---|---|---|
| UnitedHealthcare | **Optum Behavioral Health** | Largest BH carve-out. Separate Payer ID, separate credentialing, separate auth process. |
| Various employers | **Magellan Health** | Major BH carve-out (acquired by Molina Healthcare). |
| Blue Shield of California | **Magellan** (branded as Blue Shield MHSA) | Claims go to Magellan, not Blue Shield. |
| Anthem BCBS | **Carelon Behavioral Health** (formerly Beacon Health Options) | |
| Various | **Lyra Health** | Newer entrant; employer-sponsored BH benefit. |
| Various | **Spring Health** | Employer-sponsored BH benefit. |
| Federal employees (FEHB) | Various carve-outs | Varies by plan. |

**Impact on billing:**
- Credentialing is with the carve-out company, NOT the primary insurer.
- Claims are submitted to the carve-out's Payer ID, NOT the primary insurer.
- Prior authorization goes through the carve-out.
- Eligibility inquiry (270) should go to the carve-out for BH benefits.
- The patient's insurance card may only show the primary insurer. You need to identify the carve-out by calling the number on the back of the card or checking the BH benefits in the 271 response.

### EAP (Employee Assistance Program)

| Aspect | Details |
|---|---|
| **What** | A short-term counseling benefit provided by employers, usually 3-8 sessions per issue per year. Free to employees. No copay, deductible, or coinsurance. |
| **How it works** | Employee calls EAP number, receives authorization for X sessions. Provider delivers sessions and bills the EAP company. |
| **Billing** | Bill the EAP company (often Optum, Magellan, ComPsych, or the employer's EAP vendor). Same CPT codes (90834, etc.) but add **modifier HJ** to indicate EAP. |
| **Reimbursement** | EAP rates are often lower than standard insurance rates. Provider is paid directly by the EAP company. |
| **Authorization** | Required before first session. Initiated by the member or provider. An authorization number is issued. |
| **Transition to insurance** | After EAP sessions are exhausted, patient transitions to their regular insurance benefits. This requires a new intake/evaluation under insurance, new authorization (if needed), and standard billing. |
| **Separate credentialing** | Some EAP companies require separate credentialing. Others (like Optum) use the same network. |
| **Confidentiality** | EAP is separate from the employer's health plan. Employer does not receive clinical information. |
| **Not insurance** | EAP is NOT insurance. It is a separate employer-paid benefit. EAP sessions do not apply to insurance deductible or OOP max. |

### Important Behavioral Health Billing Rules

1. **One E/M per day per provider per patient** -- Cannot bill two E/M codes for the same patient on the same day by the same provider (with limited exceptions using modifier 25).
2. **Therapy + E/M same day** -- A prescriber can bill an E/M code (med management) AND an add-on therapy code (90833/90836/90838) on the same day, with modifier 25 on the E/M.
3. **Two providers same day** -- Two different providers can each bill for the same patient on the same day if they are providing different services (e.g., therapist bills 90834, psychiatrist bills 99214+90836).
4. **No double-booking** -- Cannot bill for two patients at the same time period.
5. **Group therapy billing** -- 90853 is billed per patient, per session. Document each patient's participation individually. Minimum group size varies by payer (often 2-4 members). Maximum group size also varies (typically 12).
6. **Family therapy with multiple patients** -- If multiple family members are patients with the same diagnosis/treatment plan, only bill for one identified patient per session.
7. **No show / late cancellation** -- Cannot bill insurance for no-shows or late cancellations. Can charge the patient directly per your financial policy (usually $50-$150).

### Common Behavioral Health Billing Mistakes

1. Upcoding (billing 90837 when session was only 45 minutes)
2. Not documenting start/stop times
3. Billing for documentation time (only face-to-face time counts)
4. Missing telehealth modifier or wrong POS code
5. Using an unspecified diagnosis code (F41.9) when a more specific code is available (F41.1)
6. Not verifying benefits before first session (especially carve-outs)
7. Missing prior authorization or letting it expire
8. Billing the wrong payer (primary insurer instead of BH carve-out)
9. Not billing secondary insurance after primary payment
10. Missing timely filing deadlines

---

## Glossary of Additional Terms

| Term | Definition |
|---|---|
| **Adjudication** | The process by which a payer evaluates and determines payment for a claim. |
| **Aging Report (A/R Aging)** | Report showing outstanding claims by age (30/60/90/120+ days). Used to manage collections. |
| **Authorization Number / Auth** | A unique number issued by the payer approving specific services. Must appear on the claim. |
| **Batch** | A group of claims submitted together in a single EDI transmission. |
| **Capitation** | A payment model where the provider receives a fixed monthly payment per patient regardless of services rendered. Common in HMOs. |
| **Carve-Out** | A benefit category managed by a separate specialty company rather than the primary insurer. |
| **Charge Master** | A comprehensive list of all billable services and their fees maintained by a provider. |
| **Claim Scrubbing** | Automated review of claims for errors before submission. |
| **Clearinghouse** | Intermediary that validates, formats, and routes EDI transactions between providers and payers. |
| **CMS** | Centers for Medicare & Medicaid Services. Federal agency administering Medicare, Medicaid, and ACA marketplace. |
| **COB** | Coordination of Benefits. Process for determining payment responsibility when patient has multiple insurance plans. |
| **CPT** | Current Procedural Terminology. AMA-maintained code set for medical services and procedures. |
| **Crossover Claim** | A claim that automatically crosses from Medicare to Medicaid (for dual-eligible patients). |
| **DCN / ICN** | Document Control Number / Internal Control Number. Payer-assigned unique identifier for a processed claim. Used to reference claims in status inquiries and corrected claims. |
| **DOS** | Date of Service. |
| **DRG** | Diagnosis Related Group. Used for inpatient hospital payment (not outpatient BH). |
| **E/M Code** | Evaluation and Management code (99xxx series). Used for office visits, typically by prescribers. |
| **EFT** | Electronic Funds Transfer. Payment via ACH direct deposit rather than paper check. |
| **EOB** | Explanation of Benefits. Paper statement sent to patient showing what insurance paid/denied. |
| **ERA** | Electronic Remittance Advice. EDI 835 file showing payment details sent to provider. |
| **Fee-for-Service (FFS)** | Payment model where the provider is paid for each service rendered (as opposed to capitation). |
| **FQHC** | Federally Qualified Health Center. |
| **HCPCS** | Healthcare Common Procedure Coding System. Level I = CPT codes. Level II = additional codes for supplies, equipment, and services not in CPT (e.g., S-codes, T-codes). |
| **HIPAA** | Health Insurance Portability and Accountability Act. Federal law governing healthcare data privacy, security, and transaction standards. |
| **ICN/DCN** | Internal Control Number / Document Control Number. Payer-assigned unique claim identifier. |
| **MAC** | Medicare Administrative Contractor. Regional entities that process Medicare claims. |
| **Medical Necessity** | The determination that a service is clinically appropriate and required for the patient's condition. Payers use medical necessity criteria to approve or deny claims. |
| **MPFS** | Medicare Physician Fee Schedule. Published annually. Basis for Medicare reimbursement rates. |
| **NUCC** | National Uniform Claim Committee. Maintains the CMS-1500 form and provider taxonomy codes. |
| **PECOS** | Provider Enrollment, Chain, and Ownership System. CMS system for Medicare provider enrollment. |
| **PHI** | Protected Health Information. Any individually identifiable health information subject to HIPAA. |
| **POS** | Place of Service. Two-digit code identifying where services were provided. |
| **RBRVS** | Resource-Based Relative Value Scale. Methodology for determining Medicare physician payment rates. |
| **Recoupment** | When a payer takes back money previously paid (e.g., after an audit finds overpayment). Often offset against future payments. |
| **Resubmission** | Sending a corrected version of a previously rejected or denied claim. |
| **RVU** | Relative Value Unit. Measure of value used in the RBRVS system. Components: work RVU, practice expense RVU, malpractice RVU. |
| **Self-Pay** | Patient paying out of pocket without using insurance. Provider collects full fee (or discounted self-pay rate). |
| **Sliding Scale** | A fee structure where the charge varies based on the patient's income. Common in community mental health. |
| **TIN** | Tax Identification Number. Umbrella term for EIN or SSN used on claims. |
| **UCR** | Usual, Customary, and Reasonable. Method for determining out-of-network allowed amounts. |
| **Void** | Cancelling a previously submitted claim. Uses frequency code 8 in Box 22. |
| **Write-Off** | An amount removed from the patient's balance that cannot be collected. Contractual write-offs (CO adjustments) are different from bad debt write-offs. |

---

## Sources

- [Invene - Decoding the 9 Key Healthcare EDI Transactions](https://www.invene.com/blog/demystifying-healthcare-edi-the-9-critical-transactions-explained)
- [AccountableHQ - EDI Files in Healthcare](https://www.accountablehq.com/post/edi-files-in-healthcare-what-they-are-common-transactions-837-835-270-271-and-how-they-work)
- [AnnexMed - CMS-1500 Form Key Fields](https://annexmed.com/understanding-the-cms-1500-form-for-medical-billing)
- [StudyingNurse - CMS-1500 Complete Guide](https://studyingnurse.com/study/cms-1500-claim-form/)
- [SupaNote - Behavioral Health CPT Codes 2026](https://www.supanote.ai/blog/behavioral-health-cpt-codes)
- [EliteMedFinancials - Mental Health CPT Codes 2026](https://elitemedfinancials.com/mental-health-cpt-codes/)
- [TherathinkCPT - Mental Health CPT Code Cheat Sheet](https://therathink.com/mental-health-cpt-code-cheat-sheet/)
- [AMA - Behavioral Health Coding Guide](https://www.ama-assn.org/practice-management/cpt/behavioral-health-coding-guide)
- [ICD10Data - F01-F99 Mental Disorders](https://www.icd10data.com/ICD10CM/Codes/F01-F99)
- [Headway - Guide to ICD-10 F Codes](https://headway.co/resources/f-codes)
- [Therathink - ICD-10 Mental Health Diagnosis Codes](https://therathink.com/mental-health-diagnosis-list/)
- [OneSourceRCM - POS Codes 02, 10, 11 and Modifiers 95, GT](https://www.onesourcercm.com/post/understanding-place-of-service-codes-02-10-11-and-modifiers-95-gt-for-mental-health-practices)
- [MedStates - Mental Health Billing Modifiers](https://www.medstates.com/mental-health-billing-modifiers/)
- [Therathink - Telehealth Billing for Therapists 2026](https://therathink.com/bill-telehealth-for-therapy/)
- [CodingAhead - 2026 POS Codes Complete List](https://www.codingahead.com/place-of-services-codes/)
- [CMS - Place of Service Code Set](https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets)
- [X12 - Claim Adjustment Reason Codes](https://x12.org/codes/claim-adjustment-reason-codes)
- [Sprypt - CARC and RARC Codes Complete Guide](https://www.sprypt.com/denial-codes/carc-and-rarc-codes)
- [PCHHealth - Understanding CARC and RARC Codes](https://pchhealth.global/blog/understanding-carc-and-rarc-codes-medical-billing)
- [Droidal - Medical Billing Denial Codes Guide](https://droidal.com/blog/medical-billing-denial-codes/)
- [RapidClaims - Top 20 Denial Codes 2026](https://www.rapidclaims.ai/blogs/denial-codes-medical-billing-explained)
- [X12 - Claim Status Category Codes](https://x12.org/codes/claim-status-category-codes)
- [X12 - Claim Status Codes](https://x12.org/codes/claim-status-codes)
- [Stedi - 277CA Claim Acknowledgments](https://www.stedi.com/docs/providers/providers-claim-acknowledgments)
- [UHCProvider - EDI Transactions and Code Sets](https://www.uhcprovider.com/en/resource-library/edi/edi-transactions.html)
- [Headway - Taxonomy Code for Mental Health Counselor](https://headway.co/resources/taxonomy-code-for-mental-health-counselor)
- [TheraPlatform - Taxonomy Codes for Mental Health Therapists](https://www.theraplatform.com/blog/960/taxonomy-codes-for-mental-health-therapists)
- [Medallion - Payer Enrollment vs Credentialing](https://medallion.co/resources/blog/payer-enrollment-vs-credentialing-whats-the-difference)
- [PhysicianPracticeSpecialists - Credentialing vs Enrollment](https://physicianpracticespecialists.com/credentialing/provider-credentialing-vs-provider-enrollment-understanding-the-difference/)
- [CertifyOS - CAQH Credentialing Complete Guide](https://www.certifyos.com/resources/blog/caqh-credentialing)
- [CAQH - Providers](https://www.caqh.org/providers)
- [SuperDial - Superbill vs CMS-1500](https://www.superdial.com/blog/superbill-vs-cms-1500)
- [MeetAxle - ERA and EOB Difference](https://meetaxle.com/blog/era-and-eob-difference-in-medical-billing/)
- [Waystar - Life Cycle of a Medical Bill](https://www.waystar.com/blog-revenue-cycle-101-the-life-cycle-of-a-medical-bill/)
- [BluefishMedical - Medical Claim Lifecycle](https://bluefishmedical.com/medical-claim-lifecycle/)
- [BillingParadise - Behavioral Health Claim Denials](https://www.billingparadise.com/blog/common-behavioral-health-claim-denials/)
- [EaseHealth - Mental Health Claim Denials Guide 2026](https://easehealth.com/blog/mental-health-claim-denials-guide)
- [BellMedEx - Incident-To Billing Mental Health](https://bellmedex.com/mental-health-incident-to-billing-guide/)
- [APA Services - Incident to Services](https://www.apaservices.org/practice/medicare/coverage/incident-to)
- [Thrizer - Prior Authorization for Therapy](https://www.thrizer.com/post/prior-authorization-for-therapy)
- [MZBilling - In-Network vs Out-of-Network Billing](https://mzbilling.com/blogs/in-network-vs-out-of-network-billing/)
- [NAIC - Balance Billing](https://content.naic.org/article/consumer-insight-what-balance-billing-knowing-difference-between-network-and-out-network-providers-can-help-you-avoid)
- [MediBillRCM - ANSI X12 837 File Format](https://www.medibillrcm.com/blog/ansi-x12-837-edi-file-format-healthcare-claims/)
- [CMS1500ClaimBilling - EDI 837 File Complete Format](https://cms1500claimbilling.com/edi-837-file-complete-format-ref-02/)
- [Optum Behavioral Health - Telehealth Billing Guide](https://public.providerexpress.com/content/dam/ope-provexpr/us/pdfs/home/Telehealth_Billing_Guide_Updates.pdf)
- [Wikipedia - Third-party administrator](https://en.wikipedia.org/wiki/Third-party_administrator)
- [MediBillRCM - Timely Filing Limits 2026](https://www.medibillrcm.com/blog/timely-filing-limit-for-claims-in-medical-billing/)
- [Stedi - How to Pick the Right STC](https://www.stedi.com/blog/how-to-pick-the-right-stc)
