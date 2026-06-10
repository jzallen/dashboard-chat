import {
  anonymousStateDocument,
  type ChatAppStateDocument,
  type ChatAppWireEvent,
} from "@dashboard-chat/ui-state-wire";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStateProxy, type StateEventSourceLike } from "./state-proxy";

// ── test doubles (injected at the proxy's transport ports) ──────────────────

interface RecordedFetchCall {
  url: string;
  init: RequestInit;
}

/** A fetchImpl stub that records every call and resolves with `doc` as JSON.
 *  Rejects null/empty URLs like a real fetch would. */
function fetchReturning(doc: ChatAppStateDocument): {
  impl: typeof fetch;
  calls: RecordedFetchCall[];
} {
  const calls: RecordedFetchCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!url) throw new TypeError("fetch: url required");
    calls.push({ url: String(url), init: init ?? {} });
    return { ok: true, status: 200, json: async () => doc } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

/** Deterministic SSE double satisfying StateEventSourceLike. */
class FakeEventSource implements StateEventSourceLike {
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(ev: { data: string }) => void>>();

  constructor(readonly url: string) {
    if (!url) throw new TypeError("EventSource: url required");
  }

  addEventListener(type: string, listener: (ev: { data: string }) => void) {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

function documentWithSequence(sequenceId: number): ChatAppStateDocument {
  return { ...anonymousStateDocument(), sequence_id: sequenceId };
}

const ORG_SUBMITTED: ChatAppWireEvent = {
  type: "org_form_submitted",
  payload: { org_name: "Acme" },
};

/** Case-insensitive Authorization lookup across the header literal forms the
 *  proxy could build (it only ever builds plain records). */
function authorizationHeader(init: RequestInit): string | undefined {
  const headers = (init.headers ?? {}) as Record<string, string>;
  const key = Object.keys(headers).find(
    (name) => name.toLowerCase() === "authorization",
  );
  return key === undefined ? undefined : headers[key];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── behaviors ────────────────────────────────────────────────────────────────

describe("createStateProxy (cookie CSR transport)", () => {
  it("seeds getSnapshot from the anonymous document — pure CSR, no SSR seed", () => {
    const { impl } = fetchReturning(documentWithSequence(1));
    const proxy = createStateProxy({ fetchImpl: impl });

    expect(proxy.getSnapshot()).toEqual(anonymousStateDocument());
  });

  it("postEvent POSTs to /ui-state/state/events with credentials:'include' and NO Authorization header", async () => {
    const fresh = documentWithSequence(7);
    const { impl, calls } = fetchReturning(fresh);
    const proxy = createStateProxy({ fetchImpl: impl });

    const doc = await proxy.postEvent(ORG_SUBMITTED);

    expect(doc).toEqual(fresh);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/ui-state/state/events");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.credentials).toBe("include");
    expect(authorizationHeader(calls[0].init)).toBeUndefined();
    expect(JSON.parse(String(calls[0].init.body))).toEqual(ORG_SUBMITTED);
  });

  it("send fires the same credentialed POST without an Authorization header", async () => {
    const { impl, calls } = fetchReturning(documentWithSequence(2));
    const proxy = createStateProxy({ fetchImpl: impl });

    proxy.send(ORG_SUBMITTED);
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0].url).toBe("/ui-state/state/events");
    expect(calls[0].init.credentials).toBe("include");
    expect(authorizationHeader(calls[0].init)).toBeUndefined();
  });

  it("postEvent caches the returned document BEFORE fanning out — a getSnapshot re-read inside an observer sees the fresh document", async () => {
    const fresh = documentWithSequence(9);
    const { impl } = fetchReturning(fresh);
    const proxy = createStateProxy({
      fetchImpl: impl,
      eventSourceFactory: (url) => new FakeEventSource(url),
    });

    const snapshotsSeenInsideObserver: ChatAppStateDocument[] = [];
    proxy.subscribe(() => {
      snapshotsSeenInsideObserver.push(proxy.getSnapshot());
    });

    await proxy.postEvent(ORG_SUBMITTED);

    expect(snapshotsSeenInsideObserver).toEqual([fresh]);
  });

  it("subscribe opens the SSE factory at /ui-state/state/stream — once for many observers, closed after the last unsubscribe", () => {
    const opened: FakeEventSource[] = [];
    const proxy = createStateProxy({
      fetchImpl: fetchReturning(documentWithSequence(1)).impl,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        opened.push(source);
        return source;
      },
    });

    const first = proxy.subscribe(() => {});
    const second = proxy.subscribe(() => {});

    expect(opened).toHaveLength(1);
    expect(opened[0].url).toBe("/ui-state/state/stream");

    first.unsubscribe();
    expect(opened[0].closed).toBe(false);
    second.unsubscribe();
    expect(opened[0].closed).toBe(true);
  });

  it("the DEFAULT eventSourceFactory constructs EventSource(url, { withCredentials: true })", () => {
    const constructed: Array<{
      url: string;
      init?: { withCredentials?: boolean };
    }> = [];
    class SpyEventSource {
      onerror: ((ev: unknown) => void) | null = null;
      constructor(url: string, init?: { withCredentials?: boolean }) {
        constructed.push({ url, init });
      }
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", SpyEventSource);

    const proxy = createStateProxy({
      fetchImpl: fetchReturning(documentWithSequence(1)).impl,
    });
    proxy.subscribe(() => {});

    expect(constructed).toEqual([
      { url: "/ui-state/state/stream", init: { withCredentials: true } },
    ]);
  });

  it("each SSE `state` frame updates the cache and fans out to observers", () => {
    const sources: FakeEventSource[] = [];
    const proxy = createStateProxy({
      fetchImpl: fetchReturning(documentWithSequence(1)).impl,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
    });

    const seen: ChatAppStateDocument[] = [];
    proxy.subscribe((doc) => seen.push(doc));

    const streamed = documentWithSequence(11);
    sources[0].emit("state", JSON.stringify(streamed));

    expect(seen).toEqual([streamed]);
    expect(proxy.getSnapshot()).toEqual(streamed);
  });

  it("a non-2xx POST response throws a Response carrying the status and leaves the cache last-known-good", async () => {
    const failingFetch = (async () =>
      ({ ok: false, status: 409, json: async () => ({}) }) as Response) as typeof fetch;
    const proxy = createStateProxy({ fetchImpl: failingFetch });

    await expect(proxy.postEvent(ORG_SUBMITTED)).rejects.toMatchObject({
      status: 409,
    });
    expect(proxy.getSnapshot()).toEqual(anonymousStateDocument());
  });
});
