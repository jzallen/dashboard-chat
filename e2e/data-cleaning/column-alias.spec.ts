import * as path from "path";

import { test, expect } from "../fixtures/test-fixtures";

const DIRTY_CSV = path.resolve(__dirname, "../fixtures/data/dirty-products.csv");

test.describe("Data Cleaning - Column Alias", () => {
  test.beforeEach(async ({ page, navigationHelper, seededProjectId }) => {
    await navigationHelper.navigateToProject(seededProjectId);

    await page.locator('button[aria-label="Actions"]').click();
    await page.locator('[data-testid="action-create-dataset"]').click();
    await page.setInputFiles('[data-testid="upload-file-input"]', DIRTY_CSV);
    await page.locator('[data-testid="upload-widget-selected"] button:has-text("Send")').click();
    await expect(page.locator('[data-testid="upload-widget-uploaded"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="data-table"]')).toBeVisible({ timeout: 30000 });
  });

  test("should rename column via chat", async ({ chatHelper, tableHelper }) => {
    await chatHelper.sendMessageAndWaitForToolExecution('rename column "Name" to "Product Name"');

    // Verify header updated immediately (no preview step)
    const records = await tableHelper.getPageRecords();
    expect(records.length).toBeGreaterThan(0);
    expect(Object.keys(records[0])).toContain("Product Name");
    expect(Object.keys(records[0])).not.toContain("Name");
  });
});
