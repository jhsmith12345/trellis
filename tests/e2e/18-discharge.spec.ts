import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const FAKE_CLIENT_ID = '00000000-0000-0000-0000-000000000099';
const FAKE_FIREBASE_UID = 'firebase-uid-client-1';
const FAKE_NOTE_ID = '00000000-0000-0000-0000-000000000501';

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    id: FAKE_CLIENT_ID,
    firebase_uid: FAKE_FIREBASE_UID,
    email: 'jane@example.com',
    full_name: 'Jane Doe',
    preferred_name: 'Jane',
    pronouns: 'she/her',
    date_of_birth: '1990-05-15',
    phone: '555-123-4567',
    address_line1: '123 Main St',
    address_line2: null,
    address_city: 'Springfield',
    address_state: 'IL',
    address_zip: '62701',
    emergency_contact_name: 'John Doe',
    emergency_contact_phone: '555-987-6543',
    emergency_contact_relationship: 'Spouse',
    payer_name: 'Aetna',
    member_id: 'MEM123456',
    group_number: 'GRP789',
    insurance_data: null,
    status: 'active',
    intake_completed_at: '2026-01-15T10:00:00Z',
    documents_completed_at: '2026-01-15T12:00:00Z',
    discharged_at: null,
    created_at: '2026-01-10T08:00:00Z',
    updated_at: '2026-02-20T10:00:00Z',
    ...overrides,
  };
}

function makeMockClientListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: FAKE_CLIENT_ID,
    firebase_uid: FAKE_FIREBASE_UID,
    email: 'jane@example.com',
    full_name: 'Jane Doe',
    preferred_name: 'Jane',
    phone: '555-123-4567',
    payer_name: 'Aetna',
    status: 'active',
    intake_completed_at: '2026-01-15T10:00:00Z',
    created_at: '2026-01-10T08:00:00Z',
    next_appointment: '2026-03-01T14:00:00Z',
    last_session: '2026-02-20T14:00:00Z',
    docs_total: 3,
    docs_signed: 3,
    primary_clinician_id: null,
    ...overrides,
  };
}

function makeMockDischargeStatus(overrides: Record<string, unknown> = {}) {
  return {
    can_discharge: true,
    unsigned_note_count: 0,
    future_appointment_count: 2,
    recurring_series_count: 1,
    completed_sessions: 8,
    has_treatment_plan: true,
    ...overrides,
  };
}

function makeMockDischargeResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'discharged',
    note_id: FAKE_NOTE_ID,
    cancelled_appointments: 2,
    ended_series: 1,
    completed_sessions: 8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Install route mocks for the client detail page. Mocks all the endpoints
 * that ClientDetailPage.tsx loads in parallel, plus the client list endpoint
 * used for sidebar navigation.
 */
async function setupClientDetailMocks(
  page: import('@playwright/test').Page,
  options: {
    clientOverrides?: Record<string, unknown>;
    dischargeStatusOverrides?: Record<string, unknown>;
    dischargeResultOverrides?: Record<string, unknown>;
    dischargeError?: boolean;
    dischargeStatusError?: boolean;
    encounters?: unknown[];
    notes?: unknown[];
    treatmentPlan?: unknown;
    appointments?: unknown[];
  } = {},
) {
  const mockClient = makeMockClient(options.clientOverrides || {});
  const mockDischargeStatus = makeMockDischargeStatus(options.dischargeStatusOverrides || {});
  const mockDischargeResult = makeMockDischargeResult(options.dischargeResultOverrides || {});

  // Track POST discharge requests
  let dischargePostBody: Record<string, unknown> | null = null;

  // Mock the client list endpoint (for sidebar navigation)
  await page.route((url) => url.pathname === '/api/clients' && !url.pathname.includes('/api/clients/'), (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          clients: [makeMockClientListItem(options.clientOverrides || {})],
        }),
      });
    }
    return route.continue();
  });

  // Mock client detail endpoints using a function predicate
  await page.route(
    (url) =>
      url.pathname.startsWith(`/api/clients/${FAKE_CLIENT_ID}`) ||
      url.pathname.startsWith(`/api/superbills/client/${FAKE_CLIENT_ID}`) ||
      url.pathname.startsWith(`/api/documents/status/${FAKE_FIREBASE_UID}`),
    (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      // GET /api/clients/:clientId
      if (url.pathname === `/api/clients/${FAKE_CLIENT_ID}` && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockClient),
        });
      }

      // GET /api/clients/:clientId/encounters
      if (url.pathname === `/api/clients/${FAKE_CLIENT_ID}/encounters` && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            encounters: options.encounters || [],
          }),
        });
      }

      // GET /api/clients/:clientId/notes
      if (url.pathname === `/api/clients/${FAKE_CLIENT_ID}/notes` && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            notes: options.notes || [],
          }),
        });
      }

      // GET /api/clients/:clientId/treatment-plan
      if (url.pathname === `/api/clients/${FAKE_CLIENT_ID}/treatment-plan` && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            options.treatmentPlan || { exists: false },
          ),
        });
      }

      // GET /api/clients/:clientId/appointments
      if (url.pathname === `/api/clients/${FAKE_CLIENT_ID}/appointments` && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            appointments: options.appointments || [],
          }),
        });
      }

      // GET /api/clients/:clientId/discharge-status
      if (url.pathname === `/api/clients/${FAKE_CLIENT_ID}/discharge-status` && method === 'GET') {
        if (options.dischargeStatusError) {
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ detail: 'Internal server error' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockDischargeStatus),
        });
      }

      // POST /api/clients/:clientId/discharge
      if (url.pathname === `/api/clients/${FAKE_CLIENT_ID}/discharge` && method === 'POST') {
        dischargePostBody = JSON.parse(route.request().postData() || '{}');
        if (options.dischargeError) {
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ detail: 'Discharge failed. Please try again.' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockDischargeResult),
        });
      }

      // GET /api/superbills/client/:clientId
      if (url.pathname === `/api/superbills/client/${FAKE_CLIENT_ID}` && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            superbills: [],
            count: 0,
            client_balance: { total_billed: 0, total_paid: 0, outstanding: 0 },
          }),
        });
      }

      // GET /api/documents/status/:firebaseUid
      if (url.pathname === `/api/documents/status/${FAKE_FIREBASE_UID}` && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            total: 0,
            signed: 0,
            pending: 0,
            packages: [],
          }),
        });
      }

      return route.continue();
    },
  );

  return { getDischargePostBody: () => dischargePostBody };
}

/**
 * Navigate to the client detail page via sidebar click on Clients,
 * then clicking on the client row.
 */
async function navigateToClientDetail(page: import('@playwright/test').Page) {
  // Navigate via sidebar
  const sidebar = page.locator('aside');
  await expect(sidebar).toBeVisible({ timeout: 10000 });
  await sidebar.getByText('Clients').click();
  await page.waitForURL('**/clients', { timeout: 10000 });

  // Wait for the client list to render, then click on the client row
  await expect(page.getByText('Jane Doe')).toBeVisible({ timeout: 10000 });
  await page.getByText('Jane Doe').click();
  await page.waitForURL(`**/clients/${FAKE_CLIENT_ID}`, { timeout: 10000 });

  // Wait for client detail page to finish loading
  await expect(page.getByRole('heading', { name: 'Jane Doe' })).toBeVisible({ timeout: 10000 });
}

/**
 * Full setup: install mocks, login, navigate to client detail page.
 */
async function setupAndNavigate(
  page: import('@playwright/test').Page,
  options: Parameters<typeof setupClientDetailMocks>[1] = {},
) {
  const result = await setupClientDetailMocks(page, options);
  await navigateToClientDetail(page);
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Discharge Flow', () => {
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
  // Discharge button visibility
  // -------------------------------------------------------------------------

  test('shows "Discharge Client" button for active clients', async ({ page }) => {
    await setupAndNavigate(page, { clientOverrides: { status: 'active' } });

    const dischargeBtn = page.getByRole('button', { name: 'Discharge Client' });
    await expect(dischargeBtn).toBeVisible();
  });

  test('shows "Discharged" label with date for discharged clients', async ({ page }) => {
    await setupAndNavigate(page, {
      clientOverrides: {
        status: 'discharged',
        discharged_at: '2026-02-20T10:00:00Z',
      },
    });

    // Should NOT show the discharge button
    await expect(page.getByRole('button', { name: 'Discharge Client' })).not.toBeVisible();

    // Should show the discharged label with date
    const dischargedLabel = page.getByText(/Discharged/);
    await expect(dischargedLabel.first()).toBeVisible();
  });

  test('shows discharged status badge on client header', async ({ page }) => {
    await setupAndNavigate(page, {
      clientOverrides: {
        status: 'discharged',
        discharged_at: '2026-02-20T10:00:00Z',
      },
    });

    // Status badge in header should say "discharged"
    const statusBadge = page.locator('span.capitalize', { hasText: 'discharged' });
    await expect(statusBadge).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Opening the discharge modal
  // -------------------------------------------------------------------------

  test('clicking "Discharge Client" opens the modal', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();

    // Modal header should appear
    await expect(page.getByRole('heading', { name: 'Discharge Client' })).toBeVisible({ timeout: 5000 });
    // Client name should appear in the modal header subtitle
    await expect(page.locator('.fixed.inset-0.z-50').getByText('Jane Doe')).toBeVisible();
  });

  test('discharge modal shows loading spinner while fetching status', async ({ page }) => {
    // Set up mocks but with a slow discharge-status response
    await setupClientDetailMocks(page);

    // Override the discharge-status endpoint to delay
    await page.route(
      (url) => url.pathname === `/api/clients/${FAKE_CLIENT_ID}/discharge-status`,
      async (route) => {
        // Delay 3 seconds to observe the spinner
        await new Promise((r) => setTimeout(r, 3000));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(makeMockDischargeStatus()),
        });
      },
    );

    await navigateToClientDetail(page);
    await page.getByRole('button', { name: 'Discharge Client' }).click();

    // Should show loading state
    await expect(page.getByText('Checking discharge readiness...')).toBeVisible({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // Pre-discharge summary (Step 1: confirm)
  // -------------------------------------------------------------------------

  test('discharge modal shows significant clinical action warning', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    // Wait for the status to load
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('This is a significant clinical action.')).toBeVisible();
  });

  test('discharge modal shows pre-discharge summary with correct data', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeStatusOverrides: {
        completed_sessions: 12,
        future_appointment_count: 3,
        recurring_series_count: 2,
        has_treatment_plan: true,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Completed sessions: the value div contains just the number
    const modal = page.locator('.fixed.inset-0.z-50');
    await expect(modal.getByText('Completed sessions:')).toBeVisible();
    // The grid has label/value pairs. Verify the value "12" is rendered.
    await expect(modal.locator('div.font-medium', { hasText: '12' })).toBeVisible();

    // Future appointments with "will be cancelled" note
    await expect(modal.getByText('Future appointments:')).toBeVisible();
    await expect(modal.getByText('(will be cancelled)')).toBeVisible();

    // Recurring series with "will be ended" note
    await expect(modal.getByText('Recurring series:')).toBeVisible();
    await expect(modal.getByText('(will be ended)')).toBeVisible();

    // Treatment plan
    await expect(modal.getByText('Treatment plan:')).toBeVisible();
    await expect(modal.getByText('Yes')).toBeVisible();
  });

  test('discharge modal shows "None" when no treatment plan exists', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeStatusOverrides: {
        has_treatment_plan: false,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    const modal = page.locator('.fixed.inset-0.z-50');
    await expect(modal.getByText('Treatment plan:')).toBeVisible();
    await expect(modal.getByText('None')).toBeVisible();
  });

  test('discharge modal shows unsigned notes warning when count > 0', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeStatusOverrides: {
        unsigned_note_count: 3,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Warning about unsigned notes
    await expect(page.getByText('3 unsigned notes')).toBeVisible();
    await expect(page.getByText('Consider signing outstanding notes before discharging.')).toBeVisible();
  });

  test('discharge modal shows singular unsigned note text for count of 1', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeStatusOverrides: {
        unsigned_note_count: 1,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Should show singular form "1 unsigned note" (not "notes")
    await expect(page.getByText('1 unsigned note')).toBeVisible();
  });

  test('discharge modal does NOT show unsigned notes warning when count is 0', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeStatusOverrides: {
        unsigned_note_count: 0,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // No unsigned notes warning
    await expect(page.getByText('unsigned note')).not.toBeVisible();
    await expect(page.getByText('Consider signing outstanding notes')).not.toBeVisible();
  });

  test('discharge modal has optional discharge reason textarea', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Label
    await expect(page.getByText('Discharge Reason (optional)')).toBeVisible();

    // Textarea with placeholder
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute('placeholder', /Treatment goals met/);
  });

  test('discharge modal shows no "will be cancelled/ended" notes when counts are 0', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeStatusOverrides: {
        future_appointment_count: 0,
        recurring_series_count: 0,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Should NOT show "will be cancelled" or "will be ended" text
    await expect(page.getByText('(will be cancelled)')).not.toBeVisible();
    await expect(page.getByText('(will be ended)')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Cancel / close modal
  // -------------------------------------------------------------------------

  test('Cancel button closes the discharge modal', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Modal should be gone
    await expect(page.locator('.fixed.inset-0.z-50')).not.toBeVisible();
  });

  test('clicking backdrop closes the modal during confirm step', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Click the backdrop at a position clearly outside the modal dialog.
    // The modal is centered, so clicking at position (10, 10) hits the backdrop overlay.
    await page.locator('.absolute.inset-0.bg-black\\/50').click({ position: { x: 10, y: 10 } });

    // Modal should be gone
    await expect(page.locator('.fixed.inset-0.z-50')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Confirm and process discharge
  // -------------------------------------------------------------------------

  test('Confirm Discharge sends POST request with reason', async ({ page }) => {
    const { getDischargePostBody } = await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Type a discharge reason
    await page.locator('textarea').fill('Treatment goals met, mutual agreement');

    // Click Confirm Discharge
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();

    // Wait for complete step
    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });

    // Verify POST body
    expect(getDischargePostBody()).not.toBeNull();
    expect(getDischargePostBody()!.reason).toBe('Treatment goals met, mutual agreement');
  });

  test('Confirm Discharge sends null reason when textarea is empty', async ({ page }) => {
    const { getDischargePostBody } = await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Do NOT fill in the reason -- leave it empty

    // Click Confirm Discharge
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();

    // Wait for complete step
    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });

    // Verify POST body sends null reason
    expect(getDischargePostBody()).not.toBeNull();
    expect(getDischargePostBody()!.reason).toBeNull();
  });

  test('processing step shows spinner and processing text', async ({ page }) => {
    // Use a delayed discharge response to observe the processing step
    await setupClientDetailMocks(page);

    // Override the discharge endpoint with delay
    await page.route(
      (url) => url.pathname === `/api/clients/${FAKE_CLIENT_ID}/discharge`,
      async (route) => {
        if (route.request().method() === 'POST') {
          await new Promise((r) => setTimeout(r, 3000));
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(makeMockDischargeResult()),
          });
        }
        return route.continue();
      },
    );

    await navigateToClientDetail(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Click Confirm Discharge
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();

    // Should show processing step
    await expect(page.getByText('Processing discharge...')).toBeVisible({ timeout: 3000 });
    await expect(
      page.getByText(/Cancelling appointments, generating discharge summary/),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Complete step (Step 3)
  // -------------------------------------------------------------------------

  test('complete step shows success message with correct appointment count', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeResultOverrides: {
        cancelled_appointments: 5,
        ended_series: 0,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();

    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('5 appointments cancelled')).toBeVisible();
    await expect(page.getByText('Discharge summary created as draft note')).toBeVisible();
  });

  test('complete step shows singular appointment text for count of 1', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeResultOverrides: {
        cancelled_appointments: 1,
        ended_series: 0,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();

    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });
    // Should show "1 appointment cancelled" (not "appointments")
    await expect(page.getByText('1 appointment cancelled')).toBeVisible();
  });

  test('complete step shows ended recurring series when count > 0', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeResultOverrides: {
        cancelled_appointments: 2,
        ended_series: 3,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();

    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('3 recurring series ended')).toBeVisible();
  });

  test('complete step does NOT show ended series text when count is 0', async ({ page }) => {
    await setupAndNavigate(page, {
      dischargeResultOverrides: {
        cancelled_appointments: 2,
        ended_series: 0,
      },
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();

    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('recurring series ended')).not.toBeVisible();
  });

  test('"Review Discharge Note" button navigates to note editor', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();
    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });

    // Click Review Discharge Note
    await page.getByRole('button', { name: 'Review Discharge Note' }).click();

    // Should navigate to the note editor page
    await page.waitForURL(`**/notes/${FAKE_NOTE_ID}`, { timeout: 10000 });
  });

  test('"Close" button on complete step closes the modal', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();
    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });

    // Click Close
    await page.getByRole('button', { name: 'Close' }).click();

    // Modal should be gone
    await expect(page.locator('.fixed.inset-0.z-50')).not.toBeVisible();
  });

  test('complete step shows modal header as "Client Discharged"', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();
    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });

    // Modal header changes to "Client Discharged"
    await expect(page.getByRole('heading', { name: 'Client Discharged' })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Post-discharge UI updates
  // -------------------------------------------------------------------------

  test('after discharge, client status updates to "discharged" with badge', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();
    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });

    // Close the modal
    await page.getByRole('button', { name: 'Close' }).click();

    // The status badge in the header should now say "discharged"
    const statusBadge = page.locator('span.capitalize', { hasText: 'discharged' });
    await expect(statusBadge).toBeVisible();
  });

  test('after discharge, "Discharge Client" button is replaced with "Discharged" label', async ({ page }) => {
    await setupAndNavigate(page);

    // Verify the button is present before discharge
    await expect(page.getByRole('button', { name: 'Discharge Client' })).toBeVisible();

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();
    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });

    // Close the modal
    await page.getByRole('button', { name: 'Close' }).click();

    // Discharge button should no longer exist
    await expect(page.getByRole('button', { name: 'Discharge Client' })).not.toBeVisible();

    // Instead, the "Discharged" label should appear
    await expect(page.getByText(/^Discharged/)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  test('API error on discharge shows error alert and returns to confirm step', async ({ page }) => {
    await setupAndNavigate(page, { dischargeError: true });

    // Listen for the dialog (alert)
    let alertMessage = '';
    page.on('dialog', async (dialog) => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });

    // Click Confirm Discharge
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();

    // Wait for the alert and step to revert to confirm
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    expect(alertMessage).toContain('Discharge failed');
  });

  test('Confirm Discharge button is disabled while status is loading', async ({ page }) => {
    // Use a slow discharge-status endpoint
    await setupClientDetailMocks(page);

    await page.route(
      (url) => url.pathname === `/api/clients/${FAKE_CLIENT_ID}/discharge-status`,
      async (route) => {
        await new Promise((r) => setTimeout(r, 5000));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(makeMockDischargeStatus()),
        });
      },
    );

    await navigateToClientDetail(page);
    await page.getByRole('button', { name: 'Discharge Client' }).click();

    // During loading, the Confirm Discharge button should be disabled
    const confirmBtn = page.getByRole('button', { name: 'Confirm Discharge' });
    await expect(confirmBtn).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // Complete step next-steps guidance
  // -------------------------------------------------------------------------

  test('complete step shows review and sign guidance', async ({ page }) => {
    await setupAndNavigate(page);

    await page.getByRole('button', { name: 'Discharge Client' }).click();
    await expect(page.getByText('Pre-Discharge Summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Discharge' }).click();
    await expect(page.getByText('Discharge completed successfully.')).toBeVisible({ timeout: 10000 });

    // Next-step guidance text
    await expect(page.getByText('Next step: Review and sign the discharge summary.')).toBeVisible();
    await expect(
      page.getByText(/AI-generated discharge summary has been created as a draft clinical note/),
    ).toBeVisible();
  });
});
