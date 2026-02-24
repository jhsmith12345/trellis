import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const FAKE_SUPERBILL_1 = {
  id: '00000000-0000-0000-0000-000000000201',
  client_id: 'firebase-uid-client-1',
  appointment_id: '00000000-0000-0000-0000-000000000301',
  note_id: '00000000-0000-0000-0000-000000000401',
  clinician_id: 'firebase-uid-clinician-1',
  date_of_service: '2026-02-20',
  cpt_code: '90834',
  cpt_description: 'Psychotherapy, 45 min',
  diagnosis_codes: [
    { code: 'F41.1', description: 'Generalized anxiety disorder', rank: 1 },
    { code: 'F32.1', description: 'Major depressive disorder, single episode, moderate', rank: 2 },
  ],
  fee: 175.0,
  amount_paid: 0,
  status: 'generated',
  has_pdf: true,
  client_name: 'Jane Doe',
  client_uuid: '00000000-0000-0000-0000-000000000099',
  created_at: '2026-02-20T12:00:00Z',
  updated_at: '2026-02-20T12:00:00Z',
};

const FAKE_SUPERBILL_2 = {
  id: '00000000-0000-0000-0000-000000000202',
  client_id: 'firebase-uid-client-2',
  appointment_id: '00000000-0000-0000-0000-000000000302',
  note_id: '00000000-0000-0000-0000-000000000402',
  clinician_id: 'firebase-uid-clinician-1',
  date_of_service: '2026-02-18',
  cpt_code: '90791',
  cpt_description: 'Psychiatric diagnostic evaluation',
  diagnosis_codes: [
    { code: 'F43.10', description: 'Post-traumatic stress disorder, unspecified', rank: 1 },
  ],
  fee: 250.0,
  amount_paid: 250.0,
  status: 'paid',
  has_pdf: true,
  client_name: 'John Smith',
  client_uuid: '00000000-0000-0000-0000-000000000098',
  created_at: '2026-02-18T14:00:00Z',
  updated_at: '2026-02-19T10:00:00Z',
};

const FAKE_SUPERBILL_3 = {
  id: '00000000-0000-0000-0000-000000000203',
  client_id: 'firebase-uid-client-3',
  appointment_id: null,
  note_id: '00000000-0000-0000-0000-000000000403',
  clinician_id: 'firebase-uid-clinician-1',
  date_of_service: '2026-02-15',
  cpt_code: '90837',
  cpt_description: 'Psychotherapy, 60 min',
  diagnosis_codes: [
    { code: 'F41.1', description: 'Generalized anxiety disorder', rank: 1 },
    { code: 'F32.1', description: 'Major depressive disorder, moderate', rank: 2 },
    { code: 'F40.10', description: 'Social anxiety disorder', rank: 3 },
  ],
  fee: 200.0,
  amount_paid: 0,
  status: 'outstanding',
  has_pdf: false,
  client_name: 'Alice Johnson',
  client_uuid: null,
  created_at: '2026-02-15T16:00:00Z',
  updated_at: '2026-02-16T09:00:00Z',
};

const FAKE_SUPERBILL_SUBMITTED = {
  id: '00000000-0000-0000-0000-000000000204',
  client_id: 'firebase-uid-client-4',
  appointment_id: '00000000-0000-0000-0000-000000000304',
  note_id: '00000000-0000-0000-0000-000000000404',
  clinician_id: 'firebase-uid-clinician-1',
  date_of_service: '2026-02-10',
  cpt_code: '90834',
  cpt_description: 'Psychotherapy, 45 min',
  diagnosis_codes: [],
  fee: 175.0,
  amount_paid: 0,
  status: 'submitted',
  has_pdf: true,
  client_name: 'Bob Williams',
  client_uuid: '00000000-0000-0000-0000-000000000097',
  created_at: '2026-02-10T11:00:00Z',
  updated_at: '2026-02-11T08:00:00Z',
};

const ALL_SUPERBILLS = [FAKE_SUPERBILL_1, FAKE_SUPERBILL_2, FAKE_SUPERBILL_3, FAKE_SUPERBILL_SUBMITTED];

function makeSummary(superbills: typeof ALL_SUPERBILLS) {
  const total_billed = superbills.reduce((sum, sb) => sum + (sb.fee || 0), 0);
  const total_paid = superbills.reduce((sum, sb) => sum + (sb.amount_paid || 0), 0);
  return {
    total_billed,
    total_paid,
    total_outstanding: total_billed - total_paid,
  };
}

function makeSuperbillsResponse(superbills: typeof ALL_SUPERBILLS) {
  return {
    superbills,
    count: superbills.length,
    summary: makeSummary(superbills),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Install route mocks for the billing page, then navigate to /billing.
 * Intercepts GET /api/superbills with optional status filter support.
 */
async function setupBillingPage(
  page: import('@playwright/test').Page,
  options: {
    superbills?: typeof ALL_SUPERBILLS;
    /** If true, return empty superbills list */
    empty?: boolean;
  } = {},
) {
  const superbills = options.empty ? [] : (options.superbills || ALL_SUPERBILLS);

  // Mock superbills list endpoint (supports ?status= filter)
  await page.route('**/api/superbills?*', (route) => {
    const url = new URL(route.request().url());
    const statusFilter = url.searchParams.get('status');
    let filtered = superbills;
    if (statusFilter && statusFilter !== 'all') {
      filtered = superbills.filter((sb) => sb.status === statusFilter);
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeSuperbillsResponse(filtered)),
    });
  });

  // Mock superbills list endpoint (no query params)
  await page.route('**/api/superbills', (route) => {
    if (route.request().url().includes('?')) {
      return route.fallback();
    }
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeSuperbillsResponse(superbills)),
      });
    }
    return route.continue();
  });

  await page.goto('/billing');
  await page.waitForLoadState('domcontentloaded');

  // Wait for loading spinner to disappear and content to render
  await expect(page.getByText('Billing').first()).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Billing Page', () => {
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

  test('billing page loads with header and description', async ({ page }) => {
    await setupBillingPage(page);

    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
    await expect(page.getByText('Superbills and billing status for all sessions.')).toBeVisible();
  });

  test('sidebar Billing link is active', async ({ page }) => {
    await setupBillingPage(page);

    const billingLink = page.locator('aside nav a', { hasText: 'Billing' });
    await expect(billingLink).toHaveClass(/bg-teal-50/);
  });

  // -------------------------------------------------------------------------
  // Summary cards
  // -------------------------------------------------------------------------

  test('summary cards show total billed, paid, and outstanding', async ({ page }) => {
    await setupBillingPage(page);

    // Summary cards are in a grid above the superbills table
    const summaryCards = page.locator('.grid.grid-cols-1');

    // Total Billed: 175 + 250 + 200 + 175 = $800.00
    const billedCard = summaryCards.locator('div', { hasText: 'Total Billed' });
    await expect(billedCard).toBeVisible();
    await expect(billedCard.locator('p.text-2xl')).toHaveText('$800.00');

    // Total Paid: 0 + 250 + 0 + 0 = $250.00
    const paidCard = summaryCards.locator('div', { hasText: 'Total Paid' });
    await expect(paidCard).toBeVisible();
    await expect(paidCard.locator('p.text-2xl')).toHaveText('$250.00');

    // Outstanding Balance: 800 - 250 = $550.00
    const outstandingCard = summaryCards.locator('div', { hasText: 'Outstanding Balance' });
    await expect(outstandingCard).toBeVisible();
    await expect(outstandingCard.locator('p.text-2xl')).toHaveText('$550.00');
  });

  test('outstanding balance is red when positive', async ({ page }) => {
    await setupBillingPage(page);

    // The outstanding balance card should use red text when > 0
    const outstandingValue = page.locator('text=$550.00');
    await expect(outstandingValue).toHaveClass(/text-red-600/);
  });

  test('outstanding balance is teal when zero', async ({ page }) => {
    const paidBill = {
      ...FAKE_SUPERBILL_1,
      fee: 100.0,
      amount_paid: 100.0,
      status: 'paid' as const,
    };
    await setupBillingPage(page, { superbills: [paidBill] });

    // Outstanding = 100 - 100 = 0
    const outstandingValue = page.locator('text=$0.00').last();
    await expect(outstandingValue).toHaveClass(/text-teal-700/);
  });

  // -------------------------------------------------------------------------
  // Superbills table
  // -------------------------------------------------------------------------

  test('superbills table renders column headers', async ({ page }) => {
    await setupBillingPage(page);

    const headers = ['Date', 'Client', 'Service', 'Diagnoses', 'Fee', 'Paid', 'Status', 'Actions'];
    for (const header of headers) {
      await expect(page.locator('th', { hasText: header })).toBeVisible();
    }
  });

  test('superbills table renders all superbill rows', async ({ page }) => {
    await setupBillingPage(page);

    // Should have 4 rows in the table body
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(4);
  });

  test('superbill row displays date of service', async ({ page }) => {
    await setupBillingPage(page);

    // formatDate uses new Date(iso).toLocaleDateString() which may shift by
    // one day depending on timezone (date-only ISO strings are parsed as UTC).
    // We verify that each row has a visible date cell rather than checking
    // exact formatted dates which vary by environment timezone.
    const rows = page.locator('tbody tr');
    for (let i = 0; i < 4; i++) {
      const dateCell = rows.nth(i).locator('td').nth(0);
      // Each date cell should contain a month abbreviation and year
      await expect(dateCell).toContainText('2026');
      await expect(dateCell).toContainText('Feb');
    }
  });

  test('superbill row displays client name as link when client_uuid exists', async ({ page }) => {
    await setupBillingPage(page);

    // Jane Doe has client_uuid, so should be a link
    const clientLink = page.locator('a', { hasText: 'Jane Doe' });
    await expect(clientLink).toBeVisible();
    await expect(clientLink).toHaveAttribute('href', '/clients/00000000-0000-0000-0000-000000000099');
  });

  test('superbill row displays client name as plain text when no client_uuid', async ({ page }) => {
    await setupBillingPage(page);

    // Alice Johnson has client_uuid = null, so should be plain text, not a link
    const aliceText = page.locator('td span', { hasText: 'Alice Johnson' });
    await expect(aliceText).toBeVisible();
    // Ensure it's NOT a link
    const aliceLink = page.locator('td a', { hasText: 'Alice Johnson' });
    await expect(aliceLink).toHaveCount(0);
  });

  test('superbill row displays CPT code and description', async ({ page }) => {
    await setupBillingPage(page);

    await expect(page.getByText('90834').first()).toBeVisible();
    await expect(page.getByText('Psychotherapy, 45 min').first()).toBeVisible();
    await expect(page.getByText('90791')).toBeVisible();
    await expect(page.getByText('Psychiatric diagnostic evaluation')).toBeVisible();
  });

  test('superbill row displays diagnosis codes (truncated at 2)', async ({ page }) => {
    await setupBillingPage(page);

    // FAKE_SUPERBILL_1: 2 diagnoses -- both should show
    await expect(page.getByText('F41.1').first()).toBeVisible();
    await expect(page.getByText('F32.1').first()).toBeVisible();

    // FAKE_SUPERBILL_3: 3 diagnoses -- first 2 + "+1 more"
    await expect(page.getByText('+1 more')).toBeVisible();
  });

  test('superbill row shows dash for empty diagnoses', async ({ page }) => {
    await setupBillingPage(page);

    // FAKE_SUPERBILL_SUBMITTED has empty diagnosis_codes
    // The 4th row should show "-" in the diagnoses column
    const fourthRow = page.locator('tbody tr').nth(3);
    const diagCell = fourthRow.locator('td').nth(3);
    await expect(diagCell.locator('span', { hasText: '-' })).toBeVisible();
  });

  test('superbill row displays fee and amount paid', async ({ page }) => {
    await setupBillingPage(page);

    await expect(page.getByText('$175.00').first()).toBeVisible();
    await expect(page.getByText('$250.00').first()).toBeVisible();
    await expect(page.getByText('$200.00')).toBeVisible();
  });

  test('superbill row displays status badge with correct styling', async ({ page }) => {
    await setupBillingPage(page);

    // Status badges should exist
    const generatedBadge = page.locator('span.rounded-full', { hasText: 'Generated' });
    await expect(generatedBadge).toBeVisible();
    await expect(generatedBadge).toHaveClass(/bg-blue-50/);
    await expect(generatedBadge).toHaveClass(/text-blue-700/);

    const paidBadge = page.locator('span.rounded-full', { hasText: 'Paid' });
    await expect(paidBadge).toBeVisible();
    await expect(paidBadge).toHaveClass(/bg-teal-50/);
    await expect(paidBadge).toHaveClass(/text-teal-700/);

    const outstandingBadge = page.locator('span.rounded-full', { hasText: 'Outstanding' });
    await expect(outstandingBadge).toBeVisible();
    await expect(outstandingBadge).toHaveClass(/bg-red-50/);
    await expect(outstandingBadge).toHaveClass(/text-red-700/);

    const submittedBadge = page.locator('span.rounded-full', { hasText: 'Submitted' });
    await expect(submittedBadge).toBeVisible();
    await expect(submittedBadge).toHaveClass(/bg-amber-50/);
    await expect(submittedBadge).toHaveClass(/text-amber-700/);
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  test('empty state shows message when no superbills exist', async ({ page }) => {
    await setupBillingPage(page, { empty: true });

    await expect(
      page.getByText('No superbills yet. Superbills are automatically generated when clinical notes are signed.'),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Filter buttons
  // -------------------------------------------------------------------------

  test('filter buttons are displayed', async ({ page }) => {
    await setupBillingPage(page);

    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generated' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submitted' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paid' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Outstanding' })).toBeVisible();
  });

  test('All filter button is active by default', async ({ page }) => {
    await setupBillingPage(page);

    const allButton = page.getByRole('button', { name: 'All' });
    await expect(allButton).toHaveClass(/bg-teal-50/);
    await expect(allButton).toHaveClass(/text-teal-700/);
  });

  test('clicking a filter button sends filtered API request', async ({ page }) => {
    await setupBillingPage(page);

    // Track API calls to verify filter parameter
    const apiCalls: string[] = [];
    await page.route('**/api/superbills?*', (route) => {
      apiCalls.push(route.request().url());
      const url = new URL(route.request().url());
      const statusFilter = url.searchParams.get('status');
      const filtered = ALL_SUPERBILLS.filter((sb) => sb.status === statusFilter);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeSuperbillsResponse(filtered)),
      });
    });

    // Click the "Paid" filter
    await page.getByRole('button', { name: 'Paid' }).click();

    // Wait for filtered results
    await expect(page.locator('tbody tr')).toHaveCount(1, { timeout: 5000 });

    // Verify the Paid badge is shown
    await expect(page.locator('span.rounded-full', { hasText: 'Paid' })).toBeVisible();

    // Verify Paid button is now active
    const paidButton = page.getByRole('button', { name: 'Paid' });
    await expect(paidButton).toHaveClass(/bg-teal-50/);
  });

  test('filter to status with no results shows empty state', async ({ page }) => {
    // Use only generated superbills so "paid" filter yields empty
    await setupBillingPage(page, { superbills: [FAKE_SUPERBILL_1] });

    // Override route for filtered requests
    await page.route('**/api/superbills?*', (route) => {
      const url = new URL(route.request().url());
      const statusFilter = url.searchParams.get('status');
      const filtered = [FAKE_SUPERBILL_1].filter((sb) => sb.status === statusFilter);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeSuperbillsResponse(filtered)),
      });
    });

    await page.getByRole('button', { name: 'Paid' }).click();

    await expect(page.getByText('No paid superbills.')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // PDF download button
  // -------------------------------------------------------------------------

  test('download PDF button is visible for superbills with has_pdf=true', async ({ page }) => {
    await setupBillingPage(page);

    // FAKE_SUPERBILL_1 has has_pdf=true, FAKE_SUPERBILL_3 has has_pdf=false
    // First row (Jane Doe) should have the download button
    const firstRow = page.locator('tbody tr').nth(0);
    const downloadBtn = firstRow.locator('button[title="Download PDF"]');
    await expect(downloadBtn).toBeVisible();
  });

  test('download PDF button is hidden for superbills without PDF', async ({ page }) => {
    await setupBillingPage(page);

    // FAKE_SUPERBILL_3 (Alice Johnson, outstanding) has has_pdf=false
    // It's the 3rd row (sorted by date_of_service DESC in the mock data array)
    const aliceRow = page.locator('tbody tr').nth(2);
    const downloadBtn = aliceRow.locator('button[title="Download PDF"]');
    await expect(downloadBtn).toHaveCount(0);
  });

  test('clicking download PDF triggers blob download', async ({ page }) => {
    await setupBillingPage(page);

    // Mock the PDF download endpoint
    await page.route(`**/api/superbills/${FAKE_SUPERBILL_1.id}/pdf`, (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: Buffer.from('%PDF-1.4 fake pdf content'),
        headers: {
          'Content-Disposition': `attachment; filename="superbill_test.pdf"`,
        },
      });
    });

    // Intercept the download
    const downloadPromise = page.waitForEvent('download');

    const firstRow = page.locator('tbody tr').nth(0);
    await firstRow.locator('button[title="Download PDF"]').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('superbill_');
  });

  // -------------------------------------------------------------------------
  // Email button
  // -------------------------------------------------------------------------

  test('email button is visible for superbills with PDF', async ({ page }) => {
    await setupBillingPage(page);

    const firstRow = page.locator('tbody tr').nth(0);
    const emailBtn = firstRow.locator('button[title="Email to client"]');
    await expect(emailBtn).toBeVisible();
  });

  test('email button is hidden for superbills without PDF', async ({ page }) => {
    await setupBillingPage(page);

    // FAKE_SUPERBILL_3 (row 3) has has_pdf=false
    const aliceRow = page.locator('tbody tr').nth(2);
    const emailBtn = aliceRow.locator('button[title="Email to client"]');
    await expect(emailBtn).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // Status change dropdown
  // -------------------------------------------------------------------------

  test('status dropdown button is visible for each superbill row', async ({ page }) => {
    await setupBillingPage(page);

    // Each row should have a "Change status" button
    const statusButtons = page.locator('button[title="Change status"]');
    await expect(statusButtons).toHaveCount(4);
  });

  test('clicking status dropdown shows status options excluding current status', async ({ page }) => {
    await setupBillingPage(page);

    // Click the status dropdown for FAKE_SUPERBILL_1 (status: generated)
    const firstRow = page.locator('tbody tr').nth(0);
    await firstRow.locator('button[title="Change status"]').click();

    // Should see options for Submitted, Paid, Outstanding (but NOT Generated)
    await expect(page.getByText('Mark as Submitted')).toBeVisible();
    await expect(page.getByText('Mark as Paid')).toBeVisible();
    await expect(page.getByText('Mark as Outstanding')).toBeVisible();
    // Current status "Generated" should NOT appear
    await expect(page.getByText('Mark as Generated')).not.toBeVisible();
  });

  test('clicking a status option sends PATCH request', async ({ page }) => {
    await setupBillingPage(page);

    let patchCalled = false;
    let patchBody: Record<string, unknown> = {};

    // Mock the PATCH endpoint
    await page.route(`**/api/superbills/${FAKE_SUPERBILL_1.id}/status`, (route) => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        patchBody = JSON.parse(route.request().postData() || '{}');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'updated',
            superbill_id: FAKE_SUPERBILL_1.id,
            new_status: 'submitted',
          }),
        });
      }
      return route.continue();
    });

    // Open dropdown for first row
    const firstRow = page.locator('tbody tr').nth(0);
    await firstRow.locator('button[title="Change status"]').click();

    // Click "Mark as Submitted"
    await page.getByText('Mark as Submitted').click();

    // Wait for the PATCH to be called (the reload of superbills will happen)
    await page.waitForTimeout(1000);
    expect(patchCalled).toBe(true);
    expect(patchBody.status).toBe('submitted');
  });

  test('clicking "Mark as Paid" sends PATCH with amount_paid equal to fee', async ({ page }) => {
    await setupBillingPage(page);

    let patchBody: Record<string, unknown> = {};

    // Mock the PATCH endpoint
    await page.route(`**/api/superbills/${FAKE_SUPERBILL_1.id}/status`, (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = JSON.parse(route.request().postData() || '{}');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'updated',
            superbill_id: FAKE_SUPERBILL_1.id,
            new_status: 'paid',
          }),
        });
      }
      return route.continue();
    });

    // Open dropdown
    const firstRow = page.locator('tbody tr').nth(0);
    await firstRow.locator('button[title="Change status"]').click();

    // Click "Mark as Paid"
    await page.getByText('Mark as Paid').click();

    await page.waitForTimeout(1000);
    expect(patchBody.status).toBe('paid');
    expect(patchBody.amount_paid).toBe(175.0);
  });

  test('status dropdown closes when clicking outside', async ({ page }) => {
    await setupBillingPage(page);

    // Open dropdown
    const firstRow = page.locator('tbody tr').nth(0);
    await firstRow.locator('button[title="Change status"]').click();

    // Verify dropdown is open
    await expect(page.getByText('Mark as Submitted')).toBeVisible();

    // Click outside (the fixed overlay)
    await page.locator('.fixed.inset-0.z-10').click();

    // Dropdown should close
    await expect(page.getByText('Mark as Submitted')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Superbills section heading
  // -------------------------------------------------------------------------

  test('superbills section has heading', async ({ page }) => {
    await setupBillingPage(page);

    await expect(page.getByRole('heading', { name: 'Superbills' })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Summary card rendering with specific amounts
  // -------------------------------------------------------------------------

  test('summary cards reflect filtered data correctly', async ({ page }) => {
    // Use a single paid superbill for clear math
    const singleBill = {
      ...FAKE_SUPERBILL_2,
      fee: 300.0,
      amount_paid: 300.0,
      status: 'paid' as const,
    };
    await setupBillingPage(page, { superbills: [singleBill] });

    await expect(page.getByText('$300.00').first()).toBeVisible();
    await expect(page.getByText('Total Billed')).toBeVisible();
    await expect(page.getByText('Total Paid')).toBeVisible();
    await expect(page.getByText('Outstanding Balance')).toBeVisible();
  });
});
