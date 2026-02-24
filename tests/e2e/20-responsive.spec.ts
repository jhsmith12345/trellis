import { test, expect } from '@playwright/test';

test.describe('Responsive Design', () => {
  test.describe('Landing Page', () => {
    test('renders correctly at mobile viewport (375px)', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');

      // Hero content should be visible
      await expect(page.getByText('Your Practice,')).toBeVisible();
      await expect(page.getByText('On Autopilot.')).toBeVisible();
      await expect(page.getByText('Get Started').first()).toBeVisible();
      await expect(page.getByText('Clinician Login')).toBeVisible();
    });

    test('renders correctly at tablet viewport (768px)', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/');

      await expect(page.getByText('Your Practice,')).toBeVisible();
      await expect(page.getByText('How It Works')).toBeVisible();
      await expect(page.getByText('Everything You Need')).toBeVisible();
    });

    test('renders correctly at desktop viewport (1440px)', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');

      await expect(page.getByText('Your Practice,')).toBeVisible();
      await expect(page.getByText('How It Works')).toBeVisible();
      await expect(page.getByText('Everything You Need')).toBeVisible();
    });

    test('CTA buttons stack vertically on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');

      const getStarted = page.getByText('Get Started').first();
      const clinicianLogin = page.getByText('Clinician Login');

      // Both buttons should be visible
      await expect(getStarted).toBeVisible();
      await expect(clinicianLogin).toBeVisible();

      // On mobile (375px), the buttons should be in a flex-col layout
      // which means the Clinician Login button should be below Get Started
      const gsBox = await getStarted.boundingBox();
      const clBox = await clinicianLogin.boundingBox();
      if (gsBox && clBox) {
        expect(clBox.y).toBeGreaterThan(gsBox.y);
      }
    });
  });

  test.describe('Setup Wizard', () => {
    test('renders correctly at mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/setup-wizard');

      await expect(page.getByText('Welcome to Trellis')).toBeVisible();
      await expect(page.getByText('Continue')).toBeVisible();
      await expect(page.getByText('Step 1 of 9')).toBeVisible();
    });

    test('renders correctly at desktop viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/setup-wizard');

      await expect(page.getByText('Welcome to Trellis')).toBeVisible();
      await expect(page.getByText('Continue')).toBeVisible();
    });
  });

  test.describe('Auth Modal', () => {
    test('auth modal fits on mobile screen', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');
      await page.getByText('Clinician Login').click();

      // Modal should be visible and contain form elements
      await expect(page.getByText('Welcome Back')).toBeVisible();
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.getByText('Continue with Google')).toBeVisible();

      // Modal container should be within viewport width (with padding)
      const modal = page.locator('div.relative.bg-white').first();
      const box = await modal.boundingBox();
      if (box) {
        // Modal should not exceed viewport width (375px) accounting for padding
        expect(box.x + box.width).toBeLessThanOrEqual(375 + 1);
      }
    });
  });
});
