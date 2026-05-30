import type { Context, Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_MODE = process.env.AUTH_MODE || "dev";
const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID || "";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const JWKS_URL = process.env.JWKS_URL;
// When the agent is deployed behind auth-proxy (production /worker path),
// auth-proxy verifies the bearer and injects the verified tenant identity as
// X-User-Id / X-Org-Id / X-User-Email. The agent then trusts those headers
// instead of verifying the token locally — auth-proxy mints user tokens with
// its own keypair/kid/issuer, which the JWKS path below cannot verify. Mirrors
// the backend's TRUST_PROXY_HEADERS contract.
const TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS === "true";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    if (AUTH_MODE === "dev") {
      const url = JWKS_URL || `${BACKEND_URL}/.well-known/jwks.json`;
      jwks = createRemoteJWKSet(new URL(url));
    } else if (WORKOS_CLIENT_ID) {
      const url =
        JWKS_URL ||
        `https://api.workos.com/sso/jwks/${WORKOS_CLIENT_ID}`;
      jwks = createRemoteJWKSet(new URL(url));
    }
  }
  return jwks;
}

function getVerifyOptions(): { audience: string; issuer: string } {
  if (AUTH_MODE === "dev") {
    return { audience: "dev-client", issuer: "http://localhost:8000" };
  }
  return {
    audience: WORKOS_CLIENT_ID,
    issuer: `https://api.workos.com/user_management/${WORKOS_CLIENT_ID}`,
  };
}

const PUBLIC_PATHS = new Set(["/health", "/openapi.json"]);

export async function authMiddleware(c: Context, next: Next) {
  if (PUBLIC_PATHS.has(c.req.path)) {
    return next();
  }

  // Behind auth-proxy: trust the injected identity and skip local JWT
  // verification. nginx routes /worker and the presentation-state path
  // exclusively through auth-proxy, which strips any client-supplied identity
  // headers before injecting the verified ones — so X-User-Id is authoritative
  // here. Downstream scope.ts reads X-Org-Id / X-User-Id off the request, which
  // are already present from auth-proxy's injection.
  if (TRUST_PROXY_HEADERS) {
    const userId =
      c.req.header("X-User-Id") || c.req.header("x-user-id") || "";
    if (!userId) {
      return c.json({ error: "Missing identity headers" }, 401);
    }
    return next();
  }

  const authHeader = c.req.header("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const keySet = getJWKS();
    if (!keySet) {
      if (AUTH_MODE === "dev") {
        return c.json(
          { error: "JWKS not available (backend not reachable?)" },
          401
        );
      }
      return c.json({ error: "WORKOS_CLIENT_ID not configured" }, 401);
    }
    const options = getVerifyOptions();
    const { payload } = await jwtVerify(token, keySet, {
      ...options,
      algorithms: ["RS256"],
    });

    // D-MR4-05: derive the tenant identity from the cryptographically
    // verified JWT and propagate it downstream as X-Org-Id / X-User-Id —
    // the same headers auth-proxy injects (org_id → X-Org-Id, sub →
    // X-User-Id; see auth-proxy/lib/auth.ts). The production chat path
    // (FE → reverse-proxy → /worker/chat → agent) has NO auth-proxy in
    // the chain, so the agent must not trust that these headers were set
    // upstream. We OVERWRITE any inbound X-Org-Id / X-User-Id: a
    // header-forging client must not be able to escape its own tenant
    // (this is what makes the scope.ts cross-tenant guard live). Request
    // headers are immutable, so we replace c.req.raw with a clone that
    // carries the verified identity — the channel scope.ts reads via
    // index.ts `handleChat(c.req.raw)`.
    const orgId = typeof payload.org_id === "string" ? payload.org_id : "";
    const userId = typeof payload.sub === "string" ? payload.sub : "";
    const headers = new Headers(c.req.raw.headers);
    headers.set("X-Org-Id", orgId);
    headers.set("X-User-Id", userId);
    c.req.raw = new Request(c.req.raw, { headers });

    return next();
  } catch (err) {
    console.error("JWT verification failed:", err);
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}
