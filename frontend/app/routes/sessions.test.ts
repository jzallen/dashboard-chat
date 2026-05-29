// Loader test for `/sessions` (ADR-046 MR-4). The loader now reads the
// projectContext + sessionChat REGIONS off the ONE `/state` document instead of
// two per-machine projections.
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "./sessions";

const mockFetch = vi.fn();

beforeEach(() => vi.stubGlobal("fetch", mockFetch));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function req() {
  return new Request("http://localhost/sessions", {
    headers: { authorization: "Bearer t" },
  });
}

describe("sessions loader — regions off the single document", () => {
  it("reads project from sessionChat (falling back to projectContext) + the session list", async () => {
    const doc = anonymousStateDocument();
    doc.active_scope.org_id = "org-001";
    doc.regions.projectContext.context.project = { id: "proj-7", name: "Q4 Analytics" };
    doc.regions.sessionChat.context.session_list = [
      { id: "s1", title: "First", last_active_at: "2026-05-01T00:00:00Z", active_dataset_id: null },
    ];
    doc.regions.sessionChat.context.session_list_has_more = true;
    doc.regions.sessionChat.context.session_list_next_cursor = "cur-2";
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => doc });

    const result = await loader({ request: req(), params: {}, context: {} } as never);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.org_id).toBe("org-001");
    // session-chat carries no project of its own here → falls back to projectContext.
    expect(result.project_id).toBe("proj-7");
    expect(result.project_name).toBe("Q4 Analytics");
    expect(result.sessions).toHaveLength(1);
    expect(result.has_more).toBe(true);
    expect(result.next_cursor).toBe("cur-2");
  });

  it("re-throws a 504 and returns empty defaults on other failures", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) });
    await expect(
      loader({ request: req(), params: {}, context: {} } as never),
    ).rejects.toMatchObject({ status: 504 });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const result = await loader({ request: req(), params: {}, context: {} } as never);
    expect(result).toEqual({
      org_id: "",
      project_id: null,
      project_name: null,
      sessions: [],
      next_cursor: null,
      has_more: false,
    });
  });
});
