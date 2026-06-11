// ProjectContextMachine — XState v5 statechart for J-002's project-context half.
//
// This machine owns "Which project am I in?" — initial scope resolution, project
// creation, mid-flow project switching, cross-tenant terminal failure, and the
// deep-link entry path. It owns the `org_id` + `project_id` halves of
// `active_scope`.
//
// State surface (CLIENT-REPORT-DRIVEN — ADR-049 §3 / ADR-050 §f, CDO-S1):
//
//   awaiting_scope_report (initial) ─┬─→ project_selected  (scope_resolved)
//                                     ├─→ project_selected  (project_created — Phase D)
//                                     └─→ no_projects       (no_projects_found)
//   no_projects                      ─→ project_selected    (project_created — Phase D)
//   project_selected                 (entry assigns context.project; emits project_selected)
//   scope_mismatch_terminal          ─→ awaiting_scope_report (back_to_projects_clicked)
//   error_recoverable                ─→ awaiting_scope_report (retry_clicked)
//   switching_project (invoke)       — atomic mid-flow project switch (US-207; CDO-S3 reworks).
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
  captureDeepLinkWish,
  captureSwitchTarget,
  clearScopeMismatch,
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
      tagCause: assign(tagCause),
    },
  }).createMachine({
    id: "project-context",
    initial: "awaiting_scope_report",
    // Root-level open_deep_link handler — available from ANY state. A cold
    // deep-link can arrive while the machine is in no_projects,
    // project_selected, or any other live state. The handler captures the URL
    // wish into `deeplink_*` ctx and re-enters awaiting_scope_report so the
    // client can re-probe and report the resolution for the new wish (the
    // cross_tenant / project_not_found discrimination of that wish is a client
    // `scope_mismatch` report — CDO-S3).
    on: {
      open_deep_link: {
        actions: "captureDeepLinkWish",
        target: ".awaiting_scope_report",
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
      // Cold-start (no invoke). The parent forwards `auth_ready` on the advance
      // to engaged, seeding org_id + first_name. The machine then waits for the
      // CLIENT to probe the backend (GET /api/projects) and REPORT the
      // resolution (ADR-049 §3 / ADR-050 §f) — it never resolves scope itself.
      awaiting_scope_report: {
        on: {
          // Entry from J-001 — orchestrator broadcasts this when J-001
          // transitions into `ready`. The payload carries the inherited
          // org_id + user.first_name from J-001's projection so J-002
          // never re-fetches them from JWT / /api/orgs/me (DWD-6, F-5).
          auth_ready: {
            actions: "assignAuthReady",
            target: "awaiting_scope_report",
            reenter: true,
          },
          // Client reports an existing project was picked → settle on it.
          scope_resolved: {
            target: "project_selected",
            actions: "assignResolvedScope",
          },
          // Phase D from a cold awaiting state: the (auto) default project was
          // created and reported → settle on it.
          project_created: {
            target: "project_selected",
            actions: "assignCreatedProject",
          },
          // Client reports the backend has no project yet → no_projects shell.
          no_projects_found: {
            target: "no_projects",
          },
          // Phase D failure (Spec 7b): the default-project POST failed (or its
          // response was lost) → land in the report-accepting error state.
          project_create_failed: {
            target: "error_recoverable",
            actions: {
              type: "tagCause",
              params: { tag: "project_create_failed" },
            },
          },
          // Note: open_deep_link is handled at the machine root level so it
          // can arrive from any live state (no_projects, project_selected, …).
        },
      },
      no_projects: {
        entry: { type: "tagCause", params: { tag: "no_projects" } },
        on: {
          // Phase D from the no_projects shell: the default project was created
          // and reported → settle on it (Phase D accepts project_created from
          // either awaiting_scope_report OR no_projects).
          project_created: {
            target: "project_selected",
            actions: "assignCreatedProject",
          },
          // Phase D failure from the no_projects shell (Spec 7b).
          project_create_failed: {
            target: "error_recoverable",
            actions: {
              type: "tagCause",
              params: { tag: "project_create_failed" },
            },
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
            target: "awaiting_scope_report",
            actions: "clearScopeMismatch",
          },
        },
      },
      error_recoverable: {
        // Report-accepting recovery (ADR-049 §3.3 / Spec 7b). Retry is the
        // client re-POSTing + re-reporting — the error state accepts outcome
        // reports DIRECTLY rather than re-invoking (the retired `retry_clicked`
        // re-invoke). After a lost-response project_create_failed the client
        // re-probes and reports scope_resolved (the project the POST actually
        // made) → project_selected, with no duplicate (probe-first convergence).
        on: {
          project_created: {
            target: "project_selected",
            actions: "assignCreatedProject",
          },
          scope_resolved: {
            target: "project_selected",
            actions: "assignResolvedScope",
          },
          // A re-failed retry refreshes the cause without leaving the state.
          project_create_failed: {
            target: "error_recoverable",
            actions: {
              type: "tagCause",
              params: { tag: "project_create_failed" },
            },
          },
        },
      },
    },
  });
}
