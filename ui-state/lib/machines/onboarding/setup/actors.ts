// onboarding/setup/actors.ts — the external-service request layer for
// the OnboardSession aggregate. Houses every actor RESOLVER that
// performs network I/O (WorkOS re-verify and the backend org SSOT), the I/O
// contracts they exchange with the machine, the
// `fromPromise`-bound actor-type aliases, and the wired `actors` bundle that
// machine.ts threads straight into `setup({ actors })`. It imports from `xstate`
// and the domain model (./domain.ts) ONLY — never machine.ts or the other setup
// modules (one-way dependency, no cycle): the resolvers speak the domain
// vocabulary (return `VerifiedSession`/`Org`, tag failures via `failWithCause`).
//
// Config-agnostic by design: every resolver reads its URLs from `input.config`
// and performs network I/O through `input.deps.request_client` (= the `fetch`
// library), both threaded composition root → machine input → context → invoke
// input. Tests inject a mock `fetch` as `request_client`.
//
// References:
//   docs/decisions/adr-041-*.md  — session-onboarding domain realignment; config-driven actor injection
//   docs/decisions/adr-043-*.md  — auth-proxy owns token lifecycle (no reissue)
//   docs/decisions/adr-029-*.md  — identity-header propagation

import { fromPromise } from "xstate";

import type {
  Org,
  OrgId,
  OrgName,
  PrincipalId,
  VerifiedSession,
  VerifiedUser,
} from "./domain.ts";
import { failWithCause } from "./domain.ts";

/**
 * The slice of the ui-state env config this package's resolvers actually read —
 * the package's own config contract. Declared locally (not imported from the
 * ui-state root) so the machine and resolvers state exactly the env they depend
 * on. The root `Config` is a structural superset, so the composition root passes
 * it straight in with no cast; `redisUrl` and any future root-only fields stay
 * the composition root's concern, not this package's.
 */
export interface Config {
  /** WorkOS-compatible `/oauth/userinfo` base URL (the re-verify endpoint). */
  workosUrl: string;
  /** Backend base URL the resolvers call on behalf of the principal. */
  backendUrl: string;
  /** Identity headers presented to the backend (dev fixture; M2M in prod). */
  devUserHeadersFixture: Record<string, string>;
}

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
export interface OnboardingDeps {
  request_client: RequestClient;
}

// The verified identity (VerifiedUser), the org binding (Org), and the combined
// VerifiedSession the `verifying` step resolves are the OnboardSession domain
// model — defined in ./domain.ts and imported above. Real WorkOS
// `/oauth/userinfo` carries no app-level org binding; the org is sourced
// separately from the backend (the org SSOT, `GET /api/orgs/me`), and the
// verified `X-Org-Id` header is demoted to an audit field at the route boundary
// (a cached JWT claim, not the authoritative org state).

/**
 * Input for the `verifying` resolvers (`getWorkOSUserInfo` re-verify +
 * `getUserOrg` backend org lookup). The forwarded Bearer (L4) re-verifies
 * identity; `config`/`deps` carry the WorkOS + backend URLs and the `fetch` I/O
 * port; `request_id` traces the backend call. Threaded router → machine
 * input → context → invoke input. NEVER a client body claim. `config`/`deps` are
 * null only in tests that stub the actor (the stub ignores them).
 */
export interface LoadSessionInput {
  bearer_token: string;
  request_id: string;
  config: Config | null;
  deps: OnboardingDeps | null;
}

export interface CreateOrgInput {
  /** The validated org name to create. `OrgName` (branded) makes "this passed
   *  the submission rule" a type fact, threaded from `pending_org_name`. Null
   *  only when the machine is stubbed without a pending name — createOrgFn fails
   *  fast on null, mirroring the config/deps nullable pattern below. */
  org_name: OrgName | null;
  principal_id: PrincipalId;
  request_id: string;
  /** Env config (provides `backendUrl` + the dev-user header fixture) threaded
   *  composition root → machine input → context → invoke input so the `getOrg`
   *  resolver stays config-agnostic — no factory closure. Null only when the
   *  machine is created without config (the resolver then throws a clear
   *  "config missing" error). */
  config: Config | null;
  /** The I/O port (the `fetch` library) the resolver passes into `createOrgFn`.
   *  Threaded the same path as `config`. Null only in tests that stub `createOrg`
   *  (the resolver then throws a clear "request_client missing" error). */
  deps: OnboardingDeps | null;
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
}): Promise<VerifiedUser> {
  if (!input.config) {
    throw new Error(
      "onboarding: workos config missing from re-verify input",
    );
  }
  if (!input.deps?.request_client) {
    throw new Error(
      "onboarding: request_client missing from re-verify input",
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
    // A corrupt WorkOS profile is a KNOWN, non-transient cause — tag it at the
    // seam that detected it. The other throws here (config/deps missing, a
    // userinfo non-200) carry no tag, so `causeOf` defaults them to `transient`.
    throw failWithCause(
      "workos-profile-corrupt",
      "workos profile missing email",
    );
  }
  const display_name = profile.name ?? "";
  return {
    email: profile.email,
    display_name,
    // Derived ONCE here at the parse boundary (was in the assignVerifiedUser
    // action); the VerifiedUser value object carries it from the seam onward.
    first_name: display_name.split(/\s+/)[0] || null,
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
}): Promise<Org | null> {
  if (!input.config) {
    throw new Error(
      "onboarding: backend config missing from org-lookup input",
    );
  }
  if (!input.deps?.request_client) {
    throw new Error(
      "onboarding: request_client missing from org-lookup input",
    );
  }
  const { backendUrl, devUserHeadersFixture } = input.config;
  const resp = await input.deps.request_client(`${backendUrl}/api/orgs/me`, {
    method: "GET",
    headers: {
      "x-request-id": input.request_id,
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
  // Trust-boundary brand: the backend is authoritative for an existing org id.
  return { id: id as OrgId, name };
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
  const user = await getWorkOSUserInfo({ input });
  const org = await getUserOrg({ input });
  return { user, org };
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
  /** The validated name, narrowed non-null by createOrgFn before dispatch. */
  orgName: OrgName;
}

/** Dispatch rule for a `POST /api/orgs` response status. `resolve` either
 *  yields the created org (org_id may be "" → caught by the shared post-check in
 *  createOrgFn) or throws. First matching rule wins (list order = precedence). */
interface CreateOrgStatusRule {
  matches: (status: number) => boolean;
  resolve: (resp: Response, ctx: CreateOrgContext) => Promise<Org>;
}

const CREATE_ORG_STATUS_RULES: readonly CreateOrgStatusRule[] = [
  // 201/200 → created. Read the org id/name from the response body.
  {
    matches: (s) => s === 201 || s === 200,
    resolve: async (resp, ctx) => {
      const body = (await resp.json()) as OrgResponseBody;
      return {
        id: (body.id ?? body.org_id ?? body.data?.id ?? "") as OrgId,
        name: body.name ?? body.data?.attributes?.name ?? ctx.orgName,
      };
    },
  },
  // 409 → globally-duplicate name (org names are globally unique). Tag + throw
  // so the machine maps it to an inline duplicate-name error (needs_org), NOT a
  // retry/error_recoverable.
  {
    matches: (s) => s === 409,
    resolve: async (_resp, ctx) => {
      const err = new Error(`org name '${ctx.orgName}' is already in use`);
      (err as Error & { name_taken?: boolean }).name_taken = true;
      throw err;
    },
  },
  // 500 → "user already belongs to an organization" (the dev DEV_USER
  // pre-assigned-org quirk): treat as idempotent — fetch the existing org via
  // /api/orgs/me and reuse it. Prefer the SUBMITTED name in the projection (the
  // test asserts what was submitted, not what an upstream provisioner stored).
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
        id: (meBody.id ?? meBody.data?.id ?? "") as OrgId,
        name: ctx.orgName,
      };
    },
  },
];

/**
 * Pure async function form of the org-create step (a POST to `/api/orgs`),
 * exported so the `getOrg` resolver can call it. Dispatches on the response
 * status via CREATE_ORG_STATUS_RULES. Network I/O runs through the injected
 * `requestClient` (= the `fetch` library); `backendUrl` is the auth-proxy URL,
 * so the same identity headers flow through. The org-scoped JWT is minted by
 * auth-proxy on the org-create response (X-New-Access-Token); this resolver
 * returns the org directly and does not chain a reissue call.
 */
export function createOrgFn(
  config: Config,
  requestClient: RequestClient,
): (input: CreateOrgInput) => Promise<Org> {
  const { backendUrl, devUserHeadersFixture } = config;
  return async (input) => {
    if (input.org_name === null) {
      throw new Error(
        "onboarding: create-org invoked without a validated org name",
      );
    }
    const orgName = input.org_name;
    const baseHeaders = {
      "content-type": "application/json",
      "x-request-id": input.request_id,
      ...devUserHeadersFixture,
    };

    // Create the org, then dispatch on the response status via the ordered rule
    // list (CREATE_ORG_STATUS_RULES). The matched rule yields an `Org` or
    // throws; an unmatched status is a generic failure. The shared post-check
    // rejects an empty id.
    const orgResp = await requestClient(`${backendUrl}/api/orgs`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ name: orgName }),
    });
    const rule = CREATE_ORG_STATUS_RULES.find((r) => r.matches(orgResp.status));
    if (!rule) {
      throw new Error(`org create failed: ${orgResp.status}`);
    }
    const created = await rule.resolve(orgResp, {
      requestClient,
      backendUrl,
      baseHeaders,
      orgName,
    });
    if (!created.id) {
      throw new Error("org create returned no org_id");
    }
    return created;
  };
}

/**
 * The config-driven `createOrg` actor RESOLVER (an `async ({ input }) => Org`),
 * wrapped once as the machine's default `createOrg` actor
 * (`fromPromise(getOrg)`). Its env config (`backendUrl` + the dev-user header
 * fixture) arrives on `input.config` — threaded composition root → machine
 * input → context → invoke input — so it stays config-agnostic and the
 * composition root never imports it just to inject env.
 *
 * Creates the org and returns it. auth-proxy mints the org-scoped token on the
 * org-create response itself (X-New-Access-Token); onboarding does not
 * participate in token issuance.
 */
export async function getOrg({
  input,
}: {
  input: CreateOrgInput;
}): Promise<Org> {
  if (!input.config) {
    throw new Error(
      "onboarding: backend config missing from create-org input",
    );
  }
  if (!input.deps?.request_client) {
    throw new Error(
      "onboarding: request_client missing from create-org input",
    );
  }
  const requestClient = input.deps.request_client;
  // Idempotent: a 500 "already belongs to an org" is reconciled by createOrgFn
  // via /api/orgs/me, so a re-submission returns the same org.
  return createOrgFn(input.config, requestClient)(input);
}

// Actor-type ALIASES bound to XState's `fromPromise`. They live here, next to
// the resolvers + the `fromPromise` wiring below, rather than in machine.ts —
// the machine references them only via the `actors` bundle.
export type LoadSessionActor = ReturnType<
  typeof fromPromise<VerifiedSession, LoadSessionInput>
>;

export type CreateOrgActor = ReturnType<
  typeof fromPromise<Org, CreateOrgInput>
>;

// The resolvers wrapped once as `fromPromise` actors. These are config-driven
// DEFAULTS: there is no `.provide(...)`; tests drive behavior by injecting a
// mock `fetch` as `deps.request_client`.
const loadSession = fromPromise<VerifiedSession, LoadSessionInput>(
  loadVerifiedSession,
);
const createOrg = fromPromise<Org, CreateOrgInput>(getOrg);

/**
 * The machine's default actor map — name → `fromPromise` actor index. machine.ts
 * threads this straight into `setup({ actors })` so the statechart only names
 * actors (`src: "loadSession"`), never wires them.
 */
export const actors = {
  loadSession,
  createOrg,
};

/**
 * The ProvidedActor union XState derives from `actors` when it types
 * `setup({ actors })`. XState's own `ToProvidedActor` is internal (not exported),
 * so we mirror its shape here — `{ src, logic, id }` per actor — DERIVED from
 * `typeof actors`, so adding/removing an actor updates it automatically. The
 * extracted actions (./actions.ts) pin `assign`'s `TActor` generic to this so
 * the actions bundle is assignable to `setup({ actions })`; without it the
 * actions would carry the generic `ProvidedActor` and the bundle would be
 * rejected. (No children map → `id: string | undefined`, matching XState.)
 */
type ProvidedActorOf<TActors extends Record<string, unknown>> = {
  [K in keyof TActors as K & string]: {
    src: K & string;
    logic: TActors[K];
    id: string | undefined;
  };
}[keyof TActors & string];

export type OnboardingActor = ProvidedActorOf<typeof actors>;
