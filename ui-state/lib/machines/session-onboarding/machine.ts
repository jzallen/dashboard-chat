// SessionOnboardingMachine — XState v5 statechart for the OnboardSession
// aggregate.
//
// Entry assumes an ALREADY-AUTHENTICATED principal (auth-proxy verified the
// user upstream and injected X-User-Id + forwarded the Bearer). The machine
// does not re-enact a sign-in handshake; it brings the verified principal to
// an org-scoped, app-ready state.
//
// States:
//   - verifying      — re-verify the forwarded Bearer against WorkOS
//                      /oauth/userinfo (defense-in-depth).
//   - needs_org      — verified, no org binding yet. Awaits org_form_submitted.
//   - creating_org   — POST /api/orgs. The org-scoped JWT is minted by
//                      auth-proxy on the org-create response (X-New-Access-Token);
//                      this machine does not reissue tokens.
//   - ready          — signed in with an org. Reached directly from verifying
//                      on the [hasOrg] returning-user shortcut, or from
//                      creating_org for a new user.
//   - error_recoverable — org-setup error landing zone (genuine create failure
//                      or the __force_failure__ harness jump).
//   - session_rejected — terminal: re-verify failed (token/user invalid).
//
// This file is MAPPING ONLY: it wires the setup pieces and lays out the state
// transitions. The pieces live under ./setup/ —
//   - domain.ts     — the OnboardSession value objects (OrgName, Org, …) + the
//                     failure-cause vocabulary (UnderlyingCauseTag, failWithCause/causeOf)
//   - actors.ts     — the resolvers + the `actors` bundle (external-service I/O)
//   - guards.ts     — the `guards` bundle (transition predicates)
//   - actions.ts    — the `actions` bundle (every assign)
//   - types.ts      — context / event / state / input types
// so the statechart below reads as transitions, naming actors/guards/actions by
// string without their definitions inline.
//
// References:
//   docs/decisions/adr-041-*.md  — session-onboarding domain realignment; config-driven actor injection
//   docs/decisions/adr-043-*.md  — auth-proxy owns token lifecycle (no reissue)
//   ./README.md                  — overview, state diagram, full ADR list

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
        request_id: input.request_id,
        principal_id: input.principal_id as PrincipalId,
        bearer_token: input.bearer_token ?? "",
        config: input.config ?? null,
        deps: input.deps ?? null,
      },
      user: { email: null, display_name: null, first_name: null },
      org: { id: null, name: null },
      pending_org_name: null,
      underlying_cause_tag: null,
      org_validation_error: null,
    }),
    states: {
      verifying: {
        invoke: {
          src: "loadSession",
          input: ({ context }) => ({
            bearer_token: context.params.bearer_token,
            request_id: context.params.request_id,
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
          src: "createOrg",
          input: ({ context }) => {
            return {
              org_name: context.pending_org_name,
              principal_id: context.params.principal_id,
              request_id: context.params.request_id,
              config: context.params.config,
              deps: context.params.deps,
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
            // A genuine org-create failure (not a duplicate name) is an ordinary
            // upstream error — surface it on the recoverable-error screen. There
            // is no retry loop: auth-proxy mints the org-scoped token on the
            // org-create response, so there is no reissue step to retry.
            {
              target: "error_recoverable",
              actions: { type: "tagCause", params: { tag: "partial-setup" } },
            },
          ],
        },
      },
      ready: {},
      // Terminal-ish error landing: reached by a genuine org-create failure or
      // the __force_failure__ harness jump. No retry transition.
      error_recoverable: {},
      session_rejected: {},
    },
  });
}
