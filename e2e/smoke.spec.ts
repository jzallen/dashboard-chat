import { test, expect } from "./fixtures/test-fixtures";

test.describe("Smoke Tests", () => {
  test("should load org view with Projects heading", async ({ page, navigationHelper }) => {
    await navigationHelper.navigateToOrg();
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
  });

  test("should navigate to seeded project", async ({ page, navigationHelper, seededProjectId }) => {
    await navigationHelper.navigateToProject(seededProjectId);
    await expect(page.locator(`[data-testid="project-nav-${seededProjectId}"]`)).toBeVisible();
  });

  test("should navigate to seeded dataset with table and chat", async ({
    page,
    navigationHelper,
    tableHelper,
    seededProjectId,
    seededDatasetId,
  }) => {
    await navigationHelper.navigateToDataset(seededProjectId, seededDatasetId);
    await expect(tableHelper.table).toBeVisible();
    const rowCount = await tableHelper.getVisibleRowCount();
    expect(rowCount).toBeGreaterThan(0);
    await expect(page.locator('input[placeholder="Type a command..."]')).toBeVisible();
  });
});
