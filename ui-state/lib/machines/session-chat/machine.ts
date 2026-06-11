// SessionChatMachine — XState v5 statechart for J-002's session-chat half.
//
// This machine owns "What's happening in my current session?" — session list
// visibility, resume, new-session lifecycle, dataset attachment within the
// session, and the chat-turn-emitting states. It owns the `resource_*` half of
// `active_scope`.
//
// State surface (REPORT-DRIVEN — ADR-049 §4 / ADR-050 §e.5, DR-8/AR-8): zero
// egress. The machine invokes NO server-side actors; each surviving UI intent
// SETTLES in a no-invoke state until the matching CLIENT-REPORTED past-tense
// OUTCOME arrives, which it transitions on.
//
//   waiting_for_project (initial)      ─→ awaiting_session_list_report (project_ready)
//   awaiting_session_list_report       ─┬─→ session_list_loaded   (session_list_loaded report)
//                                        └─→ error_recoverable     (session_list_failed report)
//   session_list_loaded                ─┬─→ session_active         (session_resumed ← session_clicked)
//                                        ├─→ error_recoverable      (session_resume_failed)
//                                        ├─→ session_welcome        (new_session_clicked)
//                                        └─→ awaiting_session_list_report (refresh_session_list)
//   session_welcome                    ─┬─→ session_active         (session_created ← first_message_sent)
//                                        └─→ error_recoverable      (session_create_failed)
//   session_active                     ─┬─→ session_active         (dataset_context_switched ← dataset pick)
//                                        └─→ error_recoverable      (dataset_context_switch_failed)
//   error_recoverable                  ─→ session_list_loaded / awaiting_session_list_report
//                                          (session_list_loaded report / refresh_session_list)
//
// Cross-machine isolation invariant: this file does NOT import from
// `project-context.ts` or `login-and-org-setup.ts`. The orchestrator mediates
// all cross-machine entry (`project_ready` from project-context arrives via
// orchestrator broadcast on entry into `project_selected`, carrying org_id +
// project_id + project_name + forwarded intent fields).
//
// This file is MAPPING ONLY: it wires the setup pieces and lays out the state
// transitions. The pieces live under ./setup/ —
//   - actors.ts   — the (now empty) `buildActors(deps)` seam — report-driven
//                   session-chat invokes NO actors (egress retired, DR-8)
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
  clearPendingFirstMessage,
  enterWelcomeReset,
  recordStaleSessionClicked,
  resetForProjectSwitch,
  tagCreateFailed,
  tagListFailed,
  tagResumeFailed,
  tagSwitchFailed,
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
      assignResumedSession: assign(assignResumedSession),
      assignSwitchedDataset: assign(assignSwitchedDataset),
      assignCreatedSession: assign(assignCreatedSession),
      tagListFailed: assign(tagListFailed),
      tagResumeFailed: assign(tagResumeFailed),
      tagCreateFailed: assign(tagCreateFailed),
      tagSwitchFailed: assign(tagSwitchFailed),
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
            target: "awaiting_session_list_report",
            actions: "applyProjectReady",
          },
        },
      },
      // No-invoke WAITING state (the report-driven successor to the retired
      // loading_session_list invoke). The client probes GET /sessions and
      // reports session_list_loaded / session_list_failed; the machine settles
      // here until one arrives (zero egress).
      awaiting_session_list_report: {
        on: {
          session_list_loaded: {
            target: "session_list_loaded",
            actions: "assignSessionList",
          },
          session_list_failed: {
            target: "error_recoverable",
            actions: "tagListFailed",
          },
          // Re-broadcast from the orchestrator on project switch. Declaring the
          // handler here keeps the contract stable while waiting for the report.
          project_ready: {
            target: "awaiting_session_list_report",
            reenter: true,
            actions: ["resetForProjectSwitch", "captureDeeplinkResume"],
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
              // SETTLE waiting for the client's session_resumed report.
              actions: "capturePendingResumeIntent",
            },
          ],
          // The client reports the resume outcome (zero egress).
          session_resumed: {
            // Atomic materialization per IC-J002-3 — see assignResumedSession.
            target: "session_active",
            actions: "assignResumedSession",
          },
          session_resume_failed: {
            target: "error_recoverable",
            actions: "tagResumeFailed",
          },
          new_session_clicked: {
            // US-206 / DWD-10: lazy-creation. Enter the welcome state with
            // session_id null; no session row exists until session_created.
            target: "session_welcome",
            actions: "enterWelcomeReset",
          },
          refresh_session_list: {
            target: "awaiting_session_list_report",
            reenter: true,
          },
          project_ready: [
            {
              guard: "isDifferentProject",
              target: "awaiting_session_list_report",
              actions: ["resetForProjectSwitch", "captureDeeplinkResume"],
            },
            // Same project_id — idempotent no-op.
          ],
        },
      },
      session_active: {
        on: {
          session_clicked: [
            {
              guard: "isStaleSessionClick",
              actions: "recordStaleSessionClicked",
            },
            {
              // SETTLE waiting for the client's session_resumed report.
              actions: "capturePendingResumeIntent",
            },
          ],
          session_resumed: {
            target: "session_active",
            actions: "assignResumedSession",
          },
          session_resume_failed: {
            target: "error_recoverable",
            actions: "tagResumeFailed",
          },
          refresh_session_list: {
            target: "awaiting_session_list_report",
            reenter: true,
          },
          // US-209 — a dataset pick (agent resolve_dataset tool-return OR direct
          // UI selection) captures the pick and SETTLES waiting for the client's
          // dataset_context_switched report.
          dataset_resolved_by_agent: {
            actions: "captureIntendedResource",
          },
          dataset_picked_directly: {
            actions: "captureIntendedResource",
          },
          dataset_context_switched: {
            // Validated + persisted by the client; retarget context.resource
            // (single atomic assign per IC-J002-5) — see assignSwitchedDataset.
            target: "session_active",
            actions: "assignSwitchedDataset",
          },
          dataset_context_switch_failed: {
            target: "error_recoverable",
            actions: "tagSwitchFailed",
          },
          project_ready: [
            {
              guard: "isDifferentProject",
              target: "awaiting_session_list_report",
              actions: "resetForProjectSwitch",
            },
          ],
        },
      },
      session_welcome: {
        // US-206: the welcome state. Composer text lives in component-local
        // state on the FE AND in `pending_first_message` on the machine for the
        // error_recoverable boundary.
        on: {
          // Idempotent — clicking "+ New Session" again from the welcome state
          // is a no-op (the machine already has session_id=null).
          new_session_clicked: {
            target: "session_welcome",
            reenter: false,
          },
          // Clicking an existing session cancels the new-session intent and
          // SETTLES waiting for the client's session_resumed report.
          session_clicked: [
            {
              guard: "isStaleSessionClick",
              actions: "recordStaleSessionClicked",
            },
            {
              actions: "capturePendingResumeIntent",
            },
          ],
          session_resumed: {
            target: "session_active",
            actions: "assignResumedSession",
          },
          // First message preserves the composer text and SETTLES waiting for
          // the client's session_created report.
          first_message_sent: {
            actions: "capturePendingFirstMessage",
          },
          session_created: {
            target: "session_active",
            actions: "assignCreatedSession",
          },
          session_create_failed: {
            target: "error_recoverable",
            actions: "tagCreateFailed",
          },
          // Switching project from the welcome state navigates away —
          // re-enters the awaiting state for the new project. NO session row
          // was ever created (the no-ghost-row invariant).
          project_ready: [
            {
              guard: "isDifferentProject",
              target: "awaiting_session_list_report",
              actions: ["resetForProjectSwitch", "clearPendingFirstMessage"],
            },
            // Same project_id — idempotent no-op.
          ],
        },
      },
      error_recoverable: {
        on: {
          // Report-driven recovery: the client re-probes and reports. A fresh
          // session-list report converges the recoverable error back to the
          // list; a refresh intent re-enters the awaiting state.
          session_list_loaded: {
            target: "session_list_loaded",
            actions: "assignSessionList",
          },
          refresh_session_list: {
            target: "awaiting_session_list_report",
            reenter: true,
          },
        },
      },
    },
  });
}
