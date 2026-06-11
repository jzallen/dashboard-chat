// OnboardingMachine — XState v5 statechart for the OnboardSession
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

import { assign, setup } from "xstate";

import { assignCreatedOrg, assignResolvedOrg, tagCause } from "./setup/actions.ts";
import { actors } from "./setup/actors.ts";
import type { PrincipalId } from "./setup/domain.ts";
import { guards } from "./setup/guards.ts";
import type {
  OnboardingContext,
  OnboardingEvent,
  OnboardingInput,
} from "./setup/types.ts";

export function createOnboardingMachine() {
  return setup({
    types: {
      context: {} as OnboardingContext,
      events: {} as OnboardingEvent,
      input: {} as OnboardingInput,
    },
    actors,
    guards,
    actions: {
      assignResolvedOrg: assign(assignResolvedOrg),
      assignCreatedOrg: assign(assignCreatedOrg),
      tagCause: assign(tagCause),
    },
  }).createMachine({
    id: "onboarding",
    // Client-reported model (ADR-049/050): NO server probe on arrival. The
    // machine settles immediately in awaiting_org_report and waits for the
    // client to report the outcome it observed (org_found / org_not_found).
    initial: "awaiting_org_report",
    context: ({ input }) => ({
      params: {
        request_id: input.request_id,
        principal_id: input.principal_id as PrincipalId,
        bearer_token: input.bearer_token ?? "",
        config: input.config ?? null,
        deps: input.deps ?? null,
      },
      // Identity has EXACTLY ONE writer: this cold-start seed from the verified
      // header (input.user). No outcome event ever touches user (INV-PCO).
      user: input.user ?? { email: null, display_name: null, first_name: null },
      org: { id: null, name: null },
      pending_org_name: null,
      underlying_cause_tag: null,
      org_validation_error: null,
    }),
    states: {
      // Waiting for the client's existence report. org_found → ready (returning
      // user fast path); org_not_found → needs_org.
      awaiting_org_report: {
        on: {
          org_found: { target: "ready", actions: "assignResolvedOrg" },
          org_not_found: { target: "needs_org" },
        },
      },
      needs_org: {
        on: {
          // The client created the org and reported it → ready.
          org_created: { target: "ready", actions: "assignCreatedOrg" },
          // Convergence: an org_found arriving here (the client raced a probe
          // after landing on setup) also settles ready.
          org_found: { target: "ready", actions: "assignResolvedOrg" },
          // Harness-only side-channel: force the machine into error_recoverable
          // carrying the supplied cause tag. Gated at the HTTP layer (router.ts)
          // by the failure-simulation gate so production builds never see it.
          __force_failure__: {
            target: "error_recoverable",
            actions: {
              type: "tagCause",
              params: ({ event }) => ({ tag: event.tag }),
            },
          },
        },
      },
      ready: {},
      // Recoverable-error landing: reached by the __force_failure__ harness jump
      // (empty in CDO-S1; genuine org-create failures route here in CDO-S3).
      error_recoverable: {},
    },
  });
}
