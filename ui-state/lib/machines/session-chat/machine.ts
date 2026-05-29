// SessionChatMachine — XState v5 statechart for J-002's session-chat half.
//
// This machine owns "What's happening in my current session?" — session list
// visibility, resume, new-session lifecycle, dataset attachment within the
// session, and the chat-turn-emitting states. It owns the `resource_*` half of
// `active_scope`.
//
// State surface:
//   waiting_for_project (initial) ─→ loading_session_list           (project_ready)
//   loading_session_list (invoke)  ─┬─→ session_list_loaded        (onDone, no pending_resume_session_id)
//                                    ├─→ resuming_session            (onDone, pending_resume_session_id present)
//                                    └─→ error_recoverable           (onError, transient)
//   session_list_loaded          ─┬─→ resuming_session              (session_clicked)
//                                    └─→ loading_session_list         (refresh_session_list)
//   resuming_session (invoke)     ─┬─→ session_active                (onDone, found)
//                                    ├─→ session_list_loaded         (onDone, session_not_found — silent)
//                                    └─→ error_recoverable            (onError, transient)
//   session_active                (active session)
//   session_welcome               (new-session lifecycle via createSessionEagerly)
//   switching_dataset_context     (dataset attachment within the session)
//   error_recoverable             ─→ last_live_state                  (retry_clicked)
//
// Cross-machine isolation invariant: this file does NOT import from
// `project-context.ts` or `login-and-org-setup.ts`. The orchestrator mediates
// all cross-machine entry (`project_ready` from project-context arrives via
// orchestrator broadcast on entry into `project_selected`, carrying org_id +
// project_id + project_name + forwarded intent fields).
//
// This file is MAPPING ONLY: it wires the setup pieces and lays out the state
// transitions. The pieces live under ./setup/ —
//   - actors.ts   — the resolvers + `buildActors(deps)` (external-service I/O)
//   - guards.ts   — the `guards` bundle (transition predicates)
//   - actions.ts  — the bare assign closures (every context write)
//   - types.ts    — context / event / state / summary / transcript / cause-tag / input types
// so the statechart below reads as transitions, naming actors/guards/actions by
// string without their definitions inline. session-chat owns no domain value
// object with behavior (it is an I/O + coordination machine), so there is no
// setup/domain.ts (parity with chat-app).
//
// References:
//   docs/decisions/adr-014-*.md  — UI directives filtered from visible transcript
//   docs/decisions/adr-028-*.md  — machines own transitions; parent-ignorant children
//   docs/decisions/adr-029-*.md  — ActiveScope invariants / cross-tenant rejection
//   docs/decisions/adr-030-*.md  — flow_id key form / branch-relevant data flow
//   docs/evolution/2026-05-16-project-and-chat-session-management/design/application-architecture.md
//                                — machine SRP split (app-arch §2B)
//   docs/discussion/ui-state-vocabulary-audit/findings.md — vocabulary audit
//   ./README.md                  — overview, state diagram, full ADR list

import { assign, setup } from "xstate";

import {
  applyProjectReady,
  assignCreatedSession,
  assignResumedSession,
  assignSessionList,
  assignSwitchedDataset,
  captureDeeplinkResume,
  captureIntendedResource,
  capturePendingFirstMessage,
  capturePendingResumeIntent,
  clearErrorAndBumpRetries,
  clearPendingFirstMessage,
  clearResumeTarget,
  enterWelcomeReset,
  recordStaleSessionClicked,
  resetForProjectSwitch,
  tagDatasetDeniedClearPick,
  tagListDegraded,
  tagTransientCreating,
  tagTransientResuming,
  tagTransientSwitching,
} from "./setup/actions.ts";
import { buildActors, type SessionChatMachineDeps } from "./setup/actors.ts";
import { guards } from "./setup/guards.ts";
import type {
  SessionChatEvent,
  SessionChatInput,
  SessionChatMachineContext,
} from "./setup/types.ts";

export function createSessionChatMachine(deps: SessionChatMachineDeps) {
  return setup({
    types: {
      context: {} as SessionChatMachineContext,
      events: {} as SessionChatEvent,
      input: {} as SessionChatInput,
    },
    actors: buildActors(deps),
    guards,
    actions: {
      applyProjectReady: assign(applyProjectReady),
      resetForProjectSwitch: assign(resetForProjectSwitch),
      captureDeeplinkResume: assign(captureDeeplinkResume),
      clearPendingFirstMessage: assign(clearPendingFirstMessage),
      capturePendingResumeIntent: assign(capturePendingResumeIntent),
      capturePendingFirstMessage: assign(capturePendingFirstMessage),
      recordStaleSessionClicked: assign(recordStaleSessionClicked),
      captureIntendedResource: assign(captureIntendedResource),
      assignSessionList: assign(assignSessionList),
      enterWelcomeReset: assign(enterWelcomeReset),
      clearResumeTarget: assign(clearResumeTarget),
      assignResumedSession: assign(assignResumedSession),
      tagDatasetDeniedClearPick: assign(tagDatasetDeniedClearPick),
      assignSwitchedDataset: assign(assignSwitchedDataset),
      assignCreatedSession: assign(assignCreatedSession),
      tagListDegraded: assign(tagListDegraded),
      tagTransientResuming: assign(tagTransientResuming),
      tagTransientSwitching: assign(tagTransientSwitching),
      tagTransientCreating: assign(tagTransientCreating),
      clearErrorAndBumpRetries: assign(clearErrorAndBumpRetries),
    },
  }).createMachine({
    id: "session-chat",
    initial: "waiting_for_project",
    context: ({ input }) => ({
      request_id: input.request_id,
      principal_id: input.principal_id,
      org_id: input.org_id ?? "",
      project: {
        id: input.project_id ?? null,
        name: input.project_name ?? null,
      },
      session_list: [],
      session_list_next_cursor: null,
      session_list_has_more: false,
      session_id: null,
      transcript: [],
      resource: { type: null, id: null },
      intended_resource_id: null,
      intended_resource_type: null,
      pending_resume_session_id: input.deeplink_session_id ?? null,
      underlying_cause_tag: null,
      last_live_state: null,
      retries_count: 0,
      pending_first_message: "",
      stale_intents_dropped_count: 0,
      last_stale_intent: null,
    }),
    states: {
      waiting_for_project: {
        on: {
          project_ready: {
            target: "loading_session_list",
            actions: "applyProjectReady",
          },
        },
      },
      loading_session_list: {
        on: {
          // Re-broadcast from the orchestrator on project switch. Declaring
          // the handler here keeps the contract stable even when the only
          // project_ready path is the initial spawn.
          project_ready: {
            target: "loading_session_list",
            reenter: true,
            actions: ["resetForProjectSwitch", "captureDeeplinkResume"],
          },
        },
        invoke: {
          src: "loadSessionList",
          // LEAF-C: `pending_resume_session_id` rides INTO the actor's input
          // so the actor can echo it OUT as `resume_target`. The onDone branch
          // then reads from `event.output.resume_target` — branch data flows
          // through the actor's output channel, not via a context field set
          // before the invoke (Direction F).
          input: ({ context }) => ({
            project_id: context.project?.id ?? "",
            principal_id: context.principal_id,
            page_size: 30,
            pending_resume_session_id: context.pending_resume_session_id,
          }),
          onDone: [
            {
              // Deep-link continuation: the actor surfaces the forwarded
              // target via `event.output.resume_target`. The list still
              // loads (so the FE renders the sidebar) but the machine
              // settles in resuming_session. `resuming_session.invoke.input`
              // reads `context.pending_resume_session_id` (still populated
              // by the `project_ready` handler).
              guard: "hasResumeTarget",
              target: "resuming_session",
              actions: "assignSessionList",
            },
            {
              target: "session_list_loaded",
              actions: "assignSessionList",
            },
          ],
          onError: {
            target: "error_recoverable",
            actions: "tagListDegraded",
          },
        },
      },
      session_list_loaded: {
        on: {
          session_clicked: [
            {
              // DWD-7 stale-intent: a session_clicked targeting a session
              // absent from the current list (e.g. a replayed post-THAW click)
              // is silent-dropped — observability only. See isStaleSessionClick.
              guard: "isStaleSessionClick",
              actions: "recordStaleSessionClicked",
            },
            {
              target: "resuming_session",
              actions: "capturePendingResumeIntent",
            },
          ],
          new_session_clicked: {
            // US-206 / DWD-10: lazy-creation. Enter the welcome state with
            // session_id null; no backend write fires until `first_message_sent`.
            target: "session_welcome",
            actions: "enterWelcomeReset",
          },
          refresh_session_list: {
            target: "loading_session_list",
            reenter: true,
          },
          project_ready: [
            {
              guard: "isDifferentProject",
              target: "loading_session_list",
              actions: ["resetForProjectSwitch", "captureDeeplinkResume"],
            },
            // Same project_id — idempotent no-op (the existing actor ignores
            // the re-emission).
          ],
        },
      },
      resuming_session: {
        invoke: {
          src: "resumeSession",
          input: ({ context }) => ({
            session_id:
              context.pending_resume_session_id ?? context.session_id ?? "",
            project_id: context.project?.id ?? "",
            principal_id: context.principal_id,
          }),
          onDone: [
            {
              guard: "isSessionNotFound",
              target: "session_list_loaded",
              actions: "clearResumeTarget",
            },
            {
              // Atomic materialization per IC-J002-3 — see assignResumedSession.
              target: "session_active",
              actions: "assignResumedSession",
            },
          ],
          onError: {
            target: "error_recoverable",
            actions: "tagTransientResuming",
          },
        },
      },
      session_active: {
        on: {
          session_clicked: [
            {
              // DWD-7 stale-intent: a session_clicked targeting a session
              // absent from the current list (e.g. a replayed post-THAW click)
              // is silent-dropped — observability only. See isStaleSessionClick.
              guard: "isStaleSessionClick",
              actions: "recordStaleSessionClicked",
            },
            {
              target: "resuming_session",
              actions: "capturePendingResumeIntent",
            },
          ],
          refresh_session_list: {
            target: "loading_session_list",
            reenter: true,
          },
          // US-209 — a dataset pick (via the agent's resolve_dataset
          // tool-return path OR direct UI selection) moves the machine into
          // `switching_dataset_context`. Same payload shape for both; the
          // capture action records the pick for the invoke input.
          dataset_resolved_by_agent: {
            target: "switching_dataset_context",
            actions: "captureIntendedResource",
          },
          dataset_picked_directly: {
            target: "switching_dataset_context",
            actions: "captureIntendedResource",
          },
          project_ready: [
            {
              guard: "isDifferentProject",
              target: "loading_session_list",
              actions: "resetForProjectSwitch",
            },
          ],
        },
      },
      switching_dataset_context: {
        // Entry — orchestrator-side emission of
        // `switching_dataset_context_started` happens in orchestrator.ts
        // (the pre-settle branch, mirroring `switching_project_started`). The
        // `switchDatasetContext` invoke performs GET /api/datasets/:id
        // (ScopeResolver invariant 4 — cross-tenant + cross-project) then, on
        // pass, PATCH /api/projects/:pid/sessions/:sid { active_dataset_id }
        // (DWD-2 persist via the existing update_session allowlist).
        invoke: {
          src: "switchDatasetContext",
          input: ({ context }) => ({
            session_id: context.session_id ?? "",
            project_id: context.project?.id ?? "",
            principal_id: context.principal_id,
            intended_resource_id: context.intended_resource_id ?? "",
            intended_resource_type:
              context.intended_resource_type ?? ("dataset" as const),
            prior_resource: {
              type: context.resource.type,
              id: context.resource.id,
            },
          }),
          onDone: [
            {
              // ScopeResolver invariant 4 rejection (403 / 404 / cross-project):
              // leave `context.resource` UNCHANGED — see tagDatasetDeniedClearPick.
              guard: "isDatasetAccessDenied",
              target: "session_active",
              actions: "tagDatasetDeniedClearPick",
            },
            {
              // Validated + persisted: retarget `context.resource` (single
              // atomic assign per IC-J002-5) — see assignSwitchedDataset.
              target: "session_active",
              actions: "assignSwitchedDataset",
            },
          ],
          onError: {
            target: "error_recoverable",
            actions: "tagTransientSwitching",
          },
        },
      },
      session_welcome: {
        // US-206: the welcome state. Composer text lives in component-local
        // state on the FE AND in `pending_first_message` on the machine for
        // the error_recoverable → retry boundary.
        on: {
          // Idempotent — clicking "+ New Session" again from the welcome
          // state is a no-op (the FE button is the same; the machine
          // already has session_id=null).
          new_session_clicked: {
            target: "session_welcome",
            reenter: false,
          },
          // Clicking an existing session from the welcome state cancels
          // the new-session intent and resumes the clicked session.
          session_clicked: [
            {
              // DWD-7 stale-intent: a session_clicked targeting a session
              // absent from the current list (e.g. a replayed post-THAW click)
              // is silent-dropped — observability only. See isStaleSessionClick.
              guard: "isStaleSessionClick",
              actions: "recordStaleSessionClicked",
            },
            {
              target: "resuming_session",
              actions: "capturePendingResumeIntent",
            },
          ],
          // Eager create on first message. The actor POSTs the session
          // row + PATCHes the title; on settle we transition to session_active.
          first_message_sent: {
            target: "creating_session",
            actions: "capturePendingFirstMessage",
          },
          // Switching project from the welcome state navigates away —
          // re-enters loading_session_list for the new project. NO
          // session row was ever created (the no-ghost-row invariant).
          project_ready: [
            {
              guard: "isDifferentProject",
              target: "loading_session_list",
              actions: ["resetForProjectSwitch", "clearPendingFirstMessage"],
            },
            // Same project_id — idempotent no-op (project_ready re-emission).
          ],
        },
      },
      creating_session: {
        invoke: {
          src: "createSessionEagerly",
          input: ({ context }) => ({
            project_id: context.project?.id ?? "",
            principal_id: context.principal_id,
            first_message: context.pending_first_message,
          }),
          onDone: {
            target: "session_active",
            actions: "assignCreatedSession",
          },
          onError: {
            target: "error_recoverable",
            actions: "tagTransientCreating",
          },
        },
      },
      error_recoverable: {
        on: {
          retry_clicked: [
            {
              guard: "wasLoadingList",
              target: "loading_session_list",
              reenter: true,
              actions: "clearErrorAndBumpRetries",
            },
            {
              guard: "wasResuming",
              target: "resuming_session",
              reenter: true,
              actions: "clearErrorAndBumpRetries",
            },
            {
              // US-206: retry from a failed eager-create returns to the
              // welcome state with `pending_first_message` intact (the
              // composer-state preservation contract).
              guard: "wasWelcome",
              target: "session_welcome",
              actions: "clearErrorAndBumpRetries",
            },
            {
              // US-209: retry from a transient switchDatasetContext failure
              // re-enters the switch with the captured pick still in ctx.
              guard: "wasSwitchingDataset",
              target: "switching_dataset_context",
              reenter: true,
              actions: "clearErrorAndBumpRetries",
            },
          ],
        },
      },
    },
  });
}
