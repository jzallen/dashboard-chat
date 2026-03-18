import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_MODE = process.env.AUTH_MODE || "dev";
const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID || "";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const JWKS_URL = process.env.JWKS_URL;

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

const PUBLIC_PATHS = new Set([
  "/health",
  "/.well-known/jwks.json",
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/logout",
  "/api/auth/refresh",
]);

/** Headers that must never be forwarded from clients. */
const IDENTITY_HEADERS = ["x-user-id", "x-org-id", "x-user-email"];

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
  const keySet = getJWKS();
  if (!keySet) {
    if (AUTH_MODE === "dev") {
      throw new Error("JWKS not available (backend not reachable?)");
    }
    throw new Error("WORKOS_CLIENT_ID not configured");
  }

  const options = getVerifyOptions();
  const { payload } = await jwtVerify(token, keySet, {
    ...options,
    algorithms: ["RS256"],
  });

  return {
    userId: payload.sub || "",
    orgId: (payload.org_id as string) || "",
    email: (payload.email as string) || "",
  };
}

export { IDENTITY_HEADERS };
