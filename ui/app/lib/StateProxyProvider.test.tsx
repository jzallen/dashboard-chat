// @vitest-environment happy-dom
//
// StateProxyProvider behaviors (step 02-02, ORD-4):
//   1. With the session=1 flag cookie, ensureBootstrap called from TWO surfaces
//      fires session_begin EXACTLY once; the settled document is observable via
//      the shared proxy (getSnapshot).
//   2. With no session flag, ZERO session_begin is fired.
//   3. A call AFTER the session flag appears (post-login client-side navigation)
//      DOES bootstrap — the no-session no-op must not permanently latch.
//
// Driving port: the provider's public React surface (StateProxyProvider +
// useStateProxy). Driven port boundary: the proxy's injected fetchImpl — the
// only test double, a recording stub at the transport port.
import {
  anonymousStateDocument,
  type ChatAppStateDocument,
} from "@dashboard-chat/ui-state-wire";
import { render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dropSessionFlag, giveSessionFlag } from "./_stateProxyTestKit";
import { createStateProxy } from "./state-proxy";
import { type StateProxyApi, StateProxyProvider, useStateProxy } from "./StateProxyProvider";

// ── test doubles (at the proxy's transport port) ─────────────────────────────

interface RecordedFetchCall {
  url: string;
  body: unknown;
}

/** Records every POST and resolves with `doc` as JSON. */
function fetchReturning(doc: ChatAppStateDocument): {
  impl: typeof fetch;
  calls: RecordedFetchCall[];
} {
  const calls: RecordedFetchCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return { ok: true, status: 200, json: async () => doc } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

/** The document the fake server settles to after session_begin. */
function settledDocument(): ChatAppStateDocument {
  const doc = anonymousStateDocument();
  return {
    ...doc,
    sequence_id: 1,
    regions: {
      ...doc.regions,
      onboarding: { ...doc.regions.onboarding, state: "needs_org" },
    },
  };
}

// ── surfaces (consumers entering through the useStateProxy driving port) ─────

/** An authenticated entry surface: calls ensureBootstrap on mount (the shape
 *  the app-shell gate and /onboarding adopt in 02-03/02-04). */
function BootstrappingSurface() {
  const { ensureBootstrap } = useStateProxy();
  useEffect(() => {
    void ensureBootstrap();
  }, [ensureBootstrap]);
  return null;
}

/** Captures the context api so the test can drive calls imperatively. */
function CapturingSurface({ capture }: { capture: (api: StateProxyApi) => void }) {
  capture(useStateProxy());
  return null;
}

afterEach(dropSessionFlag);

// ── behaviors ────────────────────────────────────────────────────────────────

describe("StateProxyProvider (D4 singleton + idempotent ensureBootstrap)", () => {
  it("with a session, ensureBootstrap from two surfaces fires session_begin EXACTLY once and the settled document is observable via the shared proxy", async () => {
    giveSessionFlag();
    const { impl, calls } = fetchReturning(settledDocument());
    const proxy = createStateProxy({ fetchImpl: impl });

    render(
      <StateProxyProvider proxy={proxy}>
        <BootstrappingSurface />
        <BootstrappingSurface />
      </StateProxyProvider>,
    );

    await vi.waitFor(() => expect(proxy.getSnapshot().sequence_id).toBe(1));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/ui-state/state/events");
    expect(calls[0].body).toEqual({ type: "session_begin" });
    expect(proxy.getSnapshot()).toEqual(settledDocument());
  });

  it("with no session flag, ensureBootstrap is a no-op — ZERO session_begin fired", async () => {
    const { impl, calls } = fetchReturning(settledDocument());
    const proxy = createStateProxy({ fetchImpl: impl });
    let api: StateProxyApi | undefined;

    render(
      <StateProxyProvider proxy={proxy}>
        <BootstrappingSurface />
        <CapturingSurface capture={(a) => (api = a)} />
      </StateProxyProvider>,
    );

    await api!.ensureBootstrap();
    expect(calls).toHaveLength(0);
    expect(proxy.getSnapshot()).toEqual(anonymousStateDocument());
  });

  it("a call AFTER the session flag appears (post-login navigation) DOES bootstrap — the no-session no-op never latches", async () => {
    const { impl, calls } = fetchReturning(settledDocument());
    const proxy = createStateProxy({ fetchImpl: impl });
    let api: StateProxyApi | undefined;

    render(
      <StateProxyProvider proxy={proxy}>
        <CapturingSurface capture={(a) => (api = a)} />
      </StateProxyProvider>,
    );

    // Pre-login: no flag → no-op.
    await api!.ensureBootstrap();
    expect(calls).toHaveLength(0);

    // The login flow sets the flag cookie; Root never remounts (ORD-4).
    giveSessionFlag();

    // Post-login call from an authenticated surface: bootstraps, once.
    await api!.ensureBootstrap();
    await api!.ensureBootstrap();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ type: "session_begin" });
  });
});
