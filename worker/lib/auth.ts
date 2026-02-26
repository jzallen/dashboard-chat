import type { Context, Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_MODE = process.env.AUTH_MODE || "dev";
const DEV_TOKEN = "dev-token-static";
const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID || "";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks && WORKOS_CLIENT_ID) {
    jwks = createRemoteJWKSet(
      new URL(`https://api.workos.com/sso/jwks/${WORKOS_CLIENT_ID}`)
    );
  }
  return jwks;
}

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
    return next();
  }

  // Verify JWT locally using WorkOS JWKS
  try {
    const keySet = getJWKS();
    if (!keySet) {
      return c.json({ error: "WORKOS_CLIENT_ID not configured" }, 401);
    }
    await jwtVerify(token, keySet, {
      audience: WORKOS_CLIENT_ID,
      issuer: "https://api.workos.com",
      algorithms: ["RS256"],
    });
    return next();
  } catch (err) {
    console.error("JWT verification failed:", err);
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}
