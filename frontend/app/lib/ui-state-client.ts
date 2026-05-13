// Request-scoped fetch helper for loaders that need to call ui-state via auth-proxy.
// DWD-1: loaders forward the inbound Bearer token via the request's Authorization header
// rather than reaching into client-only state (useAuth).
// DD-16 (Phase 04): every fetch is bounded by a 5-second AbortController budget.
// On timeout the call rejects with a `Response(504)` so the loader's route-level
// ErrorBoundary can render an HTML fallback rather than hanging the SSR pass.

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL ?? "http://auth-proxy:3000";
const LOADER_TIMEOUT_MS = 5000;

/**
 * Machine identifier for the project-and-chat-session-management flow
 * (project-context source-tree per DWD-13; wire-protocol name unchanged).
 * Exported so route loaders compose flowIds without re-declaring the literal.
 */
export const PROJECT_FLOW_MACHINE = "project-and-chat-session-management";
/** Sibling machine for session lifecycle per DWD-13 §2B. */
export const SESSION_CHAT_MACHINE = "session-chat";

export interface ActiveScopeShape {
  org_id: string;
  project_id: string | null;
  resource_type: "dataset" | "view" | "report" | null;
  resource_id: string | null;
}

export interface ProjectionShape {
  flow_id: string;
  state: string;
  context: Record<string, unknown>;
  active_scope: ActiveScopeShape;
  sequence_id: number;
  last_event_at: string;
  correlation_id: string;
}

async function fetchProjection(
  url: URL,
  authHeader: string,
): Promise<ProjectionShape> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOADER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { authorization: authHeader },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Response(`ui-state ${res.status}`, { status: res.status });
    }
    return (await res.json()) as ProjectionShape;
  } catch (err) {
    if (err instanceof Response) throw err;
    if (
      err instanceof Error &&
      (err.name === "AbortError" || controller.signal.aborted)
    ) {
      throw new Response("ui-state timeout", { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function uiStateClient(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  return {
    /**
     * Read a flow's projection. Per DWD-4, flow_id is principal-scoped:
     * `<machine>:<principal_id>`. When the caller passes no flowId, the
     * server returns a fresh anonymous projection (matches buildProjection's
     * default) — used for cold loader reads before a flow has been started.
     */
    async getProjection(machine: string, flowId?: string) {
      const url = new URL(`/ui-state/flow/${machine}/projection`, AUTH_PROXY_URL);
      if (flowId) url.searchParams.set("flow_id", flowId);
      return fetchProjection(url, authHeader);
    },

    /**
     * Post an event to a flow, returning the updated projection. Used by
     * route loaders that need to drive a machine forward (e.g. submit a
     * create-project intent). Body shape mirrors `/flow/:machine/event`.
     */
    async postEvent(
      machine: string,
      flowId: string,
      event: { type: string; payload?: Record<string, unknown> },
    ): Promise<ProjectionShape> {
      const url = new URL(`/ui-state/flow/${machine}/event`, AUTH_PROXY_URL);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LOADER_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: authHeader,
          },
          body: JSON.stringify({
            flow_id: flowId,
            type: event.type,
            payload: event.payload ?? {},
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Response(`ui-state ${res.status}`, { status: res.status });
        }
        return (await res.json()) as ProjectionShape;
      } catch (err) {
        if (err instanceof Response) throw err;
        if (
          err instanceof Error &&
          (err.name === "AbortError" || controller.signal.aborted)
        ) {
          throw new Response("ui-state timeout", { status: 504 });
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    },

    /**
     * Open a deep link into the project-and-chat-session-management flow
     * (DWD-4 + US-204). Posts to the intent-shaped deep-link endpoint with
     * the supplied intent_* fields. The orchestrator spawns the flow if
     * not yet started and forwards an `open_deep_link` event to the actor,
     * which re-resolves through resolving_initial_scope. Returns the
     * settled projection.
     */
    async openProjectDeepLink(
      principalId: string,
      intent: {
        intent_project_id?: string;
        intent_session_id?: string;
        intent_resource_id?: string;
        intent_resource_type?: "dataset" | "view" | "report";
      },
    ): Promise<ProjectionShape> {
      const url = new URL(
        `/ui-state/flow/${PROJECT_FLOW_MACHINE}/open-deep-link`,
        AUTH_PROXY_URL,
      );
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LOADER_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: authHeader,
          },
          body: JSON.stringify({
            principal_id: principalId,
            ...intent,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Response(`ui-state ${res.status}`, { status: res.status });
        }
        return (await res.json()) as ProjectionShape;
      } catch (err) {
        if (err instanceof Response) throw err;
        if (
          err instanceof Error &&
          (err.name === "AbortError" || controller.signal.aborted)
        ) {
          throw new Response("ui-state timeout", { status: 504 });
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

/**
 * Serialize the projection's active_scope into the X-Active-Scope header
 * value (JSON-encoded) per DWD-3 + DWD-5. The sole producer of the header
 * value — chat-view components / loaders that need to set it MUST go
 * through this helper (DWD-3 lint rule enforces).
 *
 * Returns null when the projection has no active scope yet (org_id empty);
 * caller decides whether to omit the header in that case.
 */
export function activeScopeHeader(projection: ProjectionShape): string | null {
  const scope = projection.active_scope;
  if (!scope || !scope.org_id) return null;
  return JSON.stringify(scope);
}
