import { test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem("auth_token", "dev-token-static");
      localStorage.setItem("auth_refresh_token", "dev-refresh-token-001");
      localStorage.setItem(
        "auth_token_expires_at",
        String(Date.now() + 300000)
      );
      localStorage.setItem("last_activity_ts", String(Date.now()));
      localStorage.setItem(
        "auth_user",
        JSON.stringify({
          id: "dev-user-001",
          email: "dev@localhost",
          org_id: "dev-org-001",
          name: "Dev User",
        })
      );
    });
    await use(page);
  },
});
