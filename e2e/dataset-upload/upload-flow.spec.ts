import * as path from "path";

import { test, expect } from "../fixtures/test-fixtures";

const SAMPLE_CSV = path.resolve(__dirname, "../fixtures/data/sample-upload.csv");

test.describe("Dataset Upload Flow", () => {
  test("should upload a CSV file via action menu", async ({
    page,
    navigationHelper,
    seededProjectId,
  }) => {
    await navigationHelper.navigateToProject(seededProjectId);

    // Open action menu
    await page.locator('button[aria-label="Actions"]').click();
    await expect(page.locator('[data-testid="chat-action-menu"]')).toBeVisible();

    // Click Create Dataset
    await page.locator('[data-testid="action-create-dataset"]').click();

    // Select file
    await page.setInputFiles('[data-testid="upload-file-input"]', SAMPLE_CSV);
    await expect(page.locator('[data-testid="upload-widget-selected"]')).toBeVisible();

    // Send upload
    await page.locator('[data-testid="upload-widget-selected"] button:has-text("Send")').click();
    await expect(page.locator('[data-testid="upload-widget-uploading"]')).toBeVisible();

    // Wait for uploaded state
    await expect(page.locator('[data-testid="upload-widget-uploaded"]')).toBeVisible({ timeout: 30000 });
  });

  test("should remove selected file before sending", async ({
    page,
    navigationHelper,
    seededProjectId,
  }) => {
    await navigationHelper.navigateToProject(seededProjectId);

    await page.locator('button[aria-label="Actions"]').click();
    await page.locator('[data-testid="action-create-dataset"]').click();

    // Select file
    await page.setInputFiles('[data-testid="upload-file-input"]', SAMPLE_CSV);
    await expect(page.locator('[data-testid="upload-widget-selected"]')).toBeVisible();

    // Remove file
    await page.locator('[data-testid="upload-widget-selected"] button[aria-label="Remove file"]').click();

    // Should return to browse state
    await expect(page.locator('[data-testid="upload-widget-browse"]')).toBeVisible();
  });

  test("should rename dataset via breadcrumb after upload", async ({
    page,
    navigationHelper,
    seededProjectId,
  }) => {
    await navigationHelper.navigateToProject(seededProjectId);

    await page.locator('button[aria-label="Actions"]').click();
    await page.locator('[data-testid="action-create-dataset"]').click();

    await page.setInputFiles('[data-testid="upload-file-input"]', SAMPLE_CSV);
    await page.locator('[data-testid="upload-widget-selected"] button:has-text("Send")').click();
    await expect(page.locator('[data-testid="upload-widget-uploaded"]')).toBeVisible({ timeout: 30000 });

    // Click breadcrumb to edit name
    const breadcrumbInput = page.locator('[data-testid="breadcrumb-edit-input"]');
    // The breadcrumb may auto-focus for "New Dataset" names
    if (!(await breadcrumbInput.isVisible())) {
      // Click the dataset name span to enter edit mode
      await page.locator('nav span:has-text("New Dataset"), nav span:has-text("sample-upload")').first().click();
    }
    await expect(breadcrumbInput).toBeVisible();
    await breadcrumbInput.fill("Renamed Upload");
    await breadcrumbInput.press("Enter");

    // Verify name updated
    await expect(page.locator('nav span:has-text("Renamed Upload")')).toBeVisible();
  });

  test("should show error state for invalid upload", async ({
    page,
    navigationHelper,
    seededProjectId,
  }) => {
    await navigationHelper.navigateToProject(seededProjectId);

    await page.locator('button[aria-label="Actions"]').click();
    await page.locator('[data-testid="action-create-dataset"]').click();

    // Create an invalid file (wrong content type)
    await page.setInputFiles('[data-testid="upload-file-input"]', {
      name: "invalid.xyz",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("not a valid file"),
    });

    await page.locator('[data-testid="upload-widget-selected"] button:has-text("Send")').click();

    // Should show error state with retry
    await expect(page.locator('[data-testid="upload-widget-error"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="upload-widget-error"] button:has-text("Retry")')).toBeVisible();
  });
});
