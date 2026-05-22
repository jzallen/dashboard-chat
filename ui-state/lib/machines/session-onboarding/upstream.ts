// session-onboarding/upstream.ts — the external-service request layer for the
// OnboardSession aggregate (ADR-041). Houses every actor RESOLVER that performs
// network I/O (WorkOS re-verify, the backend org SSOT, and org-create/reissue)
// plus the I/O contracts they exchange with the machine. machine.ts imports the
// resolvers to wire them as config-driven default actors; this file imports
// NOTHING from machine.ts (one-way dependency — no cycle).
//
// Config-agnostic by design: every resolver reads its URLs from `input.config`
// and performs network I/O through `input.deps.request_client` (= the `fetch`
// library), both threaded composition root → machine input → context → invoke
// input. Tests inject a mock `fetch` as `request_client`.

import type { Config } from "../../../config.ts";

/**
 * The I/O port for this machine's network side-effects: literally the `fetch`
 * function (NOT a custom wrapper interface). Injected via `input.deps.request_client`
 * — threaded the SAME PATH `config` takes (composition root → BeginFlowInput.deps
 * → machine input → context → invoke `input:` mapper → actor input → resolver).
 * Resolvers call `request_client(url, init)` directly. The local alias documents
 * the surface without inventing a new abstraction over `fetch`.
 */
export type RequestClient = typeof fetch;

/** The injected I/O port bundle. Mirrors `config`'s `Config | null` nullable +
 *  fail-fast pattern: null in tests that stub the actor; resolvers fail fast
 *  with a clear message when `request_client` is absent. */
export interface SessionOnboardingDeps {
  request_client: RequestClient;
}

/**
 * The verified-user IDENTITY returned by the WorkOS `/oauth/userinfo`
 * re-verification call (L5) — identity ONLY (email + display_name). Real WorkOS
 * `/oauth/userinfo` carries no app-level org binding; the org is sourced
 * separately from the backend (the org SSOT, `GET /api/orgs/me`).
 */
export interface WorkOSProfile {
  email: string;
  display_name: string;
}

/**
 * The combined verified session the `verifying` step resolves: the WorkOS
 * identity PLUS the user's org as reported by the backend (`GET /api/orgs/me`),
 * the org SSOT — `null` when the user has no org yet (new user). The `[hasOrg]`
 * guard reads `org` off this done-event output; the verified `X-Org-Id` header
 * is demoted to an audit field at the route boundary (it is a cached JWT claim,
 * not the authoritative org state).
 */
export interface VerifiedSession {
  email: string;
  display_name: string;
  org: { id: string; name: string } | null;
}

/**
 * Input for the `verifying` resolvers (`getWorkOSUserInfo` re-verify +
 * `getUserOrg` backend org lookup). The forwarded Bearer (L4) re-verifies
 * identity; `config`/`deps` carry the WorkOS + backend URLs and the `fetch` I/O
 * port; `correlation_id` traces the backend call. Threaded router → machine
 * input → context → invoke input. NEVER a client body claim. `config`/`deps` are
 * null only in tests that stub the actor (the stub ignores them).
 */
export interface LoadSessionInput {
  bearer_token: string;
  correlation_id: string;
  config: Config | null;
  deps: SessionOnboardingDeps | null;
}

export interface CreateOrgAndReissueInput {
  org_name: string;
  principal_id: string;
  correlation_id: string;
  attempt: number;
  /** Env config (provides `backendUrl` + the dev-user header fixture) threaded
   *  composition root → machine input → context → invoke input so the
   *  `getOrgAndReissue` resolver stays config-agnostic — no factory closure.
   *  Null only when the machine is created without config (the resolver then
   *  throws a clear "config missing" error). */
  config: Config | null;
  /** The I/O port (the `fetch` library) the resolver passes into `createOrgFn`
   *  + `reissueOrgJwtFn`. Threaded the same path as `config`. Null only in tests
   *  that stub `createOrgAndReissue` (the resolver then throws a clear
   *  "request_client missing" error). */
  deps: SessionOnboardingDeps | null;
  /** Failure-simulation budget (ADR-035): when set, `getOrgAndReissue` throws a
   *  partial-setup error for attempts 1..N (org is ALWAYS created first, so the
   *  "org row exists even when reissue fails" invariant holds), then succeeds.
   *  Folds the old closure-counter harness into a stateless attempt-vs-budget
   *  check. Null/0/absent ⇒ no forced failures. */
  force_reissue_failures?: number | null;
}

export interface CreateOrgAndReissueOutput {
  org_id: string;
  org_name: string;
}

/**
 * Re-verify the forwarded Bearer against the WorkOS-compatible
 * `/oauth/userinfo` endpoint (L3/L4) and return the verified user IDENTITY.
 *
 * Config-agnostic: `workosUrl` comes from `input.config` and the network GET
 * runs through `input.deps.request_client` (= the `fetch` library), both
 * threaded composition root → machine input → context → invoke input. Tests
 * inject a mock `fetch` as `request_client`. Identity comes from the verified
 * token (the `Authorization: Bearer` auth-proxy forwards), NEVER a client body
 * claim. Returns IDENTITY ONLY — the org is loaded separately by `getUserOrg`.
 */
export async function getWorkOSUserInfo({
  input,
}: {
  input: LoadSessionInput;
}): Promise<WorkOSProfile> {
  if (!input.config) {
    throw new Error(
      "session-onboarding: workos config missing from re-verify input",
    );
  }
  if (!input.deps?.request_client) {
    throw new Error(
      "session-onboarding: request_client missing from re-verify input",
    );
  }
  const { workosUrl } = input.config;
  const requestClient = input.deps.request_client;
  const userResp = await requestClient(`${workosUrl}/oauth/userinfo`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${input.bearer_token}`,
    },
  });
  if (!userResp.ok) {
    throw new Error(`workos userinfo failed: ${userResp.status}`);
  }
  const profile = (await userResp.json()) as {
    email?: string;
    name?: string;
  };
  if (!profile.email) {
    throw new Error("workos profile missing email");
  }
  return {
    email: profile.email,
    display_name: profile.name ?? "",
  };
}

/**
 * Load the user's org from the backend (`GET /api/orgs/me`) — the org SSOT.
 * Returns `{ id, name }` for a returning user (200) or `null` when the user has
 * no org yet (404, new user). This is why the `[hasOrg]` decision is
 * authoritative + carries the real org NAME, rather than trusting the cached
 * `X-Org-Id` JWT claim. Config-agnostic: `backendUrl` + the identity header
 * fixture come from `input.config`, the call runs through
 * `input.deps.request_client` (same auth/header shape `createOrgFn` uses for the
 * idempotent fallback). Non-200/404 statuses throw so a backend outage surfaces
 * as `session_rejected` rather than silently looking like a new user.
 */
export async function getUserOrg({
  input,
}: {
  input: LoadSessionInput;
}): Promise<{ id: string; name: string } | null> {
  if (!input.config) {
    throw new Error(
      "session-onboarding: backend config missing from org-lookup input",
    );
  }
  if (!input.deps?.request_client) {
    throw new Error(
      "session-onboarding: request_client missing from org-lookup input",
    );
  }
  const { backendUrl, devUserHeadersFixture } = input.config;
  const resp = await input.deps.request_client(`${backendUrl}/api/orgs/me`, {
    method: "GET",
    headers: {
      "x-correlation-id": input.correlation_id,
      ...devUserHeadersFixture,
    },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`org lookup failed: ${resp.status}`);
  }
  const body = (await resp.json()) as {
    id?: string;
    name?: string;
    data?: { id?: string; attributes?: { name?: string } };
  };
  const id = body.id ?? body.data?.id ?? "";
  if (!id) return null;
  const name = body.name ?? body.data?.attributes?.name ?? "";
  return { id, name };
}

/**
 * The `verifying` actor resolver: re-verify identity (WorkOS) AND load the org
 * (backend SSOT) into one combined `VerifiedSession`. The `[hasOrg]` guard reads
 * `org` off this output. A WorkOS 401 (re-verify failure) propagates → the
 * machine lands in `session_rejected`.
 */
export async function loadVerifiedSession({
  input,
}: {
  input: LoadSessionInput;
}): Promise<VerifiedSession> {
  const identity = await getWorkOSUserInfo({ input });
  const org = await getUserOrg({ input });
  return { email: identity.email, display_name: identity.display_name, org };
}

/** A backend org response body — JSON:API (`data.id`/`data.attributes.name`)
 *  or flat (`id`/`org_id`/`name`). */
interface OrgResponseBody {
  id?: string;
  org_id?: string;
  name?: string;
  data?: { id?: string; attributes?: { name?: string } };
}

/** Per-call context the status-rule resolvers need (the factory-closed I/O port
 *  + URL, the per-call headers, and the request input), bundled so the rules
 *  can live at module scope. */
interface CreateOrgContext {
  requestClient: RequestClient;
  backendUrl: string;
  baseHeaders: Record<string, string>;
  input: CreateOrgAndReissueInput;
}

/** Dispatch rule for a `POST /api/orgs` response status. `resolve` either
 *  yields the created org (org_id may be "" → caught by the shared post-check in
 *  createOrgFn) or throws. First matching rule wins (list order = precedence). */
interface CreateOrgStatusRule {
  matches: (status: number) => boolean;
  resolve: (
    resp: Response,
    ctx: CreateOrgContext,
  ) => Promise<{ org_id: string; org_name: string }>;
}

const CREATE_ORG_STATUS_RULES: readonly CreateOrgStatusRule[] = [
  // 201/200 → created. Read the org id/name from the response body.
  {
    matches: (s) => s === 201 || s === 200,
    resolve: async (resp, ctx) => {
      const body = (await resp.json()) as OrgResponseBody;
      return {
        org_id: body.id ?? body.org_id ?? body.data?.id ?? "",
        org_name:
          body.name ?? body.data?.attributes?.name ?? ctx.input.org_name,
      };
    },
  },
  // 409 → globally-duplicate name (org names are globally unique). Tag + throw
  // so the machine maps it to an inline duplicate-name error (needs_org), NOT a
  // retry/error_recoverable.
  {
    matches: (s) => s === 409,
    resolve: async (_resp, ctx) => {
      const err = new Error(
        `org name '${ctx.input.org_name}' is already in use`,
      );
      (err as Error & { name_taken?: boolean }).name_taken = true;
      throw err;
    },
  },
  // 500 → "user already belongs to an organization" (the dev DEV_USER
  // pre-assigned-org quirk): treat as idempotent — fetch the existing org via
  // /api/orgs/me and reuse it. Prefer Maya's submitted name in the projection
  // (the test asserts what she SUBMITTED, not what an upstream provisioner stored).
  {
    matches: (s) => s === 500,
    resolve: async (_resp, ctx) => {
      const meResp = await ctx.requestClient(`${ctx.backendUrl}/api/orgs/me`, {
        method: "GET",
        headers: ctx.baseHeaders,
      });
      if (!meResp.ok) {
        throw new Error(
          `org create failed: 500; /api/orgs/me lookup also failed: ${meResp.status}`,
        );
      }
      const meBody = (await meResp.json()) as OrgResponseBody;
      return {
        org_id: meBody.id ?? meBody.data?.id ?? "",
        org_name: ctx.input.org_name,
      };
    },
  },
];

/**
 * Pure async function form of the org-create step (a POST to `/api/orgs`),
 * exported so the create+reissue resolver can sequence it with the reissue step
 * (and inject forced failures only at reissue). Dispatches on the response
 * status via CREATE_ORG_STATUS_RULES. Network I/O runs through the injected
 * `requestClient` (= the `fetch` library); `backendUrl` is the auth-proxy URL,
 * so the same identity headers flow through (ADR-029).
 */
export function createOrgFn(
  config: Config,
  requestClient: RequestClient,
): (input: CreateOrgAndReissueInput) => Promise<{ org_id: string; org_name: string }> {
  const { backendUrl, devUserHeadersFixture } = config;
  return async (input) => {
      const baseHeaders = {
        "content-type": "application/json",
        "x-correlation-id": input.correlation_id,
        ...devUserHeadersFixture,
      };

      // Create the org, then dispatch on the response status via the ordered
      // rule list (CREATE_ORG_STATUS_RULES). The matched rule yields
      // { org_id, org_name } or throws; an unmatched status is a generic
      // failure. The shared post-check rejects an empty org_id.
      const orgResp = await requestClient(`${backendUrl}/api/orgs`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ name: input.org_name }),
      });
      const rule = CREATE_ORG_STATUS_RULES.find((r) =>
        r.matches(orgResp.status),
      );
      if (!rule) {
        throw new Error(`org create failed: ${orgResp.status}`);
      }
      const created = await rule.resolve(orgResp, {
        requestClient,
        backendUrl,
        baseHeaders,
        input,
      });
      if (!created.org_id) {
        throw new Error("org create returned no org_id");
      }
      return created;
  };
}

/**
 * Pure async function form of the JWT reissue step. Companion to
 * `createOrgFn` — together they form the full create-org-and-reissue
 * sequence. Separated so the harness knob can fail reissue while still
 * letting org-create run, modelling the @jwt_reissue_failed_after_org_create
 * AC semantics.
 */
export function reissueOrgJwtFn(
  config: Config,
  requestClient: RequestClient,
): (input: { org_id: string; correlation_id: string }) => Promise<void> {
  const { backendUrl, devUserHeadersFixture } = config;
  return async ({ org_id, correlation_id }) => {
    const reissueResp = await requestClient(`${backendUrl}/api/auth/reissue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlation_id,
        ...devUserHeadersFixture,
      },
      body: JSON.stringify({ org_id }),
    });
    if (!reissueResp.ok) {
      throw new Error(`reissue failed: ${reissueResp.status}`);
    }
  };
}

/**
 * The config-driven `createOrgAndReissue` actor RESOLVER (an
 * `async ({ input }) => CreateOrgAndReissueOutput`), wrapped once as the
 * machine's default `createOrgAndReissue` actor (`fromPromise(getOrgAndReissue)`).
 * Its env config (`backendUrl` + the dev-user header fixture) arrives on
 * `input.config` — threaded composition root → machine input → context → invoke
 * input — so it stays config-agnostic and the composition root never imports it
 * just to inject env.
 *
 * It folds the forced-failure harness in STATELESSLY via attempt-vs-budget:
 *   1. ALWAYS create the org first (idempotent — preserves the "org row exists
 *      even when reissue fails" invariant; retries hit /api/orgs/me).
 *   2. If `force_reissue_failures` is set AND `attempt <= force_reissue_failures`,
 *      throw a partial-setup error carrying `partial_org = { id, name }` (the
 *      same field `capturePartialOrgFromError` reads), so the machine lands in
 *      error_recoverable / re-enters creating_org with the org.id populated.
 *      (Verified: N=2 → fail,fail,succeed→ready; N=3 → fail,fail,budget-
 *      exhausted→error_recoverable, because reissueBudgetExhausted checks
 *      reissue_attempts_count+1 >= REISSUE_BUDGET (3) pre-increment.)
 *   3. Otherwise reissue the JWT and return the created org.
 */
export async function getOrgAndReissue({
  input,
}: {
  input: CreateOrgAndReissueInput;
}): Promise<CreateOrgAndReissueOutput> {
  if (!input.config) {
    throw new Error(
      "session-onboarding: backend config missing from create-org input",
    );
  }
  if (!input.deps?.request_client) {
    throw new Error(
      "session-onboarding: request_client missing from create-org input",
    );
  }
  const requestClient = input.deps.request_client;
  // ALWAYS create the org first — preserves the "org row exists even when
  // reissue fails" invariant. Idempotent: subsequent retries hit /api/orgs/me
  // and return the same org.
  const created = await createOrgFn(input.config, requestClient)(input);

  if (input.force_reissue_failures && input.attempt <= input.force_reissue_failures) {
    const err = new Error(
      `reissue forced-failure (attempt=${input.attempt}, budget=${input.force_reissue_failures})`,
    );
    // Attach the partial-org marker so capturePartialOrgFromError can read the
    // org.id from context even on the failure path (the "Try again" action then
    // only retries reissue, not org create).
    (err as Error & { partial_org?: { id: string; name: string } }).partial_org = {
      id: created.org_id,
      name: created.org_name,
    };
    throw err;
  }

  await reissueOrgJwtFn(input.config, requestClient)({
    org_id: created.org_id,
    correlation_id: input.correlation_id,
  });
  return created;
}
