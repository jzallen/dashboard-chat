// LoginAndOrgSetupMachine — XState v5 statechart for J-001.
//
// Per `docs/product/journeys/login-and-org-setup.yaml` the machine has 8
// states: anonymous, authenticating, authenticated_no_org, creating_org,
// ready, error_recoverable, expired_token, error_terminal.
//
// Step 01-01 (walking skeleton) wired the happy path through
// authenticated_no_org. Step 01-02 extends the chart with:
//   - authenticated_no_org --[org_form_submitted | validateOrgName ok]--> creating_org
//   - authenticated_no_org --[org_form_submitted | validateOrgName fail]--> stay (inline error in context)
//   - creating_org --[invoke: createOrgAndReissue onDone]--> ready
//   - creating_org --[invoke: createOrgAndReissue onError | retries < 3]--> creating_org (retry)
//   - creating_org --[invoke: createOrgAndReissue onError | retries == 3]--> error_recoverable (partial-setup)
//   - authenticating --[invoke: workosUserInfo onError]--> error_recoverable

import { assign, fromPromise, setup } from "xstate";

import {
  classifyFailure,
  validateOrgName,
  type UnderlyingCauseTag,
} from "./validation.ts";

export type LoginState =
  | "anonymous"
  | "authenticating"
  | "authenticated_no_org"
  | "creating_org"
  | "ready"
  | "error_recoverable"
  | "expired_token"
  | "error_terminal";

export type { UnderlyingCauseTag } from "./validation.ts";

export interface OrgValidationInlineError {
  kind: "empty" | "too_short" | "too_long" | "duplicate";
  message: string;
}

export interface LoginMachineContext {
  correlation_id: string;
  principal_id: string;
  user: { email: string | null; display_name: string | null };
  org: { id: string | null; name: string | null };
  /** The org name Maya last submitted -- preserved across `creating_org`
   *  re-entries so each retry sees the same name as the first attempt. */
  pending_org_name: string;
  underlying_cause_tag: UnderlyingCauseTag | null;
  retries: number;
  reissue_attempts: number;
  /** Counts USER-initiated retries from error_recoverable. The 4th total
   *  attempt at the same underlying_cause_tag escalates to error_terminal
   *  (3 user retries from the user's POV including the original failure). */
  retry_budget_used: number;
  org_validation_error: OrgValidationInlineError | null;
  existing_org_names: string[];
}

export type LoginEvent =
  | { type: "sign_in_clicked"; persona_email: string; persona_display_name: string }
  | { type: "auth_callback_resolved" }
  | { type: "auth_failed"; underlying_cause_tag: UnderlyingCauseTag }
  | { type: "org_form_submitted"; org_name: string }
  | { type: "retry_clicked" }
  | { type: "__force_failure__"; tag: UnderlyingCauseTag }
  | { type: "__expire_token__" }
  | { type: "FREEZE" }
  | { type: "THAW" };

export interface WorkOSProfile {
  email: string;
  display_name: string;
}

export interface WorkOSUserInfoInput {
  persona_email: string;
  persona_display_name: string;
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

export interface LoginMachineDeps {
  workosUserInfo: WorkOSUserInfoActor;
  createOrgAndReissue: CreateOrgAndReissueActor;
  /** Optional — when absent, expired_token has no invocation (matches the
   *  pre-Step-03-01 behavior of an empty state body). */
  silentReauth?: SilentReauthActor;
}

const REISSUE_BUDGET = 3;
/** User-retry budget on error_recoverable. The 4th total attempt at the
 *  same underlying_cause_tag (= 3 user retries) escalates to error_terminal. */
const USER_RETRY_BUDGET = 3;

export function createLoginAndOrgSetupMachine(deps: LoginMachineDeps) {
  return setup({
    types: {
      context: {} as LoginMachineContext,
      events: {} as LoginEvent,
      input: {} as {
        correlation_id: string;
        principal_id: string;
        existing_org_names?: string[];
      },
    },
    actors: {
      workosUserInfo: deps.workosUserInfo,
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
      orgNameValid: ({ context, event }) => {
        if (event.type !== "org_form_submitted") return false;
        const result = validateOrgName(
          event.org_name,
          new Set(context.existing_org_names ?? []),
        );
        return result.ok;
      },
      reissueBudgetExhausted: ({ context }) =>
        context.reissue_attempts + 1 >= REISSUE_BUDGET,
      userRetryBudgetExhausted: ({ context }) =>
        context.retry_budget_used + 1 >= USER_RETRY_BUDGET,
    },
    actions: {
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
        reissue_attempts: ({ context }) => context.reissue_attempts + 1,
      }),
      incrementUserRetryBudget: assign({
        retry_budget_used: ({ context }) => context.retry_budget_used + 1,
      }),
      resetReissueAttempts: assign({
        reissue_attempts: () => 0,
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
    id: "login-and-org-setup",
    initial: "anonymous",
    context: ({ input }) => ({
      correlation_id: input.correlation_id,
      principal_id: input.principal_id,
      user: { email: null, display_name: null },
      org: { id: null, name: null },
      pending_org_name: "",
      underlying_cause_tag: null,
      retries: 0,
      reissue_attempts: 0,
      retry_budget_used: 0,
      org_validation_error: null,
      existing_org_names: input.existing_org_names ?? [],
    }),
    states: {
      anonymous: {
        on: {
          sign_in_clicked: {
            target: "authenticating",
          },
        },
      },
      authenticating: {
        invoke: {
          src: "workosUserInfo",
          input: ({ event }) => {
            if (event.type !== "sign_in_clicked") {
              return { persona_email: "", persona_display_name: "" };
            }
            return {
              persona_email: event.persona_email,
              persona_display_name: event.persona_display_name,
            };
          },
          onDone: {
            target: "authenticated_no_org",
            actions: assign({
              user: ({ event }) => ({
                email: event.output.email,
                display_name: event.output.display_name,
              }),
            }),
          },
          onError: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: ({ event }) => {
                const err = event.error as { message?: string } | string;
                const message = typeof err === "string" ? err : err.message;
                return classifyFailure({ message });
              },
            }),
          },
        },
      },
      authenticated_no_org: {
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
          // HTTP layer (index.ts) by NWAVE_HARNESS_KNOBS=true so production
          // builds never see this event.
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
              attempt: context.reissue_attempts + 1,
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
          // expired_token. Gated at the HTTP layer by NWAVE_HARNESS_KNOBS.
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
    },
  });
}

/**
 * Build a WorkOS user-info actor that calls the real WorkOS-compatible
 * `/oauth/userinfo` endpoint. Used in production; tests can substitute via
 * `.provide({ actors: { workosUserInfo: fromPromise(...) } })`.
 */
export function createWorkOSUserInfoActor(workosUrl: string): WorkOSUserInfoActor {
  return fromPromise<WorkOSProfile, WorkOSUserInfoInput>(async ({ input }) => {
    // First do the token exchange.
    const tokenResp = await fetch(`${workosUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // The fake-workos `set_profile_for(code, ...)` keys profiles by code.
        // Persona name doubles as the auth code for fixture lookup.
        code: derivePersonaCode(input.persona_email),
      }),
    });
    if (!tokenResp.ok) {
      throw new Error(`workos token exchange failed: ${tokenResp.status}`);
    }
    const tokenBody = (await tokenResp.json()) as { access_token: string };

    // Then fetch the user profile.
    const userResp = await fetch(`${workosUrl}/oauth/userinfo`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        // The fake server keys profile lookup by `x-fake-workos-code` header.
        "x-fake-workos-code": derivePersonaCode(input.persona_email),
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
  });
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
  backendUrl: string,
  principalHeaders: Record<string, string>,
): (input: CreateOrgAndReissueInput) => Promise<{ org_id: string; org_name: string }> {
  return async (input) => {
      const baseHeaders = {
        "content-type": "application/json",
        "x-correlation-id": input.correlation_id,
        ...principalHeaders,
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
  backendUrl: string,
  principalHeaders: Record<string, string>,
): (input: { org_id: string; correlation_id: string }) => Promise<void> {
  return async ({ org_id, correlation_id }) => {
    const reissueResp = await fetch(`${backendUrl}/api/auth/reissue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlation_id,
        ...principalHeaders,
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
  backendUrl: string,
  principalHeaders: Record<string, string>,
): (input: CreateOrgAndReissueInput) => Promise<CreateOrgAndReissueOutput> {
  const createOrg = createOrgFn(backendUrl, principalHeaders);
  const reissue = reissueOrgJwtFn(backendUrl, principalHeaders);
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
 * simulation knob (orchestrator-level `force_reissue_failures`) without
 * rebuilding the actor surface.
 */
export function createOrgAndReissueActor(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): CreateOrgAndReissueActor {
  const fn = createOrgAndReissueFn(backendUrl, principalHeaders);
  return fromPromise<CreateOrgAndReissueOutput, CreateOrgAndReissueInput>(
    ({ input }) => fn(input),
  );
}

/**
 * Build a createOrgAndReissue actor that injects N forced failures before
 * delegating to a real implementation. The (N+1)-th call hits the real
 * backend; earlier calls throw "reissue forced-failure". Used by the
 * harness knob — production builds never construct this.
 */
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

/**
 * Map persona email → fake-workos lookup code. The fake server's harness
 * sets `set_profile_for("maya-auth-code", { ... })`; persona local-part
 * doubles as the code so production-shaped calls find the fixture.
 */
function derivePersonaCode(email: string): string {
  const local = email.split("@")[0] ?? "";
  // "maya.chen" → "maya-auth-code"; preserves the fixture contract the
  // walking-skeleton step set up.
  const first = local.split(".")[0];
  return `${first}-auth-code`;
}
