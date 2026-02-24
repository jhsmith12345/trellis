import { test, expect } from '@playwright/test';

test.describe('Consent Document Signing', () => {
  test('signing page route exists', async ({ page }) => {
    // /sign/:packageId is a public route but requires a valid package ID
    await page.goto('/sign/nonexistent-package-id');
    // Should load the page (will show auth gate or error)
    await expect(page).toHaveTitle('Trellis');
  });

  test.skip('signing flow requires a valid document package', async ({ page }) => {
    // The signing flow requires:
    // 1. A document package to be created for the client
    // 2. The client to be authenticated
    // 3. Documents to be pending signature
    // This is skipped because it requires backend state setup.
    // In a full test environment, we would:
    // - Create a document package via API
    // - Navigate to /sign/:packageId
    // - Authenticate via the auth gate
    // - View each document
    // - Sign with the signature canvas
  });
});
