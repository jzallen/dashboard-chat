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
//
// This file is MAPPING ONLY: it wires the setup pieces and lays out the state
// transitions. The pieces live under ./setup/ —
//   - domain.ts     — the OnboardSession value objects (OrgName, Org, …) + the
//                     failure-cause vocabulary (UnderlyingCauseTag, failWithCause/causeOf)
//   - actors.ts     — the resolvers + the `actors` bundle (external-service I/O)
//   - guards.ts     — the `guards` bundle (transition predicates)
//   - actions.ts    — the `actions` bundle (every assign, incl. former inlines)
//   - types.ts      — context / event / state / input types
// so the statechart below reads as transitions, naming actors/guards/actions by
// string without their definitions inline.
//
// References: ./README.md (overview, state diagram, full ADR list) and
// ../../../../docs/decisions/adr-041-session-onboarding-domain-realignment.md
// (the domain realignment + config-driven actor-injection inversion built here).

import { setup } from "xstate";

import { actions } from "./setup/actions.ts";
import { actors } from "./setup/actors.ts";
import type { PrincipalId } from "./setup/domain.ts";
import { guards } from "./setup/guards.ts";
import type {
  SessionOnboardingContext,
  SessionOnboardingEvent,
  SessionOnboardingInput,
} from "./setup/types.ts";

export function createSessionOnboardingMachine() {
  return setup({
    types: {
      context: {} as SessionOnboardingContext,
      events: {} as SessionOnboardingEvent,
      input: {} as SessionOnboardingInput,
    },
    actors,
    guards,
    actions,
  }).createMachine({
    id: "session-onboarding",
    initial: "verifying",
    context: ({ input }) => ({
      params: {
        correlation_id: input.correlation_id,
        principal_id: input.principal_id as PrincipalId,
        bearer_token: input.bearer_token ?? "",
        config: input.config ?? null,
        deps: input.deps ?? null,
        force_reissue_failures: input.force_reissue_failures ?? null,
      },
      user: { email: null, display_name: null, first_name: null },
      org: { id: null, name: null },
      pending_org_name: null,
      underlying_cause_tag: null,
      reissue_attempts_count: 0,
      retry_budget_used_count: 0,
      org_validation_error: null,
    }),
    states: {
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
              actions: ["clearOrgValidationError", "assignPendingOrgName"],
            },
            {
              actions: "recordOrgValidationError",
            },
          ],
          // Harness-only side-channel: force the machine into
          // error_recoverable carrying the supplied cause tag. Gated at the
          // HTTP layer (router.ts) by the failure-simulation gate so
          // production builds never see this event.
          __force_failure__: {
            target: "error_recoverable",
            actions: {
              type: "tagCause",
              params: ({ event }) => ({ tag: event.tag }),
            },
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
            actions: "assignCreatedOrg",
          },
          onError: [
            {
              guard: "isOrgNameTaken",
              target: "needs_org",
              actions: "recordOrgNameTaken",
            },
            {
              guard: "isReissueBudgetExhausted",
              target: "error_recoverable",
              actions: [
                "incrementReissueAttempts",
                { type: "tagCause", params: { tag: "partial-setup" } },
              ],
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
              guard: "isUserRetryBudgetExhausted",
              target: "error_terminal",
              actions: "incrementUserRetryBudget",
            },
            {
              target: "creating_org",
              actions: ["incrementUserRetryBudget", "resetReissueAttempts"],
            },
          ],
        },
      },
      error_terminal: {},
      session_rejected: {},
    },
  });
}
