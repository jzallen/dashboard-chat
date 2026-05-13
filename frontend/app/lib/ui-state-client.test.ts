// Vitest unit tests for the request-scoped ui-state-client (DD-16, Phase 04).
//
// The client must enforce a 5-second budget on its single fetch. When the
// upstream hangs past the budget the AbortController fires and the loader
// surface receives a `Response(504)` it can render via the route's
// ErrorBoundary — never a hung loader (DESIGN application-architecture.md §6.4).
//
// Behavior budget for this file (B-loader-timeout): 1 behavior × 2 = 2 tests
// minimum; 4 tests cover (a) happy path (b) timeout abort (c) upstream non-2xx
// pass-through (d) timeout-cleanup hygiene on the success path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uiStateClient } from "./ui-state-client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeRequest(authHeader = "") {
  return new Request("http://localhost/_test/loader-probe", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("uiStateClient — 5s loader timeout (DD-16)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves normally when fetch returns OK within budget", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ kind: "ready" }),
    });
    const result = await uiStateClient(makeRequest()).getProjection(
      "login-and-org-setup",
      "test-loader-probe",
    );
    expect(result).toEqual({ kind: "ready" });
  });

  it("throws Response(504) when fetch hangs past the 5s budget", async () => {
    // Hanging fetch that resolves only when its AbortSignal fires. Real
    // platform fetch rejects with an AbortError on abort; our mock mirrors
    // that contract so the production code's timeout branch is exercised.
    mockFetch.mockImplementationOnce(
      (_url: URL, init: RequestInit & { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) return; // no abort wired — leave promise hanging
          const onAbort = () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }),
    );
    const promise = uiStateClient(makeRequest())
      .getProjection("login-and-org-setup", "test-loader-probe")
      .catch((e: unknown) => e); // attach handler now to avoid unhandled-rejection noise
    // Advance fake clock past the 5s budget; this fires the AbortController
    // → mock fetch rejects → production code converts to Response(504).
    await vi.advanceTimersByTimeAsync(5001);
    const caught = await promise;
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(504);
  });

  it("throws the upstream Response when fetch returns non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({}),
    });
    let caught: unknown;
    try {
      await uiStateClient(makeRequest()).getProjection(
        "login-and-org-setup",
        "test-loader-probe",
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(502);
  });

  it("clears the pending timeout on successful response", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ kind: "ready" }),
    });
    await uiStateClient(makeRequest()).getProjection(
      "login-and-org-setup",
      "test-loader-probe",
    );
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
