// project-context/setup/actors.ts — the (now EGRESS-FREE) actor layer for the
// project-context half of J-002. Houses the I/O CONTRACT TYPES the client-reported
// scope/switch outcomes exchange with the machine, the `fromPromise`-bound
// actor-type aliases, and `buildActors(deps)` — which since the CDO-S1/S3
// report-only realignment returns an EMPTY map (the machine invokes NO actors:
// scope is client-reported, the project switch is a client report).
//
// ZERO EGRESS (CDO-S5 / ADR-048 §4): the network resolvers that USED to live here
// — `resolveInitialScopeFn`/`Actor` (backend GET /api/projects + per-project
// list_sessions probes), `createProjectFn`/`Actor` (POST /api/projects), and
// `switchProjectFn`/`Actor` (GET /api/projects/:id) — were DEAD CODE (buildActors
// already returned {}) and are DELETED at CDO-S5 step 05-02 along with every
// `fetch` / `backendUrl` reference. The client probes the backend and REPORTS the
// outcome; the machine transitions on the report.
//
// It imports from `xstate` and the shared domain (./types.ts, active-scope.ts)
// ONLY — never machine.ts or the other setup modules (one-way dependency, no
// cycle).
//
// References:
//   docs/decisions/adr-048-*.md  — ui-state zero network egress
//   docs/decisions/adr-049-*.md  — §4 report-only scope/switch (no server-side resolve/switch)
//   docs/decisions/adr-028-*.md  — machines own transitions; parent-ignorant children
//   docs/decisions/adr-030-*.md  — branch-relevant data flows through event.output

import { fromPromise } from "xstate";

import type { ActiveScope } from "../../../domain/active-scope.ts";
import type { ProjectSummary } from "./types.ts";

export type ResolveInitialScopeOutput =
  | {
      project: ProjectSummary;
      most_recent_session_per_project?: Record<string, string>;
      degraded_project_ids?: string[];
    }
  | { no_projects: true }
  | { cross_tenant: true }
  | { project_not_found: true };

export interface ResolveInitialScopeInput {
  org_id: string;
  deeplink_project_id: string | null;
  principal_id: string;
}

export type ResolveInitialScopeActor = ReturnType<
  typeof fromPromise<ResolveInitialScopeOutput, ResolveInitialScopeInput>
>;

export interface CreateProjectInput {
  org_name: string;
  request_id: string;
  principal_id: string;
}

export type CreateProjectActor = ReturnType<
  typeof fromPromise<ProjectSummary, CreateProjectInput>
>;

/**
 * switchProject actor. Given a target `new_project_id`, validates
 * the user's access via `GET /api/projects/:id` and returns the new
 * ProjectSummary on success. The error variants mirror resolveInitialScope:
 * `{ access_revoked: true }` (403; named diagnostic surfaces in
 * scope_mismatch_terminal), `{ project_not_found: true }` (404). Other
 * errors throw and land in `error_recoverable`.
 */
export type SwitchProjectOutput =
  | { project: ProjectSummary }
  | { access_revoked: true }
  | { project_not_found: true };

export interface SwitchProjectInput {
  new_project_id: string;
  request_id: string;
  principal_id: string;
}

export type SwitchProjectActor = ReturnType<
  typeof fromPromise<SwitchProjectOutput, SwitchProjectInput>
>;

/**
 * The construction-time deps the machine accepts. EMPTY since the CDO-S1/S3
 * report-only realignment (ADR-049 §4): the machine invokes NO actors (scope is
 * client-reported; the project switch is a client report), so `buildActors`
 * returns `{}` and needs nothing. Retained as a named (empty) contract so the
 * composition root + chat-app `ChatAppDeps.projectContext` slot keep a stable
 * type. The optional `*Actor` fields the egress resolvers once populated were
 * dropped with those resolvers at CDO-S5 (zero egress); any remaining caller
 * passes `{}`.
 */
export type ProjectContextMachineDeps = Record<string, never>;

/**
 * Build the machine's actor map from the injected `deps`. machine.ts threads the
 * return straight into `setup({ actors })` so the statechart only names actors,
 * never wires them. After the CDO-S3 report-only realignment (ADR-049 §4) the
 * machine invokes NO actors at all: scope is client-reported (no
 * resolveInitialScope) and the project switch is a client `project_switched` /
 * `scope_mismatch` REPORT (no switchProject invoke). The deps fields are kept
 * OPTIONAL on the contract so the production composition root + legacy harnesses
 * may still pass them harmlessly until their wiring is pruned; they are no longer
 * read here. The returned map is empty.
 */
export function buildActors(_deps: ProjectContextMachineDeps) {
  return {} as Record<string, never>;
}

/**
 * The ProvidedActor union XState derives from the actor map when it types
 * `setup({ actors })`. XState's own `ToProvidedActor` is internal (not exported),
 * so we mirror its shape here — `{ src, logic, id }` per actor — DERIVED from
 * `ReturnType<typeof buildActors>`, so adding/removing an actor updates it
 * automatically. (No children map → `id: string | undefined`, matching XState.)
 * Mirrors onboarding's `ProvidedActorOf` / `OnboardingActor`.
 */
type ProvidedActorOf<TActors extends Record<string, unknown>> = {
  [K in keyof TActors as K & string]: {
    src: K & string;
    logic: TActors[K];
    id: string | undefined;
  };
}[keyof TActors & string];

export type ProjectContextActor = ProvidedActorOf<ReturnType<typeof buildActors>>;



// Re-export ActiveScope so callers don't need a separate import path.
export type { ActiveScope };
