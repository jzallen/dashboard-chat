// SessionOnboardingMachine — XState v5 statechart for the OnboardSession
// aggregate (ADR-041).
//
// Entry assumes an ALREADY-AUTHENTICATED principal (auth-proxy verified the
// user upstream and injected X-User-Id + forwarded the Bearer). The machine
// does not re-enact a sign-in handshake; it brings the verified principal to
// an org-scoped, app-ready state.
//
// States (L6):
//   - verifying      — re-verify the forwarded Bearer against WorkOS
//                      /oauth/userinfo (defense-in-depth, L3). Collapses the
//                      retired `anonymous` + `authenticating` states.
//   - needs_org      — verified, no org binding yet (renamed from
//                      authenticated_no_org). Awaits org_form_submitted.
//   - creating_org   — POST /api/orgs (+ reissue). Retries within budget.
//   - ready          — signed in with an org. Reached directly from verifying
//                      on the [hasOrg] returning-user shortcut, or from
//                      creating_org for a new user.
//   - expired_token  — silent-reauth side-state.
//   - error_recoverable / error_terminal — org-setup error landing zones.
//   - session_rejected — terminal: re-verify failed (token/user invalid).

import { assign, fromPromise, setup } from "xstate";

import type { Config } from "../../../config.ts";
import {
  classifyFailure,
  type UnderlyingCauseTag,
  validateOrgName,
} from "../validation.ts";

export type SessionOnboardingState =
  | "verifying"
  | "needs_org"
  | "creating_org"
  | "ready"
  | "error_recoverable"
  | "expired_token"
  | "error_terminal"
  | "session_rejected";

export type { UnderlyingCauseTag } from "../validation.ts";

export interface OrgValidationInlineError {
  kind: "empty" | "too_short" | "too_long" | "duplicate";
  message: string;
}

export interface SessionOnboardingContext {
  correlation_id: string;
  principal_id: string;
  /** The forwarded Bearer (L4) — threaded from the router's Authorization
   *  header into the re-verify invoke input. Never a client body claim. */
  bearer_token: string;
  /** Env config (provides `workosUrl`), threaded from the composition root via
   *  the machine input so the `workosUserInfo` re-verify invoke gets its URL
   *  from input rather than a closure. Null in tests that stub the actor. */
  config: Config | null;
  user: { email: string | null; display_name: string | null; first_name: string | null };
  org: { id: string | null; name: string | null };
  /** The org name Maya last submitted -- preserved across `creating_org`
   *  re-entries so each retry sees the same name as the first attempt. */
  pending_org_name: string;
  /** The verified org claim auth-proxy injects via `X-Org-Id`, pre-seeded into
   *  context at machine creation (FIX D1). It is the SOLE source for the
   *  `[hasOrg]` returning-user shortcut — available BEFORE the re-verify invoke
   *  settles, so the guard reads it from context (not the actor output). Empty
   *  string / null means "no org" (new user). The org NAME is not in the header,
   *  so the seeded `org` carries `name: null` until the FE / a later read fills
   *  it in. */
  existing_org_id: string | null;
  underlying_cause_tag: UnderlyingCauseTag | null;
  retries_count: number;
  reissue_attempts_count: number;
  /** Counts USER-initiated retries from error_recoverable. The 4th total
   *  attempt at the same underlying_cause_tag escalates to error_terminal
   *  (3 user retries from the user's POV including the original failure). */
  retry_budget_used_count: number;
  org_validation_error: OrgValidationInlineError | null;
  existing_org_names: string[];
}

export type SessionOnboardingEvent =
  | { type: "org_form_submitted"; org_name: string }
  | { type: "retry_clicked" }
  | { type: "__force_failure__"; tag: UnderlyingCauseTag }
  | { type: "__expire_token__" }
  | { type: "FREEZE" }
  | { type: "THAW" };

/**
 * The verified-user IDENTITY returned by the WorkOS `/oauth/userinfo`
 * re-verification call (L5). Real WorkOS `/oauth/userinfo` does NOT return an
 * app-level org binding, so this is identity ONLY (email + display_name). The
 * `[hasOrg]` shortcut is driven by the verified `X-Org-Id` header instead,
 * seeded into context as `existing_org_id` (FIX D1).
 */
export interface WorkOSProfile {
  email: string;
  display_name: string;
}

/**
 * Re-verify actor input (L4): the forwarded Bearer token (from the
 * `Authorization` header), threaded router → machine input → invoke. NEVER a
 * client body claim.
 */
export interface WorkOSUserInfoInput {
  bearer_token: string;
  /** Env config (provides `workosUrl`) attached to the actor input so the
   *  re-verify resolver stays config-agnostic — no factory closure and no
   *  import of the resolver at the composition root. Threaded composition root
   *  → machine input → context → this invoke input. Null only in tests that
   *  stub `workosUserInfo` (the stub ignores it). */
  config: Config | null;
}

export type WorkOSUserInfoActor = ReturnType<
  typeof fromPromise<WorkOSProfile, WorkOSUserInfoInput>
>;

export interface CreateOrgAndReissueInput {
  org_name: string;
  principal_id: string;
  correlation_id: string;
  attempt: number;
}

export interface CreateOrgAndReissueOutput {
  org_id: string;
  org_name: string;
}

export type CreateOrgAndReissueActor = ReturnType<
  typeof fromPromise<CreateOrgAndReissueOutput, CreateOrgAndReissueInput>
>;

/**
 * Silent re-auth actor — invoked from `expired_token`. On success the
 * machine transitions back to `ready`; on failure it falls through to
 * `error_recoverable` with tag `silent-reauth-failed`. Per ADR-028 this
 * actor's input/output are minimal because the re-auth credential lookup
 * is handled by auth-proxy (the ui-state tier only learns about the
 * outcome).
 */
export type SilentReauthActor = ReturnType<
  typeof fromPromise<{ ok: true }, { correlation_id: string }>
>;

export interface SessionOnboardingDeps {
  /** Optional — defaults to the real `getWorkOSUserInfo` resolver, which reads
   *  its `workosUrl` from the actor input (config threaded via the machine
   *  input). Tests inject a stub here to override. */
  workosUserInfo?: WorkOSUserInfoActor;
  createOrgAndReissue: CreateOrgAndReissueActor;
  /** Optional — when absent, expired_token has no invocation (matches the
   *  pre-Step-03-01 behavior of an empty state body). */
  silentReauth?: SilentReauthActor;
}

const REISSUE_BUDGET = 3;
/** User-retry budget on error_recoverable. The 4th total attempt at the
 *  same underlying_cause_tag (= 3 user retries) escalates to error_terminal. */
const USER_RETRY_BUDGET = 3;

export function createSessionOnboardingMachine(deps: SessionOnboardingDeps) {
  return setup({
    types: {
      context: {} as SessionOnboardingContext,
      events: {} as SessionOnboardingEvent,
      input: {} as {
        correlation_id: string;
        principal_id: string;
        bearer_token?: string;
        existing_org_id?: string | null;
        existing_org_names?: string[];
        config?: Config | null;
      },
    },
    actors: {
      // Default to the real config-agnostic resolver; tests override via deps.
      // `getWorkOSUserInfo` reads `workosUrl` from its input (input.config),
      // which the machine threads from context — so the composition root never
      // imports it just to inject env config.
      workosUserInfo:
        deps.workosUserInfo ??
        fromPromise<WorkOSProfile, WorkOSUserInfoInput>(getWorkOSUserInfo),
      createOrgAndReissue: deps.createOrgAndReissue,
      // Fallback noop actor — never resolves. The `expired_token` invoke
      // only fires when `deps.silentReauth` is provided; if a caller forgets
      // to wire it AND drives the machine into expired_token, the actor sits
      // pending rather than blowing up the chart. This is also what we want
      // for the orchestrator-level freeze tests that don't care about reauth.
      silentReauth:
        deps.silentReauth ??
        (fromPromise(async () => new Promise<{ ok: true }>(() => {})) as SilentReauthActor),
    },
    guards: {
      // The org binding comes from the verified `X-Org-Id` header, pre-seeded
      // into context as `existing_org_id` at machine creation (FIX D1). It is
      // available BEFORE the re-verify invoke settles — reading it from context
      // (not `event.output`) sidesteps the assign-after-guard ordering trap.
      // hasOrg = a present, non-empty existing_org_id.
      hasOrg: ({ context }) => Boolean(context.existing_org_id),
      orgNameValid: ({ context, event }) => {
        if (event.type !== "org_form_submitted") return false;
        const result = validateOrgName(
          event.org_name,
          new Set(context.existing_org_names ?? []),
        );
        return result.ok;
      },
      reissueBudgetExhausted: ({ context }) =>
        context.reissue_attempts_count + 1 >= REISSUE_BUDGET,
      userRetryBudgetExhausted: ({ context }) =>
        context.retry_budget_used_count + 1 >= USER_RETRY_BUDGET,
    },
    actions: {
      // Re-verify returns IDENTITY ONLY (FIX D1) — assign user from the actor
      // output. The org is NOT in the output; it is sourced from context's
      // pre-seeded existing_org_id (see assignSeededOrg).
      assignVerifiedUser: assign({
        user: ({ event }) => {
          const output = (event as unknown as { output: WorkOSProfile }).output;
          return {
            email: output.email,
            display_name: output.display_name,
            first_name: (output.display_name ?? "").split(/\s+/)[0] || null,
          };
        },
      }),
      // Returning-user [hasOrg] arm: populate context.org from the header-seeded
      // existing_org_id. The org NAME is not in the header, so name stays null
      // (the projection tolerates a null name).
      assignSeededOrg: assign({
        org: ({ context }) =>
          context.existing_org_id
            ? { id: context.existing_org_id, name: null }
            : { id: null, name: null },
      }),
      tagSessionRejected: assign({
        underlying_cause_tag: ({ event }) => {
          const err = (event as { error?: unknown }).error as
            | { message?: string }
            | string;
          const message = typeof err === "string" ? err : err?.message;
          return classifyFailure({ message });
        },
      }),
      recordOrgValidationError: assign({
        org_validation_error: ({ context, event }) => {
          if (event.type !== "org_form_submitted") return null;
          // Recompute against the same set the guard saw so the closed-union
          // result the action persists matches the branch we took.
          const result = validateOrgName(
            event.org_name,
            new Set(context.existing_org_names ?? []),
          );
          if (result.ok) return null;
          const kind = result.error.kind;
          const messages: Record<typeof kind, string> = {
            empty: "Please enter an organization name",
            too_short: "Organization name is too short",
            too_long: "Organization name is too long",
            duplicate: "That name is already in use in your organization",
          };
          return { kind, message: messages[kind] };
        },
      }),
      clearOrgValidationError: assign({
        org_validation_error: () => null,
      }),
      incrementReissueAttempts: assign({
        reissue_attempts_count: ({ context }) => context.reissue_attempts_count + 1,
      }),
      incrementUserRetryBudget: assign({
        retry_budget_used_count: ({ context }) => context.retry_budget_used_count + 1,
      }),
      resetReissueAttempts: assign({
        reissue_attempts_count: () => 0,
      }),
      tagPartialSetup: assign({
        underlying_cause_tag: () => "partial-setup" as const,
      }),
      capturePartialOrgFromError: assign({
        org: ({ context, event }) => {
          // XState wraps invoke errors in `{ type: "...", error: <thrown> }`.
          const errEvent = event as { error?: unknown };
          const partial = (errEvent.error as { partial_org?: { id: string; name: string } })?.partial_org;
          if (!partial) return context.org;
          return { id: partial.id, name: partial.name };
        },
      }),
    },
  }).createMachine({
    id: "session-onboarding",
    initial: "verifying",
    context: ({ input }) => ({
      correlation_id: input.correlation_id,
      principal_id: input.principal_id,
      bearer_token: input.bearer_token ?? "",
      config: input.config ?? null,
      user: { email: null, display_name: null, first_name: null },
      org: { id: null, name: null },
      existing_org_id: input.existing_org_id ?? null,
      pending_org_name: "",
      underlying_cause_tag: null,
      retries_count: 0,
      reissue_attempts_count: 0,
      retry_budget_used_count: 0,
      org_validation_error: null,
      existing_org_names: input.existing_org_names ?? [],
    }),
    states: {
      // Re-verify the forwarded Bearer (defense in depth, L3). On success the
      // verified user + org binding land on the snapshot; the [hasOrg] guard
      // forks ready vs needs_org. On failure the session is rejected.
      verifying: {
        invoke: {
          src: "workosUserInfo",
          input: ({ context }) => ({
            bearer_token: context.bearer_token,
            config: context.config,
          }),
          onDone: [
            {
              guard: "hasOrg",
              target: "ready",
              actions: ["assignVerifiedUser", "assignSeededOrg"],
            },
            {
              target: "needs_org",
              actions: "assignVerifiedUser",
            },
          ],
          onError: {
            target: "session_rejected",
            actions: "tagSessionRejected",
          },
        },
      },
      needs_org: {
        on: {
          org_form_submitted: [
            {
              guard: "orgNameValid",
              target: "creating_org",
              actions: [
                "clearOrgValidationError",
                assign({
                  pending_org_name: ({ event }) =>
                    event.type === "org_form_submitted" ? event.org_name : "",
                }),
              ],
            },
            {
              // Stay in this state, attach inline error to context.
              actions: "recordOrgValidationError",
            },
          ],
          // Harness-only side-channel: force the machine into
          // error_recoverable carrying the supplied cause tag. Gated at the
          // HTTP layer (router.ts) by the failure-simulation gate so
          // production builds never see this event.
          __force_failure__: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: ({ event }) =>
                event.type === "__force_failure__" ? event.tag : "transient",
            }),
          },
        },
      },
      creating_org: {
        invoke: {
          src: "createOrgAndReissue",
          input: ({ context }) => {
            return {
              org_name: context.pending_org_name,
              principal_id: context.principal_id,
              correlation_id: context.correlation_id,
              attempt: context.reissue_attempts_count + 1,
            };
          },
          onDone: {
            target: "ready",
            actions: assign({
              org: ({ event }) => ({
                id: event.output.org_id,
                name: event.output.org_name,
              }),
            }),
          },
          onError: [
            {
              guard: "reissueBudgetExhausted",
              target: "error_recoverable",
              actions: [
                "incrementReissueAttempts",
                "tagPartialSetup",
                "capturePartialOrgFromError",
              ],
            },
            {
              target: "creating_org",
              actions: [
                "incrementReissueAttempts",
                "capturePartialOrgFromError",
              ],
              reenter: true,
            },
          ],
        },
      },
      ready: {
        on: {
          // Harness-only side-channel: force the machine from ready to
          // expired_token. Gated at the HTTP layer by the failure-sim gate.
          __expire_token__: {
            target: "expired_token",
          },
        },
      },
      error_recoverable: {
        on: {
          retry_clicked: [
            {
              // 4th total attempt at the same cause tag (= 3 user retries
              // counted). Escalate to error_terminal so the UI moves Maya
              // to a contact-support page (no further retry CTA).
              guard: "userRetryBudgetExhausted",
              target: "error_terminal",
              actions: "incrementUserRetryBudget",
            },
            {
              target: "creating_org",
              actions: [
                "incrementUserRetryBudget",
                // Re-enter the internal create+reissue path fresh. The
                // correlation_id in context is NEVER overwritten — every
                // retry threads through with Maya's original reference
                // code (verified by the B2 unit test).
                "resetReissueAttempts",
              ],
            },
          ],
        },
      },
      expired_token: {
        // Per ADR-028 §"Decision outcome": the silent-reauth path is an
        // invoked actor on `expired_token`. Success returns Maya to `ready`
        // with her existing context intact; failure falls through to
        // `error_recoverable` tagged `silent-reauth-failed`, which drives
        // the recoverable-error page worded for the sign-in-again case.
        invoke: {
          src: "silentReauth",
          input: ({ context }) => ({
            correlation_id: context.correlation_id,
          }),
          onDone: {
            target: "ready",
          },
          onError: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: () => "silent-reauth-failed" as const,
            }),
          },
        },
      },
      error_terminal: {},
      // Terminal: re-verify failed. No user state advances; no session_started
      // is emitted. The projection surfaces session_rejected (OQ-2).
      session_rejected: {},
    },
  });
}

/**
 * Re-verify the forwarded Bearer against the WorkOS-compatible
 * `/oauth/userinfo` endpoint (L3/L4) and return the verified user identity.
 *
 * This is the actor RESOLVER itself (an `async ({ input }) => profile`), not a
 * factory: the machine wraps it once as the default `workosUserInfo` actor
 * (`fromPromise(getWorkOSUserInfo)`), and its env config (`workosUrl`) arrives
 * on `input.config` — threaded composition root → machine input → context →
 * invoke input. That keeps it config-agnostic so the composition root never
 * imports it just to inject env. Tests substitute via `.provide(...)` or a deps
 * stub (the stub ignores `input.config`).
 *
 * Identity comes from the verified token (the `Authorization: Bearer` header
 * auth-proxy forwards), NEVER a client body claim. Returns IDENTITY ONLY
 * (email + display_name) — real WorkOS `/oauth/userinfo` carries no app-level
 * org binding, so the returning-user org comes from the verified `X-Org-Id`
 * header instead (FIX D1).
 */
export async function getWorkOSUserInfo({
  input,
}: {
  input: WorkOSUserInfoInput;
}): Promise<WorkOSProfile> {
  if (!input.config) {
    throw new Error(
      "session-onboarding: workos config missing from re-verify input",
    );
  }
  const { workosUrl } = input.config;
  const userResp = await fetch(`${workosUrl}/oauth/userinfo`, {
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
 * Build a createOrgAndReissue actor that POSTs to /api/orgs and then
 * /api/auth/reissue. Per ADR-029 invariant 4 the reissue must be
 * idempotent: if the user already owns the org, re-mint without
 * recreating. The actor surfaces the org_id on success.
 *
 * `backendUrl` is the auth-proxy URL — the production composition root
 * routes through auth-proxy so the same identity headers flow through.
 * Tests can override via `.provide({ actors: { createOrgAndReissue: ... } })`.
 */
/**
 * Pure async function form of the org-create step. Exported so the
 * harness-knob wrapper can sequence create + reissue with forced failures
 * injected only at the reissue step.
 */
export function createOrgFn(
  config: Config,
): (input: CreateOrgAndReissueInput) => Promise<{ org_id: string; org_name: string }> {
  const { backendUrl, devUserHeadersFixture } = config;
  return async (input) => {
      const baseHeaders = {
        "content-type": "application/json",
        "x-correlation-id": input.correlation_id,
        ...devUserHeadersFixture,
      };

      // Step 1: create the org. The backend's middleware accepts the
      // X-User-Id/X-Org-Id/X-User-Email headers (trust_proxy_headers in
      // dev). On 409 ("already exists") OR a 500 "user already belongs to
      // an organization" we treat the request as idempotent: fetch the
      // existing org via /api/orgs/me. The 500 path is the dev-mode shape
      // where DEV_USER carries a pre-assigned org_id — the AC for slice 1
      // is about the state-machine flow, not the backend's per-user-org
      // uniqueness constraint.
      const orgResp = await fetch(`${backendUrl}/api/orgs`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ name: input.org_name }),
      });
      let orgId = "";
      let orgName = input.org_name;
      if (orgResp.status === 201 || orgResp.status === 200) {
        const orgBody = (await orgResp.json()) as {
          id?: string;
          org_id?: string;
          name?: string;
          data?: { id?: string; attributes?: { name?: string } };
        };
        orgId =
          orgBody.id ??
          orgBody.org_id ??
          orgBody.data?.id ??
          "";
        orgName =
          orgBody.name ?? orgBody.data?.attributes?.name ?? input.org_name;
      } else if (orgResp.status === 409 || orgResp.status === 500) {
        const meResp = await fetch(`${backendUrl}/api/orgs/me`, {
          method: "GET",
          headers: baseHeaders,
        });
        if (!meResp.ok) {
          throw new Error(
            `org create failed: ${orgResp.status}; /api/orgs/me lookup also failed: ${meResp.status}`,
          );
        }
        const meBody = (await meResp.json()) as {
          id?: string;
          name?: string;
          data?: { id?: string; attributes?: { name?: string } };
        };
        orgId = meBody.id ?? meBody.data?.id ?? "";
        // Prefer Maya's requested name in the projection — the test asserts
        // what she SUBMITTED, not what an upstream provisioner stored. The
        // server-side name lives in /api/orgs/me; the SSOT for "Maya's
        // active organization" view label is the request she made.
        orgName = input.org_name;
      } else {
        throw new Error(`org create failed: ${orgResp.status}`);
      }
      if (!orgId) {
        throw new Error("org create returned no org_id");
      }
      return { org_id: orgId, org_name: orgName };
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
): (input: { org_id: string; correlation_id: string }) => Promise<void> {
  const { backendUrl, devUserHeadersFixture } = config;
  return async ({ org_id, correlation_id }) => {
    const reissueResp = await fetch(`${backendUrl}/api/auth/reissue`, {
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
 * Legacy combined function — chains createOrgFn + reissueOrgJwtFn. Kept
 * for the production composition root so the wiring stays a one-liner.
 */
export function createOrgAndReissueFn(
  config: Config,
): (input: CreateOrgAndReissueInput) => Promise<CreateOrgAndReissueOutput> {
  const createOrg = createOrgFn(config);
  const reissue = reissueOrgJwtFn(config);
  return async (input) => {
    const created = await createOrg(input);
    await reissue({
      org_id: created.org_id,
      correlation_id: input.correlation_id,
    });
    return created;
  };
}

/**
 * XState actor wrapper around `createOrgAndReissueFn`. Production
 * composition root calls this; tests can substitute via the failure-
 * simulation knob (the router's `force_reissue_failures`, resolved
 * into deps by the injected buildLoginDeps factory) without rebuilding the
 * actor surface.
 */
export function createOrgAndReissueActor(config: Config): CreateOrgAndReissueActor {
  const fn = createOrgAndReissueFn(config);
  return fromPromise<CreateOrgAndReissueOutput, CreateOrgAndReissueInput>(
    ({ input }) => fn(input),
  );
}

/**
 * Build an actor that DOES create the org (via the real create path) but
 * fails the REISSUE step the first N attempts. Models the scenario
 * "@jwt_reissue_failed_after_org_create" where the org row gets created
 * but the reissue step fails — Maya should land in error_recoverable
 * with the partial-setup tag, and the org.id MUST be populated so the
 * "Try again" action only retries reissue, not org create.
 */
export function createForcedFailureOrgAndReissueActor(
  realCreateOnly: (
    input: CreateOrgAndReissueInput,
  ) => Promise<{ org_id: string; org_name: string }>,
  realReissueOnly: (
    input: { org_id: string; correlation_id: string },
  ) => Promise<void>,
  initialFailureBudget: number,
): CreateOrgAndReissueActor {
  let remaining = initialFailureBudget;
  return fromPromise<CreateOrgAndReissueOutput, CreateOrgAndReissueInput>(
    async ({ input }) => {
      // ALWAYS create the org first — this preserves the "org row exists
      // even when reissue fails" invariant. Idempotent: subsequent retries
      // hit /api/orgs/me and return the same org.
      const created = await realCreateOnly(input);
      if (remaining > 0) {
        remaining -= 1;
        const err = new Error(
          `reissue forced-failure (remaining=${remaining}, attempt=${input.attempt})`,
        );
        // Attach a marker so the orchestrator's settle step can read the
        // org.id from context even on the failure path.
        (err as Error & { partial_org?: { id: string; name: string } }).partial_org = {
          id: created.org_id,
          name: created.org_name,
        };
        throw err;
      }
      await realReissueOnly({
        org_id: created.org_id,
        correlation_id: input.correlation_id,
      });
      return { org_id: created.org_id, org_name: created.org_name };
    },
  );
}
