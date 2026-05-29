// Loader test for the test-only probe route (ADR-046 MR-4). The probe now
// prefetches the single `/state` document via `fetchStateDocument` instead of the
// per-machine `getProjection`. The per-request bearer-fingerprint boundary and the
// DD-16 504 propagation are unchanged.
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "./_test-loader-probe";

const mockFetch = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", mockFetch));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function req(authHeader = "Bearer t") {
  return new Request("http://localhost/_test/loader-probe", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("loader-probe loader — single document prefetch", () => {
  it("GETs /state and returns a bearer fingerprint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => anonymousStateDocument(),
    });
    const result = await loader({ request: req(), params: {}, context: {} } as never);
    expect(String(mockFetch.mock.calls[0][0])).toContain("/ui-state/state");
    expect(result.probe).toBe("loader-probe-v1");
    expect(result.bearer_fingerprint).not.toBe("anonymous");
  });

  it("still renders (fingerprint preserved) when the document read fails — prefetchQuery swallows", async () => {
    // The probe wraps the read in QueryClient.prefetchQuery, which catches its
    // own errors (pre-existing behavior, unchanged by MR-4): the loader returns
    // for the bearer-fingerprint check rather than surfacing the read failure.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const result = await loader({ request: req(), params: {}, context: {} } as never);
    expect(result.bearer_fingerprint).not.toBe("anonymous");
  });
});
