// Guard predicates for the onboarding statechart.
//
// CLIENT-REPORTED MODEL (ADR-049/050, CDO-S1): the report-driven realignment
// retired every transition guard this machine carried. The old guards routed on
// invoke results (`hasOrg` read the loadSession output; `isOrgNameTaken` read the
// createOrg onError) or on the org-submit event (`isOrgNameValid`) — all of which
// retired with the invokes + the org_form_submitted handler. The happy arms
// (org_found / org_not_found / org_created) are unconditional transitions on the
// reported outcome, so no guard is needed.
//
// The org-name validation guard returns in CDO-S3 when the org-submit event is
// reintroduced; the value object (`constructOrgName(...).isValid()`, ./domain.ts)
// that backs it is retained there. The bundle is kept (empty) so machine.ts's
// `setup({ guards })` wiring stays structurally unchanged.

/** name → guard predicate index (empty in CDO-S1 — see header). */
export const guards = {};
