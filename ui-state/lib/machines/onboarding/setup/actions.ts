// Actions for the onboarding statechart — the ONLY writers of machine context.
// Each is a bare `assign` closure, param-annotated with the shared `ActionArgs`
// alias (./types.ts); the `assign(...)` wrap happens at the `setup()` call in
// ../machine.ts, where inference flows from `setup`'s `types` — no xstate
// generics are pinned here. `tagCause` is the one parameterized action — it reads
// its tag from a 2nd `params` arg.
//
// When a transition must RECORD a validation verdict as state
// (`recordOrgValidationError`, `recordOrgNameTaken`), the action re-runs the
// OrgName value object (`constructOrgName(...).getError()`, ./domain.ts) to read
// the structured rejection and assigns the user-facing shape onto context. That
// re-derivation — the guard already consumed `.isValid()` to route — is
// intentional and safe (the value object is pure), and is forced by XState:
// guards cannot write context. The value object evaluates, guards route, actions
// write. (See the docstring atop ./domain.ts for the full split.)
//
// `event` is the FULL declared event union for EVERY action: `setup` types each
// named action's expression-event as the whole `TEvent`, regardless of which
// transition references it. Done/error events from invoked actors are NOT
// members, so the actor-result readers cast `event` to reach `.output` / `.error`.

import type {
  Org,
  OrgName,
  UnderlyingCauseTag,
  VerifiedSession,
} from "./domain.ts";
import { causeOf, constructOrgName } from "./domain.ts";
import type { ActionArgs } from "./types.ts";

export const assignVerifiedUser = ({ event }: ActionArgs) => {
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
};
export const assignResolvedOrg = ({ event }: ActionArgs) => {
  const { org } = (event as unknown as { output: VerifiedSession }).output;
  return {
    org: org ? { id: org.id, name: org.name } : { id: null, name: null },
  };
};
export const tagSessionRejected = ({ event }: ActionArgs) => ({
  // The verifying actor branded its failure with a cause (./domain.ts
  // `failWithCause`); read it straight off the onError event. Untagged /
  // foreign throws default to "transient".
  underlying_cause_tag: causeOf((event as { error?: unknown }).error),
});
export const recordOrgValidationError = ({ event }: ActionArgs) => {
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
};
export const recordOrgNameTaken = () => ({
  org_validation_error: {
    kind: "duplicate" as const,
    message: "That name is already in use in your organization",
  },
});
export const clearOrgValidationError = () => ({
  org_validation_error: null,
});
// Parameterized: ONE "set the cause tag" action, configured per transition via
// `params` (XState's recommended way to keep an action event-agnostic).
// Replaces tagPartialSetup (constant) + assignForcedFailureTag (read event.tag).
// The 2nd `params` arg carries the per-transition tag — `assign(tagCause)` at the
// setup() site infers TParams from this annotation.
export const tagCause = (_: ActionArgs, params: { tag: UnderlyingCauseTag }) => ({
  underlying_cause_tag: params.tag,
});

/** needs_org → creating_org: preserve the submitted name across retries. The
 *  guard (isOrgNameValid) already validated it, so brand the raw name directly
 *  — re-running the constructor just to read `.value` would be redundant. */
export const assignPendingOrgName = ({ event }: ActionArgs) => {
  if (event.type !== "org_form_submitted") return {};
  return { pending_org_name: event.org_name as OrgName };
};
/** creating_org onDone: land the created Org on context. */
export const assignCreatedOrg = ({ event }: ActionArgs) => {
  const createdOrg = (event as unknown as { output: Org }).output;
  return { org: { id: createdOrg.id, name: createdOrg.name } };
};
