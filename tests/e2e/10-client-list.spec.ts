import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Client List Page', () => {
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
    await page.goto('/clients');
    await page.waitForLoadState('domcontentloaded');
  });

  test('client list page loads', async ({ page }) => {
    await expect(page.locator('main')).toBeVisible();
  });

  test('sidebar Clients link is active', async ({ page }) => {
    const clientsLink = page.locator('aside nav a', { hasText: 'Clients' });
    await expect(clientsLink).toHaveClass(/bg-teal-50/);
  });
});
