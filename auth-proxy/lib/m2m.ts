/**
 * M2M (machine-to-machine) token issuance and verification for auth-proxy.
 *
 * Implements an OAuth2 client_credentials grant. The shared auth-proxy
 * keypair (`lib/keypair.ts`) signs and verifies M2M tokens; the same
 * keypair also signs PATs (distinguished by `kid`). Tokens carry a
 * fixed `kid` so the existing verifyToken path can dispatch to the
 * local verifier (kid match) versus the remote JWKS path. Set
 * `AUTH_PROXY_KEYPAIR_PATH` to persist key material across restarts;
 * without it, restart rotates the keypair and every still-live token
 * fails verification.
 *
 * Disabled by default. Enable via M2M_ENABLED=true. Clients are configured
 * via the M2M_CLIENTS env var as a JSON object:
 *   { "<client_id>": { "secret": "...", "sub": "...", "org_id": "...", "email": "..." } }
 *
 * For production: clients should be injected through a secrets manager.
 *
 * Dev-mode parity: when AUTH_MODE=dev, a synthetic built-in client
 * (DEV_CLIENT_ID / DEV_CLIENT_SECRET) is available without any
 * M2M_CLIENTS configuration. It mints tokens identifying the standard
 * dev user (dev-user-001 / dev-org-001 / dev@localhost), the same
 * identity that backend's `dev-token-static` represents. User-supplied
 * M2M_CLIENTS entries override the built-in if they share a client_id.
 * The built-in is suppressed outside dev mode, so production deployments
 * never inadvertently expose it.
 */

// TODO(architecture): Audit how ui-state and agent authenticate to the backend.
// Currently both appear to forward the inbound user bearer JWT (see
// `agent/lib/chat/backend-client.ts:22-28`), and neither service is configured
// with M2M_CLIENTS credentials of its own. Decide whether service-to-backend
// calls should instead mint an M2M token here (via POST /api/auth/token) and
// propagate the user's identity as a separate claim/header — pros: distinct
// service identity in audit logs, decouples service-token lifetime from user
// session, per-service scopes constrain blast radius. Also verify these calls
// actually route through the auth-proxy ingress (not the container-internal
// backend URL directly).

import { timingSafeEqual } from "node:crypto";

import {
  decodeProtectedHeader,
  type JWTPayload,
  jwtVerify,
  SignJWT,
} from "jose";

import { _resetKeypairForTests, getKeypair } from "./keypair.ts";

const LOCAL_KID = "auth-proxy:m2m:1";

interface ClientConfig {
  secret: string;
  sub: string;
  org_id: string;
  email: string;
}

/**
 * Built-in dev-mode client (only registered when AUTH_MODE=dev).
 * Mirrors backend's DEV_USER (dev-user-001 / dev-org-001 / dev@localhost)
 * so an M2M-minted dev token forwards the same identity headers as
 * `dev-token-static`.
 */
export const DEV_CLIENT_ID = "dev-m2m-client";
export const DEV_CLIENT_SECRET = "dev-m2m-secret";
const DEV_BUILTIN_CLIENT: ClientConfig = {
  secret: DEV_CLIENT_SECRET,
  sub: "dev-user-001",
  org_id: "dev-org-001",
  email: "dev@localhost",
};

export interface ClientIdentity {
  sub: string;
  orgId: string;
  email: string;
}

interface RuntimeConfig {
  enabled: boolean;
  ttlSeconds: number;
  issuer: string;
  audience: string;
}

function readConfig(): RuntimeConfig {
  return {
    enabled: (process.env.M2M_ENABLED ?? "").toLowerCase() === "true",
    ttlSeconds: Math.max(
      1,
      parseInt(process.env.M2M_TOKEN_TTL_SECONDS || "3600", 10) || 3600,
    ),
    issuer: process.env.M2M_ISSUER || "auth-proxy",
    audience:
      process.env.M2M_AUDIENCE ||
      (process.env.AUTH_MODE === "dev"
        ? "dev-client"
        : process.env.WORKOS_CLIENT_ID || ""),
  };
}

let cachedClients: Record<string, ClientConfig> | null = null;

function loadClients(): Record<string, ClientConfig> {
  if (cachedClients) return cachedClients;

  // In dev mode, seed a built-in synthetic client so local development and
  // the api-driven test compose stack can mint M2M tokens without any
  // M2M_CLIENTS configuration. User-supplied entries override the built-in.
  const base: Record<string, ClientConfig> =
    process.env.AUTH_MODE === "dev"
      ? { [DEV_CLIENT_ID]: { ...DEV_BUILTIN_CLIENT } }
      : {};

  const raw = process.env.M2M_CLIENTS;
  if (!raw) {
    cachedClients = base;
    return cachedClients;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, ClientConfig>;
    if (parsed && typeof parsed === "object") {
      cachedClients = { ...base, ...parsed };
      return cachedClients;
    }
  } catch {
    // fallthrough — bad JSON is treated as no clients
  }
  cachedClients = base;
  return cachedClients;
}

export function isM2mEnabled(): boolean {
  return readConfig().enabled;
}

export function getLocalKid(): string {
  return LOCAL_KID;
}

export async function authenticateClient(
  clientId: string,
  clientSecret: string,
): Promise<ClientIdentity | null> {
  const cfg = loadClients()[clientId];
  if (!cfg) return null;

  const expected = Buffer.from(cfg.secret, "utf8");
  const supplied = Buffer.from(clientSecret, "utf8");
  if (expected.length !== supplied.length) return null;
  if (!timingSafeEqual(expected, supplied)) return null;

  return { sub: cfg.sub, orgId: cfg.org_id, email: cfg.email };
}

export async function issueM2mToken(
  client: ClientIdentity,
): Promise<{ token: string; expiresIn: number }> {
  const { privateKey } = await getKeypair();
  const { ttlSeconds, issuer, audience } = readConfig();

  const token = await new SignJWT({
    org_id: client.orgId,
    email: client.email,
  })
    .setProtectedHeader({ alg: "RS256", kid: LOCAL_KID })
    .setSubject(client.sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(privateKey);

  return { token, expiresIn: ttlSeconds };
}

export async function verifyM2mToken(token: string): Promise<JWTPayload> {
  const { publicKey } = await getKeypair();
  const { issuer, audience } = readConfig();
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ["RS256"],
    issuer,
    audience,
  });
  return payload;
}

export function isM2mToken(token: string): boolean {
  if (!token || typeof token !== "string") return false;
  try {
    const header = decodeProtectedHeader(token);
    return header.kid === LOCAL_KID;
  } catch {
    return false;
  }
}

/**
 * Test-only helper: clears the cached clients map and the shared
 * keypair. With `AUTH_PROXY_KEYPAIR_PATH` set the next `getKeypair()`
 * reloads the same keypair from disk — simulating a process restart
 * with persistence. Without it the next call regenerates a fresh
 * keypair, simulating a restart on an unconfigured deployment.
 */
export function _resetForTests(): void {
  cachedClients = null;
  _resetKeypairForTests();
}
