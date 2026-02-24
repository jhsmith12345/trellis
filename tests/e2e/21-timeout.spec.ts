import { test, expect } from '@playwright/test';
import {
  TEST_CLINICIAN_EMAIL,
  TEST_CLINICIAN_PASSWORD,
  loginViaUI,
} from './fixtures/auth';

test.describe('Session Timeout', () => {
  /**
   * Strategy:
   *
   * 1. Login normally (no timer mocking during auth).
   * 2. Use page.addInitScript() to register a setTimeout override that
   *    intercepts the specific delay values used by useSessionTimeout
   *    (780000ms warning, 900000ms logout) and replaces them with short delays.
   * 3. Reload the page — Firebase auth persists in IndexedDB so the user
   *    stays logged in, and the init script runs before any page JS.
   * 4. The session timeout hook mounts fresh with the overridden setTimeout.
   *
   * Only the specific timeout delays are intercepted; all other setTimeout
   * calls (including Firebase internals) pass through unchanged.
   */

  async function loginAsClinician(page: import('@playwright/test').Page) {
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
    await expect(page.locator('aside')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Install a setTimeout override via addInitScript, then reload the page.
   * Firebase auth state persists in IndexedDB so the session survives.
   */
  async function setupShortTimeouts(
    page: import('@playwright/test').Page,
    warningDelay: number,
    logoutDelay: number,
  ) {
    await page.addInitScript(
      ({ warnMs, logoutMs, warnTarget, logoutTarget }) => {
        const origST = window.setTimeout.bind(window);

        (window as any).setTimeout = (
          fn: TimerHandler,
          delay?: number,
          ...args: unknown[]
        ) => {
          if (delay === warnTarget) {
            return origST(fn as (...a: unknown[]) => void, warnMs, ...args);
          }
          if (delay === logoutTarget) {
            return origST(fn as (...a: unknown[]) => void, logoutMs, ...args);
          }
          return origST(fn as (...a: unknown[]) => void, delay, ...args);
        };
      },
      {
        warnMs: warningDelay,
        logoutMs: logoutDelay,
        warnTarget: 13 * 60 * 1000, // WARNING_MS in the hook
        logoutTarget: 15 * 60 * 1000, // TIMEOUT_MS in the hook
      },
    );

    // Reload so the init script takes effect before React initializes.
    await page.reload();
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await expect(page.locator('aside')).toBeVisible({ timeout: 10000 });
  }

  // ---- TESTS ----

  test('no warning modal is visible on initial page load', async ({ page }) => {
    await loginAsClinician(page);

    // The warning modal should NOT be visible immediately after login
    await expect(page.getByText('Session Timeout Warning')).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Stay Signed In' }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign Out Now' }),
    ).not.toBeVisible();
  });

  test('warning modal appears after inactivity period', async ({ page }) => {
    await loginAsClinician(page);
    await setupShortTimeouts(page, 3000, 10000);

    // Warning should appear after ~3 seconds
    await expect(page.getByText('Session Timeout Warning')).toBeVisible({
      timeout: 15000,
    });
  });

  test('warning modal shows correct heading and content', async ({ page }) => {
    await loginAsClinician(page);
    await setupShortTimeouts(page, 3000, 10000);

    await expect(page.getByText('Session Timeout Warning')).toBeVisible({
      timeout: 15000,
    });

    // PHI security message
    await expect(
      page.getByText('protected health information', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText('session will expire due to inactivity', { exact: false }),
    ).toBeVisible();

    // Both action buttons
    await expect(
      page.getByRole('button', { name: 'Stay Signed In' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign Out Now' }),
    ).toBeVisible();

    // Helper text
    await expect(
      page.getByText('Click "Stay Signed In" to continue your session'),
    ).toBeVisible();

    // Countdown timer element (format M:SS or Ns)
    const countdownEl = page.locator('.font-mono.font-bold');
    await expect(countdownEl).toBeVisible();
    const text = await countdownEl.textContent();
    expect(text).toMatch(/^\d+:\d{2}$|^\d+s$/);
  });

  test('"Stay Signed In" button dismisses warning and resets timer', async ({
    page,
  }) => {
    await loginAsClinician(page);
    await setupShortTimeouts(page, 3000, 10000);

    // Wait for warning
    await expect(page.getByText('Session Timeout Warning')).toBeVisible({
      timeout: 15000,
    });

    // Click "Stay Signed In"
    await page.getByRole('button', { name: 'Stay Signed In' }).click();

    // Warning should disappear
    await expect(page.getByText('Session Timeout Warning')).not.toBeVisible({
      timeout: 5000,
    });

    // Should still be on the dashboard (not logged out)
    await expect(page.locator('aside')).toBeVisible();
  });

  test('after dismissing warning, another inactivity period shows warning again', async ({
    page,
  }) => {
    await loginAsClinician(page);
    await setupShortTimeouts(page, 3000, 12000);

    // First warning
    await expect(page.getByText('Session Timeout Warning')).toBeVisible({
      timeout: 15000,
    });

    // Dismiss
    await page.getByRole('button', { name: 'Stay Signed In' }).click();
    await expect(page.getByText('Session Timeout Warning')).not.toBeVisible({
      timeout: 5000,
    });

    // Warning should re-appear after another ~3 seconds
    await expect(page.getByText('Session Timeout Warning')).toBeVisible({
      timeout: 15000,
    });
  });

  test('"Sign Out Now" button logs out and redirects to landing page', async ({
    page,
  }) => {
    await loginAsClinician(page);
    await setupShortTimeouts(page, 3000, 10000);

    // Wait for warning
    await expect(page.getByText('Session Timeout Warning')).toBeVisible({
      timeout: 15000,
    });

    // Click "Sign Out Now"
    await page.getByRole('button', { name: 'Sign Out Now' }).click();

    // Should redirect to landing page
    await page.waitForURL('/', { timeout: 10000 });
  });

  test('auto-logout occurs after full timeout period', async ({ page }) => {
    await loginAsClinician(page);
    await setupShortTimeouts(page, 3000, 6000);

    // Auto-logout should redirect to landing page after ~6 seconds
    await page.waitForURL('/', { timeout: 20000 });
  });

  test('warning does not appear before timeout threshold', async ({ page }) => {
    await loginAsClinician(page);
    // No short timeouts — use real 13-minute delay
    // Just verify warning is not visible after a few seconds
    await page.waitForTimeout(3000);

    // Warning should NOT be visible (13 minutes haven't passed)
    await expect(page.getByText('Session Timeout Warning')).not.toBeVisible();
    await expect(page.locator('aside')).toBeVisible();
  });
});
