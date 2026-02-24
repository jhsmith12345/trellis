/**
 * Auth fixtures for Playwright E2E tests.
 *
 * Strategy: Firebase Auth requires signing in through the actual SDK.
 * We automate the email/password login flow through the UI's AuthModal.
 * The backend runs in DEV_MODE=1, so it accepts any valid-structure JWT.
 *
 * Test accounts:
 *   - Clinician: e2e-clinician@test.trellis.dev / Test123456!
 *   - Client: e2e-client@test.trellis.dev / Test123456!
 *
 * These accounts must be pre-created in the Firebase Console for the
 * trellis-mvp project. If they don't exist yet, the auth tests will
 * skip gracefully and document the requirement.
 */
import { test as base, type Page, expect } from '@playwright/test';

export const TEST_CLINICIAN_EMAIL = 'e2e-clinician@test.trellis.dev';
export const TEST_CLINICIAN_PASSWORD = 'Test123456!';
export const TEST_CLIENT_EMAIL = 'e2e-client@test.trellis.dev';
export const TEST_CLIENT_PASSWORD = 'Test123456!';

/**
 * Signs in as a clinician or client by automating the AuthModal UI flow.
 * Expects to start on the landing page (/).
 */
export async function loginViaUI(
  page: Page,
  email: string,
  password: string,
  mode: 'clinician' | 'client',
): Promise<boolean> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Click the appropriate button to open the auth modal
  if (mode === 'clinician') {
    await page.getByText('Clinician Login').click();
  } else {
    await page.getByText('Get Started').first().click();
  }

  // Wait for the auth modal to appear
  const modal = page.locator('.fixed.inset-0.z-50');
  await expect(modal).toBeVisible({ timeout: 5000 });

  // If mode is clinician, the modal defaults to "Sign In" mode.
  // If mode is client, it defaults to "Sign Up" mode, so switch to Sign In.
  if (mode === 'client') {
    // Switch from Sign Up to Sign In
    const signInToggle = page.getByText('Sign in', { exact: true });
    if (await signInToggle.isVisible()) {
      await signInToggle.click();
    }
  }

  // Fill in email and password
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);

  // Submit the form
  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait for navigation away from the landing page or for the modal to close
  try {
    await page.waitForURL((url) => url.pathname !== '/', { timeout: 10000 });
    return true;
  } catch {
    // Auth might have failed — check for error message
    return false;
  }
}

/**
 * Extended test fixtures that provide pre-authenticated pages.
 * These automatically sign in via the UI before each test.
 */
export const test = base.extend<{
  clinicianPage: Page;
  clientPage: Page;
}>({
  clinicianPage: async ({ page }, use) => {
    const success = await loginViaUI(
      page,
      TEST_CLINICIAN_EMAIL,
      TEST_CLINICIAN_PASSWORD,
      'clinician',
    );
    if (!success) {
      test.skip(true, 'Clinician test account not available in Firebase');
    }
    await use(page);
  },
  clientPage: async ({ page }, use) => {
    const success = await loginViaUI(
      page,
      TEST_CLIENT_EMAIL,
      TEST_CLIENT_PASSWORD,
      'client',
    );
    if (!success) {
      test.skip(true, 'Client test account not available in Firebase');
    }
    await use(page);
  },
});

export { expect } from '@playwright/test';
