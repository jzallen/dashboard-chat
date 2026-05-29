// Loader test for `/projects` (ADR-046 MR-4) — reads the projectContext REGION
// off the single `/state` document.
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "./projects";

const mockFetch = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", mockFetch));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function req() {
  return new Request("http://localhost/projects", {
    headers: { authorization: "Bearer t" },
  });
}

describe("projects loader — projectContext region off the document", () => {
  it("reads org_id, selected project, last-used map and degradation off the region", async () => {
    const doc = anonymousStateDocument();
    doc.active_scope.org_id = "org-001";
    doc.regions.projectContext.context.project = { id: "proj-7", name: "Sales" };
    doc.regions.projectContext.context.most_recent_session_per_project = {
      "proj-7": "2026-05-20T00:00:00Z",
    };
    doc.regions.projectContext.context.last_used_resolution_degraded = {
      failed_project_ids: ["proj-9"],
      partial_result: true,
    };
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => doc });

    const result = await loader({ request: req(), params: {}, context: {} } as never);

    expect(result.org_id).toBe("org-001");
    expect(result.selected_project_id).toBe("proj-7");
    expect(result.selected_project_name).toBe("Sales");
    expect(result.most_recent_session_per_project).toEqual({
      "proj-7": "2026-05-20T00:00:00Z",
    });
    expect(result.last_used_resolution_degraded).toEqual({
      failed_project_ids: ["proj-9"],
      partial_result: true,
    });
  });

  it("re-throws a 504 and returns empty defaults on other failures", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) });
    await expect(
      loader({ request: req(), params: {}, context: {} } as never),
    ).rejects.toMatchObject({ status: 504 });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const result = await loader({ request: req(), params: {}, context: {} } as never);
    expect(result.org_id).toBe("");
    expect(result.selected_project_id).toBeNull();
    expect(result.most_recent_session_per_project).toEqual({});
    expect(result.last_used_resolution_degraded).toBeNull();
  });
});
