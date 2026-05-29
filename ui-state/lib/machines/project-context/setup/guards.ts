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

import { validateProjectName } from "./domain.ts";
import type { GuardArgs } from "./types.ts";

const projectNameValid = ({ event }: GuardArgs) => {
  if (event.type !== "create_project_submitted") return false;
  return validateProjectName(event.org_name) === null;
};

// resolveInitialScope onDone branch predicates — read the resolver verdict off
// `event.output`.
const isCrossTenant = ({ event }: GuardArgs) =>
  (event as { output?: { cross_tenant?: true } }).output?.cross_tenant === true;

const isProjectNotFound = ({ event }: GuardArgs) =>
  (event as { output?: { project_not_found?: true } }).output?.project_not_found ===
  true;

const isNoProjects = ({ event }: GuardArgs) =>
  (event as { output?: { no_projects?: true } }).output?.no_projects === true;

// switchProject onDone branch predicates.
const isAccessRevoked = ({ event }: GuardArgs) =>
  (event as { output?: { access_revoked?: true } }).output?.access_revoked === true;

const isSwitchProjectNotFound = ({ event }: GuardArgs) =>
  (event as { output?: { project_not_found?: true } }).output?.project_not_found ===
  true;

// name → guard predicate index (keys referenced by string in ../machine.ts).
export const guards = {
  projectNameValid,
  isCrossTenant,
  isProjectNotFound,
  isNoProjects,
  isAccessRevoked,
  isSwitchProjectNotFound,
};
