// Guard predicates for the project-context statechart.
//
// ROLE — guards are GATE CHECKS on state transitions: pure
// `(context, event) => boolean` predicates answering "may this transition
// fire?". The `onDone` predicates read the actor result off `event.output` (a
// done event is not a member of `ProjectContextEvent`, so they cast `event` to
// reach `.output` — exactly as they did when inline). `projectNameValid`
// consults the domain primitive (`validateProjectName`, ./domain.ts) to ROUTE;
// it never records the error (recording a verdict as state is an action's job,
// ./actions.ts).
//
// Defined in this bundle so machine.ts reads as transitions. Each predicate
// annotates its arg with `GuardArgs` and is exported as one `guards` bundle the
// machine threads into `setup({ guards })`.

import type { GuardArgs } from "./types.ts";

// resolveInitialScope onDone branch predicates — read the resolver verdict off
// `event.output`. RETIRED from the machine's transitions in CDO-S1 (the
// initial-scope resolver invoke is gone — scope is client-reported); retained
// here because the CDO-S3 deep-link `scope_mismatch` rework reuses them.
const isCrossTenant = ({ event }: GuardArgs) =>
  (event as { output?: { cross_tenant?: true } }).output?.cross_tenant === true;

const isProjectNotFound = ({ event }: GuardArgs) =>
  (event as { output?: { project_not_found?: true } }).output?.project_not_found ===
  true;

const isNoProjects = ({ event }: GuardArgs) =>
  (event as { output?: { no_projects?: true } }).output?.no_projects === true;

// name → guard predicate index (keys referenced by string in ../machine.ts).
// The whole bundle is now UNREFERENCED by the report-driven machine's
// transitions: scope is client-reported (no resolveInitialScope onDone) and the
// project switch is REPORT-ONLY (CDO-S3 — the switchProject invoke + its
// access_revoked / project_not_found onDone branches retire; the mismatch cause
// arrives as a client `scope_mismatch` report, tagged from event.cause). These
// output-readers are retained as the historical verdict-shape documentation; the
// machine names none of them.
export const guards = {
  isCrossTenant,
  isProjectNotFound,
  isNoProjects,
};
