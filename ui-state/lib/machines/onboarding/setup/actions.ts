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

import type { UnderlyingCauseTag } from "./domain.ts";
import { constructOrgName } from "./domain.ts";
import type { ActionArgs } from "./types.ts";

/** awaiting_org_report → ready (returning user) AND needs_org → ready
 *  (convergence): land the client-reported org on context. The wire payload's
 *  `org` ({id,name}) is spread to the event top level by the parent transport,
 *  so it reads `event.org` directly. */
export const assignResolvedOrg = ({ event }: ActionArgs) => {
  if (event.type !== "org_found") return {};
  return { org: { id: event.org.id, name: event.org.name } };
};
/** needs_org → ready: land the client-reported freshly-created org. Reads the
 *  spread `event.org` payload, same shape as assignResolvedOrg's. */
export const assignCreatedOrg = ({ event }: ActionArgs) => {
  if (event.type !== "org_created") return {};
  return { org: { id: event.org.id, name: event.org.name } };
};
// ── org-name validation recorders (CDO-S3 rewires these to the org-submit
//    event; retained now so their value-object re-derivation + UI copy do not
//    have to be reconstructed). They are event-agnostic in CDO-S1: the submitted
//    name arrives as an optional `org_name` field once an org-submit event is
//    reintroduced. ──
export const recordOrgValidationError = ({ event }: ActionArgs) => {
  const orgName = (event as { org_name?: string }).org_name;
  if (typeof orgName !== "string") {
    return { org_validation_error: null };
  }
  const rejection = constructOrgName(orgName).getError();
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
