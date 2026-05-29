// session-chat/setup/actors.ts — the external-service request layer for the
// session-chat half of J-002. Houses every actor RESOLVER that performs network
// I/O (the backend session SSOT: list/resume sessions, eager-create on first
// message, dataset switching), the I/O contracts they exchange with the machine,
// the `fromPromise`-bound actor-type aliases, the noop fallbacks, and
// `buildActors(deps)` — the deps-driven actor map machine.ts threads straight
// into `setup({ actors })`. It imports from `xstate` and the shared domain
// (./types.ts, active-scope.ts) ONLY — never machine.ts or the other setup
// modules (one-way dependency, no cycle).
//
// References:
//   docs/decisions/adr-014-*.md  — UI directives filtered from visible transcript
//   docs/decisions/adr-028-*.md  — machines own transitions; parent-ignorant children
//   docs/decisions/adr-029-*.md  — ActiveScope invariants; cross-tenant rejection; identity-header propagation
//   docs/decisions/adr-030-*.md  — branch-relevant data flows through event.output

import { fromPromise } from "xstate";

import type { ActiveScope, ResourceType } from "../../../domain/active-scope.ts";
import type { SessionSummary, TranscriptMessage } from "./types.ts";

// ─────────────────────────── Actor input / output ───────────────────────────

export interface LoadSessionListInput {
  project_id: string;
  principal_id: string;
  page_size?: number;
  /** Pending session-resume target forwarded from ctx. The actor echoes
   *  this through `resume_target` on its output so the
   *  `loading_session_list → resuming_session` branch can guard on
   *  `event.output.resume_target` instead of reading
   *  `ctx.pending_resume_session_id` (LEAF-C / Direction F: branch-relevant
   *  data MUST flow through `event.output`, never through context set before
   *  the invoke). */
  pending_resume_session_id?: string | null;
}

export interface LoadSessionListOutput {
  items: SessionSummary[];
  next_cursor: string | null;
  has_more: boolean;
  /** Echoes `input.pending_resume_session_id` so the `onDone` branch can
   *  pick between `session_list_loaded` and `resuming_session` without
   *  reading `ctx.pending_resume_session_id` (LEAF-C / Direction F). Null when
   *  no resume target was carried in. */
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

/**
 * US-209 — switchDatasetContext actor. Given the intended dataset
 * pick (from `dataset_resolved_by_agent` / `dataset_picked_directly`),
 * validates access via ScopeResolver invariant 4 (cross-tenant AND
 * cross-project rejection) by calling `GET /api/datasets/:id` and comparing
 * the dataset's `project_id` against the active project; on pass it persists
 * `session.active_dataset_id` via `update_session`
 * (`PATCH /api/projects/:pid/sessions/:sid`). On 403/404/cross-project the
 * pick is rejected with `{ dataset_access_denied: true }` and the prior
 * resource is preserved (US-209 Example 3/4). Mirrors the `switchProject`
 * actor's error-variant discipline.
 */
export type SwitchDatasetContextOutput =
  | { resource_type: ResourceType; resource_id: string; persisted: true }
  | {
      dataset_access_denied: true;
      prior_resource: { type: ResourceType | null; id: string | null };
    };

export interface SwitchDatasetContextInput {
  session_id: string;
  project_id: string;
  principal_id: string;
  intended_resource_id: string;
  intended_resource_type: ResourceType;
  /** The resource attached BEFORE this pick. Echoed back on the
   *  dataset_access_denied branch so the machine can leave
   *  `context.resource` provably unchanged (US-209 Example 3). */
  prior_resource: { type: ResourceType | null; id: string | null };
}

export type SwitchDatasetContextActor = ReturnType<
  typeof fromPromise<SwitchDatasetContextOutput, SwitchDatasetContextInput>
>;

export interface SessionChatMachineDeps {
  /** Optional. When absent, the machine still spawns into
   *  `waiting_for_project` cleanly — the project_ready transition fires but
   *  loadSessionList throws when invoked, surfacing as error_recoverable. */
  loadSessionList?: LoadSessionListActor;
  resumeSession?: ResumeSessionActor;
  /** US-206: invoked on `first_message_sent` from the welcome state.
   *  Absent → first_message_sent surfaces error_recoverable (consistent with
   *  the noop-actor pattern used for loadSessionList / resumeSession). */
  createSessionEagerly?: CreateSessionEagerlyActor;
  /** US-209: invoked on `dataset_resolved_by_agent` /
   *  `dataset_picked_directly` from `session_active`. Absent → the pick
   *  surfaces error_recoverable (same noop-actor pattern). */
  switchDatasetContext?: SwitchDatasetContextActor;
}

/**
 * Build the machine's actor map from the injected `deps`. machine.ts threads the
 * return straight into `setup({ actors })` so the statechart only names actors
 * (`src: "loadSessionList"`), never wires them. A `fromPromise` noop fallback
 * stands in for each optional dep — it throws so a future caller that forgets to
 * wire a dep surfaces a clean `error_recoverable` rather than crashing the
 * orchestrator with an "unknown actor src" error. Each fallback's generics stay
 * precise so `ReturnType<typeof buildActors>` (and the `SessionChatActor` union
 * derived from it) is exact.
 */
export function buildActors(deps: SessionChatMachineDeps) {
  return {
    loadSessionList:
      deps.loadSessionList ??
      fromPromise<LoadSessionListOutput, LoadSessionListInput>(async () => {
        throw new Error("loadSessionList actor not wired");
      }),
    resumeSession:
      deps.resumeSession ??
      fromPromise<ResumeSessionOutput, ResumeSessionInput>(async () => {
        throw new Error("resumeSession actor not wired");
      }),
    createSessionEagerly:
      deps.createSessionEagerly ??
      fromPromise<CreateSessionEagerlyOutput, CreateSessionEagerlyInput>(
        async () => {
          throw new Error("createSessionEagerly actor not wired");
        },
      ),
    switchDatasetContext:
      deps.switchDatasetContext ??
      fromPromise<SwitchDatasetContextOutput, SwitchDatasetContextInput>(
        async () => {
          throw new Error("switchDatasetContext actor not wired");
        },
      ),
  };
}

/**
 * The ProvidedActor union XState derives from the actor map when it types
 * `setup({ actors })`. XState's own `ToProvidedActor` is internal (not exported),
 * so we mirror its shape here — `{ src, logic, id }` per actor — DERIVED from
 * `ReturnType<typeof buildActors>`, so adding/removing an actor updates it
 * automatically. (No children map → `id: string | undefined`, matching XState.)
 * Mirrors project-context's `ProvidedActorOf` / `ProjectContextActor`.
 */
type ProvidedActorOf<TActors extends Record<string, unknown>> = {
  [K in keyof TActors as K & string]: {
    src: K & string;
    logic: TActors[K];
    id: string | undefined;
  };
}[keyof TActors & string];

export type SessionChatActor = ProvidedActorOf<ReturnType<typeof buildActors>>;

// ────────────────────────────────────────────────────────────────────────────
// Production actor factories — wired by the orchestrator's composition root.
// ────────────────────────────────────────────────────────────────────────────

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
        "x-request-id": "session-chat-list",
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
 * The atomicity guarantee is delivered at the XState assign boundary in the
 * machine — this actor just gathers all three reads before resolving. The
 * machine's onDone assign populates transcript+resource in a single
 * transaction.
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
          "x-request-id": "session-chat-resume",
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
    // Backend get_session route (DWD-2) returns JSON:API shape:
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
    // /api/sessions/:id/events route returns persisted DomainEvents; we
    // surface only the user/assistant message events (UI directives are
    // filtered server-side). A brand-new session has no events; an empty
    // transcript is a valid first-paint state per US-205 Example 1.
    let transcript: TranscriptMessage[] = [];
    try {
      const eventsResp = await fetch(
        `${backendUrl}/api/sessions/${encodeURIComponent(input.session_id)}/events?limit=100`,
        {
          method: "GET",
          headers: {
            "x-request-id": "session-chat-resume-transcript",
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
        // from the visible transcript.
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
              "x-request-id": "session-chat-resume-dataset",
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
  /** US-210 test-infra knob (gated, consume-once). When it returns >0 the
   *  resume holds for that many ms BEFORE the backend round-trip, so an
   *  acceptance scenario can deterministically broadcast FREEZE while the
   *  machine is still in `resuming_session` (US-210 scenario 1 — "while
   *  J-002 is in resuming_session, J-001 transitions to expired_token").
   *  Not a product behavior: gated by the failure-simulation registry
   *  exactly like the X-Force-* family; ignored in production. */
  slowResumeMsFn?: () => number,
): ResumeSessionActor {
  const fn = resumeSessionFn(backendUrl, principalHeaders);
  return fromPromise<ResumeSessionOutput, ResumeSessionInput>(
    async ({ input }) => {
      const slowMs = slowResumeMsFn?.() ?? 0;
      if (slowMs > 0) {
        await new Promise((r) => setTimeout(r, slowMs));
      }
      return fn(input);
    },
  );
}

/**
 * US-209 — switchDatasetContextFn implementation. The session-chat
 * `switchDatasetContext` actor. Enforces ScopeResolver invariant 4
 * (cross-tenant AND cross-project rejection) as defense in depth at the
 * ui-state tier:
 *
 *   1. `GET /api/datasets/:id` — the backend's `authorize_dataset_access`
 *      dep returns 403 for cross-tenant (dataset's project belongs to a
 *      different org) and 404 for a non-existent dataset. Either → the
 *      pick is rejected.
 *   2. Cross-project: a 200 dataset whose `project_id` differs from the
 *      active project (`input.project_id`) is the US-209 Example 4 anomaly
 *      — also rejected (the inline list SHOULD be project-filtered; this
 *      is the belt-and-braces check).
 *   3. On pass: `PATCH /api/projects/:pid/sessions/:sid { active_dataset_id }`
 *      persists the pick via the existing `update_session` allowlist
 *      (DWD-2). A non-2xx persist throws → transient → error_recoverable.
 *
 * Mirrors `switchProjectFn`'s status-discrimination discipline.
 */
export function switchDatasetContextFn(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): (input: SwitchDatasetContextInput) => Promise<SwitchDatasetContextOutput> {
  return async (input) => {
    if (!input.intended_resource_id) {
      throw new Error("switchDatasetContext: intended_resource_id is required");
    }
    // ─── ScopeResolver invariant 4: cross-tenant (403) / not-found (404) ──
    const dsResp = await fetch(
      `${backendUrl}/api/datasets/${encodeURIComponent(input.intended_resource_id)}?include_transforms=false`,
      {
        method: "GET",
        headers: {
          "x-request-id": "switch-dataset-context",
          ...principalHeaders,
        },
      },
    );
    if (
      dsResp.status === 403 ||
      dsResp.status === 404 ||
      dsResp.status === 410
    ) {
      return {
        dataset_access_denied: true,
        prior_resource: input.prior_resource,
      };
    }
    if (!dsResp.ok) {
      throw new Error(`get_dataset failed: ${dsResp.status}`);
    }
    // get_dataset is wrapped JSON:API: { data: { id, attributes: {
    // project_id, name, ... } } }. Tolerate a flat { id, project_id }
    // shape for forward-compat.
    const dsBody = (await dsResp.json()) as
      | { id?: string; project_id?: string | null }
      | {
          data?: {
            id?: string;
            attributes?: { project_id?: string | null };
            project_id?: string | null;
          };
        };
    const datasetProjectId =
      (dsBody as { project_id?: string | null }).project_id ??
      (dsBody as { data?: { attributes?: { project_id?: string | null } } })
        .data?.attributes?.project_id ??
      (dsBody as { data?: { project_id?: string | null } }).data?.project_id ??
      null;
    // ─── ScopeResolver invariant 4: cross-project rejection ───────────────
    if (
      datasetProjectId !== null &&
      input.project_id !== "" &&
      datasetProjectId !== input.project_id
    ) {
      return {
        dataset_access_denied: true,
        prior_resource: input.prior_resource,
      };
    }
    // ─── Persist `session.active_dataset_id` (DWD-2) ──────────────────────
    const patchResp = await fetch(
      `${backendUrl}/api/projects/${encodeURIComponent(input.project_id)}/sessions/${encodeURIComponent(input.session_id)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-request-id": "switch-dataset-context-persist",
          ...principalHeaders,
        },
        body: JSON.stringify({ active_dataset_id: input.intended_resource_id }),
      },
    );
    if (!patchResp.ok) {
      throw new Error(
        `persist active_dataset_id failed: ${patchResp.status}`,
      );
    }
    return {
      resource_type: input.intended_resource_type,
      resource_id: input.intended_resource_id,
      persisted: true,
    };
  };
}

export function switchDatasetContextActor(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): SwitchDatasetContextActor {
  const fn = switchDatasetContextFn(backendUrl, principalHeaders);
  return fromPromise<SwitchDatasetContextOutput, SwitchDatasetContextInput>(
    ({ input }) => fn(input),
  );
}

/**
 * Build the real `createSessionEagerly` actor — wraps the two-call sequence
 *   1. POST /api/projects/:id/sessions     → creates the session row (title null)
 *   2. PATCH /api/projects/:id/sessions/:sid {title: first_message[:80]}
 *
 * US-206 Scenario 2: the title is materialized before the machine settles in
 * session_active so the test can observe the row with
 * title === first_message[:80] without races.
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
          "x-request-id": "session-chat-create",
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
          "x-request-id": "session-chat-create-title",
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
