import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Schedule Page', () => {
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
    await page.goto('/schedule');
    await page.waitForLoadState('domcontentloaded');
  });

  test('schedule page loads with main content', async ({ page }) => {
    await expect(page.locator('main')).toBeVisible();
  });

  test('sidebar Schedule link is active', async ({ page }) => {
    const scheduleLink = page.locator('aside nav a', { hasText: 'Schedule' });
    await expect(scheduleLink).toHaveClass(/bg-teal-50/);
  });
});
