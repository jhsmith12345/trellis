import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Clinician Dashboard', () => {
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

  test('shows welcome message with user name', async ({ page }) => {
    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10000 });
  });

  test('shows current date', async ({ page }) => {
    // The dashboard shows the current day/date
    const today = new Date().toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    await expect(page.getByText(today)).toBeVisible({ timeout: 10000 });
  });

  test('shows sidebar with navigation links', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('Trellis').first()).toBeVisible();
    await expect(sidebar.getByText('Dashboard')).toBeVisible();
    await expect(sidebar.getByText('Clients')).toBeVisible();
    await expect(sidebar.getByText('Schedule')).toBeVisible();
    await expect(sidebar.getByText('Billing')).toBeVisible();
    await expect(sidebar.getByText('Settings')).toBeVisible();
  });

  test('shows AI Assistant button in sidebar', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('AI Assistant')).toBeVisible();
  });

  test('shows Today\'s Schedule section', async ({ page }) => {
    await expect(page.getByText("Today's Schedule")).toBeVisible({ timeout: 10000 });
  });

  test('shows Quick Actions section', async ({ page }) => {
    await expect(page.getByText('Quick Actions')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Client List')).toBeVisible();
    await expect(page.getByText('Practice Profile')).toBeVisible();
  });

  test('shows Unsigned Notes section', async ({ page }) => {
    await expect(page.getByText('Unsigned Notes')).toBeVisible({ timeout: 10000 });
  });

  test('shows This Week stats card', async ({ page }) => {
    await expect(page.getByText('This Week')).toBeVisible({ timeout: 10000 });
    // The stats card has "Appointments" and "Today" labels within
    const mainArea = page.locator('main');
    await expect(mainArea.getByText('Appointments').first()).toBeVisible();
    await expect(mainArea.getByText('Today').first()).toBeVisible();
  });

  test('shows View full schedule link', async ({ page }) => {
    const link = page.getByText('View full schedule');
    await expect(link).toBeVisible({ timeout: 10000 });
  });

  test('sidebar Dashboard link is active', async ({ page }) => {
    const dashLink = page.locator('aside nav a', { hasText: 'Dashboard' });
    // Active link has bg-teal-50 class
    await expect(dashLink).toHaveClass(/bg-teal-50/);
  });

  test('can navigate to clients from sidebar', async ({ page }) => {
    await page.locator('aside nav').getByText('Clients').click();
    await page.waitForURL('**/clients');
  });

  test('can navigate to schedule from sidebar', async ({ page }) => {
    await page.locator('aside nav').getByText('Schedule').click();
    await page.waitForURL('**/schedule');
  });

  test('can sign out', async ({ page }) => {
    await page.locator('aside').getByText('Sign out').click();
    // Should redirect to landing page
    await page.waitForURL('/');
    await expect(page.getByText('Your Practice,')).toBeVisible({ timeout: 10000 });
  });
});
