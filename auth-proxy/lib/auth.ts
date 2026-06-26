import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

import { createLogger } from "./log.ts";
import { isM2mToken, verifyM2mToken } from "./m2m.ts";
import { isPatToken, verifyPatToken } from "./pat.ts";
import { isUserToken, verifyUserToken } from "./user-token.ts";

/**
 * Audit channel for every ingress auth decision. Each verification logs an INFO
 * `auth.<kind>.verified` on success and a WARN `auth.<kind>.rejected` carrying
 * the failure reason on rejection — never the token itself. The shared redaction
 * seam (see `./log.ts`) is the backstop, but rejections deliberately carry only
 * a controlled `reason` string and the principal when derivable, so a credential
 * cannot reach a line in the first place.
 */
const log = createLogger("auth");

/** The principal kinds `verifyToken` dispatches across, as the `event.action` infix. */
type AuthKind = "m2m" | "pat" | "user" | "jwt";

/** A controlled, token-free reason string for a rejected verification. */
function rejectionReason(error: unknown): string {
  return error instanceof Error ? error.message : "verification failed";
}

/**
 * Wrap one principal kind's verification in audit logging: run `verifyCallback`,
 * then project its claims onto {@link AuthResult}. An INFO line names the resolved
 * principal on success; a WARN line names the reason (and the principal when
 * already resolved) on any failure, before the original error propagates so the
 * HTTP mapping is unchanged. The token is never passed into the attributes bag.
 */
async function withAuditLogging(
  kind: AuthKind,
  verifyCallback: () => Promise<JWTPayload>,
): Promise<AuthResult> {
  let payload: JWTPayload;
  try {
    payload = await verifyCallback();
  } catch (error) {
    log.warn(`auth.${kind}.rejected`, { reason: rejectionReason(error) });
    throw error;
  }

  const principalId = (payload.sub as string) || "";
  try {
    const result: AuthResult = {
      userId: principalId,
      orgId: resolveOrgIdClaim(payload.org_id),
      email: (payload.email as string) || "",
    };
    log.info(`auth.${kind}.verified`, { principal_id: principalId });
    return result;
  } catch (error) {
    log.warn(`auth.${kind}.rejected`, {
      reason: rejectionReason(error),
      principal_id: principalId || undefined,
    });
    throw error;
  }
}

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
 * Resolve the `org_id` claim into the tenant value carried on `X-Org-Id`.
 *
 * An ABSENT claim (`undefined`/`null`) resolves to `""` — the org-less signal
 * the onboarding flow depends on: a WorkOS user with no org membership is
 * minted with `org_id: ""` (see `lib/user-auth/workos.ts`), and the backend
 * reads an absent/empty `X-Org-Id` as "no tenant" to drive first-org creation.
 *
 * A claim that is PRESENT but not a string is a malformed / type-confused
 * token. The old `(payload.org_id as string) || ""` cast was compile-time
 * only, so a number/object/array survived to the upstream `X-Org-Id` header as
 * a spurious tenant — a cross-tenant authorization hazard. Reject it instead.
 */
function resolveOrgIdClaim(orgId: unknown): string {
  if (orgId === undefined || orgId === null) return "";
  if (typeof orgId !== "string") {
    throw new Error("Invalid token: org_id claim must be a string");
  }
  return orgId;
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
    return withAuditLogging("m2m", () => verifyM2mToken(token));
  }

  // PATs share the same dispatch shape but additionally consult the PAT
  // store, so revocation takes effect immediately rather than waiting for
  // JWT expiry.
  if (isPatToken(token)) {
    return withAuditLogging("pat", () => verifyPatToken(token));
  }

  // User tokens are auth-proxy-minted (Stage 1 of the
  // auth-proxy-mints-user-tokens feature). Distinguished by their kid,
  // verified against the same shared keypair.
  if (isUserToken(token)) {
    return withAuditLogging("user", () => verifyUserToken(token));
  }

  // Default: remote JWKS path for WorkOS / dev backend tokens. The config
  // guard throws inside the verify closure so an unconfigured JWKS source is
  // audited as a rejection alongside a signature/claim failure.
  return withAuditLogging("jwt", async () => {
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
    return payload;
  });
}

export { IDENTITY_HEADERS };
