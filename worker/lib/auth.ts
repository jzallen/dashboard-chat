import type { Context, Next } from "hono";

const AUTH_MODE = process.env.AUTH_MODE || "dev";
const DEV_TOKEN = "dev-token-static";

const PUBLIC_PATHS = new Set(["/health"]);

export async function authMiddleware(c: Context, next: Next) {
  if (PUBLIC_PATHS.has(c.req.path)) {
    return next();
  }

  const authHeader = c.req.header("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  if (AUTH_MODE === "dev") {
    if (token !== DEV_TOKEN) {
      return c.json({ error: "Invalid dev token" }, 401);
    }
    // In dev mode, just accept the static token
    return next();
  }

  // Validate token directly against WorkOS (same as backend — no coupling)
  const resp = await fetch("https://api.workos.com/user_management/users/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  return next();
}
