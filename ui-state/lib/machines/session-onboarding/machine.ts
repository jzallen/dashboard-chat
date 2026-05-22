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
//   - error_recoverable / error_terminal — org-setup error landing zones.
//   - session_rejected — terminal: re-verify failed (token/user invalid).

import { assign, fromPromise, setup } from "xstate";

import {
  classifyFailure,
  type UnderlyingCauseTag,
  validateOrgName,
} from "../validation.ts";
// The external-service request layer (WorkOS re-verify + backend org SSOT +
// org-create/reissue) and the I/O contracts those resolvers exchange with this
// machine live in ./upstream.ts. machine.ts wires the resolvers as config-driven
// default actors; the dependency is one-way (upstream.ts imports nothing here).
// `Config` comes from there too — the machine only threads it opaquely to the
// resolvers, so it references the package boundary type, not the ui-state root.
import {
  type Config,
  type CreateOrgAndReissueInput,
  type CreateOrgAndReissueOutput,
  getOrgAndReissue,
  type LoadSessionInput,
  loadVerifiedSession,
  type SessionOnboardingDeps,
  type VerifiedSession,
} from "./upstream.ts";

export type SessionOnboardingState =
  | "verifying"
  | "needs_org"
  | "creating_org"
  | "ready"
  | "error_recoverable"
  | "error_terminal"
  | "session_rejected";

export type { UnderlyingCauseTag } from "../validation.ts";

export interface OrgValidationInlineError {
  kind: "empty" | "too_short" | "too_long" | "duplicate";
  message: string;
}

/**
 * The immutable envelope injected at begin (= the machine input, normalized).
 * Written once by the context factory and NEVER reassigned; it lives in context
 * only because the invoke `input:` mappers + guards can read `context` but not
 * the actor's spawn `input`, and the input-driven (no-closure) actor design
 * means `config`/`deps` must reach the resolvers this way.
 */
export interface SessionOnboardingParams {
  correlation_id: string;
  principal_id: string;
  /** The forwarded Bearer (L4) — from the router's Authorization header into the
   *  re-verify invoke input. Never a client body claim. */
  bearer_token: string;
  /** Env config (`workosUrl` + `backendUrl`) the `loadSession` resolver reads
   *  from input rather than a closure. Null in tests that stub the actor. */
  config: Config | null;
  /** The I/O port (the `fetch` library) the resolvers call directly. Mirrors
   *  `config`'s nullable + fail-fast pattern — null in tests that stub the actor. */
  deps: SessionOnboardingDeps | null;
  /** Failure-simulation budget the `creating_org` invoke input passes to
   *  `getOrgAndReissue` (stateless attempt-vs-budget). Null ⇒ no forced failures. */
  force_reissue_failures: number | null;
}

export interface SessionOnboardingContext {
  /** Write-once injected envelope — see SessionOnboardingParams. */
  params: SessionOnboardingParams;

  // Outputs — the verified session being assembled.
  user: { email: string | null; display_name: string | null; first_name: string | null };
  org: { id: string | null; name: string | null };

  // Bookkeeping / coordination state.
  /** The org name Maya last submitted -- preserved across `creating_org`
   *  re-entries so each retry sees the same name as the first attempt. */
  pending_org_name: string;
  underlying_cause_tag: UnderlyingCauseTag | null;
  reissue_attempts_count: number;
  /** Counts USER-initiated retries from error_recoverable. The 4th total
   *  attempt at the same underlying_cause_tag escalates to error_terminal
   *  (3 user retries from the user's POV including the original failure). */
  retry_budget_used_count: number;
  org_validation_error: OrgValidationInlineError | null;
}

export type SessionOnboardingEvent =
  | { type: "org_form_submitted"; org_name: string }
  | { type: "retry_clicked" }
  | { type: "__force_failure__"; tag: UnderlyingCauseTag };

// The actor I/O contracts (WorkOSProfile, VerifiedSession, LoadSessionInput,
// CreateOrgAndReissueInput/Output) are defined in ./upstream.ts alongside the
// resolvers that produce them and imported above. The actor-type ALIASES stay
// here because they are bound to XState's `fromPromise`.
export type LoadSessionActor = ReturnType<
  typeof fromPromise<VerifiedSession, LoadSessionInput>
>;

export type CreateOrgAndReissueActor = ReturnType<
  typeof fromPromise<CreateOrgAndReissueOutput, CreateOrgAndReissueInput>
>;

const REISSUE_BUDGET = 3;
/** User-retry budget on error_recoverable. The 4th total attempt at the
 *  same underlying_cause_tag (= 3 user retries) escalates to error_terminal. */
const USER_RETRY_BUDGET = 3;

/**
 * Build the session-onboarding machine. Takes NO params — every external actor
 * is a config-driven DEFAULT (ADR-041 inversion): `loadSession` (WorkOS
 * re-verify + backend org lookup) and `createOrgAndReissue` are config-agnostic
 * resolvers that read their URLs from the actor input (config threaded
 * composition root → machine input → context → invoke input) and perform their
 * network I/O through the injected `deps.request_client` (= the `fetch`
 * library). There is NO deps-injection mechanism FOR THE ACTOR LOGIC and NO
 * `.provide(...)`: tests drive behavior by injecting a MOCK `fetch` as
 * `deps.request_client` (a `vi.fn()` typed as `typeof fetch` returning canned
 * `Response`s).
 */
export function createSessionOnboardingMachine() {
  return setup({
    types: {
      context: {} as SessionOnboardingContext,
      events: {} as SessionOnboardingEvent,
      input: {} as {
        correlation_id: string;
        principal_id: string;
        bearer_token?: string;
        config?: Config | null;
        deps?: SessionOnboardingDeps | null;
        force_reissue_failures?: number | null;
      },
    },
    actors: {
      loadSession: fromPromise<VerifiedSession, LoadSessionInput>(
        loadVerifiedSession,
      ),
      createOrgAndReissue: fromPromise<
        CreateOrgAndReissueOutput,
        CreateOrgAndReissueInput
      >(getOrgAndReissue),
    },
    guards: {
      hasOrg: ({ event }) =>
        Boolean((event as { output?: VerifiedSession }).output?.org?.id),
      isOrgNameValid: ({ event }) => {
        if (event.type !== "org_form_submitted") return false;
        return validateOrgName(event.org_name).ok;
      },
      isOrgNameTaken: ({ event }) =>
        Boolean((event as { error?: { name_taken?: boolean } }).error?.name_taken),
      isReissueBudgetExhausted: ({ context }) =>
        context.reissue_attempts_count + 1 >= REISSUE_BUDGET,
      isUserRetryBudgetExhausted: ({ context }) =>
        context.retry_budget_used_count + 1 >= USER_RETRY_BUDGET,
    },
    actions: {
      assignVerifiedUser: assign({
        user: ({ event }) => {
          const output = (event as unknown as { output: VerifiedSession })
            .output;
          return {
            email: output.email,
            display_name: output.display_name,
            first_name: (output.display_name ?? "").split(/\s+/)[0] || null,
          };
        },
      }),
      assignResolvedOrg: assign({
        org: ({ event }) => {
          const org = (event as unknown as { output: VerifiedSession }).output
            .org;
          return org ? { id: org.id, name: org.name } : { id: null, name: null };
        },
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
        org_validation_error: ({ event }) => {
          if (event.type !== "org_form_submitted") return null;
          const result = validateOrgName(event.org_name);
          if (result.ok) return null;
          const kind = result.error.kind;
          const messages: Record<typeof kind, string> = {
            empty: "Please enter an organization name",
            too_short: "Organization name is too short",
            too_long: "Organization name is too long",
          };
          return { kind, message: messages[kind] };
        },
      }),
      recordOrgNameTaken: assign({
        org_validation_error: () => ({
          kind: "duplicate" as const,
          message: "That name is already in use in your organization",
        }),
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
    },
  }).createMachine({
    id: "session-onboarding",
    initial: "verifying",
    context: ({ input }) => ({
      params: {
        correlation_id: input.correlation_id,
        principal_id: input.principal_id,
        bearer_token: input.bearer_token ?? "",
        config: input.config ?? null,
        deps: input.deps ?? null,
        force_reissue_failures: input.force_reissue_failures ?? null,
      },
      user: { email: null, display_name: null, first_name: null },
      org: { id: null, name: null },
      pending_org_name: "",
      underlying_cause_tag: null,
      reissue_attempts_count: 0,
      retry_budget_used_count: 0,
      org_validation_error: null,
    }),
    states: {
      // Re-verify the forwarded Bearer (defense in depth, L3) AND load the
      // user's org from the backend (the org SSOT). On success the verified
      // identity + resolved org land on the done-event output; the [hasOrg]
      // guard forks ready vs needs_org. On failure the session is rejected.
      verifying: {
        invoke: {
          src: "loadSession",
          input: ({ context }) => ({
            bearer_token: context.params.bearer_token,
            correlation_id: context.params.correlation_id,
            config: context.params.config,
            deps: context.params.deps,
          }),
          onDone: [
            {
              guard: "hasOrg",
              target: "ready",
              actions: ["assignVerifiedUser", "assignResolvedOrg"],
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
              guard: "isOrgNameValid",
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
        // TODO: sync WorkOS Organizations with the app-level backend orgs.
        // When a backend org is created/changed here, propagate it to WorkOS so
        // the two stores stay consistent. This machine is a natural home — it
        // already holds a WorkOS handle (the re-verify call) and is event-driven,
        // so org create/membership transitions can fan out to WorkOS.
        invoke: {
          src: "createOrgAndReissue",
          input: ({ context }) => {
            return {
              org_name: context.pending_org_name,
              principal_id: context.params.principal_id,
              correlation_id: context.params.correlation_id,
              attempt: context.reissue_attempts_count + 1,
              config: context.params.config,
              deps: context.params.deps,
              force_reissue_failures: context.params.force_reissue_failures,
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
              // Globally-duplicate name (backend 409) → inline error, back to
              // needs_org. NOT a transient failure: no budget burn, no retry.
              guard: "isOrgNameTaken",
              target: "needs_org",
              actions: "recordOrgNameTaken",
            },
            {
              guard: "isReissueBudgetExhausted",
              target: "error_recoverable",
              actions: ["incrementReissueAttempts", "tagPartialSetup"],
            },
            {
              target: "creating_org",
              actions: "incrementReissueAttempts",
              reenter: true,
            },
          ],
        },
      },
      ready: {},
      error_recoverable: {
        on: {
          retry_clicked: [
            {
              // 4th total attempt at the same cause tag (= 3 user retries
              // counted). Escalate to error_terminal so the UI moves Maya
              // to a contact-support page (no further retry CTA).
              guard: "isUserRetryBudgetExhausted",
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
      error_terminal: {},
      // Terminal: re-verify failed. No user state advances; no session_started
      // is emitted. The projection surfaces session_rejected (OQ-2).
      session_rejected: {},
    },
  });
}

