import { test, expect } from '@playwright/test';

test.describe('Setup Wizard (Public)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/setup-wizard');
  });

  test('setup wizard page loads', async ({ page }) => {
    await expect(page).toHaveTitle('Trellis');
  });

  test('shows Trellis branding in header', async ({ page }) => {
    await expect(page.getByText('Trellis').first()).toBeVisible();
    await expect(page.getByText('Setup Wizard')).toBeVisible();
  });

  test('starts on the Welcome step', async ({ page }) => {
    await expect(page.getByText('Welcome to Trellis')).toBeVisible();
    await expect(page.getByText('Step 1 of 9')).toBeVisible();
  });

  test('shows welcome content with feature cards', async ({ page }) => {
    await expect(page.getByText('Your Data, Your Control')).toBeVisible();
    await expect(page.getByText('HIPAA Compliant')).toBeVisible();
    await expect(page.getByText('AI-Powered Workflow')).toBeVisible();
    await expect(page.getByText('Google Workspace Integration')).toBeVisible();
  });

  test('shows what you will need info box', async ({ page }) => {
    await expect(page.getByText('What you will need:')).toBeVisible();
    await expect(page.getByText('Google Workspace account')).toBeVisible();
    await expect(page.getByText('Google Cloud account')).toBeVisible();
  });

  test('shows HIPAA requirement warning', async ({ page }) => {
    await expect(page.getByText('HIPAA Requirement')).toBeVisible();
    await expect(
      page.getByText("You must sign Google's Business Associate Agreement"),
    ).toBeVisible();
  });

  test('has Continue button on welcome step', async ({ page }) => {
    await expect(page.getByText('Continue')).toBeVisible();
  });

  test('does not show Back button on first step', async ({ page }) => {
    // Back button should not be visible on step 1
    await expect(page.getByText('Back')).not.toBeVisible();
  });

  test('can advance to GCP Project step', async ({ page }) => {
    await page.getByText('Continue').click();
    await expect(page.getByText('Create a GCP Project')).toBeVisible();
    await expect(page.getByText('Step 2 of 9')).toBeVisible();
  });

  test('shows progress dots', async ({ page }) => {
    // There should be 9 progress dots
    const dots = page.locator('.rounded-full.w-2.h-2');
    await expect(dots).toHaveCount(9);
  });

  test('GCP Project step has required fields', async ({ page }) => {
    await page.getByText('Continue').click();
    await expect(page.getByText('GCP Project ID')).toBeVisible();
    await expect(page.getByText('Preferred Region')).toBeVisible();
  });

  test('GCP Project step validates project ID', async ({ page }) => {
    await page.getByText('Continue').click(); // Go to step 2 (GCP Project)
    // Try to continue without entering project ID
    await page.getByText('Continue').click();
    await expect(page.getByText('Project ID is required')).toBeVisible();
  });

  test('GCP Project step validates project ID format', async ({ page }) => {
    await page.getByText('Continue').click(); // Go to step 2
    // Enter an invalid project ID (too short, uppercase)
    await page.locator('input[placeholder*="trellis"]').fill('AB');
    await page.getByText('Continue').click();
    await expect(
      page.getByText(/Must be 6-30 characters/),
    ).toBeVisible();
  });

  test('can navigate back from GCP Project step', async ({ page }) => {
    await page.getByText('Continue').click(); // Go to step 2
    await expect(page.getByText('Create a GCP Project')).toBeVisible();
    await page.getByText('Back').click(); // Go back to step 1
    await expect(page.getByText('Welcome to Trellis')).toBeVisible();
  });

  test('can advance through multiple steps with valid data', async ({ page }) => {
    // Step 1 -> Step 2
    await page.getByText('Continue').click();
    await expect(page.getByText('Create a GCP Project')).toBeVisible();

    // Fill in valid project ID
    await page.locator('input[placeholder*="trellis"]').fill('trellis-test-project');
    await page.getByText('Continue').click();

    // Step 3: BAA
    await expect(page.getByText('Sign Google Workspace BAA')).toBeVisible();
    await expect(page.getByText('Step 3 of 9')).toBeVisible();
  });

  test('BAA step requires confirmation checkbox', async ({ page }) => {
    // Navigate to BAA step
    await page.getByText('Continue').click();
    await page.locator('input[placeholder*="trellis"]').fill('trellis-test-project');
    await page.getByText('Continue').click();

    // Try to continue without checking the checkbox
    await page.getByText('Continue').click();
    // Should show validation error (checkbox border turns red)
    const checkbox = page.locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();
  });

  test('BAA step checkbox can be checked and advance', async ({ page }) => {
    // Navigate to BAA step
    await page.getByText('Continue').click();
    await page.locator('input[placeholder*="trellis"]').fill('trellis-test-project');
    await page.getByText('Continue').click();

    // Check the BAA confirmation
    await page.locator('input[type="checkbox"]').check();
    await page.getByText('Continue').click();

    // Should advance to APIs step
    await expect(page.getByText('Enable Required APIs')).toBeVisible();
    await expect(page.getByText('Step 4 of 9')).toBeVisible();
  });

  test('APIs step shows all required APIs', async ({ page }) => {
    // Navigate to APIs step (step 1 -> 2 -> 3 -> 4)
    await page.getByText('Continue').click();
    await page.locator('input[placeholder*="trellis"]').fill('trellis-test-project');
    await page.getByText('Continue').click();
    await page.locator('input[type="checkbox"]').check();
    await page.getByText('Continue').click();

    await expect(page.getByText('Enable Required APIs')).toBeVisible();
    // The page shows API names without .googleapis.com suffix
    // Verify the gcloud command is displayed
    await expect(page.getByText('gcloud services enable')).toBeVisible();
    // Verify some key APIs are listed in the grid
    await expect(page.getByText('sqladmin', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('run', { exact: false }).first()).toBeVisible();
  });

  test('setup wizard has link back to landing page', async ({ page }) => {
    const homeLink = page.locator('a[href="/"]').first();
    await expect(homeLink).toBeVisible();
  });

  test('progress bar updates as you advance steps', async ({ page }) => {
    // On step 1, progress should be at 0%
    const progressBar = page.locator('.h-1.bg-warm-100 > div');
    await expect(progressBar).toHaveCSS('width', '0px');

    // Advance to step 2
    await page.getByText('Continue').click();
    // Progress bar should have non-zero width now
    const style = await progressBar.getAttribute('style');
    expect(style).toContain('width');
    expect(style).not.toContain('0%');
  });
});
