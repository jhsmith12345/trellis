import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Clinician Authentication', () => {
  test('can sign in with email/password via auth modal', async ({ page }) => {
    const success = await loginViaUI(
      page,
      TEST_CLINICIAN_EMAIL,
      TEST_CLINICIAN_PASSWORD,
      'clinician',
    );
    expect(success).toBe(true);

    // Should land on the dashboard or role selector
    // Since the account is already registered as clinician, should go to /dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10000 });
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Clinician Login').click();

    const modal = page.locator('.fixed.inset-0.z-50');
    await expect(modal).toBeVisible({ timeout: 5000 });

    await page.locator('#email').fill('nonexistent@test.trellis.dev');
    await page.locator('#password').fill('WrongPassword123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Should show an error message
    await expect(page.getByText(/invalid|failed/i)).toBeVisible({ timeout: 10000 });
  });

  test('requires password with minimum length', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Clinician Login').click();

    const modal = page.locator('.fixed.inset-0.z-50');
    await expect(modal).toBeVisible({ timeout: 5000 });

    await page.locator('#email').fill('test@example.com');
    await page.locator('#password').fill('123'); // Too short
    // The HTML5 validation should prevent submission (minLength=6)
    const password = page.locator('#password');
    await expect(password).toHaveAttribute('minlength', '6');
  });
});
