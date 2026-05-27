/**
 * User-token issuance for auth-proxy.
 *
 * Mints RS256 JWTs signed with the shared auth-proxy keypair
 * (`lib/keypair.ts`) and tagged with `kid=auth-proxy:user:1`, distinct
 * from `auth-proxy:m2m:1` (M2M) and `auth-proxy:pat:1` (PAT). Tokens
 * carry a `sid` claim that resolves into a server-held session entry
 * in `lib/session-store.ts` (OQ1 (b) — see
 * `docs/feature/auth-proxy-mints-user-tokens/design/design.md` §7.1).
 *
 * The FE never sees the WorkOS refresh_token; only this minted token
 * leaves the server. `/api/auth/refresh` uses `sid` to look up the
 * server-side WorkOS refresh material.
 */

import {
  decodeProtectedHeader,
  type JWTPayload,
  jwtVerify,
  SignJWT,
} from "jose";

import { getKeypair } from "./keypair.ts";

const USER_TOKEN_KID = "auth-proxy:user:1";
const DEFAULT_TTL_SECONDS = 3600;

export interface UserTokenClaims {
  sub: string;
  email: string;
  name: string;
  org_id: string;
  sid: string;
}

export interface IssuedUserToken {
  token: string;
  expiresIn: number;
}

interface RuntimeConfig {
  ttlSeconds: number;
  issuer: string;
  audience: string;
}

function readConfig(): RuntimeConfig {
  return {
    ttlSeconds: Math.max(
      1,
      parseInt(process.env.USER_TOKEN_TTL_SECONDS || "", 10) ||
        DEFAULT_TTL_SECONDS,
    ),
    // Issuer/audience match what M2M/PAT use so the verifyToken path
    // can share a single (issuer, audience) tuple across all three
    // local-kid token types.
    issuer: process.env.M2M_ISSUER || "auth-proxy",
    audience:
      process.env.M2M_AUDIENCE ||
      (process.env.AUTH_MODE === "dev"
        ? "dev-client"
        : process.env.WORKOS_CLIENT_ID || ""),
  };
}

export function getUserTokenKid(): string {
  return USER_TOKEN_KID;
}

export async function mintUserToken(
  claims: UserTokenClaims,
): Promise<IssuedUserToken> {
  const { privateKey } = await getKeypair();
  const { ttlSeconds, issuer, audience } = readConfig();

  const token = await new SignJWT({
    email: claims.email,
    name: claims.name,
    org_id: claims.org_id,
    sid: claims.sid,
  })
    .setProtectedHeader({ alg: "RS256", kid: USER_TOKEN_KID })
    .setSubject(claims.sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(privateKey);

  return { token, expiresIn: ttlSeconds };
}

export function isUserToken(token: string): boolean {
  if (!token || typeof token !== "string") return false;
  try {
    return decodeProtectedHeader(token).kid === USER_TOKEN_KID;
  } catch {
    return false;
  }
}

export async function verifyUserToken(token: string): Promise<JWTPayload> {
  const { publicKey } = await getKeypair();
  const { issuer, audience } = readConfig();
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ["RS256"],
    issuer,
    audience,
  });
  return payload;
}

