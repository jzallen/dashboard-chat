// ProjectAndChatSessionMachine — XState v5 statechart for J-002.
//
// Per `docs/feature/project-and-chat-session-management/design/application-architecture.md` §2
// the J-002 machine ultimately carries 12 narrative states + `error_recoverable` +
// `freeze`. Sub-step 01-01 (substrate + walking skeleton) lands the MR-1 surface:
//
//   resolving_initial_scope (initial) ─┬─→ project_selected
//                                       ├─→ no_projects_empty_state
//                                       └─→ scope_mismatch_terminal
//   no_projects_empty_state            ─→ creating_project (valid name)
//                                      ─→ self                (empty name; inline error)
//   creating_project (invoke)          ─┬─→ project_selected   (onDone)
//                                       └─→ error_recoverable  (onError; transient)
//   project_selected                   (entry assigns context.project; emits project_selected)
//   scope_mismatch_terminal            ─→ resolving_initial_scope (back_to_projects_clicked)
//   error_recoverable                  ─→ creating_project        (retry_clicked; preserves pending_project_name)
//
// Later MRs extend with `loading_session_list`, `session_list_visible`, `resuming_session`,
// `session_active_no_messages`, `session_active`, `switching_dataset_context`,
// `switching_project`, and the cross-machine `freeze` side-state (MR-6).
//
// ADR-028 §"No machine imports another machine" is honored: this file does NOT
// import from `login-and-org-setup.ts`. Cross-machine entry happens via the
// orchestrator broadcasting `j001_ready` after J-001's `priorState` watcher
// observes a transition into `ready`.

import { assign, fromPromise, setup } from "xstate";

import type { ActiveScope, ResourceType } from "../active-scope.ts";

export type J002State =
  | "resolving_initial_scope"
  | "no_projects_empty_state"
  | "creating_project"
  | "project_selected"
  | "scope_mismatch_terminal"
  | "error_recoverable";

export interface ProjectSummary {
  id: string;
  name: string;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  last_active_at: string;
  active_dataset_id: string | null;
}

export type J002CauseTag =
  | "no_projects"
  | "transient"
  | "project_not_found"
  | "cross_tenant"
  | "access_revoked"
  | "dataset_not_found"
  | "dataset_access_denied"
  | "session_not_found"
  | "list_sessions_degraded"
  | "replay_abandoned";

export interface J002ProjectValidationError {
  kind: "empty" | "too_short" | "too_long";
  message: string;
}

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  ts: string;
}

export interface J002MachineContext {
  correlation_id: string;
  principal_id: string;

  // From J-001 projection — set on j001_ready event entry:
  org_id: string;
  user_first_name: string | null;

  // Authoritative project context — populated on project_selected entry:
  project: { id: string | null; name: string | null };

  // Session-list scaffolding — populated by later MRs (kept here so the
  // projection shape stays stable across MRs and avoids migration churn).
  session_list: SessionSummary[];
  session_list_next_cursor: string | null;
  most_recent_session_per_project: Record<string, string>;

  // Active session + transcript — populated by MR-2+:
  session_id: string | null;
  transcript: TranscriptMessage[];

  // Active resource (dataset) — populated by MR-5:
  resource: { type: ResourceType | null; id: string | null };

  // Intent payloads — populated on deep-link / switching events:
  intent_project_id: string | null;
  intent_session_id: string | null;
  intent_resource_id: string | null;
  intent_resource_type: ResourceType | null;

  // Cross-state plumbing:
  underlying_cause_tag: J002CauseTag | null;
  last_live_state: J002State | null;
  retries: number;
  /** Composer text preserved across creating_project ↔ error_recoverable. */
  pending_project_name: string;

  // Inline validation error attached when a submitted project name fails
  // local validation (parallels J-001's org_validation_error).
  project_validation_error: J002ProjectValidationError | null;

  // Observability counters:
  scope_reconciled_count: number;
  stale_intents_dropped_count: number;
}

export type J002Event =
  | { type: "j001_ready"; org_id: string; user_first_name: string }
  | { type: "create_project_clicked" }
  | { type: "create_project_submitted"; org_name: string }
  | { type: "back_to_projects_clicked" }
  | { type: "retry_clicked" }
  | {
      type: "open_deep_link";
      intent_project_id?: string;
      intent_session_id?: string;
      intent_resource_id?: string;
      intent_resource_type?: ResourceType;
    }
  | { type: "FREEZE"; origin_correlation_id?: string }
  | { type: "THAW" };

export type ResolveInitialScopeOutput =
  | { project: ProjectSummary }
  | { no_projects: true }
  | { cross_tenant: true };

export interface ResolveInitialScopeInput {
  org_id: string;
  intent_project_id: string | null;
  principal_id: string;
}

export type ResolveInitialScopeActor = ReturnType<
  typeof fromPromise<ResolveInitialScopeOutput, ResolveInitialScopeInput>
>;

export interface CreateProjectInput {
  org_name: string;
  correlation_id: string;
  principal_id: string;
}

export type CreateProjectActor = ReturnType<
  typeof fromPromise<ProjectSummary, CreateProjectInput>
>;

export interface J002MachineDeps {
  resolveInitialScope: ResolveInitialScopeActor;
  createProject: CreateProjectActor;
}

/** Trim + length-check the project name; returns null if valid. */
export function validateProjectName(
  raw: string,
): J002ProjectValidationError | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return { kind: "empty", message: "Please enter a project name" };
  }
  if (trimmed.length < 2) {
    return { kind: "too_short", message: "Project name is too short" };
  }
  if (trimmed.length > 80) {
    return { kind: "too_long", message: "Project name is too long" };
  }
  return null;
}

export function createProjectAndChatSessionMachine(deps: J002MachineDeps) {
  return setup({
    types: {
      context: {} as J002MachineContext,
      events: {} as J002Event,
      input: {} as {
        correlation_id: string;
        principal_id: string;
        org_id?: string;
        user_first_name?: string;
        intent_project_id?: string;
      },
    },
    actors: {
      resolveInitialScope: deps.resolveInitialScope,
      createProject: deps.createProject,
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
    },
  }).createMachine({
    id: "project-and-chat-session-management",
    initial: "resolving_initial_scope",
    context: ({ input }) => ({
      correlation_id: input.correlation_id,
      principal_id: input.principal_id,
      org_id: input.org_id ?? "",
      user_first_name: input.user_first_name ?? null,
      project: { id: null, name: null },
      session_list: [],
      session_list_next_cursor: null,
      most_recent_session_per_project: {},
      session_id: null,
      transcript: [],
      resource: { type: null, id: null },
      intent_project_id: input.intent_project_id ?? null,
      intent_session_id: null,
      intent_resource_id: null,
      intent_resource_type: null,
      underlying_cause_tag: null,
      last_live_state: null,
      retries: 0,
      pending_project_name: "",
      project_validation_error: null,
      scope_reconciled_count: 0,
      stale_intents_dropped_count: 0,
    }),
    states: {
      resolving_initial_scope: {
        on: {
          // Entry from J-001 — orchestrator broadcasts this when J-001
          // transitions into `ready`. The payload carries the inherited
          // org_id + user_first_name from J-001's projection so J-002
          // never re-fetches them from JWT / /api/orgs/me (DWD-6, F-5).
          j001_ready: {
            actions: assign({
              org_id: ({ event }) => event.org_id,
              user_first_name: ({ event }) => event.user_first_name,
            }),
            // Stay in resolving_initial_scope — the invoke below fires.
            target: "resolving_initial_scope",
            reenter: true,
          },
        },
        invoke: {
          src: "resolveInitialScope",
          input: ({ context }) => ({
            org_id: context.org_id,
            intent_project_id: context.intent_project_id,
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
                (event.output as { no_projects?: true }).no_projects === true,
              target: "no_projects_empty_state",
            },
            {
              target: "project_selected",
              actions: assign({
                project: ({ event }) => {
                  const out = event.output as { project: ProjectSummary };
                  return { id: out.project.id, name: out.project.name };
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
      no_projects_empty_state: {
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
            correlation_id: context.correlation_id,
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
        // Terminal-for-MR-1 (future MRs add transitions to switching_project,
        // session_active, etc.). The walking-skeleton's "project chip rendered"
        // assertion reads context.project on entry.
      },
      scope_mismatch_terminal: {
        on: {
          back_to_projects_clicked: {
            target: "resolving_initial_scope",
            actions: assign({
              intent_project_id: () => null,
              intent_session_id: () => null,
              intent_resource_id: () => null,
              intent_resource_type: () => null,
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
              retries: ({ context }) => context.retries + 1,
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
 * exists for MR-1). The `intent_project_id` branch is wired in 01-03; in
 * 01-01 we just check the project list and pick the first project (or
 * report no_projects).
 *
 * NOTE: the backend's authorize_org middleware checks `X-Org-Id` against
 * the JWT. Auth-proxy injects these headers in dev mode (DEV_USER).
 */
export function resolveInitialScopeFn(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): (input: ResolveInitialScopeInput) => Promise<ResolveInitialScopeOutput> {
  return async (input) => {
    const resp = await fetch(`${backendUrl}/api/projects`, {
      method: "GET",
      headers: {
        "x-correlation-id": "j002-resolve",
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

    // If intent_project_id is set (deep link), find that one. If not in
    // the list, fall through to scope_mismatch_terminal via cross_tenant.
    if (input.intent_project_id) {
      const match = items.find((p) => p.id === input.intent_project_id);
      if (!match) {
        return { cross_tenant: true };
      }
      return { project: { id: match.id, name: match.name } };
    }

    if (items.length === 0) {
      return { no_projects: true };
    }
    // First-project heuristic for MR-1; MR-2 lands the last-used resolution.
    const head = items[0];
    return { project: { id: head.id, name: head.name } };
  };
}

export function resolveInitialScopeActor(
  backendUrl: string,
  principalHeaders: Record<string, string>,
): ResolveInitialScopeActor {
  const fn = resolveInitialScopeFn(backendUrl, principalHeaders);
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
        "x-correlation-id": input.correlation_id,
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

// Re-export ActiveScope so callers don't need a separate import path.
export type { ActiveScope };
