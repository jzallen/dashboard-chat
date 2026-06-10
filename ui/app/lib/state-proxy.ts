// StateProxy — the CLIENT stand-in for the remote ChatApp actor (ADR-046,
// Decision 2). A hand-built object satisfying XState's ActorRef surface
// (`.send` / `.getSnapshot` / `.subscribe`, plus `.postEvent` for loader
// ergonomics) that `useSelector` consumes. The machine NEVER leaves the server;
// the proxy observes a stable `ChatAppStateDocument` and the SPA slices it.
//
//   .getSnapshot() → the last observed document (cache; never undefined —
//                    seeded anonymous for this pure-CSR SPA)
//   .send(event)   → POST /state/events (fire-and-forget); caches the response
//   .postEvent(e)  → POST /state/events (awaitable); returns the new document
//   .subscribe(o)  → GET /state/stream (SSE); pushes each frame to observers
//
// COOKIE TRANSPORT (this SPA's baseline): auth rides the httpOnly auth_token
// cookie — every fetch uses `credentials: "include"`, the default SSE factory is
// `new EventSource(url, { withCredentials: true })`, and NO Authorization header
// is ever built. Ported from frontend/app/lib/state-proxy.ts with the SSR seed
// path (fetchStateDocument / AUTH_PROXY_URL) dropped — this SPA is CSR-only and
// seeds from `anonymousStateDocument()`.
//
// Transport is injected (fetchImpl + eventSourceFactory) so it is unit-testable
// with no network and no platform EventSource; the defaults are the browser
// platform primitives. The wire types are imported from the shared SSOT —
// @dashboard-chat/ui-state-wire — NOT from any ui-state machine internal.
//
// References:
//   docs/decisions/adr-046-*.md — Decision 2 (the StateProxy contract), Decision 3 (event surface)
//   frontend/app/lib/state-proxy.ts — the (frozen) SSR-era reference this ports

import {
  anonymousStateDocument,
  type ChatAppStateDocument,
  type ChatAppWireEvent,
} from "@dashboard-chat/ui-state-wire";

/** The `/ui-state/*` prefix the auth-proxy routes to the ui-state container —
 *  relative, so requests ride the same origin the SPA is served from. */
const UI_STATE_PREFIX = "/ui-state";
const FETCH_TIMEOUT_MS = 5000;

// ───────────────────────────── transport ports (injectable) ─────────────────────────────

/** The minimal SSE source surface the proxy consumes — `EventSource` satisfies
 *  it structurally. Injected so tests drive frames deterministically. */
export interface StateEventSourceLike {
  addEventListener(
    type: string,
    listener: (ev: { data: string }) => void,
  ): void;
  close(): void;
  onerror: ((ev: unknown) => void) | null;
}

/** Observer forms `subscribe` accepts: a bare `next` function, or an observer
 *  object. `@xstate/react`'s `useSelector` passes `{ next, error }`. */
export type StateObserver =
  | ((doc: ChatAppStateDocument) => void)
  | {
      next?: (doc: ChatAppStateDocument) => void;
      error?: (e: unknown) => void;
      complete?: () => void;
    };

export interface StateProxyOptions {
  /** First document. Default `anonymousStateDocument()` (pure CSR). */
  seed?: ChatAppStateDocument;
  /** Base path for the `/state*` routes. Default `/ui-state` (relative). */
  baseUrl?: string;
  /** fetch implementation. Default `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** SSE source factory. Default a credentialed `EventSource`. */
  eventSourceFactory?: (url: string) => StateEventSourceLike;
}

/** The ActorRef-shaped proxy `useSelector` consumes (Decision 2). */
export interface StateProxy {
  /** ActorRef.getSnapshot — the last observed document, synchronously (cache). */
  getSnapshot(): ChatAppStateDocument;
  /** ActorRef.send — fire-and-forget; POSTs the event and caches the response. */
  send(event: ChatAppWireEvent): void;
  /** Loader/req-resp ergonomics — await the document a send produces. */
  postEvent(event: ChatAppWireEvent): Promise<ChatAppStateDocument>;
  /** ActorRef.subscribe — registers an observer and (on the first) opens the SSE. */
  subscribe(observer: StateObserver): { unsubscribe(): void };
  /** Minimal ActorRef identity (useSelector tolerates these; nothing reads them
   *  on the client — there is no client-side actor system). */
  id: string;
  sessionId: string;
}

// ───────────────────────────── bounded fetch ─────────────────────────────

/** A single JSON fetch bounded by a 5s AbortController. Non-2xx → thrown
 *  `Response(status)`; timeout → thrown `Response(504)` — so callers surface a
 *  fallback rather than hanging. */
async function fetchDocument(
  fetchImpl: typeof fetch,
  url: string | URL,
  init: RequestInit,
): Promise<ChatAppStateDocument> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
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

// ───────────────────────────── the proxy factory ─────────────────────────────

export function createStateProxy(opts: StateProxyOptions = {}): StateProxy {
  const baseUrl = opts.baseUrl ?? UI_STATE_PREFIX;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const eventSourceFactory =
    opts.eventSourceFactory ??
    ((url: string) =>
      new EventSource(url, { withCredentials: true }) as StateEventSourceLike);

  // The cache — getSnapshot's synchronous return. Never undefined: the anonymous
  // document (every region in its initial `verifying` state) until the first
  // POST response or SSE frame replaces it.
  let cached: ChatAppStateDocument = opts.seed ?? anonymousStateDocument();

  const observers = new Set<{
    next?: (doc: ChatAppStateDocument) => void;
    error?: (e: unknown) => void;
    complete?: () => void;
  }>();
  let source: StateEventSourceLike | null = null;

  const normalize = (observer: StateObserver) =>
    typeof observer === "function" ? { next: observer } : observer;

  /** Cache the document FIRST, then fan out — so a re-read of getSnapshot from
   *  inside an observer (useSelector does exactly this) sees the fresh value. */
  const pushDocument = (doc: ChatAppStateDocument): void => {
    cached = doc;
    for (const o of observers) o.next?.(doc);
  };

  const pushError = (e: unknown): void => {
    for (const o of observers) o.error?.(e);
  };

  const openStream = (): void => {
    if (source) return;
    const es = eventSourceFactory(`${baseUrl}/state/stream`);
    source = es;
    // Each `event: state` frame's data is a fresh document.
    es.addEventListener("state", (ev) => {
      try {
        pushDocument(JSON.parse(ev.data) as ChatAppStateDocument);
      } catch (err) {
        pushError(err);
      }
    });
    // A server-emitted `event: error` frame (carries data) — surface it; the
    // cache stays last-known-good.
    es.addEventListener("error", (ev) => {
      pushError(ev?.data ? safeParse(ev.data) : ev);
    });
    // Transport error (connection drop). EventSource auto-reconnects and the
    // server re-emits the current document as the first frame, so we keep the
    // cache and only notify — never tear down.
    es.onerror = (ev) => pushError(ev);
  };

  const closeStream = (): void => {
    source?.close();
    source = null;
  };

  const postEvent = async (
    event: ChatAppWireEvent,
  ): Promise<ChatAppStateDocument> => {
    const doc = await fetchDocument(fetchImpl, `${baseUrl}/state/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(event),
    });
    // The response IS the new document — cache it and fan out so the user's own
    // event reflects immediately, without waiting for the SSE round-trip.
    pushDocument(doc);
    return doc;
  };

  return {
    id: "state-proxy",
    sessionId: "state-proxy",
    getSnapshot: () => cached,
    postEvent,
    send: (event) => {
      // ActorRef.send is fire-and-forget; swallow rejection (the cache stays
      // last-known-good, and postEvent callers handle errors explicitly).
      void postEvent(event).catch(() => {});
    },
    subscribe: (observer) => {
      const normalized = normalize(observer);
      observers.add(normalized);
      openStream();
      return {
        unsubscribe: () => {
          observers.delete(normalized);
          if (observers.size === 0) closeStream();
        },
      };
    },
  };
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
