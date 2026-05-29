// Loader-facing ui-state transport for the single `/state` document surface
// (ADR-046 MR-4 — the FE-wholesale cutover to StateProxy + one document).
//
// The per-machine read model is GONE. ADR-046 dissolves the three per-machine
// projections (`login-and-org-setup` / `project-and-chat-session-management` /
// `session-chat`) into ONE `ChatAppStateDocument` whose `regions.{onboarding,
// projectContext,sessionChat}` carry what the three projections used to. RRv7
// server loaders consume that document through two helpers:
//
//   - `fetchStateDocument(request)` — GET /state once for the SSR seed (re-exported
//     from the StateProxy client lib; the browser builds `createStateProxy({ seed })`
//     from the loader's serialized document so first paint has the real document).
//   - `postStateEvent(request, event)` — the single `POST /state/events` write
//     surface. The server-side analog of the proxy's `.postEvent` (which is browser-
//     credentialed); loaders that drive the actor forward (deep links, restart) use
//     this and forward the inbound Bearer (DWD-1) rather than reaching into client
//     state. It supersedes the old `postEvent(machine, …)` and
//     `openProjectDeepLink(…)` — those collapse into `open_deep_link` /
//     `session_begin` events on the one event surface (ADR-046 Decision 3).
//
// Both keep the DD-16 5-second AbortController budget: a hang surfaces as
// `Response(504)` and a non-2xx upstream surfaces as the upstream `Response`, so the
// route's ErrorBoundary renders an HTML fallback rather than hanging SSR.
//
// References:
//   docs/decisions/adr-046-*.md — Decision 1 (document), Decision 2 (StateProxy + SSR seed), Decision 3 (event surface)
//   frontend/app/lib/state-proxy.ts — createStateProxy + fetchStateDocument (the browser/SSR read)

import type {
  ChatAppStateDocument,
  ChatAppWireEvent,
} from "@dashboard-chat/ui-state-wire";

import { fetchStateDocument } from "./state-proxy";

// Re-export the SSR seed read so loaders import the whole document transport from
// one module (read via `fetchStateDocument`, write via `postStateEvent`).
export { fetchStateDocument };

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL ?? "http://auth-proxy:3000";
/** The `/ui-state/*` prefix auth-proxy proxies to the ui-state container. */
const UI_STATE_PREFIX = "/ui-state";
const LOADER_TIMEOUT_MS = 5000;

/**
 * A single JSON fetch bounded by a 5s AbortController (DD-16). Non-2xx → thrown
 * `Response(status)`; timeout → thrown `Response(504)`, exactly the contract the
 * StateProxy client uses, so server loaders surface an HTML fallback rather than
 * hanging the SSR pass.
 */
async function boundedFetch(
  url: URL,
  init: RequestInit,
): Promise<ChatAppStateDocument> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOADER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Response(`ui-state ${res.status}`, { status: res.status });
    }
    return (await res.json()) as ChatAppStateDocument;
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

/**
 * Post one event to the single `/state/events` write surface and return the new
 * `ChatAppStateDocument` (ADR-046 Decision 3 — the response IS the new document).
 * Identity is header-derived (auth-proxy injects `X-User-Id` from the re-verified
 * Bearer the loader forwards); the body is the bare event envelope. Deep links
 * (`open_deep_link`) and force-restart (`session_begin`) are ordinary events here —
 * the standalone `/open-deep-link` + `/begin` routes collapsed into this surface.
 */
export async function postStateEvent(
  request: Request,
  event: ChatAppWireEvent,
): Promise<ChatAppStateDocument> {
  const authHeader = request.headers.get("authorization") ?? "";
  const url = new URL(`${UI_STATE_PREFIX}/state/events`, AUTH_PROXY_URL);
  return boundedFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader },
    body: JSON.stringify(event),
  });
}

/**
 * Serialize the document's TOP-LEVEL `active_scope` into the X-Active-Scope header
 * value (JSON-encoded) per DWD-3 + DWD-5. Re-pointed from the old per-machine
 * `projection.active_scope` to the document's single authoritative `active_scope`
 * (ADR-046 Decision 1 — the deepest-resolved region wins, hoisted to the top level).
 * The sole producer of the header value — call sites that need it MUST go through
 * this helper (DWD-3 lint rule enforces).
 *
 * Returns null when the document has no active scope yet (org_id empty); the caller
 * decides whether to omit the header in that case.
 */
export function activeScopeHeader(
  document: ChatAppStateDocument,
): string | null {
  const scope = document.active_scope;
  if (!scope || !scope.org_id) return null;
  return JSON.stringify(scope);
}
