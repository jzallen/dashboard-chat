import * as path from "path";

import { test, expect } from "../fixtures/test-fixtures";

const DIRTY_CSV = path.resolve(__dirname, "../fixtures/data/dirty-products.csv");

test.describe("Data Cleaning - Trim & Case", () => {
  test.beforeEach(async ({ page, navigationHelper, seededProjectId }) => {
    // Navigate to project to upload a fresh dirty dataset
    await navigationHelper.navigateToProject(seededProjectId);

    // Upload dirty CSV
    await page.locator('button[aria-label="Actions"]').click();
    await page.locator('[data-testid="action-create-dataset"]').click();
    await page.setInputFiles('[data-testid="upload-file-input"]', DIRTY_CSV);
    await page.locator('[data-testid="upload-widget-selected"] button:has-text("Send")').click();
    await expect(page.locator('[data-testid="upload-widget-uploaded"]')).toBeVisible({ timeout: 30000 });

    // Wait for table to load
    await expect(page.locator('[data-testid="data-table"]')).toBeVisible({ timeout: 30000 });
  });

  test("should trim whitespace from name column", async ({ chatHelper, tableHelper }) => {
    await chatHelper.sendMessageAndWaitForToolExecution("trim whitespace from name column");

    // Verify table values are trimmed (no leading/trailing spaces)
    const records = await tableHelper.getPageRecords();
    for (const record of records) {
      expect(record["Name"]).toBe(record["Name"].trim());
    }
  });

  test("should convert category to title case", async ({ chatHelper, tableHelper }) => {
    await chatHelper.sendMessageAndWaitForToolExecution("make category title case");

    const records = await tableHelper.getPageRecords();
    const categories = records.map((r) => r["Category"].trim());
    for (const cat of categories) {
      // Title case: first letter uppercase, rest lowercase
      expect(cat).toMatch(/^[A-Z][a-z]*$/);
    }
  });

  test("should fill blanks in status with Unknown", async ({ chatHelper, tableHelper }) => {
    await chatHelper.sendMessageAndWaitForToolExecution('fill blanks in status with "Unknown"');

    const records = await tableHelper.getPageRecords();
    for (const record of records) {
      expect(record["Status"].trim()).not.toBe("");
    }
  });

  test("should undo last transform", async ({ chatHelper, tableHelper }) => {
    const recordsBefore = await tableHelper.getPageRecords();

    await chatHelper.sendMessageAndWaitForToolExecution("trim whitespace from name column");
    const recordsAfterTrim = await tableHelper.getPageRecords();
    expect(recordsAfterTrim).not.toEqual(recordsBefore);

    await chatHelper.sendMessageAndWaitForToolExecution("undo");
    const recordsAfterUndo = await tableHelper.getPageRecords();
    expect(recordsAfterUndo).toEqual(recordsBefore);
  });
});
