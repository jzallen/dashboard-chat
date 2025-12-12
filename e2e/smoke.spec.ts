import { test, expect } from "./fixtures/test-fixtures";

test.describe("Smoke Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("table")).toBeVisible();
  });

  test("should load the application with table and chat panel", async ({
    page,
    tableHelper,
  }) => {
    await expect(tableHelper.table).toBeVisible();
    const rowCount = await tableHelper.getVisibleRowCount();
    expect(rowCount).toBeGreaterThan(0);

    await expect(
      page.locator('input[placeholder="Type a command..."]')
    ).toBeVisible();
  });

  test("should display initial sample data", async ({ tableHelper }) => {
    const rowCount = await tableHelper.getVisibleRowCount();
    expect(rowCount).toBe(10);
  });
});
