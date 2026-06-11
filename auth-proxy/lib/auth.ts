import { createRemoteJWKSet, jwtVerify } from "jose";

import { isM2mToken, verifyM2mToken } from "./m2m.ts";
import { isPatToken, verifyPatToken } from "./pat.ts";
import { isUserToken, verifyUserToken } from "./user-token.ts";

/**
 * Auth-proxy ingress verification.
 *
 * Env vars are read lazily (per request) rather than at module-load
 * time. The tradeoff is one extra `process.env` read per ingress call;
 * the win is that `AUTH_MODE` / `WORKOS_CLIENT_ID` switches take effect
 * without a process restart, which keeps dev/workos test parity honest
 * (a test that flips modes doesn't get a stale module-level snapshot).
 */

interface JwksConfig {
  url: string;
  audience: string;
  issuer: string;
}

function readJwksConfig(): JwksConfig | null {
  const authMode = process.env.AUTH_MODE || "dev";
  const explicitJwksUrl = process.env.JWKS_URL;

  if (authMode === "dev") {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    return {
      url: explicitJwksUrl || `${backendUrl}/.well-known/jwks.json`,
      audience: "dev-client",
      issuer: "http://localhost:8000",
    };
  }

  const workosClientId = process.env.WORKOS_CLIENT_ID || "";
  if (!workosClientId) return null;
  return {
    url:
      explicitJwksUrl || `https://api.workos.com/sso/jwks/${workosClientId}`,
    audience: workosClientId,
    issuer: `https://api.workos.com/user_management/${workosClientId}`,
  };
}

// Cache the JWKS resolver per URL so we don't rebuild it on every
// request, but invalidate when the URL itself changes (mode switch).
let cachedJwks: { url: string; resolver: ReturnType<typeof createRemoteJWKSet> } | null =
  null;

function getJWKS(url: string) {
  if (!cachedJwks || cachedJwks.url !== url) {
    cachedJwks = { url, resolver: createRemoteJWKSet(new URL(url)) };
  }
  return cachedJwks.resolver;
}

const PUBLIC_PATHS = new Set([
  "/health",
  "/.well-known/jwks.json",
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/logout",
  "/api/auth/refresh",
]);

/**
 * Headers that must never be forwarded from clients — stripped on EVERY route
 * and replaced with the verified identity (strip-then-inject), so a client can
 * never spoof them. The WorkOS org-create interception (CDO-S5, ADR-050 §b)
 * reuses this for the org-id carry: it overrides `x-org-id` with the freshly-
 * provisioned WorkOS org id on the backend forward, which the backend persists
 * as the new org's row id.
 */
const IDENTITY_HEADERS = [
  "x-user-id",
  "x-org-id",
  "x-user-email",
];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

export interface AuthResult {
  userId: string;
  orgId: string;
  email: string;
}

/**
 * Verify the Bearer token and return identity claims.
 * Both dev and production modes use RS256 JWT verification via JWKS.
 * Throws on invalid/missing tokens.
 */
export async function verifyToken(token: string): Promise<AuthResult> {
  // M2M tokens carry a fixed kid and verify against auth-proxy's local keypair.
  // This dispatch keeps the existing JWKS-based path unchanged for WorkOS / dev backend tokens.
  if (isM2mToken(token)) {
    const payload = await verifyM2mToken(token);
    return {
      userId: (payload.sub as string) || "",
      orgId: (payload.org_id as string) || "",
      email: (payload.email as string) || "",
    };
  }

  // PATs share the same dispatch shape but additionally consult the PAT
  // store, so revocation takes effect immediately rather than waiting for
  // JWT expiry.
  if (isPatToken(token)) {
    const payload = await verifyPatToken(token);
    return {
      userId: (payload.sub as string) || "",
      orgId: (payload.org_id as string) || "",
      email: (payload.email as string) || "",
    };
  }

  // User tokens are auth-proxy-minted (Stage 1 of the
  // auth-proxy-mints-user-tokens feature). Distinguished by their kid,
  // verified against the same shared keypair.
  if (isUserToken(token)) {
    const payload = await verifyUserToken(token);
    return {
      userId: (payload.sub as string) || "",
      orgId: (payload.org_id as string) || "",
      email: (payload.email as string) || "",
    };
  }

  const config = readJwksConfig();
  if (!config) {
    if ((process.env.AUTH_MODE || "dev") === "dev") {
      throw new Error("JWKS not available (backend not reachable?)");
    }
    throw new Error("WORKOS_CLIENT_ID not configured");
  }

  const keySet = getJWKS(config.url);
  const { payload } = await jwtVerify(token, keySet, {
    audience: config.audience,
    issuer: config.issuer,
    algorithms: ["RS256"],
  });

  return {
    userId: payload.sub || "",
    orgId: (payload.org_id as string) || "",
    email: (payload.email as string) || "",
  };
}

export { IDENTITY_HEADERS };
