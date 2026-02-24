import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Schedule / Availability Page', () => {
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
    // Wait for the ClinicianShell to render (sidebar visible = auth complete)
    await expect(page.locator('aside')).toBeVisible({ timeout: 10000 });
    // Navigate via client-side routing (avoid full page reload which re-inits Firebase auth)
    await page.locator('aside nav a', { hasText: 'Schedule' }).click();
    await page.waitForURL('**/schedule', { timeout: 5000 });
  });

  test('schedule page loads', async ({ page }) => {
    await expect(page.locator('main')).toBeVisible();
  });

  test('sidebar Schedule link is active', async ({ page }) => {
    const scheduleLink = page.locator('aside nav a', { hasText: 'Schedule' });
    await expect(scheduleLink).toHaveClass(/bg-teal-50/);
  });
});
