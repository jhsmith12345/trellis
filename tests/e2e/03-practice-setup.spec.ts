import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Practice Setup Page', () => {
  test('clinician can access practice settings', async ({ page }) => {
    const success = await loginViaUI(
      page,
      TEST_CLINICIAN_EMAIL,
      TEST_CLINICIAN_PASSWORD,
      'clinician',
    );
    if (!success) {
      test.skip(true, 'Clinician test account not available');
      return;
    }
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Navigate to settings/practice
    await page.goto('/settings/practice');
    await page.waitForLoadState('domcontentloaded');

    // The page should load within the ClinicianShell
    await expect(page.locator('main')).toBeVisible();
  });
});
