import { test, expect } from "@playwright/test";

test.describe("Auth - Activity Check", () => {
  test("should show activity check modal after inactivity", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-03-07T12:00:00Z") });
    await page.addInitScript(() => {
      localStorage.setItem("auth_token", "dev-token-static");
      localStorage.setItem("auth_refresh_token", "dev-refresh-token-001");
      localStorage.setItem("auth_token_expires_at", String(Date.now() + 300000));
      localStorage.setItem("last_activity_ts", String(Date.now()));
      localStorage.setItem("auth_user", JSON.stringify({id:"dev-user-001",email:"dev@localhost",org_id:"dev-org-001",name:"Dev User"}));
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Fast-forward past 20min inactivity threshold
    await page.clock.fastForward("21:00");
    await page.clock.runFor(61_000);

    await expect(page.locator('[data-testid="activity-check-modal"]')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Are you still there?")).toBeVisible();
  });

  test("should dismiss modal on Continue click", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-03-07T12:00:00Z") });
    await page.addInitScript(() => {
      localStorage.setItem("auth_token", "dev-token-static");
      localStorage.setItem("auth_refresh_token", "dev-refresh-token-001");
      localStorage.setItem("auth_token_expires_at", String(Date.now() + 300000));
      localStorage.setItem("last_activity_ts", String(Date.now()));
      localStorage.setItem("auth_user", JSON.stringify({id:"dev-user-001",email:"dev@localhost",org_id:"dev-org-001",name:"Dev User"}));
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.clock.fastForward("21:00");
    await page.clock.runFor(61_000);

    await expect(page.locator('[data-testid="activity-check-modal"]')).toBeVisible({ timeout: 10000 });

    // Click Continue
    await page.locator('[data-testid="activity-check-confirm"]').click();

    // Modal should close
    await expect(page.locator('[data-testid="activity-check-modal"]')).not.toBeVisible();
  });

  test("should redirect to login after modal timeout", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-03-07T12:00:00Z") });
    await page.addInitScript(() => {
      localStorage.setItem("auth_token", "dev-token-static");
      localStorage.setItem("auth_refresh_token", "dev-refresh-token-001");
      localStorage.setItem("auth_token_expires_at", String(Date.now() + 300000));
      localStorage.setItem("last_activity_ts", String(Date.now()));
      localStorage.setItem("auth_user", JSON.stringify({id:"dev-user-001",email:"dev@localhost",org_id:"dev-org-001",name:"Dev User"}));
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger inactivity modal
    await page.clock.fastForward("21:00");
    await page.clock.runFor(61_000);
    await expect(page.locator('[data-testid="activity-check-modal"]')).toBeVisible({ timeout: 10000 });

    // Fast-forward 10 more minutes for modal auto-logout
    await page.clock.fastForward("10:00");
    await page.clock.runFor(61_000);

    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });
});
