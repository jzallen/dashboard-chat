/**
 * Unit tests — `post-response-reissue` hook (Stage 2)
 *
 * Source under test: `auth-proxy/lib/post-response-reissue.ts`.
 *
 * The Stage-2 response-side decision hook. Observes proxied responses; when the
 * inbound request was `POST /api/orgs` AND the response status is 201 AND the
 * body carries an org id, mints a fresh user token with the updated `org_id`
 * claim. Path-and-status-specific by design — generalization to other
 * scope-changing operations is deferred to OQ2 (org-switch, invite-accept,
 * role-change) at N=3+.
 *
 * Integration-level coverage (full Hono app + the R7 smuggle invariant) lives in
 * `auth-proxy/org-create-reissue.test.ts`. This file is the pure-module tier:
 * `mintUserToken` is injected so no app/keypair is spun up.
 */

import { describe, expect, it, vi } from "vitest";

import {
  computeOrgCreateReissue,
  extractOrgId,
  isOrgCreateReissueTrigger,
  type ReissueBaseClaims,
} from "./post-response-reissue.ts";
import type { IssuedUserToken, UserTokenClaims } from "./user-token.ts";

const BASE: ReissueBaseClaims = {
  sub: "u-1",
  email: "a@b.example",
  name: "Ada",
  sid: "s-1",
};

/** Capturing mint stub: records the claims it was asked to sign. */
function makeMint() {
  const calls: UserTokenClaims[] = [];
  const mint = vi.fn(async (claims: UserTokenClaims): Promise<IssuedUserToken> => {
    calls.push(claims);
    return { token: `minted(${claims.org_id})`, expiresIn: 3600 };
  });
  return { mint, calls };
}

describe("isOrgCreateReissueTrigger", () => {
  it("is true only for POST /api/orgs with a 201", () => {
    expect(isOrgCreateReissueTrigger("POST", "/api/orgs", 201)).toBe(true);
  });

  it("is false for non-201 statuses", () => {
    expect(isOrgCreateReissueTrigger("POST", "/api/orgs", 200)).toBe(false);
    expect(isOrgCreateReissueTrigger("POST", "/api/orgs", 400)).toBe(false);
    expect(isOrgCreateReissueTrigger("POST", "/api/orgs", 409)).toBe(false);
    expect(isOrgCreateReissueTrigger("POST", "/api/orgs", 500)).toBe(false);
  });

  it("is false for GET /api/orgs and for other methods", () => {
    expect(isOrgCreateReissueTrigger("GET", "/api/orgs", 201)).toBe(false);
    expect(isOrgCreateReissueTrigger("PUT", "/api/orgs", 201)).toBe(false);
  });

  it("is false for other paths", () => {
    expect(isOrgCreateReissueTrigger("POST", "/api/projects", 201)).toBe(false);
    expect(isOrgCreateReissueTrigger("POST", "/api/orgs/abc/members", 201)).toBe(
      false,
    );
  });
});

describe("extractOrgId", () => {
  it("reads a flat { id } body", () => {
    expect(extractOrgId({ id: "org-1", name: "Acme" })).toBe("org-1");
  });

  it("reads an { org_id } body", () => {
    expect(extractOrgId({ org_id: "org-2" })).toBe("org-2");
  });

  it("reads a JSON:API { data: { id } } body", () => {
    expect(
      extractOrgId({ data: { id: "org-3", attributes: { name: "Acme" } } }),
    ).toBe("org-3");
  });

  it("returns null when no id is present", () => {
    expect(extractOrgId({ name: "Acme" })).toBeNull();
  });

  it("returns null for non-object bodies", () => {
    expect(extractOrgId(null)).toBeNull();
    expect(extractOrgId("not-json")).toBeNull();
    expect(extractOrgId(undefined)).toBeNull();
  });
});

describe("computeOrgCreateReissue", () => {
  it("mints a token carrying the new org_id on POST /api/orgs 201", async () => {
    const { mint, calls } = makeMint();
    const result = await computeOrgCreateReissue(
      {
        method: "POST",
        path: "/api/orgs",
        status: 201,
        body: { id: "org-new", name: "Acme" },
        baseClaims: BASE,
      },
      mint,
    );

    expect(result).not.toBeNull();
    expect(result!.token).toBe("minted(org-new)");
    expect(result!.expiresIn).toBe(3600);
    expect(calls).toHaveLength(1);
    expect(calls[0].org_id).toBe("org-new");
  });

  it("preserves sub/email/sid/name and changes only org_id", async () => {
    const { mint, calls } = makeMint();
    await computeOrgCreateReissue(
      {
        method: "POST",
        path: "/api/orgs",
        status: 201,
        body: { id: "org-new" },
        baseClaims: BASE,
      },
      mint,
    );

    expect(calls[0]).toEqual({
      sub: "u-1",
      email: "a@b.example",
      name: "Ada",
      sid: "s-1",
      org_id: "org-new",
    });
  });

  it("does NOT mint on a non-201 org-create response", async () => {
    const { mint } = makeMint();
    for (const status of [400, 409, 500]) {
      const result = await computeOrgCreateReissue(
        {
          method: "POST",
          path: "/api/orgs",
          status,
          body: { id: "org-new" },
          baseClaims: BASE,
        },
        mint,
      );
      expect(result).toBeNull();
    }
    expect(mint).not.toHaveBeenCalled();
  });

  it("does NOT mint on a different path", async () => {
    const { mint } = makeMint();
    const result = await computeOrgCreateReissue(
      {
        method: "POST",
        path: "/api/projects",
        status: 201,
        body: { id: "proj-1" },
        baseClaims: BASE,
      },
      mint,
    );
    expect(result).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });

  it("does NOT mint when the body carries no org id", async () => {
    const { mint } = makeMint();
    const result = await computeOrgCreateReissue(
      {
        method: "POST",
        path: "/api/orgs",
        status: 201,
        body: { name: "Acme" },
        baseClaims: BASE,
      },
      mint,
    );
    expect(result).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });

  it("does NOT mint when the body is unparseable", async () => {
    const { mint } = makeMint();
    const result = await computeOrgCreateReissue(
      {
        method: "POST",
        path: "/api/orgs",
        status: 201,
        body: null,
        baseClaims: BASE,
      },
      mint,
    );
    expect(result).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });

  it("does NOT mint for an anonymous / non-user caller (no preservable sid)", async () => {
    const { mint } = makeMint();
    const result = await computeOrgCreateReissue(
      {
        method: "POST",
        path: "/api/orgs",
        status: 201,
        body: { id: "org-new" },
        baseClaims: null,
      },
      mint,
    );
    expect(result).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });
});
