import { test, expect } from '@playwright/test';
import {
  TEST_CLIENT_EMAIL,
  TEST_CLIENT_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Client Onboarding Page', () => {
  test('onboarding page requires authentication', async ({ page }) => {
    // Trying to access /onboarding without auth should redirect to /
    await page.goto('/onboarding');
    await page.waitForURL('/');
  });

  test.skip('shows intake choice after login', async ({ page }) => {
    // NOTE: Skipped because client accounts route to /client/dashboard,
    // and /onboarding is only shown for newly registered clients before
    // they have completed intake. The flow depends on backend state.
    const success = await loginViaUI(
      page,
      TEST_CLIENT_EMAIL,
      TEST_CLIENT_PASSWORD,
      'client',
    );
    if (!success) {
      test.skip(true, 'Client test account not available');
    }
    await page.goto('/onboarding');
    await expect(page.getByText('Voice Conversation')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Written Form')).toBeVisible();
  });
});
