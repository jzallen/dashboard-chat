// Guard predicates for the session-onboarding statechart.
//
// ROLE — guards are GATE CHECKS on state transitions: pure
// `(context, event) => boolean` predicates answering "may this transition
// fire?". They CONSULT a domain value object — `constructOrgName(...).isValid()`
// (./domain.ts) — to ROUTE; they never read the error, never build user
// messages, and never mutate context (recording a verdict as state is an
// action's job, ./actions.ts). The value object evaluates; guards just route on
// the result. (See the docstring atop ./domain.ts for the full split.)
//
// Extracted from the machine's `setup({ guards })` block so machine.ts reads as
// transitions. Each predicate annotates its arg with `GuardArgs` (the inference
// setup() gave them inline) and is exported as one `guards` bundle the machine
// threads into `setup({ guards })`.

import type { VerifiedSession } from "./domain.ts";
import { constructOrgName } from "./domain.ts";
import type { GuardArgs } from "./types.ts";

const REISSUE_BUDGET = 3;
/** User-retry budget on error_recoverable. The 4th total attempt at the
 *  same underlying_cause_tag (= 3 user retries) escalates to error_terminal. */
const USER_RETRY_BUDGET = 3;

export const guards = {
  hasOrg: ({ event }: GuardArgs) =>
    Boolean((event as { output?: VerifiedSession }).output?.org?.id),
  isOrgNameValid: ({ event }: GuardArgs) => {
    if (event.type !== "org_form_submitted") return false;
    return constructOrgName(event.org_name).isValid();
  },
  isOrgNameTaken: ({ event }: GuardArgs) =>
    Boolean((event as { error?: { name_taken?: boolean } }).error?.name_taken),
  isReissueBudgetExhausted: ({ context }: GuardArgs) =>
    context.reissue_attempts_count + 1 >= REISSUE_BUDGET,
  isUserRetryBudgetExhausted: ({ context }: GuardArgs) =>
    context.retry_budget_used_count + 1 >= USER_RETRY_BUDGET,
};
