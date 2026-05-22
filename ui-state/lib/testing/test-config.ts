// Test helpers for the session-onboarding suites.
//
// The fake HTTP server (lib/testing/fake-upstream.ts) was superseded: the
// machine now injects `deps.request_client` (= the `fetch` library) as its I/O
// port, so tests drive the upstream side-effects with a MOCK `fetch` (a
// `vi.fn()` typed as `typeof fetch`) returning canned `Response`s, keyed on the
// request URL/method. No live socket, no ephemeral port.
//
//   - GET  /oauth/userinfo   — WorkOS re-verify. 200 {email,name} for a normal
//                              Bearer; 401 when the Bearer matches `badToken`
//                              (drives session_rejected).
//   - GET  /api/orgs/me      — backend org lookup (the org SSOT, drives [hasOrg]).
//                              200 {id,name} when `existingOrg` is set (returning
//                              user); 404 otherwise (new user → needs_org).
//   - POST /api/orgs         — backend org-create. 201 {id,name}.
//   - POST /api/auth/reissue — backend JWT reissue. 200.
//
// The backend endpoints ALWAYS succeed: the forced-reissue-failure path is
// driven by the `force_reissue_failures` INPUT (the `getOrgAndReissue` resolver
// throws an attempt-vs-budget error), not by the mock failing.

import { vi } from "vitest";

import type { Config } from "../../config.ts";
import type { RequestClient } from "../machines/session-onboarding/index.ts";

export interface MockFetchProfile {
  email: string;
  name: string;
}

export interface MockFetchOptions {
  /** Identity returned by GET /oauth/userinfo for a non-bad Bearer. */
  profile?: MockFetchProfile;
  /** Bearer token value that GET /oauth/userinfo answers with 401. Drives the
   *  session_rejected path. When unset, no token is rejected (but a MISSING
   *  bearer is always 401). */
  badToken?: string;
  /** The user's existing org as the backend SSOT (`GET /api/orgs/me`) reports
   *  it. Set ⇒ returning user (200 → `[hasOrg]` → ready). Null/absent ⇒ new user
   *  (404 → needs_org). */
  existingOrg?: { id: string; name: string } | null;
  /** Org id `POST /api/orgs` echoes back on the new-user create path. */
  orgId?: string;
}

const DEFAULT_PROFILE: MockFetchProfile = {
  email: "maya.chen@acme-data.example",
  name: "Maya Chen",
};

const DEFAULT_ORG_ID = "org-1";

/** Pull the bearer token out of a fetch `init`'s `authorization` header. */
function bearerOf(init?: RequestInit): string {
  const headers = init?.headers;
  let auth = "";
  if (headers instanceof Headers) {
    auth = headers.get("authorization") ?? headers.get("Authorization") ?? "";
  } else if (Array.isArray(headers)) {
    auth =
      headers.find(([k]) => k.toLowerCase() === "authorization")?.[1] ?? "";
  } else if (headers) {
    const record = headers as Record<string, string>;
    auth = record.authorization ?? record.Authorization ?? "";
  }
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1] ?? "";
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a MOCK `fetch` (a `vi.fn()` typed as `typeof fetch`) that canned-responds
 * to the session-onboarding upstream surface, keyed on URL path + method. The
 * placeholder URLs `makeTestConfig` hands the resolvers only need to carry the
 * right PATH suffixes — this mock branches on them.
 */
export function makeMockFetch(options: MockFetchOptions = {}): RequestClient {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const badToken = options.badToken ?? "";
  const orgId = options.orgId ?? DEFAULT_ORG_ID;
  const existingOrg = options.existingOrg ?? null;

  const impl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    // WorkOS re-verify. A missing bearer or the designated bad token → 401, so
    // getWorkOSUserInfo throws and the machine lands in session_rejected.
    if (url.includes("/oauth/userinfo")) {
      const token = bearerOf(init);
      if (!token || (badToken && token === badToken)) {
        return jsonResponse({ error: "invalid_token" }, 401);
      }
      return jsonResponse({ email: profile.email, name: profile.name }, 200);
    }

    // Backend org-lookup (the org SSOT, drives [hasOrg]). Returning user → 200
    // {id,name}; new user → 404 (→ needs_org).
    if (url.includes("/api/orgs/me") && method === "GET") {
      return existingOrg
        ? jsonResponse({ id: existingOrg.id, name: existingOrg.name }, 200)
        : jsonResponse({ error: "no_org" }, 404);
    }
    // Backend org-create — ALWAYS succeeds. Echo the submitted name so the
    // projection asserts what Maya submitted.
    if (url.includes("/api/orgs") && method === "POST") {
      const body = init?.body
        ? (JSON.parse(init.body as string) as { name?: string })
        : {};
      return jsonResponse({ id: orgId, name: body.name ?? "" }, 201);
    }

    // Backend JWT reissue — ALWAYS succeeds. The forced-failure path is driven
    // by force_reissue_failures, not by this endpoint failing.
    if (url.includes("/api/auth/reissue") && method === "POST") {
      return jsonResponse({ ok: true }, 200);
    }

    return jsonResponse({ error: "unexpected_request", url, method }, 404);
  };

  return vi.fn(impl) as unknown as RequestClient;
}

/**
 * Build a Config with placeholder workosUrl/backendUrl. The values only need to
 * carry the path suffixes the resolvers append — the injected mock `fetch`
 * branches on those paths and decides the responses, so the host is arbitrary.
 * Mirrors the production Config shape (dev-user header fixture, no Redis ⇒ the
 * noop event log).
 */
export function makeTestConfig(baseUrl = "http://upstream.test"): Config {
  return {
    workosUrl: baseUrl,
    backendUrl: baseUrl,
    redisUrl: undefined,
    devUserHeadersFixture: {
      "x-user-id": "dev-user-001",
      "x-org-id": "dev-org-001",
      "x-user-email": "dev@localhost",
    },
  };
}
