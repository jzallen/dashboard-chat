// Guard predicates for the onboarding statechart.
//
// CLIENT-REPORTED MODEL (ADR-049/050): the report-driven realignment retired the
// old invoke-result + org-submit guards. The happy arms (org_found /
// org_not_found / org_created) are unconditional transitions on the reported
// outcome, so they need no guard.
//
// CDO-S3 re-populates the bundle for the org_create_failed RE-EDIT vs RETRY split
// (domain §4.3 Specs 4-5). The cause guards read the reported `event.cause` to
// pick the arm: a re-edit cause (org_name_taken / org_name_invalid) keeps the
// user on the form (no target), everything else falls through to the retryable
// error_recoverable. The guards ROUTE only — they never read errors or mutate;
// the recording is the action's job (./actions.ts).

import type { GuardArgs } from "./types.ts";

/** org_create_failed reported a 409 collision — route to the inline
 *  duplicate-name arm (stay on the form). */
export const causeIsOrgNameTaken = ({ event }: GuardArgs) =>
  event.type === "org_create_failed" && event.cause === "org_name_taken";

/** org_create_failed reported a shape rejection — route to the inline
 *  validation arm (stay on the form). */
export const causeIsOrgNameInvalid = ({ event }: GuardArgs) =>
  event.type === "org_create_failed" && event.cause === "org_name_invalid";

/** name → guard predicate index, wired into machine.ts's `setup({ guards })`. */
export const guards = {
  causeIsOrgNameTaken,
  causeIsOrgNameInvalid,
};
