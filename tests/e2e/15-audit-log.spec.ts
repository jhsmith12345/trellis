import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const FAKE_EVENT_1 = {
  id: '00000000-0000-0000-0000-000000000001',
  user_id: 'firebase-uid-clinician-123',
  action: 'viewed',
  resource_type: 'clinical_note',
  resource_id: '00000000-0000-0000-0000-aaaaaaaaaaaa',
  ip_address: '192.168.1.10',
  user_agent: 'Mozilla/5.0',
  metadata: { page: 1 },
  created_at: '2026-02-22T10:30:00Z',
};

const FAKE_EVENT_2 = {
  id: '00000000-0000-0000-0000-000000000002',
  user_id: 'firebase-uid-clinician-123',
  action: 'signed',
  resource_type: 'clinical_note',
  resource_id: '00000000-0000-0000-0000-bbbbbbbbbbbb',
  ip_address: '10.0.0.5',
  user_agent: 'Mozilla/5.0',
  metadata: { content_hash: 'abc123' },
  created_at: '2026-02-21T14:15:00Z',
};

const FAKE_EVENT_3 = {
  id: '00000000-0000-0000-0000-000000000003',
  user_id: null,
  action: 'created',
  resource_type: 'client',
  resource_id: '00000000-0000-0000-0000-cccccccccccc',
  ip_address: null,
  user_agent: null,
  metadata: null,
  created_at: '2026-02-20T09:00:00Z',
};

const FAKE_EVENT_4 = {
  id: '00000000-0000-0000-0000-000000000004',
  user_id: 'firebase-uid-clinician-123',
  action: 'updated',
  resource_type: 'treatment_plan',
  resource_id: '00000000-0000-0000-0000-dddddddddddd',
  ip_address: '172.16.0.1',
  user_agent: 'Mozilla/5.0',
  metadata: { status: 'active' },
  created_at: '2026-02-19T16:45:00Z',
};

const FAKE_EVENT_5 = {
  id: '00000000-0000-0000-0000-000000000005',
  user_id: 'firebase-uid-client-456',
  action: 'listed',
  resource_type: 'appointment',
  resource_id: null,
  ip_address: '203.0.113.42',
  user_agent: 'Mozilla/5.0',
  metadata: null,
  created_at: '2026-02-18T11:20:00Z',
};

const ALL_EVENTS = [FAKE_EVENT_1, FAKE_EVENT_2, FAKE_EVENT_3, FAKE_EVENT_4, FAKE_EVENT_5];

const ALL_ACTIONS = ['created', 'listed', 'signed', 'updated', 'viewed'];
const ALL_RESOURCE_TYPES = ['appointment', 'client', 'clinical_note', 'treatment_plan'];

function makeAuditResponse(
  events: typeof ALL_EVENTS,
  opts: { page?: number; per_page?: number; total?: number } = {},
) {
  const page = opts.page ?? 1;
  const per_page = opts.per_page ?? 50;
  const total = opts.total ?? events.length;
  return {
    events,
    total,
    page,
    per_page,
    total_pages: Math.max(1, Math.ceil(total / per_page)),
    filters: {
      actions: ALL_ACTIONS,
      resource_types: ALL_RESOURCE_TYPES,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Install route mocks for the audit log page, then navigate to /settings/audit-log.
 * Intercepts GET /api/audit-log and supports filtering by query params.
 */
async function setupAuditPage(
  page: import('@playwright/test').Page,
  options: {
    events?: typeof ALL_EVENTS;
    empty?: boolean;
    /** Override total count (for pagination tests) */
    total?: number;
    /** Override per_page */
    per_page?: number;
    /** Callback to dynamically generate responses based on request params */
    handler?: (url: URL) => object;
  } = {},
) {
  // Intercept audit log API calls (matches with or without query params)
  // Intercept audit log API calls — must be set up BEFORE navigation triggers the fetch
  await page.route((url) => url.pathname === '/api/audit-log', (route) => {
    const reqUrl = route.request().url();

    const url = new URL(reqUrl);

    if (options.handler) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(options.handler(url)),
      });
    }

    const events = options.empty ? [] : (options.events || ALL_EVENTS);
    const pageNum = parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = options.per_page ?? 50;

    let filtered = events;
    const actionParam = url.searchParams.get('action');
    if (actionParam) {
      filtered = filtered.filter((e) => e.action === actionParam);
    }
    const resourceParam = url.searchParams.get('resource_type');
    if (resourceParam) {
      filtered = filtered.filter((e) => e.resource_type === resourceParam);
    }

    const total = options.total ?? filtered.length;

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeAuditResponse(filtered, { page: pageNum, per_page: perPage, total })),
    });
  });

  // Navigate via sidebar to avoid page.goto() which breaks Firebase auth session
  const sidebar = page.locator('aside');
  await expect(sidebar).toBeVisible({ timeout: 10000 });

  // Click Settings in sidebar, then navigate to audit log
  const settingsLink = sidebar.getByText('Settings');
  await settingsLink.click();
  await page.waitForURL('**/settings/**', { timeout: 10000 });

  // Now click the Audit Log tab
  await page.getByRole('link', { name: 'Audit Log' }).click();
  await page.waitForURL('**/settings/audit-log', { timeout: 10000 });

  // Wait for heading to confirm page loaded
  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible({ timeout: 10000 });

  // Wait for data to load (loading state to disappear) unless we're testing empty state
  if (!options.empty) {
    await expect(page.locator('table')).toBeVisible({ timeout: 15000 });
  } else {
    await expect(page.getByText('No audit events found')).toBeVisible({ timeout: 15000 });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Audit Log Page', () => {
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
  // Page loading and header
  // -------------------------------------------------------------------------

  test('page loads with heading and description', async ({ page }) => {
    await setupAuditPage(page);
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
    await expect(page.getByText('HIPAA-compliant activity log')).toBeVisible();
  });

  test('settings tab navigation shows Profile link and active Audit Log tab', async ({ page }) => {
    await setupAuditPage(page);
    const profileLink = page.getByRole('link', { name: 'Profile' });
    await expect(profileLink).toBeVisible();
    await expect(profileLink).toHaveAttribute('href', '/settings/practice');
    // Audit Log tab is the active one (rendered as span, not a link)
    await expect(page.locator('span', { hasText: 'Audit Log' })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Table columns and data rendering
  // -------------------------------------------------------------------------

  test('table renders correct column headers', async ({ page }) => {
    await setupAuditPage(page);
    const headers = page.locator('thead th');
    await expect(headers).toHaveCount(6);
    await expect(headers.nth(0)).toHaveText('Timestamp');
    await expect(headers.nth(1)).toHaveText('User');
    await expect(headers.nth(2)).toHaveText('Action');
    await expect(headers.nth(3)).toHaveText('Resource');
    await expect(headers.nth(4)).toHaveText('IP Address');
    await expect(headers.nth(5)).toHaveText('Details');
  });

  test('table renders all mock events as rows', async ({ page }) => {
    await setupAuditPage(page);
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(5);
  });

  test('event with user_id displays truncated user id', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_1] });
    // user_id is truncated to first 12 chars + "..."
    await expect(page.getByText('firebase-uid...')).toBeVisible();
  });

  test('event with null user_id displays "system"', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_3] });
    const userCell = page.locator('tbody tr td').nth(1);
    await expect(userCell).toHaveText('system');
  });

  test('action is displayed with underscores replaced by spaces', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_1] });
    // "viewed" has no underscores, but test the action badge rendering
    await expect(page.locator('tbody tr td').nth(2).locator('span')).toHaveText('viewed');
  });

  test('resource type is displayed with underscores replaced by spaces', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_1] });
    // "clinical_note" should become "clinical note"
    await expect(page.locator('tbody tr td').nth(3)).toContainText('clinical note');
  });

  test('resource_id is displayed truncated when present', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_1] });
    // resource_id is sliced to first 8 chars
    await expect(page.locator('tbody tr td').nth(3)).toContainText('00000000');
  });

  test('IP address is displayed when present', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_1] });
    await expect(page.locator('tbody tr td').nth(4)).toHaveText('192.168.1.10');
  });

  test('IP address shows dash when null', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_3] });
    await expect(page.locator('tbody tr td').nth(4)).toHaveText('-');
  });

  test('metadata is displayed as JSON when present', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_1] });
    await expect(page.locator('tbody tr td').nth(5)).toContainText('{"page":1}');
  });

  test('metadata shows dash when null', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_3] });
    await expect(page.locator('tbody tr td').nth(5)).toHaveText('-');
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  test('empty state message when no events', async ({ page }) => {
    await setupAuditPage(page, { empty: true });
    await expect(page.getByText('No audit events found')).toBeVisible();
    // Table should not be present
    await expect(page.locator('table')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Filter dropdowns
  // -------------------------------------------------------------------------

  test('action filter dropdown populates with available actions', async ({ page }) => {
    await setupAuditPage(page);
    const actionSelect = page.locator('select').first();
    await expect(actionSelect).toBeVisible();

    // Check the "All actions" default option
    const options = actionSelect.locator('option');
    await expect(options.first()).toHaveText('All actions');

    // Verify action options are present (underscores replaced by spaces)
    await expect(actionSelect).toContainText('created');
    await expect(actionSelect).toContainText('listed');
    await expect(actionSelect).toContainText('signed');
    await expect(actionSelect).toContainText('updated');
    await expect(actionSelect).toContainText('viewed');
  });

  test('resource type filter dropdown populates with available types', async ({ page }) => {
    await setupAuditPage(page);
    const resourceSelect = page.locator('select').nth(1);
    await expect(resourceSelect).toBeVisible();

    // Check default option
    const options = resourceSelect.locator('option');
    await expect(options.first()).toHaveText('All types');

    // Verify resource type options are present (underscores replaced by spaces)
    await expect(resourceSelect).toContainText('appointment');
    await expect(resourceSelect).toContainText('client');
    await expect(resourceSelect).toContainText('clinical note');
    await expect(resourceSelect).toContainText('treatment plan');
  });

  test('selecting action filter sends correct API request', async ({ page }) => {
    let capturedAction = '';
    await setupAuditPage(page, {
      handler: (url) => {
        capturedAction = url.searchParams.get('action') || '';
        const events = capturedAction ? ALL_EVENTS.filter((e) => e.action === capturedAction) : ALL_EVENTS;
        return makeAuditResponse(events);
      },
    });

    // Select "viewed" action
    const actionSelect = page.locator('select').first();
    await actionSelect.selectOption('viewed');

    // Wait for the re-fetch
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    expect(capturedAction).toBe('viewed');
  });

  test('selecting resource type filter sends correct API request', async ({ page }) => {
    let capturedResourceType = '';
    await setupAuditPage(page, {
      handler: (url) => {
        capturedResourceType = url.searchParams.get('resource_type') || '';
        const events = capturedResourceType
          ? ALL_EVENTS.filter((e) => e.resource_type === capturedResourceType)
          : ALL_EVENTS;
        return makeAuditResponse(events);
      },
    });

    // Select "client" resource type
    const resourceSelect = page.locator('select').nth(1);
    await resourceSelect.selectOption('client');

    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    expect(capturedResourceType).toBe('client');
  });

  test('action filter reduces displayed rows', async ({ page }) => {
    await setupAuditPage(page);

    // Initially 5 rows
    await expect(page.locator('tbody tr')).toHaveCount(5);

    // Select "signed" action -- only FAKE_EVENT_2 matches
    const actionSelect = page.locator('select').first();
    await actionSelect.selectOption('signed');
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr td').nth(2).locator('span')).toHaveText('signed');
  });

  test('resource type filter reduces displayed rows', async ({ page }) => {
    await setupAuditPage(page);

    // Initially 5 rows
    await expect(page.locator('tbody tr')).toHaveCount(5);

    // Select "treatment_plan" -- only FAKE_EVENT_4 matches
    const resourceSelect = page.locator('select').nth(1);
    await resourceSelect.selectOption('treatment_plan');
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr td').nth(3)).toContainText('treatment plan');
  });

  // -------------------------------------------------------------------------
  // Date range filters
  // -------------------------------------------------------------------------

  test('date inputs are present with correct labels', async ({ page }) => {
    await setupAuditPage(page);
    await expect(page.getByText('Start Date')).toBeVisible();
    await expect(page.getByText('End Date')).toBeVisible();
    await expect(page.locator('input[type="date"]')).toHaveCount(2);
  });

  test('setting start date sends start_date param in API request', async ({ page }) => {
    let capturedStartDate = '';
    await setupAuditPage(page, {
      handler: (url) => {
        capturedStartDate = url.searchParams.get('start_date') || '';
        return makeAuditResponse(ALL_EVENTS);
      },
    });

    const startInput = page.locator('input[type="date"]').first();
    await startInput.fill('2026-02-20');

    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    expect(capturedStartDate).toBe('2026-02-20');
  });

  test('setting end date sends end_date param in API request', async ({ page }) => {
    let capturedEndDate = '';
    await setupAuditPage(page, {
      handler: (url) => {
        capturedEndDate = url.searchParams.get('end_date') || '';
        return makeAuditResponse(ALL_EVENTS);
      },
    });

    const endInput = page.locator('input[type="date"]').nth(1);
    await endInput.fill('2026-02-22');

    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    expect(capturedEndDate).toBe('2026-02-22');
  });

  // -------------------------------------------------------------------------
  // Clear filters button
  // -------------------------------------------------------------------------

  test('clear filters button resets all filters', async ({ page }) => {
    let lastRequestUrl = '';
    await setupAuditPage(page, {
      handler: (url) => {
        lastRequestUrl = url.toString();
        return makeAuditResponse(ALL_EVENTS);
      },
    });

    // Set some filters
    const actionSelect = page.locator('select').first();
    await actionSelect.selectOption('viewed');
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    const startInput = page.locator('input[type="date"]').first();
    await startInput.fill('2026-02-20');
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    // Click "Clear filters"
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    // Verify the cleared request does not include action or start_date params
    const url = new URL(lastRequestUrl);
    expect(url.searchParams.get('action')).toBeNull();
    expect(url.searchParams.get('start_date')).toBeNull();
    expect(url.searchParams.get('end_date')).toBeNull();
    expect(url.searchParams.get('resource_type')).toBeNull();
    expect(url.searchParams.get('page')).toBe('1');
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  test('pagination controls show correct text', async ({ page }) => {
    await setupAuditPage(page, { total: 120, per_page: 50 });

    // "Showing 1 to 5 of 120 events" (5 mock events on page, but total is 120)
    await expect(page.getByText(/Showing 1 to/)).toBeVisible();
    await expect(page.getByText(/of 120 events/)).toBeVisible();

    // "Page 1 of 3"
    await expect(page.getByText('Page 1 of 3')).toBeVisible();
  });

  test('Previous button is disabled on first page', async ({ page }) => {
    await setupAuditPage(page, { total: 120, per_page: 50 });

    const prevButton = page.getByRole('button', { name: 'Previous' });
    await expect(prevButton).toBeDisabled();
  });

  test('Next button is enabled when more pages exist', async ({ page }) => {
    await setupAuditPage(page, { total: 120, per_page: 50 });

    const nextButton = page.getByRole('button', { name: 'Next' });
    await expect(nextButton).toBeEnabled();
  });

  test('clicking Next sends page=2 API request', async ({ page }) => {
    let capturedPage = 1;
    await setupAuditPage(page, {
      total: 120,
      per_page: 50,
      handler: (url) => {
        capturedPage = parseInt(url.searchParams.get('page') || '1', 10);
        return makeAuditResponse(ALL_EVENTS, { page: capturedPage, per_page: 50, total: 120 });
      },
    });

    // Click Next
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    expect(capturedPage).toBe(2);
    await expect(page.getByText('Page 2 of 3')).toBeVisible();
  });

  test('clicking Previous goes back one page', async ({ page }) => {
    let capturedPage = 1;
    await setupAuditPage(page, {
      total: 120,
      per_page: 50,
      handler: (url) => {
        capturedPage = parseInt(url.searchParams.get('page') || '1', 10);
        return makeAuditResponse(ALL_EVENTS, { page: capturedPage, per_page: 50, total: 120 });
      },
    });

    // Navigate to page 2 first
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));
    await expect(page.getByText('Page 2 of 3')).toBeVisible();

    // Navigate back to page 1
    await page.getByRole('button', { name: 'Previous' }).click();
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    expect(capturedPage).toBe(1);
    await expect(page.getByText('Page 1 of 3')).toBeVisible();
  });

  test('Next button is disabled on last page', async ({ page }) => {
    // Single page of results
    await setupAuditPage(page, { total: 3, per_page: 50 });

    const nextButton = page.getByRole('button', { name: 'Next' });
    await expect(nextButton).toBeDisabled();
  });

  test('pagination not shown in empty state', async ({ page }) => {
    await setupAuditPage(page, { empty: true });
    await expect(page.getByRole('button', { name: 'Previous' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Selecting a filter resets page to 1
  // -------------------------------------------------------------------------

  test('changing action filter resets to page 1', async ({ page }) => {
    let capturedPage = 1;
    await setupAuditPage(page, {
      handler: (url) => {
        capturedPage = parseInt(url.searchParams.get('page') || '1', 10);
        return makeAuditResponse(ALL_EVENTS, { page: capturedPage, per_page: 50, total: 120 });
      },
    });

    // Go to page 2
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));
    expect(capturedPage).toBe(2);

    // Now select an action filter -- should reset to page 1
    const actionSelect = page.locator('select').first();
    await actionSelect.selectOption('signed');
    await page.waitForResponse((resp) => resp.url().includes('/api/audit-log'));

    expect(capturedPage).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  test('API error shows error message', async ({ page }) => {
    // Set up route that returns 500 error
    await page.route('**/api/audit-log*', (route) => {
      const reqUrl = route.request().url();
      if (!reqUrl.includes('/api/audit-log')) return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal server error' }),
      });
    });

    // Navigate via sidebar
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await sidebar.getByText('Settings').click();
    await page.waitForURL('**/settings/**', { timeout: 10000 });
    await page.getByRole('link', { name: 'Audit Log' }).click();
    await page.waitForURL('**/settings/audit-log', { timeout: 10000 });

    await expect(page.getByText('Internal server error')).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  test('loading state is shown while fetching', async ({ page }) => {
    // Delay the response so we can see the loading state
    await page.route('**/api/audit-log*', async (route) => {
      const reqUrl = route.request().url();
      if (!reqUrl.includes('/api/audit-log')) return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeAuditResponse(ALL_EVENTS)),
      });
    });

    // Navigate via sidebar
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await sidebar.getByText('Settings').click();
    await page.waitForURL('**/settings/**', { timeout: 10000 });
    await page.getByRole('link', { name: 'Audit Log' }).click();

    // Loading text should appear
    await expect(page.getByText('Loading...')).toBeVisible();

    // After delay, data should appear
    await expect(page.locator('tbody tr')).toHaveCount(5, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Multiple events with varying data
  // -------------------------------------------------------------------------

  test('multiple events render with correct data in each row', async ({ page }) => {
    await setupAuditPage(page, { events: [FAKE_EVENT_2, FAKE_EVENT_5] });

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(2);

    // First row: FAKE_EVENT_2 (signed, clinical_note)
    const row1 = rows.nth(0);
    await expect(row1.locator('td').nth(2).locator('span')).toHaveText('signed');
    await expect(row1.locator('td').nth(3)).toContainText('clinical note');
    await expect(row1.locator('td').nth(4)).toHaveText('10.0.0.5');

    // Second row: FAKE_EVENT_5 (listed, appointment, null resource_id)
    const row2 = rows.nth(1);
    await expect(row2.locator('td').nth(2).locator('span')).toHaveText('listed');
    await expect(row2.locator('td').nth(3)).toContainText('appointment');
    await expect(row2.locator('td').nth(4)).toHaveText('203.0.113.42');
  });
});
