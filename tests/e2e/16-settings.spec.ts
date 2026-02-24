import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_PROFILE = {
  id: '00000000-0000-0000-0000-000000000001',
  clinician_uid: 'firebase-uid-clinician-123',
  practice_name: 'Serenity Counseling',
  clinician_name: 'Dr. Sarah Mitchell',
  credentials: 'LCSW',
  license_number: 'LC-789012',
  license_state: 'NY',
  npi: '1234567890',
  tax_id: '12-3456789',
  specialties: ['Anxiety', 'Depression', 'CBT'],
  bio: 'Licensed clinical social worker specializing in evidence-based therapies for anxiety and mood disorders.',
  phone: '(555) 123-4567',
  email: 'sarah@serenitycounseling.com',
  website: 'https://serenitycounseling.com',
  address_line1: '100 Wellness Blvd',
  address_line2: 'Suite 204',
  address_city: 'Albany',
  address_state: 'NY',
  address_zip: '12207',
  accepted_insurances: ['Aetna', 'Cigna', 'Medicare'],
  session_rate: 175,
  intake_rate: 225,
  sliding_scale: true,
  sliding_scale_min: 80,
  default_session_duration: 53,
  intake_duration: 75,
  timezone: 'America/New_York',
};

const EMPTY_PROFILE_RESPONSE = {
  exists: false,
};

const POPULATED_PROFILE_RESPONSE = {
  exists: true,
  ...MOCK_PROFILE,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Install route mocks for the practice settings page, then navigate via sidebar.
 * Intercepts GET and PUT /api/practice-profile.
 */
async function setupSettingsPage(
  page: import('@playwright/test').Page,
  options: {
    profile?: object;
    empty?: boolean;
    /** Simulate a GET error */
    loadError?: boolean;
    /** Simulate a PUT error */
    saveError?: boolean;
    /** Custom PUT handler for capturing request body */
    onSave?: (body: Record<string, unknown>) => void;
  } = {},
) {
  // Set up route interception BEFORE navigation
  await page.route((url) => url.pathname === '/api/practice-profile', (route) => {
    if (route.request().method() === 'GET') {
      if (options.loadError) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Internal server error' }),
        });
      }
      if (options.empty) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(EMPTY_PROFILE_RESPONSE),
        });
      }
      const profile = options.profile || POPULATED_PROFILE_RESPONSE;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(profile),
      });
    }

    if (route.request().method() === 'PUT') {
      if (options.saveError) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Failed to save' }),
        });
      }
      if (options.onSave) {
        const body = route.request().postDataJSON();
        options.onSave(body);
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    }

    return route.fallback();
  });

  // Navigate via sidebar to avoid losing Firebase auth session
  const sidebar = page.locator('aside');
  await expect(sidebar).toBeVisible({ timeout: 10000 });
  await sidebar.getByText('Settings').click();
  await page.waitForURL('**/settings/**', { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Practice Settings Page', () => {
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

  test('page loads with heading and description text', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Your practice information, credentials, and rates.')).toBeVisible();
  });

  test('tab navigation shows Profile as active tab', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });
    // Profile tab is rendered as a span (active), not a link
    const profileTab = page.locator('span', { hasText: 'Profile' }).first();
    await expect(profileTab).toBeVisible();
  });

  test('tab navigation shows Audit Log link with correct href', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });
    const auditLogLink = page.getByRole('link', { name: 'Audit Log' });
    await expect(auditLogLink).toBeVisible();
    await expect(auditLogLink).toHaveAttribute('href', '/settings/audit-log');
  });

  test('tab navigation shows Setup New Instance link', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });
    const setupLink = page.getByRole('link', { name: 'Setup New Instance' });
    await expect(setupLink).toBeVisible();
    await expect(setupLink).toHaveAttribute('href', '/setup-wizard');
  });

  // -------------------------------------------------------------------------
  // Form section headings
  // -------------------------------------------------------------------------

  test('renders all four section headings', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Practice Info', { exact: true })).toBeVisible();
    // "Credentials" appears as both a section heading and a field label, so use the h2
    await expect(page.locator('h2', { hasText: 'Credentials' })).toBeVisible();
    await expect(page.getByText('Contact & Address', { exact: true })).toBeVisible();
    await expect(page.getByText('Insurance & Rates', { exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Form populates with existing profile data
  // -------------------------------------------------------------------------

  test('form populates with existing profile data', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Practice Info - find inputs by label and check their values
    const practiceNameLabel = page.getByText('Practice Name').first();
    const practiceNameInput = practiceNameLabel.locator('..').locator('input');
    await expect(practiceNameInput).toHaveValue('Serenity Counseling');

    const fullNameLabel = page.getByText('Your Full Name');
    const fullNameInput = fullNameLabel.locator('..').locator('input');
    await expect(fullNameInput).toHaveValue('Dr. Sarah Mitchell');

    // Verify specialties as comma-separated
    const specialtiesInput = page.locator('input[placeholder="Comma-separated"]');
    await expect(specialtiesInput).toHaveValue('Anxiety, Depression, CBT');

    // Bio textarea
    const bioTextarea = page.locator('textarea');
    await expect(bioTextarea).toHaveValue(/Licensed clinical social worker/);
  });

  test('credentials section populates with mock data', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Credentials field
    await expect(page.locator('input[placeholder="e.g. LCSW, LPC"]')).toHaveValue('LCSW');

    // License Number
    const licenseNumberLabel = page.getByText('License Number');
    const licenseNumberInput = licenseNumberLabel.locator('..').locator('input');
    await expect(licenseNumberInput).toHaveValue('LC-789012');

    // License State dropdown
    const licenseStateSelect = page.locator('select').first();
    await expect(licenseStateSelect).toHaveValue('NY');

    // NPI Number
    const npiLabel = page.getByText('NPI Number');
    const npiInput = npiLabel.locator('..').locator('input');
    await expect(npiInput).toHaveValue('1234567890');

    // Tax ID
    const taxIdLabel = page.getByText('Tax ID / EIN');
    const taxIdInput = taxIdLabel.locator('..').locator('input');
    await expect(taxIdInput).toHaveValue('12-3456789');
  });

  test('contact and address section populates with mock data', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Find inputs by their labels and check values
    const phoneLabel = page.getByText('Phone', { exact: true });
    await expect(phoneLabel.locator('..').locator('input')).toHaveValue('(555) 123-4567');

    const emailLabel = page.getByText('Email', { exact: true }).first();
    await expect(emailLabel.locator('..').locator('input')).toHaveValue('sarah@serenitycounseling.com');

    const websiteLabel = page.getByText('Website');
    await expect(websiteLabel.locator('..').locator('input')).toHaveValue('https://serenitycounseling.com');

    const addr1Label = page.getByText('Address Line 1');
    await expect(addr1Label.locator('..').locator('input')).toHaveValue('100 Wellness Blvd');

    const addr2Label = page.getByText('Address Line 2');
    await expect(addr2Label.locator('..').locator('input')).toHaveValue('Suite 204');

    const cityLabel = page.getByText('City');
    await expect(cityLabel.locator('..').locator('input')).toHaveValue('Albany');

    const zipLabel = page.getByText('ZIP');
    await expect(zipLabel.locator('..').locator('input')).toHaveValue('12207');
  });

  test('insurance and rates section populates with mock data', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Session Rate and Intake Rate inputs (type=number)
    const numberInputs = page.locator('input[type="number"]');
    // session_rate = 175, intake_rate = 225
    await expect(numberInputs.first()).toHaveValue('175');
    await expect(numberInputs.nth(1)).toHaveValue('225');
  });

  // -------------------------------------------------------------------------
  // Empty state (first setup)
  // -------------------------------------------------------------------------

  test('empty state shows blank form with default timezone and durations', async ({ page }) => {
    await setupSettingsPage(page, { empty: true });
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Clinician name should be empty
    const nameLabel = page.getByText('Your Full Name');
    const nameSection = nameLabel.locator('..');
    const nameInput = nameSection.locator('input');
    await expect(nameInput).toHaveValue('');

    // Default timezone should be "America/New_York"
    // Find the timezone select - it's the last select in the Contact & Address section
    // The Timezone select shows "New York" as the display text
    const timezoneSelects = page.locator('select');
    // Last select on the page is the timezone
    const lastSelect = timezoneSelects.last();
    await expect(lastSelect).toHaveValue('America/New_York');

    // Default session duration = 53 and intake duration = 53
    const sessionDurationLabel = page.getByText('Session Duration (min)');
    const sessionDurationSection = sessionDurationLabel.locator('..');
    await expect(sessionDurationSection.locator('input')).toHaveValue('53');

    const intakeDurationLabel = page.getByText('Intake Duration (min)');
    const intakeDurationSection = intakeDurationLabel.locator('..');
    await expect(intakeDurationSection.locator('input')).toHaveValue('53');
  });

  // -------------------------------------------------------------------------
  // Form field editability
  // -------------------------------------------------------------------------

  test('text inputs are editable', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Edit clinician name
    const nameLabel = page.getByText('Your Full Name');
    const nameSection = nameLabel.locator('..');
    const nameInput = nameSection.locator('input');
    await nameInput.clear();
    await nameInput.fill('Dr. New Name');
    await expect(nameInput).toHaveValue('Dr. New Name');
  });

  test('bio textarea is editable', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    const bioTextarea = page.locator('textarea');
    await bioTextarea.clear();
    await bioTextarea.fill('Updated bio text');
    await expect(bioTextarea).toHaveValue('Updated bio text');
  });

  test('specialties input is editable', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    const specialtiesInput = page.locator('input[placeholder="Comma-separated"]');
    await specialtiesInput.clear();
    await specialtiesInput.fill('PTSD, Trauma, EMDR');
    await expect(specialtiesInput).toHaveValue('PTSD, Trauma, EMDR');
  });

  // -------------------------------------------------------------------------
  // Dropdowns
  // -------------------------------------------------------------------------

  test('License State dropdown contains US states', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // The first select on the page is the License State dropdown
    const licenseStateSelect = page.locator('select').first();
    await expect(licenseStateSelect).toBeVisible();

    // Check for the "Select" default option and some US states
    const options = licenseStateSelect.locator('option');
    await expect(options.first()).toHaveText('Select');
    // Check a sampling of states
    await expect(licenseStateSelect).toContainText('CA');
    await expect(licenseStateSelect).toContainText('NY');
    await expect(licenseStateSelect).toContainText('TX');
    await expect(licenseStateSelect).toContainText('FL');
    await expect(licenseStateSelect).toContainText('DC');
  });

  test('License State dropdown is changeable', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    const licenseStateSelect = page.locator('select').first();
    await licenseStateSelect.selectOption('CA');
    await expect(licenseStateSelect).toHaveValue('CA');
  });

  test('Timezone dropdown contains timezone options', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Timezone select is the last select on the page
    const timezoneSelect = page.locator('select').last();
    await expect(timezoneSelect).toBeVisible();

    // Check that timezone options are present (displayed without America/ prefix)
    await expect(timezoneSelect).toContainText('New York');
    await expect(timezoneSelect).toContainText('Chicago');
    await expect(timezoneSelect).toContainText('Denver');
    await expect(timezoneSelect).toContainText('Los Angeles');
    await expect(timezoneSelect).toContainText('Honolulu');
  });

  // -------------------------------------------------------------------------
  // Insurance toggle buttons
  // -------------------------------------------------------------------------

  test('insurance toggle buttons render all 12 common insurances', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    const insurances = [
      'Aetna', 'Anthem', 'Blue Cross Blue Shield', 'Cigna', 'Humana',
      'Kaiser Permanente', 'Magellan Health', 'Medicaid', 'Medicare',
      'Optum / UnitedHealthcare', 'Tricare', 'Other',
    ];

    for (const ins of insurances) {
      await expect(page.getByRole('button', { name: ins, exact: true })).toBeVisible();
    }
  });

  test('selected insurances show active styling', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Aetna, Cigna, Medicare are selected in mock data
    const aetnaBtn = page.getByRole('button', { name: 'Aetna', exact: true });
    await expect(aetnaBtn).toHaveClass(/bg-teal-50/);
    await expect(aetnaBtn).toHaveClass(/border-teal-400/);

    // Anthem is NOT selected
    const anthemBtn = page.getByRole('button', { name: 'Anthem', exact: true });
    await expect(anthemBtn).not.toHaveClass(/bg-teal-50/);
  });

  test('clicking insurance button toggles selection on', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Anthem is not selected initially
    const anthemBtn = page.getByRole('button', { name: 'Anthem', exact: true });
    await expect(anthemBtn).not.toHaveClass(/bg-teal-50/);

    // Click to select
    await anthemBtn.click();
    await expect(anthemBtn).toHaveClass(/bg-teal-50/);
    await expect(anthemBtn).toHaveClass(/border-teal-400/);
  });

  test('clicking selected insurance button toggles selection off', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Aetna is selected initially
    const aetnaBtn = page.getByRole('button', { name: 'Aetna', exact: true });
    await expect(aetnaBtn).toHaveClass(/bg-teal-50/);

    // Click to deselect
    await aetnaBtn.click();
    await expect(aetnaBtn).not.toHaveClass(/bg-teal-50/);
  });

  // -------------------------------------------------------------------------
  // Sliding scale checkbox
  // -------------------------------------------------------------------------

  test('sliding scale checkbox shows min rate field when checked', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Mock data has sliding_scale: true, so min rate field should be visible
    await expect(page.getByText('Offer sliding scale fees')).toBeVisible();
    await expect(page.getByText('Minimum sliding scale rate ($)')).toBeVisible();
  });

  test('unchecking sliding scale hides the minimum rate field', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Sliding scale is checked, min rate is visible
    await expect(page.getByText('Minimum sliding scale rate ($)')).toBeVisible();

    // Uncheck sliding scale
    const checkbox = page.locator('input[type="checkbox"]');
    await checkbox.uncheck();

    // Min rate field should be hidden
    await expect(page.getByText('Minimum sliding scale rate ($)')).not.toBeVisible();
  });

  test('checking sliding scale reveals the minimum rate field', async ({ page }) => {
    await setupSettingsPage(page, { empty: true });
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Empty form has sliding_scale: false, so min rate field should not be visible
    await expect(page.getByText('Minimum sliding scale rate ($)')).not.toBeVisible();

    // Check sliding scale
    const checkbox = page.locator('input[type="checkbox"]');
    await checkbox.check();

    // Min rate field should now be visible
    await expect(page.getByText('Minimum sliding scale rate ($)')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Save button states
  // -------------------------------------------------------------------------

  test('Save Changes button is visible', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
  });

  test('Save button is disabled when clinician_name is empty', async ({ page }) => {
    await setupSettingsPage(page, { empty: true });
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Clinician name is empty in empty state
    const saveBtn = page.getByRole('button', { name: 'Save Changes' });
    await expect(saveBtn).toBeDisabled();
  });

  test('Save button becomes enabled when clinician_name is filled', async ({ page }) => {
    await setupSettingsPage(page, { empty: true });
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Initially disabled
    const saveBtn = page.getByRole('button', { name: 'Save Changes' });
    await expect(saveBtn).toBeDisabled();

    // Fill in the name
    const nameLabel = page.getByText('Your Full Name');
    const nameSection = nameLabel.locator('..');
    const nameInput = nameSection.locator('input');
    await nameInput.fill('Dr. Test Name');

    // Now should be enabled
    await expect(saveBtn).toBeEnabled();
  });

  // -------------------------------------------------------------------------
  // Save flow (PUT request)
  // -------------------------------------------------------------------------

  test('Save button sends PUT request and shows success message', async ({ page }) => {
    let savedBody: Record<string, unknown> | null = null;

    await setupSettingsPage(page, {
      onSave: (body) => {
        savedBody = body;
      },
    });
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Click Save
    const saveBtn = page.getByRole('button', { name: 'Save Changes' });
    await saveBtn.click();

    // Wait for the response
    await page.waitForResponse((resp) =>
      resp.url().includes('/api/practice-profile') && resp.request().method() === 'PUT',
    );

    // "Saved successfully" message should appear
    await expect(page.getByText('Saved successfully')).toBeVisible();

    // Verify the request body was sent
    expect(savedBody).not.toBeNull();
    expect(savedBody!.clinician_name).toBe('Dr. Sarah Mitchell');
    expect(savedBody!.practice_name).toBe('Serenity Counseling');
    expect(savedBody!.timezone).toBe('America/New_York');
  });

  test('Save button shows Saving... text while request is in flight', async ({ page }) => {
    // Set up a delayed PUT response
    await page.route((url) => url.pathname === '/api/practice-profile', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(POPULATED_PROFILE_RESPONSE),
        });
      }
      if (route.request().method() === 'PUT') {
        // Delay the response
        await new Promise((resolve) => setTimeout(resolve, 500));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }
      return route.fallback();
    });

    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await sidebar.getByText('Settings').click();
    await page.waitForURL('**/settings/**', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Click Save
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Button should show "Saving..." while in flight
    await expect(page.getByRole('button', { name: 'Saving...' })).toBeVisible();

    // After response, should revert to "Save Changes"
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Saved successfully')).toBeVisible();
  });

  test('Save sends correct data types for numeric and array fields', async ({ page }) => {
    let savedBody: Record<string, unknown> | null = null;

    await setupSettingsPage(page, {
      onSave: (body) => {
        savedBody = body;
      },
    });
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Click Save
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForResponse((resp) =>
      resp.url().includes('/api/practice-profile') && resp.request().method() === 'PUT',
    );

    expect(savedBody).not.toBeNull();
    // Rates should be numbers
    expect(savedBody!.session_rate).toBe(175);
    expect(savedBody!.intake_rate).toBe(225);
    expect(savedBody!.sliding_scale_min).toBe(80);
    // Durations should be integers
    expect(savedBody!.default_session_duration).toBe(53);
    expect(savedBody!.intake_duration).toBe(75);
    // Specialties should be an array
    expect(savedBody!.specialties).toEqual(['Anxiety', 'Depression', 'CBT']);
    // Insurances should be an array
    expect(savedBody!.accepted_insurances).toEqual(['Aetna', 'Cigna', 'Medicare']);
    // Boolean
    expect(savedBody!.sliding_scale).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Error states
  // -------------------------------------------------------------------------

  test('API error on load does not render the form', async ({ page }) => {
    await setupSettingsPage(page, { loadError: true });

    // When GET fails, form stays null and component shows loading spinner
    // (error text is set but never rendered because loading guard returns spinner)
    // Verify the form heading does NOT appear
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).not.toBeVisible({ timeout: 5000 });
    // The spinner remains visible
    await expect(page.locator('.animate-spin').first()).toBeVisible();
  });

  test('API error on save shows error message', async ({ page }) => {
    await setupSettingsPage(page, { saveError: true });
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Click Save
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Wait for PUT response
    await page.waitForResponse((resp) =>
      resp.url().includes('/api/practice-profile') && resp.request().method() === 'PUT',
    );

    // Should show error message
    await expect(page.getByText('Failed to save')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  test('loading spinner is shown while fetching profile', async ({ page }) => {
    // Set up a delayed GET response
    await page.route((url) => url.pathname === '/api/practice-profile', async (route) => {
      if (route.request().method() === 'GET') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(POPULATED_PROFILE_RESPONSE),
        });
      }
      return route.fallback();
    });

    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await sidebar.getByText('Settings').click();
    await page.waitForURL('**/settings/**', { timeout: 10000 });

    // Loading spinner should be visible (it's an animate-spin div)
    // Use .first() to avoid strict mode violation if multiple spinners exist
    await expect(page.locator('.animate-spin').first()).toBeVisible();

    // After data loads, form should appear
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // Form field labels
  // -------------------------------------------------------------------------

  test('Practice Info section shows correct field labels', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('Practice Name')).toBeVisible();
    await expect(page.getByText('Your Full Name')).toBeVisible();
    await expect(page.getByText('Specialties')).toBeVisible();
    await expect(page.getByText('Bio')).toBeVisible();
  });

  test('Credentials section shows correct field labels', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // "Credentials" appears as both section heading and field label
    const credentialsLabels = page.getByText('Credentials');
    await expect(credentialsLabels.first()).toBeVisible();
    await expect(page.getByText('License Number')).toBeVisible();
    await expect(page.getByText('License State')).toBeVisible();
    await expect(page.getByText('NPI Number')).toBeVisible();
    await expect(page.getByText('Tax ID / EIN')).toBeVisible();
  });

  test('Contact & Address section shows correct field labels', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('Phone')).toBeVisible();
    await expect(page.getByText('Email', { exact: true })).toBeVisible();
    await expect(page.getByText('Website')).toBeVisible();
    await expect(page.getByText('Address Line 1')).toBeVisible();
    await expect(page.getByText('Address Line 2')).toBeVisible();
    await expect(page.getByText('City')).toBeVisible();
    await expect(page.getByText('ZIP')).toBeVisible();
    await expect(page.getByText('Timezone')).toBeVisible();
  });

  test('Insurance & Rates section shows correct field labels', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('Accepted Insurance')).toBeVisible();
    await expect(page.getByText('Session Rate ($)')).toBeVisible();
    await expect(page.getByText('Intake Rate ($)')).toBeVisible();
    await expect(page.getByText('Session Duration (min)')).toBeVisible();
    await expect(page.getByText('Intake Duration (min)')).toBeVisible();
    await expect(page.getByText('Offer sliding scale fees')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Required field indicator
  // -------------------------------------------------------------------------

  test('Your Full Name field has required indicator', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // The "Your Full Name" label has a required asterisk (*) next to it
    const nameLabel = page.locator('label', { hasText: 'Your Full Name' });
    await expect(nameLabel.locator('span.text-red-400')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Saved message clears on edit
  // -------------------------------------------------------------------------

  test('saved message clears when form is edited after save', async ({ page }) => {
    await setupSettingsPage(page);
    await expect(page.getByRole('heading', { name: 'Practice Profile' })).toBeVisible({ timeout: 10000 });

    // Save
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForResponse((resp) =>
      resp.url().includes('/api/practice-profile') && resp.request().method() === 'PUT',
    );
    await expect(page.getByText('Saved successfully')).toBeVisible();

    // Edit a field — "Saved successfully" should disappear
    const specialtiesInput = page.locator('input[placeholder="Comma-separated"]');
    await specialtiesInput.clear();
    await specialtiesInput.fill('New Specialty');

    await expect(page.getByText('Saved successfully')).not.toBeVisible();
  });
});
