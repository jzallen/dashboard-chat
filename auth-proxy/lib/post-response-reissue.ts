/**
 * Org-create response-header reissue hook.
 *
 * Stage 2 of the auth-proxy-mints-user-tokens feature
 * (`docs/feature/auth-proxy-mints-user-tokens/design/design.md` §3.4 + §Stage 2).
 *
 * When auth-proxy observes `POST /api/orgs` returning 201 with an org id in the
 * body, it mints a fresh user token whose `org_id` claim matches the just-created
 * org and attaches it to the response as `X-New-Access-Token` (+
 * `X-New-Token-Expires-In`). The hook is deliberately path-and-status-specific —
 * generalizing to other scope-changing operations (org-switch, invite-accept,
 * role-change) is deferred to OQ2 at N=3+.
 *
 * The mint rides the EXISTING keypair path (`mintUserToken` → `getKeypair()` /
 * `jose`); no second signing path is introduced. Non-org claims (`sub`, `email`,
 * `name`, `sid`) are preserved from the caller's verified token; only `org_id`
 * changes.
 */

import { type IssuedUserToken, mintUserToken, type UserTokenClaims } from "./user-token.ts";

/** Identity claims preserved across the reissue (everything but `org_id`). */
export interface ReissueBaseClaims {
  sub: string;
  email: string;
  name: string;
  sid: string;
}

export interface OrgCreateReissueInput {
  method: string;
  path: string;
  status: number;
  /** Parsed upstream response body, or null/undefined when unparseable. */
  body: unknown;
  /** Inbound user-token claims, or null for anonymous / non-user callers. */
  baseClaims: ReissueBaseClaims | null;
}

export interface OrgCreateReissue {
  token: string;
  expiresIn: number;
}

const ORG_CREATE_PATH = "/api/orgs";

/**
 * True only for the exact org-create success signal: `POST /api/orgs` → 201.
 * A 200/4xx/5xx, a GET, or any other path does NOT trigger the reissue.
 */
export function isOrgCreateReissueTrigger(
  method: string,
  path: string,
  status: number,
): boolean {
  return (
    method.toUpperCase() === "POST" &&
    pathname(path) === ORG_CREATE_PATH &&
    status === 201
  );
}

/**
 * Pull the new org id out of the create response. Handles both the flat
 * (`{ id }` / `{ org_id }`) and JSON:API (`{ data: { id } }`) body shapes the
 * backend can emit. Returns null when no usable id is present.
 */
export function extractOrgId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    id?: unknown;
    org_id?: unknown;
    data?: { id?: unknown };
  };
  const id = b.id ?? b.org_id ?? b.data?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Decide whether to reissue and, if so, mint the fresh token. Returns null
 * when the hook does not fire (wrong path/method/status, no org id in the body,
 * or no preservable caller identity). `mint` is injectable for unit testing;
 * it defaults to the real `mintUserToken` (itself pure — it signs via the
 * shared keypair).
 */
export async function computeOrgCreateReissue(
  input: OrgCreateReissueInput,
  mint: (claims: UserTokenClaims) => Promise<IssuedUserToken> = mintUserToken,
): Promise<OrgCreateReissue | null> {
  if (!isOrgCreateReissueTrigger(input.method, input.path, input.status)) {
    return null;
  }
  if (!input.baseClaims) return null;
  const orgId = extractOrgId(input.body);
  if (!orgId) return null;

  const { token, expiresIn } = await mint({
    sub: input.baseClaims.sub,
    email: input.baseClaims.email,
    name: input.baseClaims.name,
    org_id: orgId,
    sid: input.baseClaims.sid,
  });
  return { token, expiresIn };
}

/** Strip any query/fragment so path matching is exact. */
function pathname(path: string): string {
  const q = path.search(/[?#]/);
  return q === -1 ? path : path.slice(0, q);
}
