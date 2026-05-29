// Loader test for `/` (index) and `/chat/:channelId` (ADR-046 MR-4). The
// session-chat read comes off the single `/state` document's `sessionChat` region,
// and the deep-link is now an `open_deep_link` EVENT on the one write surface
// (`postStateEvent`) — the standalone `/open-deep-link` route collapsed.
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "./chat";

const mockFetch = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", mockFetch));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function req() {
  return new Request("http://localhost/", {
    headers: { authorization: "Bearer t" },
  });
}

function sessionChatDoc() {
  const doc = anonymousStateDocument();
  doc.active_scope.org_id = "org-001";
  doc.regions.sessionChat.state = "session_active";
  doc.regions.sessionChat.context.project = { id: "proj-7", name: "Sales" };
  doc.regions.sessionChat.context.session_id = "sess-1";
  doc.regions.sessionChat.context.transcript = [
    { id: "m1", role: "user", content: "hi", ts: "2026-05-01T00:00:00Z" },
  ];
  return doc;
}

describe("chat loader — sessionChat region off the document", () => {
  it("index path reads the session-chat region via GET /state (no event)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sessionChatDoc() });

    const result = await loader({ request: req(), params: {}, context: {} } as never);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/ui-state/state");
    expect(init?.method ?? "GET").toBe("GET");
    expect(result.state).toBe("session_active");
    expect(result.org_id).toBe("org-001");
    expect(result.project_id).toBe("proj-7");
    expect(result.session_id).toBe("sess-1");
    expect(result.transcript).toHaveLength(1);
  });

  it("deep-link path posts open_deep_link as an event then renders off the returned document", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sessionChatDoc() });

    const result = await loader({
      request: req(),
      params: { channelId: "sess-1" },
      context: {},
    } as never);

    expect(mockFetch).toHaveBeenCalledTimes(1); // the event response IS the document
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/ui-state/state/events");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      type: "open_deep_link",
      payload: { intent_session_id: "sess-1" },
    });
    expect(result.pending_resume_session_id).toBe("sess-1");
    expect(result.state).toBe("session_active");
  });

  it("re-throws a 504 and returns defaults on other failures", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) });
    await expect(
      loader({ request: req(), params: {}, context: {} } as never),
    ).rejects.toMatchObject({ status: 504 });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const result = await loader({ request: req(), params: {}, context: {} } as never);
    expect(result.state).toBe("waiting_for_project");
    expect(result.org_id).toBe("");
  });
});
