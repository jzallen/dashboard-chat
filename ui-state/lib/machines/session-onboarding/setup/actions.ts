// Actions for the session-onboarding statechart.
//
// ROLE — actions are the ONLY writers of machine context. When a transition must
// RECORD a validation verdict as state (`recordOrgValidationError`,
// `recordOrgNameTaken`), the action re-runs the OrgName value object
// (`constructOrgName(...).getError()`, ./domain.ts) to read the structured
// rejection and `assign`s the user-facing shape onto context. That re-derivation
// — the guard already consumed `.isValid()` to route — is intentional and safe
// (the value object is pure), and is forced by XState: guards cannot write
// context. The value object evaluates, guards route, actions write. (See the
// docstring atop ./domain.ts for the full split.)
//
// Every `assign` lives here, including assignPendingOrgName, assignCreatedOrg,
// and the parameterized `tagCause`, so machine.ts only ever names actions (with
// `params` where they vary). Exported as one `actions` bundle threaded into
// `setup({ actions })`.
//
// Most actions are no-param `assign`s sharing `updateContext` — `assign` with its
// five generics pinned once via an instantiation expression (the generics have no
// defaults, so all five must be supplied; `TExpressionEvent` and `TEvent` are
// distinct `assign` generics that are the same union here).
//
// `event` is the FULL declared event union for EVERY action in this bundle:
// `setup` types each named action's expression-event as the whole `TEvent`,
// regardless of which transition references it (a named action may be attached to
// any transition). So the actor-result readers must cast `event` to reach
// `.output` — that is the cost of defining named actions in this bundle rather
// than inline, NOT a side effect of `updateContext`. (An inline `onDone` action
// would receive `DoneActorEvent<output>` and need no cast; the trade buys a
// mapping-only machine.ts.) `tagCause` is the exception that proves the rule — it takes
// `params`, so it needs its own `assign` with `TParams = { tag }`.

import { assign } from "xstate";

import type { SessionOnboardingActor } from "./actors.ts";
import type {
  Org,
  OrgName,
  UnderlyingCauseTag,
  VerifiedSession,
} from "./domain.ts";
import { causeOf, constructOrgName } from "./domain.ts";
import type {
  SessionOnboardingContext,
  SessionOnboardingEvent,
} from "./types.ts";

const updateContext = assign<
  SessionOnboardingContext,
  SessionOnboardingEvent,
  undefined,
  SessionOnboardingEvent,
  SessionOnboardingActor
>;

export const actions = {
  assignVerifiedUser: updateContext(({ event }) => {
    // The verifying resolver returns a VerifiedSession; its `user` is a
    // VerifiedUser with first_name already derived at the boundary.
    const { user } = (event as unknown as { output: VerifiedSession }).output;
    return {
      user: {
        email: user.email,
        display_name: user.display_name,
        first_name: user.first_name,
      },
    };
  }),
  assignResolvedOrg: updateContext(({ event }) => {
    const { org } = (event as unknown as { output: VerifiedSession }).output;
    return {
      org: org ? { id: org.id, name: org.name } : { id: null, name: null },
    };
  }),
  tagSessionRejected: updateContext(({ event }) => ({
    // The verifying actor branded its failure with a cause (./domain.ts
    // `failWithCause`); read it straight off the onError event. Untagged /
    // foreign throws default to "transient".
    underlying_cause_tag: causeOf((event as { error?: unknown }).error),
  })),
  recordOrgValidationError: updateContext(({ event }) => {
    if (event.type !== "org_form_submitted") {
      return { org_validation_error: null };
    }
    const rejection = constructOrgName(event.org_name).getError();
    if (rejection === null) return { org_validation_error: null };
    // kind → UI copy is a PRESENTATION mapping, so it lives here in the action,
    // not on the value object (the domain doesn't know UI strings).
    const kind = rejection.kind;
    const messages: Record<typeof kind, string> = {
      empty: "Please enter an organization name",
      too_short: "Organization name is too short",
      too_long: "Organization name is too long",
    };
    return { org_validation_error: { kind, message: messages[kind] } };
  }),
  recordOrgNameTaken: updateContext(() => ({
    org_validation_error: {
      kind: "duplicate" as const,
      message: "That name is already in use in your organization",
    },
  })),
  clearOrgValidationError: updateContext(() => ({ org_validation_error: null })),
  // Parameterized: ONE "set the cause tag" action, configured per transition via
  // `params` (XState's recommended way to keep an action event-agnostic).
  // Replaces tagPartialSetup (constant) + assignForcedFailureTag (read event.tag).
  // Needs its OWN `assign` because its TParams is `{ tag }`, not the `undefined`
  // updateContext pins — the one axis where per-action types legitimately differ.
  tagCause: assign<
    SessionOnboardingContext,
    SessionOnboardingEvent,
    { tag: UnderlyingCauseTag },
    SessionOnboardingEvent,
    SessionOnboardingActor
  >((_, params) => ({ underlying_cause_tag: params.tag })),

  /** needs_org → creating_org: preserve the submitted name across retries. The
   *  guard (isOrgNameValid) already validated it, so brand the raw name directly
   *  — re-running the constructor just to read `.value` would be redundant. */
  assignPendingOrgName: updateContext(({ event }) => {
    if (event.type !== "org_form_submitted") return {};
    return { pending_org_name: event.org_name as OrgName };
  }),
  /** creating_org onDone: land the created Org on context. */
  assignCreatedOrg: updateContext(({ event }) => {
    const createdOrg = (event as unknown as { output: Org }).output;
    return { org: { id: createdOrg.id, name: createdOrg.name } };
  }),
};
