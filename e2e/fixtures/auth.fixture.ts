import { test as base } from "@playwright/test";

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL || "http://localhost:3000";

async function fetchDevAuth(): Promise<{
  token: string;
  user: { id: string; email: string; org_id: string; name: string };
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(`${AUTH_PROXY_URL}/api/auth/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "dev-auth-code" }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch dev auth: ${res.status} ${await res.text()}`
    );
  }
  return res.json();
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const auth = await fetchDevAuth();
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
    await use(page);
  },
});
