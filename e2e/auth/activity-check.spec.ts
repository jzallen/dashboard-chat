import { test, expect, type Page } from "@playwright/test";

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL || "http://localhost:3000";

async function injectDevAuth(page: Page) {
  const res = await fetch(`${AUTH_PROXY_URL}/api/auth/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "dev-auth-code" }),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch dev auth: ${res.status}`);
  }
  const auth = await res.json();
  const expiresAt = Date.now() + auth.expires_in * 1000;

  await page.addInitScript(
    ({ token, user, refreshToken, expiresAt, lastActivity }) => {
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_refresh_token", refreshToken);
      localStorage.setItem("auth_token_expires_at", String(expiresAt));
      localStorage.setItem("last_activity_ts", String(lastActivity));
      localStorage.setItem("auth_user", JSON.stringify(user));
    },
    {
      token: auth.token,
      user: auth.user,
      refreshToken: auth.refresh_token,
      expiresAt,
      lastActivity: Date.now(),
    }
  );
}

test.describe("Auth - Activity Check", () => {
  test("should show activity check modal after inactivity", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-03-07T12:00:00Z") });
    await injectDevAuth(page);
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
    await injectDevAuth(page);
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
    await injectDevAuth(page);
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
