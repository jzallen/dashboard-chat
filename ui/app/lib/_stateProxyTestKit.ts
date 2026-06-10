/* Shared StateProxy test doubles — scripted at the proxy's TRANSPORT ports only
   (fetchImpl + eventSourceFactory; never machine internals). Used by the
   StateProxy consumers' tests (the app-shell gate, /onboarding, _testRoutes) so
   the fake server lives in one place. Underscore-prefixed colocated test
   support — the routes/_fixtureCatalog.ts pattern. */
import type {
  ChatAppStateDocument,
  ChatAppWireEvent,
} from "@dashboard-chat/ui-state-wire";

import { createStateProxy, type StateProxy } from "./state-proxy";

/** happy-dom has no EventSource — a silent fake stream satisfies subscribe. */
export const silentEventSourceFactory = () => ({
  addEventListener() {},
  close() {},
  onerror: null as ((ev: unknown) => void) | null,
});

/** A StateProxy with no network: every POSTed wire event is recorded in
 *  `posted` and answered with the document `respond` scripts for it — the fake
 *  server. The SSE stream is the silent fake. */
export function scriptedStateProxy(
  seed: ChatAppStateDocument,
  respond: (event: ChatAppWireEvent) => ChatAppStateDocument,
): { proxy: StateProxy; posted: ChatAppWireEvent[] } {
  const posted: ChatAppWireEvent[] = [];
  const fetchImpl = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const event = JSON.parse(String(init?.body)) as ChatAppWireEvent;
    posted.push(event);
    const doc = respond(event);
    return { ok: true, status: 200, json: async () => doc } as Response;
  }) as typeof fetch;
  const proxy = createStateProxy({
    seed,
    fetchImpl,
    eventSourceFactory: silentEventSourceFactory,
  });
  return { proxy, posted };
}

// ── session flag cookie helpers (happy-dom) ──────────────────────────────────

export function giveSessionFlag(): void {
  document.cookie = "session=1";
}

export function dropSessionFlag(): void {
  document.cookie = "session=1; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}
