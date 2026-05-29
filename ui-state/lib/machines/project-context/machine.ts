// ProjectContextMachine — XState v5 statechart for J-002's project-context half.
//
// This machine owns "Which project am I in?" — initial scope resolution, project
// creation, mid-flow project switching, cross-tenant terminal failure, and the
// deep-link entry path. It owns the `org_id` + `project_id` halves of
// `active_scope`.
//
// State surface:
//
//   resolving_initial_scope (initial) ─┬─→ project_selected
//                                       ├─→ no_projects
//                                       └─→ scope_mismatch_terminal
//   no_projects                        ─→ creating_project (valid name)
//                                      ─→ self                (empty name; inline error)
//   creating_project (invoke)          ─┬─→ project_selected   (onDone)
//                                       └─→ error_recoverable  (onError; transient)
//   project_selected                   (entry assigns context.project; emits project_selected)
//   scope_mismatch_terminal            ─→ resolving_initial_scope (back_to_projects_clicked)
//   error_recoverable                  ─→ creating_project        (retry_clicked; preserves pending_project_name)
//   switching_project                  — atomic mid-flow project switch.
//
// Cross-machine isolation invariant: this file does NOT import from
// `session-chat.ts` or `login-and-org-setup.ts`. The orchestrator mediates all
// cross-machine entry (`auth_ready` from login → project-context; `project_ready`
// from project-context → session-chat).
//
// This file is MAPPING ONLY: it wires the setup pieces and lays out the state
// transitions. The pieces live under ./setup/ —
//   - domain.ts   — the project-name validation primitive (validateProjectName)
//   - actors.ts   — the resolvers + `buildActors(deps)` (external-service I/O)
//   - guards.ts   — the `guards` bundle (transition predicates)
//   - actions.ts  — the bare assign closures (every context write)
//   - types.ts    — context / event / state / summary / cause-tag / input types
// so the statechart below reads as transitions, naming actors/guards/actions by
// string without their definitions inline.
//
// References:
//   docs/decisions/adr-028-*.md  — machines own transitions; parent-ignorant children
//   docs/decisions/adr-029-*.md  — ActiveScope invariants / cross-tenant rejection
//   docs/decisions/adr-030-*.md  — flow_id key form / branch-relevant data flow
//   docs/evolution/2026-05-16-project-and-chat-session-management/design/application-architecture.md
//                                — machine SRP split (app-arch §2A)
//   docs/discussion/ui-state-vocabulary-audit/findings.md — vocabulary audit
//   ./README.md                  — overview, state diagram, full ADR list

import { assign, setup } from "xstate";

import {
  assignAuthReady,
  assignCreatedProject,
  assignResolvedScope,
  assignSwitchedProject,
  capturePendingProjectName,
  captureDeepLinkWish,
  captureSwitchTarget,
  clearErrorAndBumpRetries,
  clearProjectValidationError,
  clearScopeMismatch,
  recordProjectValidationError,
  tagCause,
} from "./setup/actions.ts";
import { buildActors, type ProjectContextMachineDeps } from "./setup/actors.ts";
import { guards } from "./setup/guards.ts";
import type {
  ProjectContextEvent,
  ProjectContextInput,
  ProjectContextMachineContext,
} from "./setup/types.ts";

export function createProjectContextMachine(deps: ProjectContextMachineDeps) {
  return setup({
    types: {
      context: {} as ProjectContextMachineContext,
      events: {} as ProjectContextEvent,
      input: {} as ProjectContextInput,
    },
    actors: buildActors(deps),
    guards,
    actions: {
      captureDeepLinkWish: assign(captureDeepLinkWish),
      assignAuthReady: assign(assignAuthReady),
      assignResolvedScope: assign(assignResolvedScope),
      assignCreatedProject: assign(assignCreatedProject),
      captureSwitchTarget: assign(captureSwitchTarget),
      assignSwitchedProject: assign(assignSwitchedProject),
      clearScopeMismatch: assign(clearScopeMismatch),
      clearErrorAndBumpRetries: assign(clearErrorAndBumpRetries),
      tagCause: assign(tagCause),
      recordProjectValidationError: assign(recordProjectValidationError),
      clearProjectValidationError: assign(clearProjectValidationError),
      capturePendingProjectName: assign(capturePendingProjectName),
    },
  }).createMachine({
    id: "project-context",
    initial: "resolving_initial_scope",
    // Root-level open_deep_link handler — available from ANY state. A cold
    // deep-link can arrive while the machine is in no_projects,
    // project_selected, or any other live state. The handler captures the URL
    // wish into `deeplink_*` ctx and re-enters resolving_initial_scope so the
    // resolver re-runs with the new wish.
    on: {
      open_deep_link: {
        actions: "captureDeepLinkWish",
        target: ".resolving_initial_scope",
        reenter: true,
      },
    },
    context: ({ input }) => ({
      request_id: input.request_id,
      principal_id: input.principal_id,
      org_id: input.org_id ?? "",
      user: { first_name: input.user?.first_name ?? null },
      project: { id: null, name: null },
      deeplink_project_id: input.deeplink_project_id ?? null,
      deeplink_session_id: null,
      underlying_cause_tag: null,
      retries_count: 0,
      pending_project_name: "",
      project_validation_error: null,
      scope_reconciled_count: 0,
      stale_intents_dropped_count: 0,
      last_stale_intent: null,
      most_recent_session_per_project: {},
      last_used_degraded_project_ids: [],
    }),
    states: {
      resolving_initial_scope: {
        on: {
          // Entry from J-001 — orchestrator broadcasts this when J-001
          // transitions into `ready`. The payload carries the inherited
          // org_id + user.first_name from J-001's projection so J-002
          // never re-fetches them from JWT / /api/orgs/me (DWD-6, F-5).
          auth_ready: {
            actions: "assignAuthReady",
            // Stay in resolving_initial_scope — the invoke below fires.
            target: "resolving_initial_scope",
            reenter: true,
          },
          // Note: open_deep_link is handled at the machine root level so it
          // can arrive from any live state (no_projects,
          // project_selected, etc).
        },
        invoke: {
          src: "resolveInitialScope",
          input: ({ context }) => ({
            org_id: context.org_id,
            deeplink_project_id: context.deeplink_project_id,
            principal_id: context.principal_id,
          }),
          onDone: [
            {
              guard: "isCrossTenant",
              target: "scope_mismatch_terminal",
              actions: { type: "tagCause", params: { tag: "cross_tenant" } },
            },
            {
              guard: "isProjectNotFound",
              target: "scope_mismatch_terminal",
              actions: { type: "tagCause", params: { tag: "project_not_found" } },
            },
            {
              guard: "isNoProjects",
              target: "no_projects",
            },
            {
              target: "project_selected",
              actions: "assignResolvedScope",
            },
          ],
          onError: {
            target: "error_recoverable",
            actions: { type: "tagCause", params: { tag: "transient" } },
          },
        },
      },
      no_projects: {
        entry: { type: "tagCause", params: { tag: "no_projects" } },
        on: {
          create_project_clicked: {
            target: "creating_project",
          },
          create_project_submitted: [
            {
              guard: "projectNameValid",
              target: "creating_project",
              actions: ["clearProjectValidationError", "capturePendingProjectName"],
            },
            {
              // Empty / invalid name — stay in this state with inline error.
              actions: "recordProjectValidationError",
            },
          ],
        },
      },
      creating_project: {
        invoke: {
          src: "createProject",
          input: ({ context }) => ({
            org_name: context.pending_project_name,
            request_id: context.request_id,
            principal_id: context.principal_id,
          }),
          onDone: {
            target: "project_selected",
            actions: "assignCreatedProject",
          },
          onError: {
            target: "error_recoverable",
            actions: { type: "tagCause", params: { tag: "transient" } },
          },
        },
      },
      project_selected: {
        // Entry assigns context.project. The orchestrator's priorState watcher
        // observes entry to this state and broadcasts `project_ready` to
        // session-chat (idempotent on same project_id; invalidates
        // session_id+resource_* on different project_id).
        //
        // `switching_project_intent` moves the machine into
        // `switching_project`. The IC-J002-4 invalidation contract
        // (session_id + resource_* cleared BEFORE the new project's
        // loading_session_list fires) is enforced via the
        // `switching_project_started` event handler in projection.ts;
        // session-chat reacts by zeroing its own context fields.
        on: {
          switching_project_intent: {
            target: "switching_project",
            actions: "captureSwitchTarget",
          },
        },
      },
      switching_project: {
        // Entry — orchestrator-side emission of `switching_project_started`
        // happens in orchestrator.ts (state-watcher branch). The event
        // payload carries the target project_id so the projection layer
        // can write the invalidation atomically.
        invoke: {
          src: "switchProject",
          input: ({ context }) => ({
            new_project_id: context.deeplink_project_id ?? "",
            request_id: context.request_id,
            principal_id: context.principal_id,
          }),
          onDone: [
            {
              guard: "isAccessRevoked",
              target: "scope_mismatch_terminal",
              actions: { type: "tagCause", params: { tag: "access_revoked" } },
            },
            {
              guard: "isSwitchProjectNotFound",
              target: "scope_mismatch_terminal",
              actions: { type: "tagCause", params: { tag: "project_not_found" } },
            },
            {
              target: "project_selected",
              actions: "assignSwitchedProject",
            },
          ],
          onError: {
            target: "error_recoverable",
            actions: { type: "tagCause", params: { tag: "transient" } },
          },
        },
      },
      scope_mismatch_terminal: {
        on: {
          back_to_projects_clicked: {
            target: "resolving_initial_scope",
            actions: "clearScopeMismatch",
          },
        },
      },
      error_recoverable: {
        on: {
          retry_clicked: {
            target: "creating_project",
            actions: "clearErrorAndBumpRetries",
          },
        },
      },
    },
  });
}
