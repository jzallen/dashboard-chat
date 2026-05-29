// Unit tests for the StateProxy client library (ADR-046 MR-3, Decision 2).
//
// StateProxy is a hand-built object satisfying XState's ActorRef surface
// (.send / .getSnapshot / .subscribe) that stands in for the remote ChatApp
// actor. It does NOT run a machine — it caches the server's stable
// ChatAppStateDocument and lets the FE slice it with `useSelector`.
//
// Transport is injected (fetchImpl + eventSourceFactory) so these tests exercise
// the real proxy logic with no network / no platform EventSource — mocks live
// only at the port boundary.
//
// Behavior budget:
//   - getSnapshot: seed / anonymous default (never undefined)
//   - postEvent / send: POST /state/events; cache update + observer fan-out;
//       failure rejects and leaves cache unchanged
//   - subscribe: opens GET /state/stream SSE; frames update cache + push to
//       observers (object + function forms); reconnection/error keep last-known-good;
//       unsubscribe closes the stream when the last observer leaves
//   - useSelector(stateProxy, selector): selects + re-renders ONLY on
//       selected-slice change (the load-bearing ActorRef-compatibility test)
//   - fetchStateDocument: SSR seed happy path + error → thrown Response

import { render, screen, act, cleanup } from "@testing-library/react";
import { useSelector } from "@xstate/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anonymousStateDocument,
  type ChatAppStateDocument,
} from "@dashboard-chat/ui-state-wire";

import {
  createStateProxy,
  fetchStateDocument,
  type StateProxy,
} from "./state-proxy";

// ─────────────────────────── test doubles (port boundary) ───────────────────────────

/** A fake SSE source matching the minimal surface the proxy consumes. Lets a
 *  test push `state` frames and trigger transport errors deterministically. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners: Record<string, Array<(ev: { data: string }) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: { data: string }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  close(): void {
    this.closed = true;
  }

  /** Simulate a server `event: <type>\ndata: <json>` frame. */
  emit(type: string, data: unknown): void {
    for (const l of this.listeners[type] ?? []) l({ data: JSON.stringify(data) });
  }

  /** Simulate an EventSource transport error (connection drop). */
  failTransport(err: unknown = new Error("connection lost")): void {
    this.onerror?.(err);
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }
}

function eventSourceFactory(url: string): FakeEventSource {
  return new FakeEventSource(url);
}

function docWith(
  overrides: {
    projectContextState?: string;
    onboardingState?: string;
    sequence_id?: number;
  } = {},
): ChatAppStateDocument {
  const doc = anonymousStateDocument();
  if (overrides.projectContextState !== undefined)
    doc.regions.projectContext.state = overrides.projectContextState;
  if (overrides.onboardingState !== undefined)
    doc.regions.onboarding.state = overrides.onboardingState;
  if (overrides.sequence_id !== undefined) doc.sequence_id = overrides.sequence_id;
  return doc;
}

/** A fetch double that returns one JSON document with status 200. */
function okFetchReturning(doc: ChatAppStateDocument) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => doc,
  });
}

const BASE = "/ui-state";

function makeProxy(opts: Partial<Parameters<typeof createStateProxy>[0]> = {}): StateProxy {
  return createStateProxy({
    baseUrl: BASE,
    eventSourceFactory,
    ...opts,
  });
}

afterEach(() => {
  FakeEventSource.reset();
  vi.restoreAllMocks();
  cleanup();
});

// ─────────────────────────────── getSnapshot ───────────────────────────────

describe("createStateProxy — getSnapshot", () => {
  it("returns the seed document when constructed with { seed }", () => {
    const seed = docWith({ projectContextState: "project_selected", sequence_id: 8 });
    const proxy = makeProxy({ seed });
    expect(proxy.getSnapshot()).toEqual(seed);
  });

  it("returns the anonymous document (never undefined) with no seed", () => {
    const proxy = makeProxy();
    const snap = proxy.getSnapshot();
    expect(snap).toBeDefined();
    expect(snap.phase).toBe("onboarding");
    expect(snap.regions.onboarding.state).toBe("verifying");
    expect(snap.regions.projectContext.state).toBe("verifying");
    expect(snap.regions.sessionChat.state).toBe("verifying");
    expect(snap.active_scope.org_id).toBe("");
  });

  it("exposes the minimal ActorRef identity fields useSelector tolerates", () => {
    const proxy = makeProxy();
    expect(typeof proxy.id).toBe("string");
    expect(typeof proxy.sessionId).toBe("string");
  });
});

// ─────────────────────────── send / postEvent ───────────────────────────

describe("createStateProxy — send / postEvent", () => {
  it("postEvent POSTs to /state/events and returns the new document", async () => {
    const next = docWith({ projectContextState: "project_selected" });
    const fetchImpl = okFetchReturning(next);
    const proxy = makeProxy({ fetchImpl });

    const result = await proxy.postEvent({
      type: "switching_project_intent",
      payload: { new_project_id: "proj-7" },
    });

    expect(result).toEqual(next);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain(`${BASE}/state/events`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      type: "switching_project_intent",
      payload: { new_project_id: "proj-7" },
    });
  });

  it("postEvent updates the cached document (getSnapshot reflects it)", async () => {
    const next = docWith({ projectContextState: "project_selected" });
    const proxy = makeProxy({ fetchImpl: okFetchReturning(next) });

    expect(proxy.getSnapshot().regions.projectContext.state).toBe("verifying");
    await proxy.postEvent({ type: "noop" });
    expect(proxy.getSnapshot().regions.projectContext.state).toBe("project_selected");
  });

  it("send POSTs and updates the cache + fans out to observers", async () => {
    const next = docWith({ onboardingState: "ready" });
    const proxy = makeProxy({ fetchImpl: okFetchReturning(next) });
    const observed: ChatAppStateDocument[] = [];
    proxy.subscribe((d) => observed.push(d));

    proxy.send({ type: "org_form_submitted", payload: { org_name: "Acme" } });
    // send is fire-and-forget; allow the POST microtask to settle.
    await vi.waitFor(() =>
      expect(proxy.getSnapshot().regions.onboarding.state).toBe("ready"),
    );
    expect(observed[observed.length - 1]?.regions.onboarding.state).toBe("ready");
  });

  it("rejects postEvent and leaves the cache unchanged when the POST fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });
    const seed = docWith({ projectContextState: "project_selected" });
    const proxy = makeProxy({ seed, fetchImpl });

    await expect(proxy.postEvent({ type: "noop" })).rejects.toBeInstanceOf(Response);
    // cache untouched
    expect(proxy.getSnapshot()).toEqual(seed);
  });
});

// ─────────────────────────────── subscribe (SSE) ───────────────────────────────

describe("createStateProxy — subscribe (SSE stream)", () => {
  it("opens the GET /state/stream SSE on first subscription", () => {
    const proxy = makeProxy();
    expect(FakeEventSource.instances).toHaveLength(0);
    proxy.subscribe(() => {});
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain(`${BASE}/state/stream`);
  });

  it("a `state` frame updates the cache and pushes to a function observer", () => {
    const proxy = makeProxy();
    const observed: ChatAppStateDocument[] = [];
    proxy.subscribe((d) => observed.push(d));

    const frame = docWith({ projectContextState: "no_projects", sequence_id: 3 });
    FakeEventSource.instances[0].emit("state", frame);

    expect(proxy.getSnapshot().regions.projectContext.state).toBe("no_projects");
    expect(observed).toHaveLength(1);
    expect(observed[0].sequence_id).toBe(3);
  });

  it("supports the observer-object form { next, error }", () => {
    const proxy = makeProxy();
    const next = vi.fn();
    const error = vi.fn();
    proxy.subscribe({ next, error });

    FakeEventSource.instances[0].emit("state", docWith({ onboardingState: "needs_org" }));
    expect(next).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("only opens ONE stream for multiple observers and closes it when the last leaves", () => {
    const proxy = makeProxy();
    const a = proxy.subscribe(() => {});
    const b = proxy.subscribe(() => {});
    expect(FakeEventSource.instances).toHaveLength(1);

    a.unsubscribe();
    expect(FakeEventSource.instances[0].closed).toBe(false);
    b.unsubscribe();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("routes transport errors to observer.error and keeps the cache last-known-good", () => {
    const seed = docWith({ projectContextState: "project_selected" });
    const proxy = makeProxy({ seed });
    const error = vi.fn();
    proxy.subscribe({ next: () => {}, error });

    FakeEventSource.instances[0].failTransport(new Error("boom"));

    expect(error).toHaveBeenCalledTimes(1);
    // cache unchanged — the FE renders stale-but-coherent rather than blanking.
    expect(proxy.getSnapshot()).toEqual(seed);
  });
});

// ─────────────────────── useSelector compatibility (load-bearing) ───────────────────────

describe("useSelector(stateProxy, selector) — ActorRef compatibility", () => {
  function ProjectStateProbe({
    proxy,
    onRender,
  }: {
    proxy: StateProxy;
    onRender: (state: string) => void;
  }) {
    const projectState = useSelector(
      proxy,
      (d: ChatAppStateDocument) => d.regions.projectContext.state,
    );
    onRender(projectState);
    return <span data-testid="project-state">{projectState}</span>;
  }

  it("selects the slice on first render and reacts only when that slice changes", () => {
    const proxy = makeProxy({
      seed: docWith({ projectContextState: "resolving_initial_scope" }),
    });
    const renders: string[] = [];
    render(<ProjectStateProbe proxy={proxy} onRender={(s) => renders.push(s)} />);

    // First paint reflects the seeded slice.
    expect(screen.getByTestId("project-state").textContent).toBe(
      "resolving_initial_scope",
    );
    const rendersAfterMount = renders.length;

    // A frame that changes the SELECTED slice → re-render with the new value.
    act(() => {
      FakeEventSource.instances[0].emit(
        "state",
        docWith({ projectContextState: "project_selected" }),
      );
    });
    expect(screen.getByTestId("project-state").textContent).toBe("project_selected");

    // A frame that changes a DIFFERENT slice only → no new render of this value.
    const rendersBeforeIrrelevant = renders.length;
    act(() => {
      FakeEventSource.instances[0].emit(
        "state",
        docWith({ projectContextState: "project_selected", onboardingState: "ready" }),
      );
    });
    expect(renders.length).toBe(rendersBeforeIrrelevant);
    expect(renders.length).toBeGreaterThan(rendersAfterMount);
    expect(screen.getByTestId("project-state").textContent).toBe("project_selected");
  });
});

// ─────────────────────────────── fetchStateDocument (SSR seed) ───────────────────────────────

describe("fetchStateDocument — SSR seed", () => {
  it("GETs the state document and forwards the request's Authorization header", async () => {
    const doc = docWith({ onboardingState: "ready" });
    const fetchImpl = okFetchReturning(doc);
    const request = new Request("http://localhost/app", {
      headers: { authorization: "Bearer abc" },
    });

    const result = await fetchStateDocument(request, { fetchImpl });

    expect(result).toEqual(doc);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer abc");
  });

  it("throws the upstream Response when the GET returns non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    const request = new Request("http://localhost/app");

    let caught: unknown;
    try {
      await fetchStateDocument(request, { fetchImpl });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(503);
  });
});
