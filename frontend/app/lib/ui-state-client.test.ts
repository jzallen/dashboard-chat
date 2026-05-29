// Vitest unit tests for the loader-facing ui-state document transport
// (ADR-046 MR-4). The per-machine `getProjection`/`postEvent`/`openProjectDeepLink`
// surface is gone — the FE reads ONE `ChatAppStateDocument` via `fetchStateDocument`
// (SSR seed read) and drives the actor forward via `postStateEvent` (the single
// `POST /state/events` write surface, the server-side analog of the proxy's
// `.postEvent`, forwarding the inbound Bearer). `activeScopeHeader` is retained but
// re-pointed at the document's TOP-LEVEL `active_scope`.
//
// Both helpers keep the DD-16 5-second AbortController budget: a hang surfaces as
// `Response(504)` and a non-2xx upstream surfaces as the upstream `Response` so the
// route's ErrorBoundary renders an HTML fallback rather than hanging SSR.
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeScopeHeader,
  fetchStateDocument,
  postStateEvent,
} from "./ui-state-client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeRequest(authHeader = "") {
  return new Request("http://localhost/app", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("postStateEvent — single /state/events write surface (DD-16 budget)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("POSTs the event to /ui-state/state/events, forwards the Bearer, returns the document", async () => {
    const doc = anonymousStateDocument();
    doc.regions.projectContext.state = "project_selected";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => doc,
    });

    const result = await postStateEvent(makeRequest("Bearer abc"), {
      type: "open_deep_link",
      payload: { intent_project_id: "proj-7" },
    });

    expect(result.regions.projectContext.state).toBe("project_selected");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/ui-state/state/events");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer abc");
    expect(JSON.parse(init.body as string)).toEqual({
      type: "open_deep_link",
      payload: { intent_project_id: "proj-7" },
    });
  });

  it("throws Response(504) when the POST hangs past the 5s budget", async () => {
    mockFetch.mockImplementationOnce(
      (_url: URL, init: RequestInit & { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) return;
          const onAbort = () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
    );
    const promise = postStateEvent(makeRequest(), { type: "noop" }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(5001);
    const caught = await promise;
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(504);
  });

  it("throws the upstream Response when the POST returns non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
    let caught: unknown;
    try {
      await postStateEvent(makeRequest(), { type: "noop" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(502);
  });
});

describe("fetchStateDocument — re-exported SSR seed read", () => {
  it("is re-exported from the loader transport for single-import loaders", () => {
    expect(typeof fetchStateDocument).toBe("function");
  });
});

describe("activeScopeHeader — re-pointed at the document's top-level active_scope", () => {
  it("serializes the document's active_scope as JSON when org_id is present", () => {
    const doc = anonymousStateDocument();
    doc.active_scope = {
      org_id: "org-001",
      project_id: "proj-7",
      resource_type: null,
      resource_id: null,
    };
    expect(activeScopeHeader(doc)).toBe(JSON.stringify(doc.active_scope));
  });

  it("returns null when the document has no resolved org yet", () => {
    const doc = anonymousStateDocument(); // active_scope.org_id === ""
    expect(activeScopeHeader(doc)).toBeNull();
  });
});
