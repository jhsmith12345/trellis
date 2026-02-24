import { test, expect } from '@playwright/test';
import {
  TEST_CLIENT_EMAIL,
  TEST_CLIENT_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Client Authentication', () => {
  test('can sign in as a client', async ({ page }) => {
    const success = await loginViaUI(
      page,
      TEST_CLIENT_EMAIL,
      TEST_CLIENT_PASSWORD,
      'client',
    );
    expect(success).toBe(true);

    // Should land on client dashboard since account is registered as client
    await page.waitForURL('**/client/dashboard', { timeout: 15000 });
  });
});
