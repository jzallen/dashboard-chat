// ProjectContextMachine — XState v5 statechart for J-002's project-context half.
//
// Per `docs/feature/project-and-chat-session-management/design/application-architecture.md`
// §2A (post-DWD-13 SRP amendment) this machine owns "Which project am I in?" —
// initial scope resolution, project creation, mid-flow project switching (MR-4),
// cross-tenant terminal failure, and the deep-link entry path. It owns the
// `org_id` + `project_id` halves of `active_scope`.
//
// MR-1 surface (lifted verbatim from the pre-split file at `cd4103e`, types
// renamed to drop the J002/ProjectFlow prefixes per DWD-13):
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
//
// MR-4 will add `switching_project`; MR-6 will add `freeze` + top-level FREEZE handler.
//
// ADR-028:46-48 invariant: this file does NOT import from `session-chat.ts` or
// `login-and-org-setup.ts`. The orchestrator mediates all cross-machine entry
// (`auth_ready` from login → project-context; `project_ready` from project-context
// → session-chat).

import { assign, fromPromise, setup } from "xstate";

import type { ActiveScope, ResourceType } from "../../active-scope.ts";
import {
  type ProjectValidationError,
  validateProjectName,
} from "./validation.ts";

export type ProjectContextState =
  | "resolving_initial_scope"
  | "no_projects"
  | "creating_project"
  | "project_selected"
  | "switching_project"
  | "scope_mismatch_terminal"
  | "error_recoverable"
  | "freeze";

export interface ProjectSummary {
  id: string;
  name: string;
}

export type ProjectContextCauseTag =
  | "no_projects"
  | "transient"
  | "project_not_found"
  | "cross_tenant"
  | "access_revoked"
  | "replay_abandoned";

export interface ProjectContextMachineContext {
  request_id: string;
  principal_id: string;

  // From J-001 projection — set on auth_ready event entry:
  org_id: string;
  user: { first_name: string | null };

  // Authoritative project context — populated on project_selected entry:
  project: { id: string | null; name: string | null };

  // Deep-link wish payloads — populated on open_deep_link; cleared on settle.
  // Per audit §5 "intent" + §7 Tier-1 #2 (MR-D): these fields are URL-level
  // user wishes that have not yet been confirmed or denied. They carry the
  // shape the user requested from the URL through resolution; on settle
  // (project_selected) the orchestrator forwards `deeplink_session_id` to
  // session-chat via the `project_ready` payload.
  //
  // The pre-MR-D pair `intent_resource_id` + `intent_resource_type` was
  // removed from this context: project-context never read them — they were
  // pure pass-through (Direction F / ADR-030 §"Migration sequencing"). The
  // orchestrator now forwards them from the `open_deep_link` event payload
  // directly into `project_ready`, never touching this machine's ctx.
  deeplink_project_id: string | null;
  deeplink_session_id: string | null;

  // Cross-state plumbing:
  underlying_cause_tag: ProjectContextCauseTag | null;
  last_live_state: ProjectContextState | null;
  retries_count: number;
  /** Composer text preserved across creating_project ↔ error_recoverable. */
  pending_project_name: string;

  // Inline validation error attached when a submitted project name fails
  // local validation (parallels J-001's org_validation_error).
  project_validation_error: ProjectValidationError | null;

  // Observability counters:
  scope_reconciled_count: number;
  stale_intents_dropped_count: number;
  // MR-6 / US-210 — the most recent DWD-7 stale-dropped intent; harvested
  // by the orchestrator to emit stale_intent_dropped_after_thaw (machines
  // never write FlowEvents — ADR-028/ADR-030).
  last_stale_intent: { intent_type: string; target_id: string } | null;

  // Per OQ-J002-5: per-project last_active_at map captured by resolveInitialScope.
  most_recent_session_per_project: Record<string, string>;

  // Last-used resolution degraded set (OQ-J002-5). Populated on
  // resolving_initial_scope's onDone when one or more `list_sessions` calls
  // 5xx-failed. The orchestrator reads this on settle to emit a
  // `last_used_resolution_degraded` event with `partial_result: true`.
  last_used_degraded_project_ids: string[];
}

export type ProjectContextEvent =
  | { type: "auth_ready"; org_id: string; user: { first_name: string } }
  | { type: "create_project_clicked" }
  | { type: "create_project_submitted"; org_name: string }
  | { type: "back_to_projects_clicked" }
  | { type: "retry_clicked" }
  // The `open_deep_link` event payload keys retain the legacy `intent_*`
  // prefix — that's a wire surface (FE + orchestrator) renamed in a
  // separate follow-up MR. Post-MR-D the values land in `deeplink_*`
  // context fields here.
  | {
      type: "open_deep_link";
      intent_project_id?: string;
      intent_session_id?: string;
      intent_resource_id?: string;
      intent_resource_type?: ResourceType;
    }
  // MR-4 — atomic project switching. Fired by a loader (mid-session
  // deep-link to a different project) OR by the chat-view's
  // project-picker. The machine invokes `switchProject` which validates
  // the target via the backend's `GET /api/projects/:id`; the IC-J002-4
  // invalidation contract (session_id + resource_* cleared BEFORE the
  // new project's loading_session_list fires) is enforced at the
  // projection layer via the `switching_project_started` event handler.
  | { type: "switching_project_intent"; new_project_id: string }
  | { type: "FREEZE"; origin_request_id?: string }
  | { type: "THAW" }
  // Orchestrator-emitted on the 5s replay-buffer timeout (ADR-027 §5):
  // silent re-auth never succeeded; freeze → error_recoverable.
  | { type: "replay_abandoned" };

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
 * MR-4 — switchProject actor. Given a target `new_project_id`, validates
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

export interface ProjectContextMachineDeps {
  resolveInitialScope: ResolveInitialScopeActor;
  createProject: CreateProjectActor;
  /** Optional: MR-4 atomic project switching. When omitted, the
   *  `switching_project_intent` event is dropped (no-op) — keeps the
   *  machine backward-compatible with MR-1..MR-3 deployments. */
  switchProject?: SwitchProjectActor;
}

export function createProjectContextMachine(deps: ProjectContextMachineDeps) {
  return setup({
    types: {
      context: {} as ProjectContextMachineContext,
      events: {} as ProjectContextEvent,
      input: {} as {
        request_id: string;
        principal_id: string;
        org_id?: string;
        user?: { first_name?: string };
        deeplink_project_id?: string;
      },
    },
    actors: {
      resolveInitialScope: deps.resolveInitialScope,
      createProject: deps.createProject,
      // MR-4 — fromPromise fallback when deps.switchProject is absent (legacy
      // MR-1..MR-3 deployments). The fallback throws so test setups that
      // never wired it surface a named diagnostic rather than silently
      // succeeding.
      switchProject:
        deps.switchProject ??
        fromPromise<SwitchProjectOutput, SwitchProjectInput>(async () => {
          throw new Error(
            "switchProject actor not wired — MR-4 deps.switchProject is required",
          );
        }),
    },
    guards: {
      projectNameValid: ({ event }) => {
        if (event.type !== "create_project_submitted") return false;
        return validateProjectName(event.org_name) === null;
      },
    },
    actions: {
      recordProjectValidationError: assign({
        project_validation_error: ({ event }) => {
          if (event.type !== "create_project_submitted") return null;
          return validateProjectName(event.org_name);
        },
      }),
      clearProjectValidationError: assign({
        project_validation_error: () => null,
      }),
      capturePendingProjectName: assign({
        pending_project_name: ({ event, context }) => {
          if (event.type !== "create_project_submitted") {
            return context.pending_project_name;
          }
          return event.org_name.trim();
        },
      }),
      // MR-6 / US-210 — record the live state we froze from so on.THAW
      // returns there (DWD-2/DWD-6: queryable context field, not an
      // XState history node). FREEZE is top-level so the snapshot value
      // is still the source state when this assigner runs.
      captureFreezeOrigin: assign({
        last_live_state: ({ self }) =>
          self.getSnapshot().value as ProjectContextState,
      }),
    },
  }).createMachine({
    id: "project-context",
    initial: "resolving_initial_scope",
    // Root-level open_deep_link handler — available from ANY state. Per
    // app-arch §2.3 / DWD-9: a cold deep-link can arrive while the machine
    // is in no_projects, project_selected, or any other live state. The
    // handler captures the URL wish into `deeplink_*` ctx and re-enters
    // resolving_initial_scope so the resolver re-runs with the new wish.
    on: {
      // MR-6 / US-210 §2.2 — top-level FREEZE handler, inherited by every
      // non-terminal state. project-context is a pure downstream consumer
      // (ADR-028:46-48): it never emits FREEZE/THAW, only reacts to the
      // orchestrator broadcast. `freeze` is a side-state with NO invoke;
      // the in-flight switchProject of the state we left is stopped by
      // XState so a mid-flight 401 is discarded with no transition.
      FREEZE: {
        target: ".freeze",
        actions: "captureFreezeOrigin",
      },
      open_deep_link: {
        actions: assign({
          deeplink_project_id: ({ event, context }) =>
            event.intent_project_id ?? context.deeplink_project_id,
          deeplink_session_id: ({ event, context }) =>
            event.intent_session_id ?? context.deeplink_session_id,
          // `intent_resource_id` / `intent_resource_type` are carried in
          // the event payload but no longer materialized here — the
          // orchestrator forwards them directly from the event payload
          // into the `project_ready` broadcast (audit §7 Tier-1 #2;
          // Direction F / ADR-030 §"Migration sequencing").
        }),
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
      last_live_state: null,
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
            actions: assign({
              org_id: ({ event }) => event.org_id,
              user: ({ event }) => ({ first_name: event.user.first_name }),
            }),
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
              guard: ({ event }) =>
                (event.output as { cross_tenant?: true }).cross_tenant === true,
              target: "scope_mismatch_terminal",
              actions: assign({
                underlying_cause_tag: () => "cross_tenant" as const,
              }),
            },
            {
              guard: ({ event }) =>
                (event.output as { project_not_found?: true }).project_not_found === true,
              target: "scope_mismatch_terminal",
              actions: assign({
                underlying_cause_tag: () => "project_not_found" as const,
              }),
            },
            {
              guard: ({ event }) =>
                (event.output as { no_projects?: true }).no_projects === true,
              target: "no_projects",
            },
            {
              target: "project_selected",
              actions: assign({
                project: ({ event }) => {
                  const out = event.output as { project: ProjectSummary };
                  return { id: out.project.id, name: out.project.name };
                },
                most_recent_session_per_project: ({ event, context }) => {
                  const out = event.output as {
                    most_recent_session_per_project?: Record<string, string>;
                  };
                  return out.most_recent_session_per_project ?? context.most_recent_session_per_project;
                },
                last_used_degraded_project_ids: ({ event }) => {
                  const out = event.output as { degraded_project_ids?: string[] };
                  return out.degraded_project_ids ?? [];
                },
              }),
            },
          ],
          onError: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: () => "transient" as const,
            }),
          },
        },
      },
      no_projects: {
        entry: assign({
          underlying_cause_tag: () => "no_projects" as const,
        }),
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
            actions: assign({
              project: ({ event }) => ({
                id: event.output.id,
                name: event.output.name,
              }),
            }),
          },
          onError: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: () => "transient" as const,
            }),
          },
        },
      },
      project_selected: {
        // MR-1 entry — the walking-skeleton's "project chip rendered"
        // assertion reads context.project on entry. Per DESIGN §3.2.B the
        // orchestrator's priorState watcher observes entry to this state and
        // broadcasts `project_ready` to session-chat (idempotent on same
        // project_id; invalidates session_id+resource_* on different project_id).
        //
        // MR-4 — `switching_project_intent` moves the machine into
        // `switching_project`. The IC-J002-4 invalidation contract
        // (session_id + resource_* cleared BEFORE the new project's
        // loading_session_list fires) is enforced via the
        // `switching_project_started` event handler in projection.ts;
        // session-chat reacts by zeroing its own context fields.
        on: {
          switching_project_intent: {
            target: "switching_project",
            actions: assign({
              deeplink_project_id: ({ event }) =>
                event.type === "switching_project_intent"
                  ? event.new_project_id
                  : null,
            }),
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
              guard: ({ event }) =>
                (event.output as { access_revoked?: true }).access_revoked === true,
              target: "scope_mismatch_terminal",
              actions: assign({
                underlying_cause_tag: () => "access_revoked" as const,
              }),
            },
            {
              guard: ({ event }) =>
                (event.output as { project_not_found?: true }).project_not_found === true,
              target: "scope_mismatch_terminal",
              actions: assign({
                underlying_cause_tag: () => "project_not_found" as const,
              }),
            },
            {
              target: "project_selected",
              actions: assign({
                project: ({ event }) => {
                  const out = event.output as { project: ProjectSummary };
                  return { id: out.project.id, name: out.project.name };
                },
                // Clear the deeplink wish — settled.
                deeplink_project_id: () => null,
                deeplink_session_id: () => null,
                underlying_cause_tag: () => null,
                scope_reconciled_count: ({ context }) =>
                  context.scope_reconciled_count + 1,
              }),
            },
          ],
          onError: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: () => "transient" as const,
            }),
          },
        },
      },
      scope_mismatch_terminal: {
        on: {
          back_to_projects_clicked: {
            target: "resolving_initial_scope",
            actions: assign({
              deeplink_project_id: () => null,
              deeplink_session_id: () => null,
              underlying_cause_tag: () => null,
            }),
          },
        },
      },
      error_recoverable: {
        on: {
          retry_clicked: {
            target: "creating_project",
            actions: assign({
              underlying_cause_tag: () => null,
              retries_count: ({ context }) => context.retries_count + 1,
            }),
          },
        },
      },
      // MR-6 / US-210 §2.3.A — the `freeze` side-state. Reached only via
      // the top-level on.FREEZE. NO invoke (no outgoing mutations while
      // frozen). on.THAW returns to `last_live_state` (one guarded arm per
      // freezable state — DWD-2/DWD-6: context-driven history target, not
      // an XState history node). The invoke-driven transients
      // (resolving_initial_scope, creating_project, switching_project)
      // re-enter so the invoke re-runs with the fresh post-re-auth JWT
      // (US-210 scenario 2: "the project-load fires with the fresh JWT").
      // on.replay_abandoned → error_recoverable (the 5s timeout).
      freeze: {
        on: {
          THAW: [
            { guard: ({ context }) => context.last_live_state === "resolving_initial_scope", target: "resolving_initial_scope", reenter: true },
            { guard: ({ context }) => context.last_live_state === "no_projects", target: "no_projects" },
            { guard: ({ context }) => context.last_live_state === "creating_project", target: "creating_project", reenter: true },
            { guard: ({ context }) => context.last_live_state === "project_selected", target: "project_selected" },
            { guard: ({ context }) => context.last_live_state === "switching_project", target: "switching_project", reenter: true },
            { guard: ({ context }) => context.last_live_state === "scope_mismatch_terminal", target: "scope_mismatch_terminal" },
            { guard: ({ context }) => context.last_live_state === "error_recoverable", target: "error_recoverable" },
            // Defensive fallback — no recorded origin: re-resolve scope.
            { target: "resolving_initial_scope", reenter: true },
          ],
          replay_abandoned: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: () => "replay_abandoned" as const,
            }),
          },
        },
      },
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Production actor factories — wired by the orchestrator's composition root.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the real `resolveInitialScope` actor that calls the backend's
 * `GET /api/projects` (page 1; we only need to learn whether any project
 * exists for MR-1). The `deeplink_project_id` branch is wired in 01-03;
 * in 01-01 we just check the project list and pick the first project (or
 * report no_projects).
 *
 * NOTE: the backend's authorize_org middleware checks `X-Org-Id` against
 * the JWT. Auth-proxy injects these headers in dev mode (DEV_USER).
 */
export function resolveInitialScopeFn(
  backendUrl: string,
  principalHeaders: Record<string, string>,
  shouldFailListSessions: (project_id: string) => boolean = () => false,
): (input: ResolveInitialScopeInput) => Promise<ResolveInitialScopeOutput> {
  return async (input) => {
    // ─── Deep-link (deeplink_project_id) fast-path ────────────────────────
    // Per US-204 / app-arch §2.3: when a deeplink_project_id is supplied, the
    // resolver consults the backend's `GET /api/projects/:id` directly so it
    // can distinguish 403 (cross-tenant / access revoked) from 404
    // (project_not_found). Listing all the user's projects can't make that
    // distinction (the project is simply absent in both cases). The branch
    // returns the project_not_found / cross_tenant variant accordingly; on
    // 200 the project is settled.
    if (input.deeplink_project_id) {
      const detailResp = await fetch(
        `${backendUrl}/api/projects/${encodeURIComponent(input.deeplink_project_id)}`,
        {
          method: "GET",
          headers: {
            "x-request-id": "j002-resolve-intent",
            ...principalHeaders,
          },
        },
      );
      if (detailResp.status === 404) {
        return { project_not_found: true };
      }
      if (detailResp.status === 403) {
        return { cross_tenant: true };
      }
      if (!detailResp.ok) {
        throw new Error(`get_project failed: ${detailResp.status}`);
      }
      const detailBody = (await detailResp.json()) as
        | { id?: string; name?: string }
        | { data?: { id?: string; name?: string; attributes?: { name?: string } } };
      const projId =
        (detailBody as { id?: string }).id ??
        (detailBody as { data?: { id?: string } }).data?.id ??
        input.deeplink_project_id;
      const projName =
        (detailBody as { name?: string }).name ??
        (detailBody as { data?: { name?: string; attributes?: { name?: string } } }).data
          ?.name ??
        (detailBody as { data?: { attributes?: { name?: string } } }).data?.attributes
          ?.name ??
        "Untitled";
      return { project: { id: projId, name: projName } };
    }

    // ─── No intent — list_projects fallback (last-used resolution) ────────
    const resp = await fetch(`${backendUrl}/api/projects`, {
      method: "GET",
      headers: {
        "x-request-id": "j002-resolve",
        ...principalHeaders,
      },
    });
    if (!resp.ok) {
      throw new Error(`list_projects failed: ${resp.status}`);
    }
    // Backend's list_projects responds with JSON:API-shaped envelope:
    //   { data: [{id, attributes:{name}, ...}], links, meta }
    // Tolerate the plain {items} or array shapes for forward-compat with
    // possible adapter rewrites.
    const body = (await resp.json()) as
      | { items?: Array<{ id: string; name?: string }> }
      | { data?: Array<{ id: string; name?: string; attributes?: { name?: string } }> }
      | Array<{ id: string; name?: string }>;
    const rawItems = Array.isArray(body)
      ? body
      : "data" in body && Array.isArray(body.data)
        ? body.data
        : "items" in body && Array.isArray(body.items)
          ? body.items
          : [];
    const items = rawItems.map((p) => ({
      id: p.id,
      name:
        p.name ??
        (p as { attributes?: { name?: string } }).attributes?.name ??
        "Untitled",
    }));

    if (items.length === 0) {
      return { no_projects: true };
    }

    // ─── Last-used resolution (OQ-J002-5 / DWD-9 / 01-02) ───────────────────
    // Fire N parallel `list_sessions(project_id, limit=1)` reads. For each
    // project, capture the most-recent session's last_active_at (or NULL if
    // empty). Pick the project carrying the freshest last_active_at; ties
    // broken by lexicographic-smaller `id`. Projects whose `list_sessions`
    // call 5xx-fails are omitted from the map AND surfaced as
    // `degraded_project_ids` so the orchestrator can emit a
    // `last_used_resolution_degraded` event.
    const probes = await Promise.all(
      items.map(async (p) => {
        // Test-only knob: simulate a 5xx list_sessions for this project.
        if (shouldFailListSessions(p.id)) {
          return { id: p.id, name: p.name, last_active_at: null as string | null, degraded: true };
        }
        try {
          const sResp = await fetch(
            `${backendUrl}/api/projects/${encodeURIComponent(p.id)}/sessions?page%5Bsize%5D=1`,
            {
              method: "GET",
              headers: {
                "x-request-id": "j002-list-sessions",
                ...principalHeaders,
              },
            },
          );
          if (!sResp.ok) {
            // 4xx OR 5xx — treat as degraded; omit from the map.
            return { id: p.id, name: p.name, last_active_at: null as string | null, degraded: sResp.status >= 500 };
          }
          const sBody = (await sResp.json()) as
            | { items?: Array<{ last_active_at?: string }> }
            | { data?: Array<{ attributes?: { last_active_at?: string }; last_active_at?: string }> }
            | Array<{ last_active_at?: string }>;
          const rawSessions = Array.isArray(sBody)
            ? sBody
            : "data" in sBody && Array.isArray(sBody.data)
              ? sBody.data
              : "items" in sBody && Array.isArray(sBody.items)
                ? sBody.items
                : [];
          if (rawSessions.length === 0) {
            return { id: p.id, name: p.name, last_active_at: null, degraded: false };
          }
          const first = rawSessions[0] as {
            last_active_at?: string;
            attributes?: { last_active_at?: string };
          };
          const ts =
            first.last_active_at ??
            first.attributes?.last_active_at ??
            null;
          return { id: p.id, name: p.name, last_active_at: ts, degraded: false };
        } catch {
          // Network / transport error — degraded.
          return { id: p.id, name: p.name, last_active_at: null as string | null, degraded: true };
        }
      }),
    );

    const most_recent_session_per_project: Record<string, string> = {};
    const degraded_project_ids: string[] = [];
    for (const probe of probes) {
      if (probe.degraded) {
        degraded_project_ids.push(probe.id);
        continue;
      }
      if (probe.last_active_at) {
        most_recent_session_per_project[probe.id] = probe.last_active_at;
      }
    }

    // Pick: among projects with a non-null last_active_at, pick the freshest
    // (lex-larger ISO timestamp wins; tie → lex-smaller `id`). Among projects
    // with NULL last_active_at (no sessions), fall back to lex-smaller `name`.
    const withSessions = probes.filter((p) => !p.degraded && p.last_active_at !== null);
    const withoutSessions = probes.filter((p) => !p.degraded && p.last_active_at === null);

    let pick: { id: string; name: string } | null = null;
    if (withSessions.length > 0) {
      const sorted = [...withSessions].sort((a, b) => {
        // Primary: last_active_at DESC.
        const ta = a.last_active_at ?? "";
        const tb = b.last_active_at ?? "";
        if (ta !== tb) return tb.localeCompare(ta);
        // Tie-break: lex-smaller id WINS (deterministic across cold restarts).
        return a.id.localeCompare(b.id);
      });
      const head = sorted[0];
      pick = { id: head.id, name: head.name };
    } else if (withoutSessions.length > 0) {
      // No sessions anywhere → lex-smallest by NAME.
      const sorted = [...withoutSessions].sort((a, b) => a.name.localeCompare(b.name));
      const head = sorted[0];
      pick = { id: head.id, name: head.name };
    } else {
      // Every project was degraded — fall back to lex-smallest by name from
      // the raw items list so we still land in `project_selected` (the user
      // sees something rather than the welcome shell). The
      // `last_used_resolution_degraded` event still fires for every project.
      const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name));
      const head = sortedItems[0];
      pick = { id: head.id, name: head.name };
    }

    return {
      project: pick,
      most_recent_session_per_project,
      ...(degraded_project_ids.length > 0 ? { degraded_project_ids } : {}),
    };
  };
}

export function resolveInitialScopeActor(
  backendUrl: string,
  principalHeaders: Record<string, string>,
  shouldFailListSessions: (project_id: string) => boolean = () => false,
): ResolveInitialScopeActor {
  const fn = resolveInitialScopeFn(
    backendUrl,
    principalHeaders,
    shouldFailListSessions,
  );
  return fromPromise<ResolveInitialScopeOutput, ResolveInitialScopeInput>(
    ({ input }) => fn(input),
  );
}

/**
 * Build the real `createProject` actor — wraps `POST /api/projects`.
 * Returns the project summary (id + name) the backend assigned.
 *
 * Honors the `X-Force-Create-Project-Failure` header for the
 * transient-failure scenario when NWAVE_HARNESS_KNOBS=true; the
 * orchestrator wires this when constructing the actor.
 */
export function createProjectFn(
  backendUrl: string,
  principalHeaders: Record<string, string>,
  forceFailure: () => boolean,
): (input: CreateProjectInput) => Promise<ProjectSummary> {
  return async (input) => {
    if (forceFailure()) {
      throw new Error("create-project forced transient failure");
    }
    const resp = await fetch(`${backendUrl}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": input.request_id,
        ...principalHeaders,
      },
      body: JSON.stringify({ name: input.org_name }),
    });
    if (!resp.ok) {
      throw new Error(`create_project failed: ${resp.status}`);
    }
    // JSON:API-shaped envelope: { data: { id, attributes: { name } } } OR
    // flat { id, name }; tolerate both.
    const body = (await resp.json()) as {
      id?: string;
      project_id?: string;
      name?: string;
      data?: { id?: string; name?: string; attributes?: { name?: string } };
    };
    const id =
      body.id ?? body.project_id ?? body.data?.id ?? "";
    const name =
      body.name ?? body.data?.name ?? body.data?.attributes?.name ?? input.org_name;
    if (!id) {
      throw new Error("create_project returned no id");
    }
    return { id, name };
  };
}

export function createProjectActor(
  backendUrl: string,
  principalHeaders: Record<string, string>,
  forceFailure: () => boolean = () => false,
): CreateProjectActor {
  const fn = createProjectFn(backendUrl, principalHeaders, forceFailure);
  return fromPromise<ProjectSummary, CreateProjectInput>(({ input }) =>
    fn(input),
  );
}

/**
 * MR-4 — switchProjectFn implementation. Mirrors resolveInitialScopeFn's
 * deep-link fast-path: `GET /api/projects/:id` distinguishes 200 (settled),
 * 403 (access_revoked / cross-tenant), 404 (project_not_found). All other
 * non-2xx statuses throw and land in error_recoverable.
 */
export function switchProjectFn(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): (input: SwitchProjectInput) => Promise<SwitchProjectOutput> {
  return async (input) => {
    if (!input.new_project_id) {
      throw new Error("switchProject: new_project_id is required");
    }
    const resp = await fetch(
      `${backendUrl}/api/projects/${encodeURIComponent(input.new_project_id)}`,
      {
        method: "GET",
        headers: {
          "x-request-id": input.request_id,
          ...principalHeaders,
        },
      },
    );
    if (resp.status === 403) return { access_revoked: true };
    if (resp.status === 404) return { project_not_found: true };
    if (!resp.ok) {
      throw new Error(`switch_project get_project failed: ${resp.status}`);
    }
    const body = (await resp.json()) as
      | { id?: string; name?: string }
      | { data?: { id?: string; name?: string; attributes?: { name?: string } } };
    const id =
      (body as { id?: string }).id ??
      (body as { data?: { id?: string } }).data?.id ??
      input.new_project_id;
    const name =
      (body as { name?: string }).name ??
      (body as { data?: { name?: string } }).data?.name ??
      (body as { data?: { attributes?: { name?: string } } }).data?.attributes?.name ??
      "Untitled";
    return { project: { id, name } };
  };
}

export function switchProjectActor(
  backendUrl: string,
  principalHeaders: Record<string, string>,
  /** US-210 test-infra knob (gated, consume-once) — mirrors
   *  resumeSession's slow knob. Holds the switch BEFORE the backend
   *  round-trip so an acceptance scenario can broadcast FREEZE while the
   *  machine is still in `switching_project` (US-210 scenario 2). Not a
   *  product behavior. */
  slowSwitchMsFn?: () => number,
): SwitchProjectActor {
  const fn = switchProjectFn(backendUrl, principalHeaders);
  return fromPromise<SwitchProjectOutput, SwitchProjectInput>(
    async ({ input }) => {
      const slowMs = slowSwitchMsFn?.() ?? 0;
      if (slowMs > 0) {
        await new Promise((r) => setTimeout(r, slowMs));
      }
      return fn(input);
    },
  );
}

// Re-export ActiveScope so callers don't need a separate import path.
export type { ActiveScope };
