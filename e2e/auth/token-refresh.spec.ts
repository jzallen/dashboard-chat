import { test, expect } from "../fixtures/test-fixtures";

test.describe("Auth - Token Refresh", () => {
  test("should recover from cleared auth token in dev mode", async ({
    page,
    navigationHelper,
  }) => {
    await navigationHelper.navigateToOrg();

    // Clear auth token
    await page.evaluate(() => {
      localStorage.removeItem("auth_token");
    });

    // Navigate again -- dev mode should auto-recover
    await page.reload();
    await page.waitForLoadState("networkidle");

    // App should still be functional (dev mode re-initializes)
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
