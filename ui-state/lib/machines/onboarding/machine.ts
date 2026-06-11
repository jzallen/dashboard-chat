// OnboardingMachine — XState v5 statechart for the OnboardSession
// aggregate.
//
// Entry assumes an ALREADY-AUTHENTICATED principal (auth-proxy verified the
// user upstream and injected X-User-Id + forwarded the Bearer). The machine
// does not re-enact a sign-in handshake; it brings the verified principal to
// an org-scoped, app-ready state.
//
// States (client-reported model — ADR-049/050; no invokes, no egress):
//   - awaiting_org_report — settled on cold-start; waits for the client's
//                      existence report (org_found / org_not_found).
//   - needs_org      — no org binding yet. The client POSTs the org and reports
//                      the outcome: org_created → ready; org_create_failed splits
//                      RE-EDIT (org_name_taken / org_name_invalid stay here with an
//                      inline form error) from RETRY (everything else →
//                      error_recoverable). See domain-model §4.3 Specs 4-5.
//   - ready          — signed in with an org. Reached from the [org_found]
//                      returning-user fast path or from a reported org_created.
//   - error_recoverable — REPORT-ACCEPTING retryable landing (NOT a dead end):
//                      a later org_created/org_found settles ready; a repeated
//                      org_create_failed self-loops, refreshing the cause. Also
//                      the __force_failure__ harness jump target.
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

import {
  assignCreatedOrg,
  assignResolvedOrg,
  recordOrgNameTaken,
  recordOrgValidationError,
  tagCause,
} from "./setup/actions.ts";
import { actors } from "./setup/actors.ts";
import { causeTagOf, type PrincipalId } from "./setup/domain.ts";
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
      recordOrgNameTaken: assign(recordOrgNameTaken),
      recordOrgValidationError: assign(recordOrgValidationError),
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
          // The org-create report split (domain §4.3 Specs 4-5): the RE-EDIT
          // causes (org_name_taken / org_name_invalid) REMAIN here (no target)
          // and record an inline form error; everything else falls through to
          // the retryable error_recoverable. Order = precedence (first match).
          org_create_failed: [
            // 409 collision → inline duplicate-name error, stay on the form.
            { guard: "causeIsOrgNameTaken", actions: "recordOrgNameTaken" },
            // 422 shape rejection → inline validation error, stay on the form.
            {
              guard: "causeIsOrgNameInvalid",
              actions: "recordOrgValidationError",
            },
            // Generic (5xx / compensated / orphaned) → retryable error screen.
            {
              target: "error_recoverable",
              actions: {
                type: "tagCause",
                params: ({ event }) => ({ tag: causeTagOf(event.cause) }),
              },
            },
          ],
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
      // Recoverable-error landing — REPORT-ACCEPTING (domain §4.2 Spec 5): NOT a
      // dead end. A successful re-submit (org_created / org_found) settles ready;
      // a repeated failure self-loops here, refreshing the cause.
      error_recoverable: {
        on: {
          org_created: { target: "ready", actions: "assignCreatedOrg" },
          org_found: { target: "ready", actions: "assignResolvedOrg" },
          org_create_failed: {
            target: "error_recoverable",
            actions: {
              type: "tagCause",
              params: ({ event }) => ({ tag: causeTagOf(event.cause) }),
            },
          },
        },
      },
    },
  });
}
