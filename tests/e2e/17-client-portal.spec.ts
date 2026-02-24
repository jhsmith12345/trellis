import { test, expect } from '@playwright/test';
import {
  TEST_CLIENT_EMAIL,
  TEST_CLIENT_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Client Portal', () => {
  test.beforeEach(async ({ page }) => {
    const success = await loginViaUI(
      page,
      TEST_CLIENT_EMAIL,
      TEST_CLIENT_PASSWORD,
      'client',
    );
    if (!success) {
      test.skip(true, 'Client test account not available');
    }
    await page.waitForURL('**/client/dashboard', { timeout: 15000 });
  });

  test('client dashboard loads', async ({ page }) => {
    await expect(page.locator('main')).toBeVisible();
  });

  test('shows Trellis branding with Client Portal label', async ({ page }) => {
    // Desktop sidebar shows "Trellis" and "Client Portal"
    // Ensure we're at desktop width so the sidebar is visible
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(200);
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Trellis').first()).toBeVisible();
    await expect(sidebar.getByText('Client Portal')).toBeVisible();
  });

  test('shows client navigation links', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Home')).toBeVisible();
    await expect(sidebar.getByText('Appointments')).toBeVisible();
    await expect(sidebar.getByText('Documents')).toBeVisible();
    await expect(sidebar.getByText('Billing')).toBeVisible();
  });

  test('can navigate to appointments', async ({ page }) => {
    await page.locator('aside nav').getByText('Appointments').click();
    await page.waitForURL('**/client/appointments');
  });

  test('can navigate to documents', async ({ page }) => {
    await page.locator('aside nav').getByText('Documents').click();
    await page.waitForURL('**/client/documents');
  });

  test('can navigate to billing', async ({ page }) => {
    await page.locator('aside nav').getByText('Billing').click();
    await page.waitForURL('**/client/billing');
  });

  test('can sign out', async ({ page }) => {
    await page.locator('aside').getByText('Sign out').click();
    await page.waitForURL('/');
    await expect(page.getByText('Your Practice,')).toBeVisible({ timeout: 10000 });
  });
});
