// SessionChatMachine — XState v5 statechart for J-002's session-chat half.
//
// Per `docs/feature/project-and-chat-session-management/design/application-architecture.md`
// §2B (post-DWD-13 SRP amendment) this machine owns "What's happening in my
// current session?" — session list visibility, resume, new-session lifecycle,
// dataset attachment within the session, and the chat-turn-emitting states.
// It owns the `resource_*` half of `active_scope`.
//
// MR-1.5 surface (THIS MR — DWD-13 §"MR-to-machine implementation guidance"):
//   waiting_for_project (initial) ─→ self (project_ready event populates context)
//
// MR-2 will replace the `project_ready` handler to target `loading_session_list`
// (and `resuming_session` when intent_session_id is present) and add the four
// session-list / resume / active states. MR-3 adds `session_active_no_messages`.
// MR-5 adds `switching_dataset_context`. MR-6 adds top-level `on.FREEZE` +
// `freeze` side-state.
//
// ADR-028:46-48 invariant: this file does NOT import from `project-context.ts`
// or `login-and-org-setup.ts`. The orchestrator mediates all cross-machine
// entry (`project_ready` from project-context arrives via orchestrator broadcast
// on entry into `project_selected`, carrying org_id + project_id + project_name
// + forwarded intent fields).

import { assign, setup } from "xstate";

import type { ActiveScope, ResourceType } from "../active-scope.ts";

export type SessionChatState =
  // MR-1.5 (stub):
  | "waiting_for_project"
  // Reserved for MR-2..MR-6 (declared here so the type stays stable across
  // future MRs; no XState state declares them yet in MR-1.5):
  | "loading_session_list"
  | "session_list_visible"
  | "resuming_session"
  | "session_active_no_messages"
  | "session_active"
  | "switching_dataset_context"
  | "error_recoverable"
  | "freeze";

export interface SessionSummary {
  id: string;
  title: string | null;
  last_active_at: string;
  active_dataset_id: string | null;
}

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  ts: string;
}

export type SessionChatCauseTag =
  | "transient"
  | "list_sessions_degraded"
  | "session_not_found"
  | "dataset_not_found"
  | "dataset_access_denied"
  | "replay_abandoned";

export interface SessionChatMachineContext {
  correlation_id: string;
  principal_id: string;

  // Received via `project_ready` orchestrator broadcast — populated on entry
  // out of `waiting_for_project` (MR-2 lifts the transition target):
  org_id: string;
  project_id: string | null;
  project_name: string | null;

  // Session list state — populated on session_list_visible entry (MR-2):
  session_list: SessionSummary[];
  session_list_next_cursor: string | null;

  // Active session — populated on session_active entry (MR-2 + MR-3):
  session_id: string | null;
  transcript: TranscriptMessage[];

  // Active resource (dataset) — populated on session_active entry +
  // switching_dataset_context exit (MR-5):
  resource: { type: ResourceType | null; id: string | null };

  // Deep-link intent payloads forwarded by project-context via the
  // `project_ready` event payload (per DESIGN §3.4):
  intent_session_id: string | null;
  intent_resource_id: string | null;
  intent_resource_type: ResourceType | null;

  // Cross-state plumbing:
  underlying_cause_tag: SessionChatCauseTag | null;
  last_live_state: SessionChatState | null;
  retries: number;
  /** Composer text preserved across session_active_no_messages ↔ error_recoverable (MR-3). */
  pending_first_message: string;

  // Observability counters:
  stale_intents_dropped_count: number;
}

export type SessionChatEvent =
  // External (MR-2..MR-5):
  | { type: "session_clicked"; session_id: string }
  | { type: "new_session_clicked" }
  | { type: "first_message_sent"; content: string }
  | { type: "dataset_resolved_by_agent"; resource_id: string; resource_type: ResourceType }
  | { type: "dataset_picked_directly"; resource_id: string; resource_type: ResourceType }
  | { type: "retry_clicked" }
  | { type: "suggestion_chip_clicked_upload" }
  | { type: "suggestion_chip_clicked_browse_projects" }
  // Cross-machine (orchestrator-emitted; never FE-emitted):
  | {
      type: "project_ready";
      org_id: string;
      project_id: string;
      project_name: string;
      correlation_id: string;
      intent_session_id?: string | null;
      intent_resource_id?: string | null;
      intent_resource_type?: ResourceType | null;
    }
  | { type: "FREEZE"; origin_correlation_id?: string }
  | { type: "THAW" };

/**
 * Per DESIGN §2.1.B the session-chat machine's deps will carry actors for
 * `loadSessionList`, `resumeSession`, `createSessionEagerly`, and
 * `switchDatasetContext` when MR-2..MR-5 land them. For MR-1.5 the stub
 * declares no invokes (waiting_for_project is interactive-wait-only), so the
 * deps interface is empty. MR-2's crafter extends it without restructuring.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SessionChatMachineDeps {
  // (No actor wirings in MR-1.5. MR-2 adds `loadSessionList`, `resumeSession`.)
}

export function createSessionChatMachine(_deps: SessionChatMachineDeps) {
  return setup({
    types: {
      context: {} as SessionChatMachineContext,
      events: {} as SessionChatEvent,
      input: {} as {
        correlation_id: string;
        principal_id: string;
        // Optional inputs forwarded by the orchestrator on spawn; the
        // canonical population path is the `project_ready` event (handled in
        // `waiting_for_project` below) so the spawn-time fields can be
        // omitted and the actor still settles correctly.
        org_id?: string;
        project_id?: string;
        project_name?: string;
        intent_session_id?: string | null;
        intent_resource_id?: string | null;
        intent_resource_type?: ResourceType | null;
      },
    },
  }).createMachine({
    id: "session-chat",
    initial: "waiting_for_project",
    context: ({ input }) => ({
      correlation_id: input.correlation_id,
      principal_id: input.principal_id,
      org_id: input.org_id ?? "",
      project_id: input.project_id ?? null,
      project_name: input.project_name ?? null,
      session_list: [],
      session_list_next_cursor: null,
      session_id: null,
      transcript: [],
      resource: { type: null, id: null },
      intent_session_id: input.intent_session_id ?? null,
      intent_resource_id: input.intent_resource_id ?? null,
      intent_resource_type: input.intent_resource_type ?? null,
      underlying_cause_tag: null,
      last_live_state: null,
      retries: 0,
      pending_first_message: "",
      stale_intents_dropped_count: 0,
    }),
    states: {
      waiting_for_project: {
        on: {
          // MR-1.5 stub: receive the orchestrator's `project_ready` broadcast
          // and assign the forwarded context fields. The transition target is
          // self (stay in waiting_for_project) because MR-2 hasn't landed
          // `loading_session_list` yet. MR-2's crafter replaces this handler
          // with `target: "loading_session_list"` (or `"resuming_session"`
          // when `intent_session_id` is present) per DESIGN §2.3.B.
          project_ready: {
            target: "waiting_for_project",
            reenter: false,
            actions: assign({
              org_id: ({ event }) => event.org_id,
              project_id: ({ event }) => event.project_id,
              project_name: ({ event }) => event.project_name,
              correlation_id: ({ event, context }) =>
                event.correlation_id ?? context.correlation_id,
              intent_session_id: ({ event, context }) =>
                event.intent_session_id ?? context.intent_session_id,
              intent_resource_id: ({ event, context }) =>
                event.intent_resource_id ?? context.intent_resource_id,
              intent_resource_type: ({ event, context }) =>
                event.intent_resource_type ?? context.intent_resource_type,
            }),
          },
        },
      },
    },
  });
}

// Re-export ActiveScope so callers don't need a separate import path.
export type { ActiveScope };
