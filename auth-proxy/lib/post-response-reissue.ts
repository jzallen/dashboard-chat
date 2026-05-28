/**
 * Org-create response-header reissue hook — RED scaffold (created by DISTILL).
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
 * Replaced by the real implementation in DELIVER. While this scaffold is in
 * place the runtime functions throw so the Stage-2 unit suite is RED (not
 * BROKEN): see `auth-proxy/lib/post-response-reissue.test.ts`.
 */

export const __SCAFFOLD__ = true;

import type { IssuedUserToken, UserTokenClaims } from "./user-token.ts";

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

export function isOrgCreateReissueTrigger(
  _method: string,
  _path: string,
  _status: number,
): boolean {
  throw new Error("Not yet implemented — RED scaffold");
}

export function extractOrgId(_body: unknown): string | null {
  throw new Error("Not yet implemented — RED scaffold");
}

export async function computeOrgCreateReissue(
  _input: OrgCreateReissueInput,
  _mint?: (claims: UserTokenClaims) => Promise<IssuedUserToken>,
): Promise<OrgCreateReissue | null> {
  throw new Error("Not yet implemented — RED scaffold");
}
