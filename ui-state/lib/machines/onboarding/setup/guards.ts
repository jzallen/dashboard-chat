// Guard predicates for the onboarding statechart.
//
// ROLE — guards are GATE CHECKS on state transitions: pure
// `(context, event) => boolean` predicates answering "may this transition
// fire?". They CONSULT a domain value object — `constructOrgName(...).isValid()`
// (./domain.ts) — to ROUTE; they never read the error, never build user
// messages, and never mutate context (recording a verdict as state is an
// action's job, ./actions.ts). The value object evaluates; guards just route on
// the result. (See the docstring atop ./domain.ts for the full split.)
//
// Defined in this bundle so machine.ts reads as transitions. Each predicate
// annotates its arg with `GuardArgs` and is exported as one `guards` bundle the
// machine threads into `setup({ guards })`.

import type { VerifiedSession } from "./domain.ts";
import { constructOrgName } from "./domain.ts";
import type { GuardArgs } from "./types.ts";

const hasOrg = ({ event }: GuardArgs) =>
  Boolean((event as { output?: VerifiedSession }).output?.org?.id);

const isOrgNameValid = ({ event }: GuardArgs) => {
  if (event.type !== "org_form_submitted") return false;
  return constructOrgName(event.org_name).isValid();
};

const isOrgNameTaken = ({ event }: GuardArgs) =>
  Boolean((event as { error?: { name_taken?: boolean } }).error?.name_taken);

// name → guard predicate index (keys referenced by string in ../machine.ts).
export const guards = {
  hasOrg,
  isOrgNameValid,
  isOrgNameTaken,
};
