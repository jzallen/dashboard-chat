/**
 * M2M (machine-to-machine) token issuance and verification for auth-proxy.
 *
 * Implements an OAuth2 client_credentials grant. Auth-proxy generates an
 * RSA keypair at first use; the same keypair signs and verifies M2M tokens.
 * Tokens carry a fixed `kid` so the existing verifyToken path can dispatch
 * to the local verifier (kid match) versus the remote JWKS path.
 *
 * Disabled by default. Enable via M2M_ENABLED=true. Clients are configured
 * via the M2M_CLIENTS env var as a JSON object:
 *   { "<client_id>": { "secret": "...", "sub": "...", "org_id": "...", "email": "..." } }
 *
 * For production: clients should be injected through a secrets manager.
 * Dev-mode parity (A.2) layers a friendlier setup on top of this surface.
 */

import { timingSafeEqual } from "node:crypto";

import {
  decodeProtectedHeader,
  generateKeyPair,
  type JWTPayload,
  jwtVerify,
  SignJWT,
} from "jose";

const LOCAL_KID = "auth-proxy:m2m:1";

interface ClientConfig {
  secret: string;
  sub: string;
  org_id: string;
  email: string;
}

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
  const raw = process.env.M2M_CLIENTS;
  if (!raw) {
    cachedClients = {};
    return cachedClients;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, ClientConfig>;
    if (parsed && typeof parsed === "object") {
      cachedClients = parsed;
      return cachedClients;
    }
  } catch {
    // fallthrough — bad JSON is treated as no clients
  }
  cachedClients = {};
  return cachedClients;
}

let keypairPromise: ReturnType<typeof generateKeyPair> | null = null;

function getKeypair() {
  if (!keypairPromise) {
    keypairPromise = generateKeyPair("RS256");
  }
  return keypairPromise;
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

/** Test-only helper: clears the cached clients map and the module keypair. */
export function _resetForTests(): void {
  cachedClients = null;
  keypairPromise = null;
}
