// project-context/setup/actors.ts — the external-service request layer for the
// project-context half of J-002. Houses every actor RESOLVER that performs
// network I/O (the backend project SSOT: list/get/create projects + the
// last-used `list_sessions` probes), the I/O contracts they exchange with the
// machine, the `fromPromise`-bound actor-type aliases, and `buildActors(deps)` —
// the deps-driven actor map machine.ts threads straight into `setup({ actors })`.
// It imports from `xstate` and the shared domain (./types.ts, active-scope.ts)
// ONLY — never machine.ts or the other setup modules (one-way dependency, no
// cycle).
//
// References:
//   docs/decisions/adr-028-*.md  — machines own transitions; parent-ignorant children
//   docs/decisions/adr-029-*.md  — ActiveScope invariants; cross-tenant rejection; identity-header propagation
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

export interface ProjectContextMachineDeps {
  resolveInitialScope: ResolveInitialScopeActor;
  createProject: CreateProjectActor;
  /** Optional: atomic project switching. When omitted, the
   *  `switching_project_intent` event is dropped (no-op). */
  switchProject?: SwitchProjectActor;
}

/**
 * Build the machine's actor map from the injected `deps`. machine.ts threads the
 * return straight into `setup({ actors })` so the statechart only names actors
 * (`src: "resolveInitialScope"`), never wires them. A `fromPromise` fallback
 * stands in for the optional `switchProject` — it throws so test setups that
 * never wired it surface a named diagnostic rather than silently succeeding. The
 * fallback's generics stay precise so `ReturnType<typeof buildActors>` (and the
 * `ProjectContextActor` union derived from it) is exact.
 */
export function buildActors(deps: ProjectContextMachineDeps) {
  return {
    resolveInitialScope: deps.resolveInitialScope,
    createProject: deps.createProject,
    // fromPromise fallback when deps.switchProject is absent. The fallback
    // throws so test setups that never wired it surface a named diagnostic
    // rather than silently succeeding.
    switchProject:
      deps.switchProject ??
      fromPromise<SwitchProjectOutput, SwitchProjectInput>(async () => {
        throw new Error(
          "switchProject actor not wired — MR-4 deps.switchProject is required",
        );
      }),
  };
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

// ────────────────────────────────────────────────────────────────────────────
// Production actor factories — wired by the orchestrator's composition root.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the real `resolveInitialScope` actor that calls the backend's
 * `GET /api/projects` (page 1; we only need to learn whether any project
 * exists). Without a `deeplink_project_id` it checks the project list and
 * picks the first project (or reports no_projects); with one it takes the
 * deep-link fast-path below.
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
    // US-204: when a deeplink_project_id is supplied, the
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

    // ─── Last-used resolution (OQ-J002-5 / DWD-9) ──────────────────────────
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
 * switchProjectFn implementation. Mirrors resolveInitialScopeFn's
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
