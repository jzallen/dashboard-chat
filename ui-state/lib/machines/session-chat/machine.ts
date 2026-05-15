// SessionChatMachine — XState v5 statechart for J-002's session-chat half.
//
// Per `docs/feature/project-and-chat-session-management/design/application-architecture.md`
// §2B (post-DWD-13 SRP amendment) this machine owns "What's happening in my
// current session?" — session list visibility, resume, new-session lifecycle,
// dataset attachment within the session, and the chat-turn-emitting states.
// It owns the `resource_*` half of `active_scope`.
//
// MR-2 surface (THIS MR — DWD-13 §"MR-to-machine implementation guidance"):
//   waiting_for_project (initial) ─→ loading_session_list           (project_ready)
//   loading_session_list (invoke)  ─┬─→ session_list_loaded        (onDone, no pending_resume_session_id)
//                                    ├─→ resuming_session            (onDone, pending_resume_session_id present)
//                                    └─→ error_recoverable           (onError, transient)
//   session_list_loaded          ─┬─→ resuming_session              (session_clicked)
//                                    └─→ loading_session_list         (refresh_session_list)
//   resuming_session (invoke)     ─┬─→ session_active                (onDone, found)
//                                    ├─→ session_list_loaded         (onDone, session_not_found — silent)
//                                    └─→ error_recoverable            (onError, transient)
//   session_active                (read-only path for MR-2; write path lands MR-3+)
//   error_recoverable             ─→ last_live_state                  (retry_clicked)
//
// MR-3 will add `session_welcome` + `createSessionEagerly`; MR-5
// adds `switching_dataset_context`; MR-6 adds top-level `on.FREEZE` + `freeze`.
//
// ADR-028:46-48 invariant: this file does NOT import from `project-context.ts`
// or `login-and-org-setup.ts`. The orchestrator mediates all cross-machine
// entry (`project_ready` from project-context arrives via orchestrator broadcast
// on entry into `project_selected`, carrying org_id + project_id + project_name
// + forwarded intent fields).

import { assign, fromPromise, setup } from "xstate";

import type { ActiveScope, ResourceType } from "../../active-scope.ts";

export type SessionChatState =
  | "waiting_for_project"
  | "loading_session_list"
  | "session_list_loaded"
  | "resuming_session"
  | "session_welcome"
  | "creating_session"
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
  // out of `waiting_for_project`:
  org_id: string;
  project: { id: string | null; name: string | null };

  // Session list state — populated on session_list_loaded entry:
  session_list: SessionSummary[];
  session_list_next_cursor: string | null;
  session_list_has_more: boolean;

  // Active session — populated on session_active entry (MR-2 read path; MR-3 write path):
  session_id: string | null;
  transcript: TranscriptMessage[];

  // Active resource (dataset) — populated on session_active entry from
  // `session.active_dataset_id` (MR-2 read path); switching_dataset_context exit (MR-5):
  resource: { type: ResourceType | null; id: string | null };

  // Pending session-resume target — populated EITHER by the inbound
  // `project_ready` payload's `deeplink_session_id` key (URL-level wish
  // forwarded by project-context per audit §5 / MR-D) OR by a
  // `session_clicked` event (capturePendingResumeIntent action). Both
  // paths feed the same downstream consumer: the `loading_session_list →
  // resuming_session` branch reads the actor output's `resume_target`
  // (which echoes `input.pending_resume_session_id`) and the
  // `resuming_session.invoke.input` reads ctx directly for the session
  // id to resume. Cleared by the resume actor's onDone.
  //
  // `intent_resource_id` / `intent_resource_type` were previously
  // captured here but the session-chat machine never read them after
  // capture (the MR-5+ dataset-switching events carry the resource id/
  // type directly in their payload — see SessionChatEvent's
  // `dataset_resolved_by_agent` and `dataset_picked_directly` variants).
  // Per app-arch §3.4 they no longer touch this ctx — the orchestrator
  // forwards them directly from the `open_deep_link` event payload into
  // the `project_ready` broadcast, and the session-chat input/event
  // surface still accepts them as no-op forward-compat slots.
  pending_resume_session_id: string | null;

  // Cross-state plumbing:
  underlying_cause_tag: SessionChatCauseTag | null;
  last_live_state: SessionChatState | null;
  retries_count: number;
  /** Composer text preserved across session_welcome ↔ error_recoverable (MR-3). */
  pending_first_message: string;

  // Observability counters:
  stale_intents_dropped_count: number;
}

export type SessionChatEvent =
  // External (MR-2..MR-5):
  | { type: "session_clicked"; session_id: string }
  | { type: "new_session_clicked" }
  | { type: "first_message_sent"; content: string }
  | { type: "refresh_session_list" }
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
      // The URL-level deep-link session wish (renamed from
      // intent_session_id in MR-D). Captured into
      // pending_resume_session_id on entry.
      deeplink_session_id?: string | null;
      // Forward-compat slots — accepted but no longer stored on ctx
      // (the orchestrator routes them through the wire/projection
      // directly per MR-D). Kept on the event surface for the
      // open_deep_link follow-up MR that will rename them.
      intent_resource_id?: string | null;
      intent_resource_type?: ResourceType | null;
    }
  | { type: "FREEZE"; origin_correlation_id?: string }
  | { type: "THAW" };

// ─────────────────────────── Actor input / output ───────────────────────────

export interface LoadSessionListInput {
  project_id: string;
  principal_id: string;
  page_size?: number;
  /** Pending session-resume target forwarded from ctx. The actor echoes
   *  this through `resume_target` on its output so the
   *  `loading_session_list → resuming_session` branch can guard on
   *  `event.output.resume_target` instead of reading
   *  `ctx.pending_resume_session_id` (ADR-030 §"Migration sequencing"
   *  LEAF-C; ADR-028 Direction F — branch-relevant data MUST flow
   *  through `event.output`, never through context set before the
   *  invoke). */
  pending_resume_session_id?: string | null;
}

export interface LoadSessionListOutput {
  items: SessionSummary[];
  next_cursor: string | null;
  has_more: boolean;
  /** Echoes `input.pending_resume_session_id` so the `onDone` branch can
   *  pick between `session_list_loaded` and `resuming_session` without
   *  reading `ctx.pending_resume_session_id` (ADR-030 §254 / ADR-028
   *  Amendment 2026-05-15 Direction F). Null when no resume target was
   *  carried in. */
  resume_target: string | null;
}

export type LoadSessionListActor = ReturnType<
  typeof fromPromise<LoadSessionListOutput, LoadSessionListInput>
>;

export interface ResumeSessionInput {
  session_id: string;
  project_id: string;
  principal_id: string;
}

export type ResumeSessionOutput =
  | {
      session_id: string;
      transcript: TranscriptMessage[];
      active_dataset_id: string | null;
      /** Set when active_dataset_id resolves to a deleted/404 dataset — the
       *  resource_* fields stay null and the projection emits
       *  session_dataset_unavailable per US-205 Example 3. */
      dataset_unavailable?: boolean;
    }
  | { session_not_found: true };

export type ResumeSessionActor = ReturnType<
  typeof fromPromise<ResumeSessionOutput, ResumeSessionInput>
>;

/** US-206 / DWD-10 lazy-creation: invoked on `first_message_sent` from the
 *  welcome state. POSTs to `/api/projects/:id/sessions` and PATCHes the
 *  title in one fire-and-await sequence so the test can observe the title
 *  by the time `session_active` settles. */
export interface CreateSessionEagerlyInput {
  project_id: string;
  principal_id: string;
  first_message: string;
}

export interface CreateSessionEagerlyOutput {
  session_id: string;
}

export type CreateSessionEagerlyActor = ReturnType<
  typeof fromPromise<CreateSessionEagerlyOutput, CreateSessionEagerlyInput>
>;

export interface SessionChatMachineDeps {
  /** Optional in MR-1.5; MR-2+ provides the real actor implementation. When
   *  absent, the machine still spawns into `waiting_for_project` cleanly —
   *  the project_ready transition fires but loadSessionList throws when
   *  invoked, surfacing as error_recoverable. */
  loadSessionList?: LoadSessionListActor;
  resumeSession?: ResumeSessionActor;
  /** MR-3 (US-206): invoked on `first_message_sent` from the welcome state.
   *  Absent → first_message_sent surfaces error_recoverable (consistent with
   *  the noop-actor pattern used for loadSessionList / resumeSession). */
  createSessionEagerly?: CreateSessionEagerlyActor;
}

// ──────────────────────────── Factory ────────────────────────────

export function createSessionChatMachine(deps: SessionChatMachineDeps) {
  // The noop actor is used when a dep is not provided — keeps the type system
  // happy and surfaces a clean error_recoverable rather than crashing the
  // orchestrator with an "unknown actor src" error if a future caller forgets
  // to wire the dep.
  const noopLoadSessionList: LoadSessionListActor =
    deps.loadSessionList ??
    fromPromise<LoadSessionListOutput, LoadSessionListInput>(async () => {
      throw new Error("loadSessionList actor not wired");
    });
  const noopResumeSession: ResumeSessionActor =
    deps.resumeSession ??
    fromPromise<ResumeSessionOutput, ResumeSessionInput>(async () => {
      throw new Error("resumeSession actor not wired");
    });
  const noopCreateSessionEagerly: CreateSessionEagerlyActor =
    deps.createSessionEagerly ??
    fromPromise<CreateSessionEagerlyOutput, CreateSessionEagerlyInput>(
      async () => {
        throw new Error("createSessionEagerly actor not wired");
      },
    );

  return setup({
    types: {
      context: {} as SessionChatMachineContext,
      events: {} as SessionChatEvent,
      input: {} as {
        correlation_id: string;
        principal_id: string;
        org_id?: string;
        project_id?: string;
        project_name?: string;
        // URL-level wish at spawn time — captured into
        // pending_resume_session_id. Renamed from intent_session_id in
        // MR-D to disambiguate it from the click-captured resume target
        // (audit §5 / §7 Tier-1 #2).
        deeplink_session_id?: string | null;
        // Forward-compat — no longer stored on ctx (audit §7 Tier-1 #2).
        intent_resource_id?: string | null;
        intent_resource_type?: ResourceType | null;
      },
    },
    actors: {
      loadSessionList: noopLoadSessionList,
      resumeSession: noopResumeSession,
      createSessionEagerly: noopCreateSessionEagerly,
    },
    actions: {
      capturePendingResumeIntent: assign({
        pending_resume_session_id: ({ event, context }) =>
          event.type === "session_clicked"
            ? event.session_id
            : context.pending_resume_session_id,
      }),
      capturePendingFirstMessage: assign({
        pending_first_message: ({ event, context }) =>
          event.type === "first_message_sent"
            ? event.content
            : context.pending_first_message,
      }),
    },
  }).createMachine({
    id: "session-chat",
    initial: "waiting_for_project",
    context: ({ input }) => ({
      correlation_id: input.correlation_id,
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
      pending_resume_session_id: input.deeplink_session_id ?? null,
      underlying_cause_tag: null,
      last_live_state: null,
      retries_count: 0,
      pending_first_message: "",
      stale_intents_dropped_count: 0,
    }),
    states: {
      waiting_for_project: {
        on: {
          project_ready: {
            target: "loading_session_list",
            actions: assign({
              org_id: ({ event }) => event.org_id,
              project: ({ event }) => ({
                id: event.project_id,
                name: event.project_name,
              }),
              correlation_id: ({ event, context }) =>
                event.correlation_id ?? context.correlation_id,
              pending_resume_session_id: ({ event, context }) =>
                event.deeplink_session_id ?? context.pending_resume_session_id,
            }),
          },
        },
      },
      loading_session_list: {
        on: {
          // Re-broadcast from the orchestrator on project switch (MR-4).
          // For MR-2 the only project_ready path is the initial spawn — but
          // declaring the handler keeps the contract stable.
          project_ready: {
            target: "loading_session_list",
            reenter: true,
            actions: assign({
              org_id: ({ event }) => event.org_id,
              project: ({ event }) => ({
                id: event.project_id,
                name: event.project_name,
              }),
              correlation_id: ({ event, context }) =>
                event.correlation_id ?? context.correlation_id,
              session_id: () => null,
              transcript: () => [],
              resource: () => ({ type: null, id: null }),
              session_list: () => [],
              pending_resume_session_id: ({ event, context }) =>
                event.deeplink_session_id ?? context.pending_resume_session_id,
            }),
          },
        },
        invoke: {
          src: "loadSessionList",
          // ADR-030 LEAF-C: `pending_resume_session_id` rides INTO the
          // actor's input so the actor can echo it OUT as `resume_target`.
          // The onDone branch then reads from `event.output.resume_target`
          // — branch data flows through the actor's output channel, not
          // via a context field set before the invoke (ADR-028 Amendment
          // 2026-05-15 Direction F, ADR-030 §254).
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
              // by the `project_ready` handler) — that context field is
              // the per-MR-D split for the resume half (audit §7 Tier-1
              // #2).
              guard: ({ event }) => event.output.resume_target !== null,
              target: "resuming_session",
              actions: assign({
                session_list: ({ event }) => event.output.items,
                session_list_next_cursor: ({ event }) => event.output.next_cursor,
                session_list_has_more: ({ event }) => event.output.has_more,
              }),
            },
            {
              target: "session_list_loaded",
              actions: assign({
                session_list: ({ event }) => event.output.items,
                session_list_next_cursor: ({ event }) => event.output.next_cursor,
                session_list_has_more: ({ event }) => event.output.has_more,
              }),
            },
          ],
          onError: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: () => "list_sessions_degraded" as const,
              last_live_state: () => "loading_session_list" as const,
            }),
          },
        },
      },
      session_list_loaded: {
        on: {
          session_clicked: {
            target: "resuming_session",
            actions: "capturePendingResumeIntent",
          },
          new_session_clicked: {
            // US-206 / DWD-10: lazy-creation. Enter the welcome state with
            // session_id null; no backend write fires until `first_message_sent`.
            target: "session_welcome",
            actions: assign({
              session_id: () => null,
              transcript: () => [],
              resource: () => ({ type: null, id: null }),
              pending_first_message: () => "",
            }),
          },
          refresh_session_list: {
            target: "loading_session_list",
            reenter: true,
          },
          project_ready: [
            {
              guard: ({ context, event }) => context.project?.id !== event.project_id,
              target: "loading_session_list",
              actions: assign({
                org_id: ({ event }) => event.org_id,
                project: ({ event }) => ({
                  id: event.project_id,
                  name: event.project_name,
                }),
                correlation_id: ({ event, context }) =>
                  event.correlation_id ?? context.correlation_id,
                session_id: () => null,
                transcript: () => [],
                resource: () => ({ type: null, id: null }),
                session_list: () => [],
                pending_resume_session_id: ({ event, context }) =>
                  event.deeplink_session_id ?? context.pending_resume_session_id,
              }),
            },
            // Same project_id — idempotent no-op (the existing actor ignores
            // the re-emission per DESIGN §3.2.B).
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
              guard: ({ event }) =>
                (event.output as { session_not_found?: true }).session_not_found === true,
              target: "session_list_loaded",
              actions: assign({
                // Silent return per US-205 Example 4 — clear the pending
                // resume target so we don't loop on re-emission.
                pending_resume_session_id: () => null,
                session_id: () => null,
                transcript: () => [],
                resource: () => ({ type: null, id: null }),
                underlying_cause_tag: () => null,
              }),
            },
            {
              // Atomic materialization per IC-J002-3: transcript AND resource
              // are populated in a SINGLE assign before transitioning to
              // session_active. There is no intermediate snapshot where one
              // is set but not the other.
              target: "session_active",
              actions: assign({
                session_id: ({ event }) => {
                  const out = event.output as {
                    session_id: string;
                    transcript: TranscriptMessage[];
                    active_dataset_id: string | null;
                  };
                  return out.session_id;
                },
                transcript: ({ event }) => {
                  const out = event.output as {
                    transcript: TranscriptMessage[];
                  };
                  return out.transcript;
                },
                resource: ({ event }) => {
                  const out = event.output as {
                    active_dataset_id: string | null;
                    dataset_unavailable?: boolean;
                  };
                  if (out.dataset_unavailable === true || out.active_dataset_id === null) {
                    return { type: null, id: null };
                  }
                  return { type: "dataset" as ResourceType, id: out.active_dataset_id };
                },
                underlying_cause_tag: ({ event }) => {
                  const out = event.output as { dataset_unavailable?: boolean };
                  return out.dataset_unavailable === true ? "dataset_not_found" : null;
                },
                pending_resume_session_id: () => null,
              }),
            },
          ],
          onError: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: () => "transient" as const,
              last_live_state: () => "resuming_session" as const,
            }),
          },
        },
      },
      session_active: {
        on: {
          session_clicked: {
            target: "resuming_session",
            actions: "capturePendingResumeIntent",
          },
          refresh_session_list: {
            target: "loading_session_list",
            reenter: true,
          },
          project_ready: [
            {
              guard: ({ context, event }) => context.project?.id !== event.project_id,
              target: "loading_session_list",
              actions: assign({
                org_id: ({ event }) => event.org_id,
                project: ({ event }) => ({
                  id: event.project_id,
                  name: event.project_name,
                }),
                correlation_id: ({ event, context }) =>
                  event.correlation_id ?? context.correlation_id,
                session_id: () => null,
                transcript: () => [],
                resource: () => ({ type: null, id: null }),
                session_list: () => [],
              }),
            },
          ],
        },
      },
      session_welcome: {
        // US-206: the welcome state. Composer text lives in component-local
        // state on the FE per app-arch §6.4 AND in `pending_first_message`
        // on the machine for the error_recoverable → retry boundary.
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
          session_clicked: {
            target: "resuming_session",
            actions: "capturePendingResumeIntent",
          },
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
              guard: ({ context, event }) =>
                context.project?.id !== event.project_id,
              target: "loading_session_list",
              actions: assign({
                org_id: ({ event }) => event.org_id,
                project: ({ event }) => ({
                  id: event.project_id,
                  name: event.project_name,
                }),
                correlation_id: ({ event, context }) =>
                  event.correlation_id ?? context.correlation_id,
                session_id: () => null,
                transcript: () => [],
                resource: () => ({ type: null, id: null }),
                session_list: () => [],
                pending_first_message: () => "",
              }),
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
            actions: assign({
              session_id: ({ event }) => event.output.session_id,
              transcript: () => [],
              resource: () => ({ type: null, id: null }),
              pending_first_message: () => "",
              underlying_cause_tag: () => null,
            }),
          },
          onError: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: () => "transient" as const,
              last_live_state: () => "session_welcome" as const,
            }),
          },
        },
      },
      error_recoverable: {
        on: {
          retry_clicked: [
            {
              guard: ({ context }) => context.last_live_state === "loading_session_list",
              target: "loading_session_list",
              reenter: true,
              actions: assign({
                underlying_cause_tag: () => null,
                retries_count: ({ context }) => context.retries_count + 1,
              }),
            },
            {
              guard: ({ context }) => context.last_live_state === "resuming_session",
              target: "resuming_session",
              reenter: true,
              actions: assign({
                underlying_cause_tag: () => null,
                retries_count: ({ context }) => context.retries_count + 1,
              }),
            },
            {
              // US-206: retry from a failed eager-create returns to the
              // welcome state with `pending_first_message` intact (app-arch
              // §6.4 composer-state preservation contract).
              guard: ({ context }) =>
                context.last_live_state === "session_welcome",
              target: "session_welcome",
              actions: assign({
                underlying_cause_tag: () => null,
                retries_count: ({ context }) => context.retries_count + 1,
              }),
            },
          ],
        },
      },
    },
  });
}

// ─────────────────────────── Production actor factories ───────────────────────────

/**
 * Build the real `loadSessionList` actor — wraps `GET /api/projects/:id/sessions`.
 * Returns the session summaries with cursor + has_more shape.
 */
export function loadSessionListFn(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): (input: LoadSessionListInput) => Promise<LoadSessionListOutput> {
  return async (input) => {
    const pageSize = input.page_size ?? 30;
    const url = `${backendUrl}/api/projects/${encodeURIComponent(input.project_id)}/sessions?page%5Bsize%5D=${pageSize}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "x-correlation-id": "session-chat-list",
        ...principalHeaders,
      },
    });
    // Treat 404 as "no sessions yet" — the backend wraps the session list in a
    // ProjectMemory row that is lazily created at first-session. A project
    // without a memory means zero sessions, which lands cleanly in
    // session_list_loaded (US-203 Example 3 no_sessions_empty_state sub-shape
    // per DWD-1). The 404 is NOT a transient failure.
    if (resp.status === 404) {
      return {
        items: [],
        next_cursor: null,
        has_more: false,
        resume_target: input.pending_resume_session_id ?? null,
      };
    }
    if (!resp.ok) {
      throw new Error(`list_sessions failed: ${resp.status}`);
    }
    // The backend's list_sessions returns JSON:API: { data: [...], meta, links }.
    // Tolerate the plain {items} or array shape for forward-compat.
    const body = (await resp.json()) as
      | {
          items?: Array<{
            id: string;
            title?: string | null;
            last_active_at?: string;
            active_dataset_id?: string | null;
          }>;
        }
      | {
          data?: Array<{
            id: string;
            attributes?: {
              title?: string | null;
              last_active_at?: string;
              active_dataset_id?: string | null;
            };
          }>;
          links?: { next?: string | null };
        }
      | Array<{
          id: string;
          title?: string | null;
          last_active_at?: string;
          active_dataset_id?: string | null;
        }>;

    let rawItems: Array<{
      id: string;
      title?: string | null;
      last_active_at?: string;
      active_dataset_id?: string | null;
    }>;
    let nextCursor: string | null = null;

    if (Array.isArray(body)) {
      rawItems = body;
    } else if ("data" in body && Array.isArray(body.data)) {
      rawItems = body.data.map((row) => ({
        id: row.id,
        title: row.attributes?.title ?? null,
        last_active_at: row.attributes?.last_active_at,
        active_dataset_id: row.attributes?.active_dataset_id ?? null,
      }));
      nextCursor = body.links?.next ?? null;
    } else if ("items" in body && Array.isArray(body.items)) {
      rawItems = body.items;
    } else {
      rawItems = [];
    }

    const items: SessionSummary[] = rawItems
      .filter((r) => typeof r.id === "string" && typeof r.last_active_at === "string")
      .map((r) => ({
        id: r.id,
        title: r.title ?? null,
        last_active_at: r.last_active_at as string,
        active_dataset_id: r.active_dataset_id ?? null,
      }))
      // Sort DESC by last_active_at (lex-larger ISO timestamp wins). The
      // backend SHOULD return them in this order already, but a defensive
      // sort keeps the contract stable across backend variations.
      .sort((a, b) => b.last_active_at.localeCompare(a.last_active_at));

    return {
      items,
      next_cursor: nextCursor,
      has_more: items.length >= pageSize,
      resume_target: input.pending_resume_session_id ?? null,
    };
  };
}

export function loadSessionListActor(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): LoadSessionListActor {
  const fn = loadSessionListFn(backendUrl, principalHeaders);
  return fromPromise<LoadSessionListOutput, LoadSessionListInput>(({ input }) =>
    fn(input),
  );
}

/**
 * Build the real `resumeSession` actor — wraps `GET /api/sessions/:id` +
 * `GET /api/sessions/:id/messages` (transcript) and (when active_dataset_id
 * is set) `GET /api/datasets/:id` to detect deletion (US-205 Example 3).
 *
 * Per DESIGN §2.3.B, the atomicity guarantee is delivered at the XState assign
 * boundary in the machine — this actor just gathers all three reads before
 * resolving. The machine's onDone assign populates transcript+resource in a
 * single transaction.
 */
export function resumeSessionFn(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): (input: ResumeSessionInput) => Promise<ResumeSessionOutput> {
  return async (input) => {
    const sessionResp = await fetch(
      `${backendUrl}/api/sessions/${encodeURIComponent(input.session_id)}`,
      {
        method: "GET",
        headers: {
          "x-correlation-id": "session-chat-resume",
          ...principalHeaders,
        },
      },
    );
    if (sessionResp.status === 404) {
      return { session_not_found: true };
    }
    if (!sessionResp.ok) {
      throw new Error(`get_session failed: ${sessionResp.status}`);
    }
    // Backend get_session route (J-002 MR-2 / DWD-2) returns JSON:API shape:
    //   { data: { id, attributes: { active_dataset_id, ... } } }
    // Tolerate the flat {id, active_dataset_id} shape for forward-compat.
    const sessionBody = (await sessionResp.json()) as
      | {
          id?: string;
          active_dataset_id?: string | null;
        }
      | {
          data?: {
            id?: string;
            attributes?: { active_dataset_id?: string | null };
          };
        };
    const sessionId =
      (sessionBody as { id?: string }).id ??
      (sessionBody as { data?: { id?: string } }).data?.id ??
      input.session_id;
    const activeDatasetId =
      (sessionBody as { active_dataset_id?: string | null }).active_dataset_id ??
      (sessionBody as { data?: { attributes?: { active_dataset_id?: string | null } } })
        .data?.attributes?.active_dataset_id ??
      null;

    // Fetch transcript via the session-replay events endpoint. The
    // /api/sessions/:id/events route returns persisted DomainEvents per
    // dc-x3y.3.2 — for MR-2 we surface only the user/assistant message
    // events (UI directives are filtered server-side per ADR-014). A
    // brand-new session has no events; an empty transcript is a valid
    // first-paint state per US-205 Example 1.
    let transcript: TranscriptMessage[] = [];
    try {
      const eventsResp = await fetch(
        `${backendUrl}/api/sessions/${encodeURIComponent(input.session_id)}/events?limit=100`,
        {
          method: "GET",
          headers: {
            "x-correlation-id": "session-chat-resume-transcript",
            ...principalHeaders,
          },
        },
      );
      if (eventsResp.ok) {
        const eventsBody = (await eventsResp.json()) as {
          events?: Array<{
            id?: string;
            event_type?: string;
            payload?: { role?: string; content?: string; text?: string };
            ts?: string;
          }>;
        };
        const events = eventsBody.events ?? [];
        // Pull the user/assistant message events out of the DomainEvent
        // stream; everything else (tool turns, audit events) is dropped
        // from the visible transcript per ADR-014.
        transcript = events
          .filter((e) => {
            const t = e.event_type ?? "";
            return t === "user_message_sent" || t === "assistant_message_sent" || t === "tool_response_received";
          })
          .map((e, idx) => ({
            id: e.id ?? `evt-${idx}`,
            role: ((): "user" | "assistant" | "tool" => {
              const t = e.event_type ?? "";
              if (t === "assistant_message_sent") return "assistant";
              if (t === "tool_response_received") return "tool";
              return "user";
            })(),
            content: e.payload?.content ?? e.payload?.text ?? "",
            ts: e.ts ?? new Date(0).toISOString(),
          }));
      }
    } catch {
      transcript = [];
    }

    // If active_dataset_id is set, verify the dataset still exists. 404 →
    // session_dataset_unavailable per US-205 Example 3 (graceful degradation
    // to conversational mode).
    let datasetUnavailable = false;
    if (activeDatasetId) {
      try {
        const dsResp = await fetch(
          `${backendUrl}/api/datasets/${encodeURIComponent(activeDatasetId)}`,
          {
            method: "GET",
            headers: {
              "x-correlation-id": "session-chat-resume-dataset",
              ...principalHeaders,
            },
          },
        );
        if (dsResp.status === 404 || dsResp.status === 410) {
          datasetUnavailable = true;
        }
      } catch {
        // Network error reading the dataset — treat as transient AT the
        // dataset-probe boundary; the session is still resumable in
        // conversational mode (per US-205 Example 3 the GREEN-path behavior).
        datasetUnavailable = true;
      }
    }

    return {
      session_id: sessionId,
      transcript,
      active_dataset_id: datasetUnavailable ? null : activeDatasetId,
      dataset_unavailable: datasetUnavailable,
    };
  };
}

export function resumeSessionActor(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): ResumeSessionActor {
  const fn = resumeSessionFn(backendUrl, principalHeaders);
  return fromPromise<ResumeSessionOutput, ResumeSessionInput>(({ input }) =>
    fn(input),
  );
}

/**
 * Build the real `createSessionEagerly` actor — wraps the two-call sequence
 *   1. POST /api/projects/:id/sessions     → creates the session row (title null)
 *   2. PATCH /api/projects/:id/sessions/:sid {title: first_message[:80]}
 *
 * Per app-arch §2.3 + US-206 Scenario 2: the title is materialized before
 * the machine settles in session_active so the test can observe the row
 * with title === first_message[:80] without races.
 *
 * `shouldFailNext` is the harness knob (consumed once per call) that lets
 * the US-206 transient-failure scenario simulate a 503 without coupling
 * the test to actual backend chaos.
 */
export function createSessionEagerlyFn(
  backendUrl: string,
  principalHeaders: Record<string, string>,
  shouldFailNext: () => boolean = () => false,
): (input: CreateSessionEagerlyInput) => Promise<CreateSessionEagerlyOutput> {
  return async (input) => {
    if (shouldFailNext()) {
      throw new Error("transient: forced by X-Force-Create-Session-Failure");
    }
    const createResp = await fetch(
      `${backendUrl}/api/projects/${encodeURIComponent(input.project_id)}/sessions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "session-chat-create",
          ...principalHeaders,
        },
        // The backend's create_session route does NOT accept a body today —
        // the title is set via PATCH below. Sending an empty body keeps the
        // wire payload deterministic.
        body: "{}",
      },
    );
    if (!createResp.ok) {
      throw new Error(`create_session failed: ${createResp.status}`);
    }
    const createBody = (await createResp.json()) as
      | { id?: string }
      | { data?: { id?: string } };
    const sessionId =
      (createBody as { id?: string }).id ??
      (createBody as { data?: { id?: string } }).data?.id;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("create_session: missing session id in response");
    }
    // Title = first_message truncated to 80 chars (US-206 Scenario 2 contract).
    const title = input.first_message.slice(0, 80);
    const patchResp = await fetch(
      `${backendUrl}/api/projects/${encodeURIComponent(input.project_id)}/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "session-chat-create-title",
          ...principalHeaders,
        },
        body: JSON.stringify({ title }),
      },
    );
    if (!patchResp.ok) {
      // The session row exists but title-set failed. We surface this as a
      // create-session failure because the contract (row with title) is
      // not met — the welcome-state composer text stays in pending_first_message
      // so the retry path re-attempts atomically.
      throw new Error(`set_session_title failed: ${patchResp.status}`);
    }
    return { session_id: sessionId };
  };
}

export function createSessionEagerlyActor(
  backendUrl: string,
  principalHeaders: Record<string, string>,
  shouldFailNext: () => boolean = () => false,
): CreateSessionEagerlyActor {
  const fn = createSessionEagerlyFn(backendUrl, principalHeaders, shouldFailNext);
  return fromPromise<CreateSessionEagerlyOutput, CreateSessionEagerlyInput>(
    ({ input }) => fn(input),
  );
}

// Re-export ActiveScope so callers don't need a separate import path.
export type { ActiveScope };
