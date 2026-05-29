// StateProxy — the CLIENT stand-in for the remote ChatApp actor (ADR-046 MR-3,
// Decision 2). A hand-built object satisfying XState's ActorRef surface
// (`.send` / `.getSnapshot` / `.subscribe`, plus `.postEvent` for loader
// ergonomics) that `useSelector` consumes. The machine NEVER leaves the server;
// the proxy observes a stable `ChatAppStateDocument` and the FE slices it.
//
//   .getSnapshot() → the last observed document (cache; never undefined —
//                    seeded for SSR, anonymous for pure CSR)
//   .send(event)   → POST /state/events (fire-and-forget); caches the response
//   .postEvent(e)  → POST /state/events (awaitable); returns the new document
//   .subscribe(o)  → GET /state/stream (SSE); pushes each frame to observers
//
// Transport is injected (fetchImpl + eventSourceFactory) so it is unit-testable
// with no network and no platform EventSource; the defaults are the browser
// platform primitives. The wire types are imported from the shared SSOT —
// @dashboard-chat/ui-state-wire — NOT from any ui-state machine internal.
//
// References:
//   docs/decisions/adr-046-*.md — Decision 2 (the StateProxy contract), Decision 3 (event surface)
//   frontend/app/lib/ui-state-client.ts — the per-machine client this supersedes (bounded-fetch pattern reused)

import {
  anonymousStateDocument,
  type ChatAppStateDocument,
  type ChatAppWireEvent,
} from "@dashboard-chat/ui-state-wire";

// Server-side base for SSR seed fetches (mirrors ui-state-client.ts). The
// browser proxy uses a relative base so requests ride the same origin the SPA is
// served from (auth-proxy injects identity from the session).
const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL ?? "http://auth-proxy:3000";
/** The `/ui-state/*` prefix auth-proxy proxies to the ui-state container. */
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
  /** SSR-seeded first document (from `fetchStateDocument`) — no first-paint flash. */
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

// ───────────────────────────── bounded fetch (mirrors ui-state-client.ts) ─────────────────────────────

/** A single JSON fetch bounded by a 5s AbortController. Non-2xx → thrown
 *  `Response(status)`; timeout → thrown `Response(504)` — exactly the contract
 *  the current client maps timeouts to, so server loaders surface an HTML
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

  // The cache — getSnapshot's synchronous return. Never undefined: the SSR seed,
  // else the anonymous document (every region in its initial `verifying` state).
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

// ───────────────────────────── SSR seed ─────────────────────────────

export interface FetchStateDocumentOptions {
  /** fetch implementation. Default `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Origin for the `/ui-state/state` route. Default the auth-proxy URL. */
  authProxyUrl?: string;
}

/**
 * Fetch the current `ChatAppStateDocument` once for the SSR seed (Decision 2,
 * "First document"). The RRv7 server loader calls this and serializes the result
 * into the hydration payload so `createStateProxy({ seed })` returns the real
 * document on first render (no first-paint flash). Forwards the inbound Bearer
 * via the request's Authorization header (DWD-1), bounded by the same 5s budget
 * as the per-machine client.
 */
export async function fetchStateDocument(
  request: Request,
  opts: FetchStateDocumentOptions = {},
): Promise<ChatAppStateDocument> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const origin = opts.authProxyUrl ?? AUTH_PROXY_URL;
  const authHeader = request.headers.get("authorization") ?? "";
  const url = new URL(`${UI_STATE_PREFIX}/state`, origin);
  return fetchDocument(fetchImpl, url, {
    headers: { authorization: authHeader },
  });
}
