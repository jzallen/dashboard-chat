import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_MODE = process.env.AUTH_MODE || "dev";
const DEV_TOKEN = "dev-token-static";
const DEV_USER: AuthResult = {
  userId: "dev-user-001",
  orgId: "dev-org-001",
  email: "dev@localhost",
};
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

const PUBLIC_PATHS = new Set([
  "/health",
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
 * Returns null for public paths (no auth required).
 * Throws on invalid/missing tokens.
 */
export async function verifyToken(token: string): Promise<AuthResult> {
  if (AUTH_MODE === "dev") {
    if (token !== DEV_TOKEN) {
      throw new Error("Invalid dev token");
    }
    return DEV_USER;
  }

  // WorkOS mode: verify JWT using JWKS
  const keySet = getJWKS();
  if (!keySet) {
    throw new Error("WORKOS_CLIENT_ID not configured");
  }

  const { payload } = await jwtVerify(token, keySet, {
    audience: WORKOS_CLIENT_ID,
    issuer: `https://api.workos.com/user_management/${WORKOS_CLIENT_ID}`,
    algorithms: ["RS256"],
  });

  return {
    userId: payload.sub || "",
    orgId: (payload.org_id as string) || "",
    email: (payload.email as string) || "",
  };
}

export { IDENTITY_HEADERS };
