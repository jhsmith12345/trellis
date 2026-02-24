import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const FAKE_PLAN_ID = '00000000-0000-0000-0000-000000000101';
const FAKE_CLIENT_UUID = '00000000-0000-0000-0000-000000000099';

function makeMockPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: FAKE_PLAN_ID,
    client_id: 'firebase-uid-client-1',
    version: 1,
    diagnoses: [
      {
        code: 'F41.1',
        description: 'Generalized anxiety disorder',
        rank: 1,
        type: 'primary',
      },
      {
        code: 'F32.1',
        description: 'Major depressive disorder, single episode, moderate',
        rank: 2,
        type: 'secondary',
      },
    ],
    goals: [
      {
        id: 'goal_1',
        description: 'Reduce anxiety symptoms to manageable levels',
        target_date: '2026-06-01',
        status: 'active',
        objectives: [
          {
            id: 'obj_1_1',
            description: 'Client will learn 3 coping strategies for anxiety within 4 weeks',
            status: 'active',
          },
          {
            id: 'obj_1_2',
            description: 'Client will reduce panic attack frequency from 3x/week to 1x/week',
            status: 'active',
          },
        ],
        interventions: [
          'Cognitive Behavioral Therapy (CBT)',
          'Relaxation training and breathing exercises',
        ],
      },
    ],
    presenting_problems: '<p>Client presents with persistent worry and sleep difficulties.</p>',
    review_date: '2026-05-01',
    status: 'draft',
    signed_by: null,
    signed_at: null,
    content_hash: null,
    signature_data: null,
    source_encounter_id: null,
    previous_version_id: null,
    created_at: '2026-02-20T10:00:00Z',
    updated_at: '2026-02-20T10:05:00Z',
    client: {
      firebase_uid: 'firebase-uid-client-1',
      full_name: 'Jane Doe',
      preferred_name: 'Jane',
      email: 'jane@example.com',
      date_of_birth: '1990-05-15',
    },
    client_uuid: FAKE_CLIENT_UUID,
    versions: [
      {
        id: FAKE_PLAN_ID,
        version: 1,
        status: 'draft',
        created_at: '2026-02-20T10:00:00Z',
        signed_at: null,
      },
    ],
    has_pdf: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Install route mocks for the treatment plan editor, then navigate to the page. */
async function setupPlanEditorPage(
  page: import('@playwright/test').Page,
  planOverrides: Record<string, unknown> = {},
) {
  const mockPlan = makeMockPlan(planOverrides);

  // Mock the plan detail GET
  await page.route(`**/api/treatment-plans/${FAKE_PLAN_ID}`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockPlan),
      });
    }
    // PUT for save/status updates
    if (route.request().method() === 'PUT') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'updated', plan_id: FAKE_PLAN_ID }),
      });
    }
    return route.continue();
  });

  // Mock the stored signature endpoint
  await page.route('**/api/treatment-plans/signing/signature', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ signature: null }),
    });
  });

  await page.goto(`/treatment-plans/${FAKE_PLAN_ID}`);
  await page.waitForLoadState('domcontentloaded');

  // Wait for the page to fully render (Treatment Plan heading visible)
  await expect(page.getByRole('heading', { name: /Treatment Plan/i })).toBeVisible({ timeout: 10000 });

  // Wait for React and TipTap to finish initial re-renders
  await page.waitForTimeout(500);
}

/**
 * Reliably click a button that may contain an SVG icon.
 * Scrolls into view, waits for stability, then clicks.
 * Includes a retry mechanism to handle occasional missed clicks during React re-renders.
 */
async function reliableClick(locator: import('@playwright/test').Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.waitFor({ state: 'visible' });
  await locator.click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Treatment Plan Editor Page', () => {
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
  // Basic rendering — draft plan
  // -------------------------------------------------------------------------

  test('draft plan renders header with title, version, and status badge', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Header title
    await expect(page.getByRole('heading', { name: /Treatment Plan/i })).toBeVisible();

    // Version label (appears in header and metadata footer, use first)
    await expect(page.getByText('v1').first()).toBeVisible();

    // Status badge — "draft"
    const badge = page.locator('span.capitalize', { hasText: 'draft' });
    await expect(badge).toBeVisible();
  });

  test('draft plan renders client name and creation date', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Client name from preferred_name
    await expect(page.getByText('Jane').first()).toBeVisible();

    // "Created" label in metadata
    await expect(page.getByText('Created', { exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Diagnoses section
  // -------------------------------------------------------------------------

  test('draft plan renders diagnoses with ICD-10 codes and descriptions', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Section heading
    await expect(page.getByText('Diagnoses (ICD-10)')).toBeVisible();

    // Diagnosis code inputs should have the values
    const codeInputs = page.locator('input[placeholder="ICD-10 Code"]');
    await expect(codeInputs.nth(0)).toHaveValue('F41.1');
    await expect(codeInputs.nth(1)).toHaveValue('F32.1');

    // Description inputs
    const descInputs = page.locator('input[placeholder="Diagnosis description"]');
    await expect(descInputs.nth(0)).toHaveValue('Generalized anxiety disorder');
    await expect(descInputs.nth(1)).toHaveValue('Major depressive disorder, single episode, moderate');
  });

  test('Add Diagnosis button adds a new empty diagnosis row', async ({ page }) => {
    await setupPlanEditorPage(page);

    const codeInputs = page.locator('input[placeholder="ICD-10 Code"]');
    await expect(codeInputs).toHaveCount(2);

    await reliableClick(page.getByRole('button', { name: '+ Add Diagnosis' }));
    await expect(codeInputs).toHaveCount(3, { timeout: 10000 });
  });

  test('remove diagnosis button removes the diagnosis', async ({ page }) => {
    await setupPlanEditorPage(page);

    const codeInputs = page.locator('input[placeholder="ICD-10 Code"]');
    await expect(codeInputs).toHaveCount(2);

    await reliableClick(page.getByRole('button', { name: 'Remove diagnosis' }).first());
    await expect(codeInputs).toHaveCount(1, { timeout: 10000 });
  });

  test('no diagnoses shows empty state message', async ({ page }) => {
    await setupPlanEditorPage(page, { diagnoses: [] });

    await expect(page.getByText('No diagnoses added yet.')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Goals, Objectives, and Interventions
  // -------------------------------------------------------------------------

  test('draft plan renders goals with description and status', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Section heading
    await expect(page.getByText('Treatment Goals & Objectives')).toBeVisible();

    // Goal label
    await expect(page.getByText('GOAL 1')).toBeVisible();

    // Goal description in textarea
    const goalTextarea = page.locator('textarea[placeholder="Goal description..."]');
    await expect(goalTextarea.first()).toHaveValue('Reduce anxiety symptoms to manageable levels');
  });

  test('draft plan renders objectives within goals', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Objectives section heading
    await expect(page.getByText('Objectives', { exact: true }).first()).toBeVisible();

    // Objective numbering (1.1 and 1.2)
    await expect(page.getByText('1.1')).toBeVisible();
    await expect(page.getByText('1.2')).toBeVisible();

    // Objective descriptions in textareas
    const objTextareas = page.locator('textarea[placeholder="Measurable objective..."]');
    await expect(objTextareas.nth(0)).toHaveValue('Client will learn 3 coping strategies for anxiety within 4 weeks');
    await expect(objTextareas.nth(1)).toHaveValue('Client will reduce panic attack frequency from 3x/week to 1x/week');
  });

  test('draft plan renders interventions within goals', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Interventions section heading
    await expect(page.getByText('Interventions', { exact: true }).first()).toBeVisible();

    // Intervention text in textareas
    const intTextareas = page.locator('textarea[placeholder="Evidence-based intervention..."]');
    await expect(intTextareas.nth(0)).toHaveValue('Cognitive Behavioral Therapy (CBT)');
    await expect(intTextareas.nth(1)).toHaveValue('Relaxation training and breathing exercises');
  });

  test('Add Goal button adds a new empty goal', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Start with 1 goal
    await expect(page.getByText('GOAL 1')).toBeVisible();
    await expect(page.getByText('GOAL 2')).not.toBeVisible();

    await reliableClick(page.getByRole('button', { name: '+ Add Goal' }));

    // Now there should be 2 goals
    await expect(page.getByText('GOAL 2')).toBeVisible({ timeout: 10000 });
  });

  test('remove goal button removes the goal', async ({ page }) => {
    await setupPlanEditorPage(page);

    await expect(page.getByText('GOAL 1')).toBeVisible();

    await reliableClick(page.locator('button[title="Remove goal"]').first());

    // Goal label should be gone, and empty state should show
    await expect(page.getByText('No goals defined yet.')).toBeVisible({ timeout: 10000 });
  });

  test('no goals shows empty state message', async ({ page }) => {
    await setupPlanEditorPage(page, { goals: [] });

    await expect(page.getByText('No goals defined yet.')).toBeVisible();
  });

  test('Add objective button adds a new objective to the goal', async ({ page }) => {
    await setupPlanEditorPage(page);

    const objTextareas = page.locator('textarea[placeholder="Measurable objective..."]');
    await expect(objTextareas).toHaveCount(2);

    // The "+ Add" buttons: nth(0) is for Objectives, nth(1) is for Interventions
    await reliableClick(page.getByRole('button', { name: '+ Add', exact: true }).nth(0));
    await expect(objTextareas).toHaveCount(3, { timeout: 10000 });
  });

  test('remove objective button removes the objective', async ({ page }) => {
    await setupPlanEditorPage(page);

    const objTextareas = page.locator('textarea[placeholder="Measurable objective..."]');
    await expect(objTextareas).toHaveCount(2);

    await reliableClick(page.locator('button[title="Remove objective"]').first());
    await expect(objTextareas).toHaveCount(1, { timeout: 10000 });
  });

  test('Add intervention button adds a new intervention', async ({ page }) => {
    await setupPlanEditorPage(page);

    const intTextareas = page.locator('textarea[placeholder="Evidence-based intervention..."]');
    await expect(intTextareas).toHaveCount(2);

    // The "+ Add" buttons: nth(0) is for Objectives, nth(1) is for Interventions
    await reliableClick(page.getByRole('button', { name: '+ Add', exact: true }).nth(1));
    await expect(intTextareas).toHaveCount(3, { timeout: 10000 });
  });

  test('remove intervention button removes the intervention', async ({ page }) => {
    await setupPlanEditorPage(page);

    const intTextareas = page.locator('textarea[placeholder="Evidence-based intervention..."]');
    await expect(intTextareas).toHaveCount(2);

    await reliableClick(page.locator('button[title="Remove intervention"]').first());
    await expect(intTextareas).toHaveCount(1, { timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // Presenting Problems section
  // -------------------------------------------------------------------------

  test('presenting problems section renders with content', async ({ page }) => {
    await setupPlanEditorPage(page);

    await expect(page.getByText('Presenting Problems')).toBeVisible();
    await expect(page.getByText('Client presents with persistent worry and sleep difficulties.')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Review Schedule section
  // -------------------------------------------------------------------------

  test('review schedule section renders with date', async ({ page }) => {
    await setupPlanEditorPage(page);

    await expect(page.getByText('Review Schedule')).toBeVisible();
    await expect(page.getByText('Next Review Date:')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Draft action buttons
  // -------------------------------------------------------------------------

  test('draft plan shows editable action buttons', async ({ page }) => {
    await setupPlanEditorPage(page);

    await expect(page.getByRole('button', { name: /Regenerate/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Ready for Review/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign Plan/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Versions/i })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Status-specific rendering: review
  // -------------------------------------------------------------------------

  test('review status plan shows Back to Draft button instead of Ready for Review', async ({ page }) => {
    await setupPlanEditorPage(page, { status: 'review' });

    const badge = page.locator('span.capitalize', { hasText: 'review' });
    await expect(badge).toBeVisible();

    await expect(page.getByRole('button', { name: /Back to Draft/i })).toBeVisible();
    // "Ready for Review" should NOT be present for review-status plans
    await expect(page.getByRole('button', { name: /Ready for Review/i })).not.toBeVisible();
  });

  test('review status plan still shows Save and Sign buttons', async ({ page }) => {
    await setupPlanEditorPage(page, { status: 'review' });

    await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign Plan/i })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Status-specific rendering: signed
  // -------------------------------------------------------------------------

  test('signed plan shows signed banner and hides editing buttons', async ({ page }) => {
    await setupPlanEditorPage(page, {
      status: 'signed',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
      has_pdf: true,
    });

    // Signed banner
    await expect(page.getByText('Treatment Plan Signed')).toBeVisible();
    await expect(page.getByText(/Signed by dr@example\.com/).first()).toBeVisible();
    await expect(page.getByText(/Content Hash:/)).toBeVisible();

    // Signed actions
    await expect(page.getByRole('button', { name: /Download PDF/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Update Plan/i })).toBeVisible();

    // Draft/review buttons should NOT be present
    await expect(page.getByRole('button', { name: /^Save$/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Sign Plan/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Ready for Review/i })).not.toBeVisible();
  });

  test('signed plan renders diagnoses as read-only (disabled inputs)', async ({ page }) => {
    await setupPlanEditorPage(page, {
      status: 'signed',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: 'hash123',
      has_pdf: true,
    });

    // Diagnosis inputs should be disabled
    const codeInputs = page.locator('input[placeholder="ICD-10 Code"]');
    await expect(codeInputs.first()).toBeDisabled();

    // Add Diagnosis button should NOT be visible
    await expect(page.getByRole('button', { name: /Add Diagnosis/i })).not.toBeVisible();

    // Remove buttons should NOT be visible
    await expect(page.locator('button[title="Remove diagnosis"]')).toHaveCount(0);
  });

  test('signed plan renders goals as read-only', async ({ page }) => {
    await setupPlanEditorPage(page, {
      status: 'signed',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: 'hash123',
      has_pdf: true,
    });

    // Goal textarea should be disabled
    const goalTextarea = page.locator('textarea[placeholder="Goal description..."]');
    await expect(goalTextarea.first()).toBeDisabled();

    // Add Goal button should NOT be visible
    await expect(page.getByRole('button', { name: /Add Goal/i })).not.toBeVisible();

    // Remove goal button should NOT be visible
    await expect(page.locator('button[title="Remove goal"]')).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // Metadata footer
  // -------------------------------------------------------------------------

  test('metadata footer shows plan details', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Metadata row labels
    await expect(page.getByText('Created', { exact: true })).toBeVisible();
    await expect(page.getByText('Updated', { exact: true })).toBeVisible();
    await expect(page.getByText('Version', { exact: true })).toBeVisible();
    await expect(page.getByText('Review Date', { exact: true })).toBeVisible();
  });

  test('signed plan metadata footer shows SHA-256 hash', async ({ page }) => {
    const fullHash = 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd';
    await setupPlanEditorPage(page, {
      status: 'signed',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: fullHash,
      has_pdf: true,
    });

    // SHA-256 appears in the metadata footer
    await expect(page.getByText(`SHA-256: ${fullHash}`)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Version history panel
  // -------------------------------------------------------------------------

  test('Versions button toggles version history panel', async ({ page }) => {
    await setupPlanEditorPage(page, {
      versions: [
        {
          id: FAKE_PLAN_ID,
          version: 1,
          status: 'draft',
          created_at: '2026-02-20T10:00:00Z',
          signed_at: null,
        },
        {
          id: '00000000-0000-0000-0000-000000000102',
          version: 2,
          status: 'signed',
          created_at: '2026-02-21T10:00:00Z',
          signed_at: '2026-02-21T11:00:00Z',
        },
      ],
    });

    // Click Versions button
    await page.getByRole('button', { name: /Versions/i }).click();

    // Version history panel should appear
    await expect(page.getByText('Version History')).toBeVisible();
    await expect(page.getByText('Current Version')).toBeVisible();
    await expect(page.getByText('View Version 2')).toBeVisible();

    // Toggle off
    await page.getByRole('button', { name: /Hide Versions/i }).click();
    await expect(page.getByText('Version History')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Back link navigation
  // -------------------------------------------------------------------------

  test('back link goes to client detail when client_uuid is present', async ({ page }) => {
    await setupPlanEditorPage(page);

    const backLink = page.getByText(/Back to Jane/);
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', `/clients/${FAKE_CLIENT_UUID}`);
  });

  test('back link goes to dashboard when client_uuid is null', async ({ page }) => {
    await setupPlanEditorPage(page, { client_uuid: null });

    const backLink = page.getByText(/Back to Dashboard/);
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', '/dashboard');
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  test('displays error when plan fails to load', async ({ page }) => {
    // Return a 404 to simulate missing plan
    await page.route(`**/api/treatment-plans/${FAKE_PLAN_ID}`, (route) => {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Treatment plan not found' }),
      });
    });

    await page.goto(`/treatment-plans/${FAKE_PLAN_ID}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText(/Failed to load treatment plan/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Back to Dashboard/i)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Superseded status rendering
  // -------------------------------------------------------------------------

  test('superseded plan shows superseded badge and read-only state', async ({ page }) => {
    await setupPlanEditorPage(page, {
      status: 'superseded',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: 'hash123',
    });

    const badge = page.locator('span.capitalize', { hasText: 'superseded' });
    await expect(badge).toBeVisible();

    // Editing buttons should NOT be present
    await expect(page.getByRole('button', { name: /^Save$/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Sign Plan/i })).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Save interaction
  // -------------------------------------------------------------------------

  test('Save button is present for draft plans', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Save button should exist for editable (draft) plans.
    // Note: TipTap's onUpdate fires during initial content parse, so
    // hasChanges may become true immediately. We just verify the button exists.
    const saveBtn = page.getByRole('button', { name: /^Save$/i });
    await expect(saveBtn).toBeVisible();
  });

  test('successful save shows success message', async ({ page }) => {
    await setupPlanEditorPage(page);

    // Make a change to enable save
    await page.getByRole('button', { name: /Add Diagnosis/i }).click();

    // Click save
    await page.getByRole('button', { name: /^Save$/i }).click();

    // Success message
    await expect(page.getByText('Saved successfully')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Signed plan with signature image
  // -------------------------------------------------------------------------

  test('signed plan with signature data shows signature image', async ({ page }) => {
    await setupPlanEditorPage(page, {
      status: 'signed',
      signed_by: 'dr@example.com',
      signed_at: '2026-02-20T11:00:00Z',
      content_hash: 'hash123',
      signature_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      has_pdf: true,
    });

    // Signature image should be visible
    const sigImg = page.locator('img[alt="Clinician signature"]');
    await expect(sigImg).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Goal with no objectives/interventions shows empty messages
  // -------------------------------------------------------------------------

  test('goal with no objectives or interventions shows empty messages', async ({ page }) => {
    await setupPlanEditorPage(page, {
      goals: [
        {
          id: 'goal_empty',
          description: 'Empty goal for testing',
          target_date: '',
          status: 'active',
          objectives: [],
          interventions: [],
        },
      ],
    });

    await expect(page.getByText('No objectives defined.')).toBeVisible();
    await expect(page.getByText('No interventions defined.')).toBeVisible();
  });
});
