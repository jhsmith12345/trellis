import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays the page title', async ({ page }) => {
    await expect(page).toHaveTitle('Trellis');
  });

  test('shows the hero section with branding', async ({ page }) => {
    await expect(page.getByText('AI-Native Behavioral Health')).toBeVisible();
    await expect(page.getByText('Your Practice,')).toBeVisible();
    await expect(page.getByText('On Autopilot.')).toBeVisible();
  });

  test('shows the Trellis description', async ({ page }) => {
    await expect(
      page.getByText('Trellis automates intake, scheduling, notes, and billing'),
    ).toBeVisible();
  });

  test('has Get Started CTA button', async ({ page }) => {
    const cta = page.getByText('Get Started', { exact: false }).first();
    await expect(cta).toBeVisible();
  });

  test('has Clinician Login button', async ({ page }) => {
    const loginBtn = page.getByText('Clinician Login');
    await expect(loginBtn).toBeVisible();
  });

  test('shows How It Works section', async ({ page }) => {
    await expect(page.getByText('How It Works')).toBeVisible();
    await expect(page.getByText('Create Your Account')).toBeVisible();
    await expect(page.getByText('Complete Your Intake')).toBeVisible();
    await expect(page.getByText('Begin Your Journey')).toBeVisible();
  });

  test('shows Everything You Need features section', async ({ page }) => {
    await expect(page.getByText('Everything You Need')).toBeVisible();
    await expect(page.getByText('Voice-First Intake')).toBeVisible();
    await expect(page.getByText('Automated Scheduling')).toBeVisible();
    await expect(page.getByText('Notes & Billing')).toBeVisible();
  });

  test('shows footer CTA section', async ({ page }) => {
    await expect(page.getByText('Ready to Simplify')).toBeVisible();
    await expect(page.getByText('Get Started Free')).toBeVisible();
  });

  test('shows footer with Trellis branding', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.getByText('Trellis').first()).toBeVisible();
  });

  test('has setup wizard link in footer', async ({ page }) => {
    const link = page.getByText('Setting up Trellis? Use our setup wizard');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/setup-wizard');
  });

  test('clicking Get Started opens auth modal in client mode', async ({ page }) => {
    await page.getByText('Get Started').first().click();
    // Auth modal should open in client mode with signup prompt
    await expect(page.getByText('Create an account to start your confidential intake')).toBeVisible();
    // The modal should have the email/password form visible
    await expect(page.locator('#email')).toBeVisible();
  });

  test('clicking Clinician Login opens auth modal in clinician mode', async ({ page }) => {
    await page.getByText('Clinician Login').click();
    // Auth modal should open with "Welcome Back" heading (clinician mode)
    await expect(page.getByText('Welcome Back')).toBeVisible();
    await expect(page.getByText('Sign in to your clinician portal')).toBeVisible();
  });

  test('auth modal can be closed', async ({ page }) => {
    await page.getByText('Clinician Login').click();
    await expect(page.getByText('Welcome Back')).toBeVisible();
    // Close via the X button
    await page.getByLabel('Close').click();
    await expect(page.getByText('Welcome Back')).not.toBeVisible();
  });

  test('auth modal has Google sign-in button', async ({ page }) => {
    await page.getByText('Clinician Login').click();
    await expect(page.getByText('Continue with Google')).toBeVisible();
  });

  test('auth modal has email/password form', async ({ page }) => {
    await page.getByText('Clinician Login').click();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('auth modal toggles between sign in and sign up', async ({ page }) => {
    await page.getByText('Clinician Login').click();
    // Should start in sign-in mode
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByText('Need an account?')).toBeVisible();
    // Toggle to sign-up
    await page.getByText('Sign up', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
    await expect(page.getByText('Already have an account?')).toBeVisible();
  });
});
