import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const FAKE_NOTE_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_CLIENT_UUID = '00000000-0000-0000-0000-000000000099';

function makeMockNote(overrides: Record<string, unknown> = {}) {
  return {
    id: FAKE_NOTE_ID,
    encounter_id: '00000000-0000-0000-0000-000000000002',
    format: 'SOAP',
    content: {
      subjective: '<p>Client reports feeling anxious this week.</p>',
      objective: '<p>Client appears fidgety, avoids eye contact.</p>',
      assessment: '<p>Generalized anxiety disorder, moderate severity.</p>',
      plan: '<p>Continue weekly CBT sessions. Review coping strategies.</p>',
    },
    flags: [],
    signed_by: null,
    signed_at: null,
    status: 'draft',
    content_hash: null,
    amendment_of: null,
    signature_data: null,
    created_at: '2026-02-20T10:00:00Z',
    updated_at: '2026-02-20T10:05:00Z',
    client_id: 'firebase-uid-client-1',
    encounter_type: 'clinical',
    encounter_source: 'voice',
    transcript: 'Clinician: How have you been this week?\nClient: I have been feeling pretty anxious...',
    encounter_data: { appointment_type: 'individual' },
    duration_sec: 2700,
    encounter_created_at: '2026-02-20T09:00:00Z',
    client: {
      firebase_uid: 'firebase-uid-client-1',
      full_name: 'Jane Doe',
      preferred_name: 'Jane',
      email: 'jane@example.com',
      date_of_birth: '1990-05-15',
    },
    client_uuid: FAKE_CLIENT_UUID,
    amendments: [],
    has_pdf: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Install route mocks for the note editor, then navigate to the page. */
async function setupNoteEditorPage(
  page: import('@playwright/test').Page,
  noteOverrides: Record<string, unknown> = {},
) {
  const mockNote = makeMockNote(noteOverrides);

  // Mock the note detail GET
  await page.route(`**/api/notes/${FAKE_NOTE_ID}`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockNote),
      });
    }
    // PUT for save/status updates
    if (route.request().method() === 'PUT') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'updated', note_id: FAKE_NOTE_ID }),
      });
    }
    return route.continue();
  });

  // Mock the stored signature endpoint
  await page.route('**/api/notes/signing/signature', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ signature: null }),
    });
  });

  await page.goto(`/notes/${FAKE_NOTE_ID}`);
  await page.waitForLoadState('domcontentloaded');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Note Editor Page', () => {
  test.beforeEach(async ({ page }) => {
    const success = await loginViaUI(
      page,
      TEST_CLINICIAN_EMAIL,
      TEST_CLINICIAN_PASSWORD,
      'clinician',
    );
    if (!success) {
      test.skip(true, 'Clinician test account not available');
    }
    await page.waitForURL('**/dashboard', { timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  test('draft SOAP note renders header with format label and status badge', async ({ page }) => {
    await setupNoteEditorPage(page);

    // Header: "SOAP Progress Note"
    await expect(page.getByRole('heading', { name: /SOAP Progress Note/i })).toBeVisible();

    // Status badge — "draft"
    const badge = page.locator('span.capitalize', { hasText: 'draft' });
    await expect(badge).toBeVisible();
  });

  test('draft SOAP note renders all four section editors', async ({ page }) => {
    await setupNoteEditorPage(page);

    // Sections headings
    await expect(page.getByText('Subjective', { exact: true })).toBeVisible();
    await expect(page.getByText('Objective', { exact: true })).toBeVisible();
    await expect(page.getByText('Assessment', { exact: true })).toBeVisible();
    await expect(page.getByText('Plan', { exact: true })).toBeVisible();
  });

  test('draft note shows client name and session metadata', async ({ page }) => {
    await setupNoteEditorPage(page);

    // Client name comes from preferred_name (appears in back link and metadata)
    await expect(page.getByText('Jane').first()).toBeVisible();
  });

  test('draft note shows editable action buttons', async ({ page }) => {
    await setupNoteEditorPage(page);

    // Toolbar buttons visible for a draft
    await expect(page.getByRole('button', { name: /View Transcript/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Regenerate/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Ready for Review/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign Note/i })).toBeVisible();
  });

  test('metadata footer shows encounter details', async ({ page }) => {
    await setupNoteEditorPage(page);

    // Metadata row labels
    await expect(page.getByText('Created', { exact: true })).toBeVisible();
    await expect(page.getByText('Updated', { exact: true })).toBeVisible();
    await expect(page.getByText('Encounter Type', { exact: true })).toBeVisible();
    await expect(page.getByText('Source', { exact: true })).toBeVisible();

    // Values
    await expect(page.getByText('clinical')).toBeVisible();
    await expect(page.getByText('voice')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Transcript panel toggle
  // -------------------------------------------------------------------------

  test('View Transcript button toggles transcript panel', async ({ page }) => {
    await setupNoteEditorPage(page);

    const btn = page.getByRole('button', { name: /View Transcript/i });
    await btn.click();

    // The transcript panel should appear with source text
    await expect(page.getByText('Source Transcript')).toBeVisible();
    await expect(page.getByText(/How have you been this week/)).toBeVisible();

    // Button text changes
    await expect(page.getByRole('button', { name: /Hide Transcript/i })).toBeVisible();

    // Toggle off
    await page.getByRole('button', { name: /Hide Transcript/i }).click();
    await expect(page.getByText('Source Transcript')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Save button (disabled when no changes)
  // -------------------------------------------------------------------------

  test('Save button is present for draft notes', async ({ page }) => {
    await setupNoteEditorPage(page);

    // Save button should exist for editable (draft) notes.
    // Note: TipTap's onUpdate fires during initial content parse, so
    // hasChanges may become true immediately. We just verify the button exists.
    const saveBtn = page.getByRole('button', { name: /^Save$/i });
    await expect(saveBtn).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Status-specific rendering: review
  // -------------------------------------------------------------------------

  test('review status note shows Back to Draft button instead of Ready for Review', async ({ page }) => {
    await setupNoteEditorPage(page, { status: 'review' });

    const badge = page.locator('span.capitalize', { hasText: 'review' });
    await expect(badge).toBeVisible();

    await expect(page.getByRole('button', { name: /Back to Draft/i })).toBeVisible();
    // "Ready for Review" should NOT be present for review-status notes
    await expect(page.getByRole('button', { name: /Ready for Review/i })).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Status-specific rendering: signed
  // -------------------------------------------------------------------------

  test('signed note shows signed banner and hides editing buttons', async ({ page }) => {
    await setupNoteEditorPage(page, {
      status: 'signed',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
      has_pdf: true,
    });

    // Signed banner
    await expect(page.getByText('Note Signed')).toBeVisible();
    // "Signed by" text appears in both the banner and the metadata footer
    await expect(page.getByText(/Signed by dr@example\.com/).first()).toBeVisible();
    await expect(page.getByText(/Content Hash:/)).toBeVisible();

    // Signed actions
    await expect(page.getByRole('button', { name: /Download PDF/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Amend Note/i })).toBeVisible();

    // Draft/review buttons should NOT be present
    await expect(page.getByRole('button', { name: /^Save$/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Sign Note/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Regenerate/i })).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // DAP format rendering
  // -------------------------------------------------------------------------

  test('DAP note renders three section editors', async ({ page }) => {
    await setupNoteEditorPage(page, {
      format: 'DAP',
      content: {
        data: '<p>Session data goes here.</p>',
        assessment: '<p>Assessment text.</p>',
        plan: '<p>Plan text.</p>',
      },
    });

    await expect(page.getByRole('heading', { name: /DAP Progress Note/i })).toBeVisible();
    await expect(page.getByText('Data', { exact: true })).toBeVisible();
    await expect(page.getByText('Assessment', { exact: true })).toBeVisible();
    await expect(page.getByText('Plan', { exact: true })).toBeVisible();
    // Subjective and Objective should NOT be present
    await expect(page.getByText('Subjective', { exact: true })).not.toBeVisible();
    await expect(page.getByText('Objective', { exact: true })).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Narrative (biopsychosocial) format rendering
  // -------------------------------------------------------------------------

  test('narrative note renders all 13 section editors', async ({ page }) => {
    const narrativeContent: Record<string, string> = {};
    const narrativeKeys = [
      'identifying_information', 'presenting_problem', 'history_of_present_illness',
      'psychiatric_history', 'substance_use_history', 'medical_history', 'family_history',
      'social_developmental_history', 'mental_status_examination', 'diagnostic_impressions',
      'risk_assessment', 'treatment_recommendations', 'clinical_summary',
    ];
    for (const key of narrativeKeys) {
      narrativeContent[key] = `<p>${key} content.</p>`;
    }

    await setupNoteEditorPage(page, {
      format: 'narrative',
      content: narrativeContent,
    });

    await expect(page.getByRole('heading', { name: /Biopsychosocial Assessment/i })).toBeVisible();
    // Check a sample of sections exist
    await expect(page.getByText('Identifying Information', { exact: true })).toBeVisible();
    await expect(page.getByText('Presenting Problem', { exact: true })).toBeVisible();
    await expect(page.getByText('Clinical Summary', { exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  test('displays error when note fails to load', async ({ page }) => {
    // Return a 404 to simulate missing note
    await page.route(`**/api/notes/${FAKE_NOTE_ID}`, (route) => {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Note not found' }),
      });
    });

    await page.goto(`/notes/${FAKE_NOTE_ID}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText(/Failed to load note/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Back to Dashboard/i)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Back link
  // -------------------------------------------------------------------------

  test('back link goes to client detail when client_uuid is present', async ({ page }) => {
    await setupNoteEditorPage(page);

    const backLink = page.getByText(/Back to Jane/);
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', `/clients/${FAKE_CLIENT_UUID}`);
  });

  test('back link goes to dashboard when client_uuid is null', async ({ page }) => {
    await setupNoteEditorPage(page, { client_uuid: null });

    const backLink = page.getByText(/Back to Dashboard/);
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', '/dashboard');
  });

  // -------------------------------------------------------------------------
  // Amendment rendering
  // -------------------------------------------------------------------------

  test('amended note shows amendment badge and has-amendments label', async ({ page }) => {
    await setupNoteEditorPage(page, {
      status: 'amended',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
      has_pdf: true,
      amendments: [
        {
          id: '00000000-0000-0000-0000-000000000010',
          status: 'draft',
          signed_at: null,
          signed_by: null,
          created_at: '2026-02-21T10:00:00Z',
        },
      ],
    });

    // Status badge
    const badge = page.locator('span.capitalize', { hasText: 'amended' });
    await expect(badge).toBeVisible();

    // "Has Amendments" label in the signed banner
    await expect(page.getByText('Has Amendments')).toBeVisible();

    // Amendment history section
    await expect(page.getByText('Amendment History')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Amendment-of note shows original note link
  // -------------------------------------------------------------------------

  test('amendment note shows link to original note', async ({ page }) => {
    await setupNoteEditorPage(page, {
      amendment_of: '00000000-0000-0000-0000-000000000050',
      status: 'draft',
    });

    // The "Amendment" badge next to the title
    await expect(page.getByText('Amendment', { exact: true })).toBeVisible();

    // Amendment history section with original note link
    await expect(page.getByText('View Original Note')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // TipTap toolbar present in editable mode
  // -------------------------------------------------------------------------

  test('section editors show formatting toolbar when editable', async ({ page }) => {
    await setupNoteEditorPage(page);

    // Toolbar buttons: Bold (B), Italic (I), Underline (U), H3, H4
    // These are inside ToolbarButton components with title attributes
    await expect(page.locator('button[title="Bold (Ctrl+B)"]').first()).toBeVisible();
    await expect(page.locator('button[title="Italic (Ctrl+I)"]').first()).toBeVisible();
    await expect(page.locator('button[title="Underline (Ctrl+U)"]').first()).toBeVisible();
    await expect(page.locator('button[title="Heading"]').first()).toBeVisible();
    await expect(page.locator('button[title="Bullet List"]').first()).toBeVisible();
    await expect(page.locator('button[title="Numbered List"]').first()).toBeVisible();
  });

  test('section editors hide formatting toolbar when note is signed (readOnly)', async ({ page }) => {
    await setupNoteEditorPage(page, {
      status: 'signed',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: 'hash123',
      has_pdf: true,
    });

    // Toolbar buttons should NOT be present in read-only mode
    await expect(page.locator('button[title="Bold (Ctrl+B)"]')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Content renders inside TipTap editors
  // -------------------------------------------------------------------------

  test('section content renders inside TipTap editors', async ({ page }) => {
    await setupNoteEditorPage(page);

    // The mock content text should appear in the rendered page
    await expect(page.getByText('Client reports feeling anxious this week.')).toBeVisible();
    await expect(page.getByText('Client appears fidgety, avoids eye contact.')).toBeVisible();
    await expect(page.getByText('Generalized anxiety disorder, moderate severity.')).toBeVisible();
    await expect(page.getByText('Continue weekly CBT sessions. Review coping strategies.')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Discharge format rendering
  // -------------------------------------------------------------------------

  test('discharge note renders all eight section editors', async ({ page }) => {
    const dischargeContent: Record<string, string> = {
      reason_for_treatment: '<p>Reason content.</p>',
      course_of_treatment: '<p>Course content.</p>',
      progress_toward_goals: '<p>Progress content.</p>',
      diagnoses_at_discharge: '<p>Diagnoses content.</p>',
      discharge_recommendations: '<p>Recommendations content.</p>',
      medications_at_discharge: '<p>Medications content.</p>',
      risk_assessment: '<p>Risk content.</p>',
      clinical_summary: '<p>Summary content.</p>',
    };

    await setupNoteEditorPage(page, {
      format: 'discharge',
      content: dischargeContent,
    });

    await expect(page.getByRole('heading', { name: /Discharge Summary/i })).toBeVisible();
    await expect(page.getByText('Reason for Treatment', { exact: true })).toBeVisible();
    await expect(page.getByText('Course of Treatment', { exact: true })).toBeVisible();
    await expect(page.getByText('Discharge Recommendations', { exact: true })).toBeVisible();
    await expect(page.getByText('Risk Assessment at Discharge', { exact: true })).toBeVisible();
    await expect(page.getByText('Clinical Summary', { exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Signing SHA-256 in metadata footer
  // -------------------------------------------------------------------------

  test('signed note metadata footer shows SHA-256 hash', async ({ page }) => {
    const fullHash = 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd';
    await setupNoteEditorPage(page, {
      status: 'signed',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: fullHash,
      has_pdf: true,
    });

    // SHA-256 appears in the metadata footer section
    await expect(page.getByText(`SHA-256: ${fullHash}`)).toBeVisible();
  });
});
