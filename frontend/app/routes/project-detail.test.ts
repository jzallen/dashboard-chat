// Loader test for `/projects/:projectId` (+ /datasets/:datasetId) — ADR-046 MR-4.
// The cold deep-link resolution is now an `open_deep_link` EVENT on the single
// write surface (`postStateEvent`); the settled `projectContext` region is read off
// the returned document.
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "./project-detail";

const mockFetch = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", mockFetch));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function req() {
  return new Request("http://localhost/projects/proj-7", {
    headers: { authorization: "Bearer t" },
  });
}

describe("project-detail loader — open_deep_link event + projectContext region", () => {
  it("posts open_deep_link with intent_project_id and reads the settled region", async () => {
    const doc = anonymousStateDocument();
    doc.active_scope.org_id = "org-001";
    doc.active_scope.project_id = "proj-7";
    doc.regions.projectContext.state = "project_selected";
    doc.regions.projectContext.context.project = { id: "proj-7", name: "Sales" };
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => doc });

    const result = await loader({
      request: req(),
      params: { projectId: "proj-7" },
      context: {},
    } as never);

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/ui-state/state/events");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      type: "open_deep_link",
      payload: { intent_project_id: "proj-7" },
    });
    expect(result.org_id).toBe("org-001");
    expect(result.project_id).toBe("proj-7");
    expect(result.project_name).toBe("Sales");
    expect(result.state).toBe("project_selected");
  });

  it("includes the dataset resource in the event payload on the dataset route", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => anonymousStateDocument(),
    });

    await loader({
      request: req(),
      params: { projectId: "proj-7", datasetId: "ds-1" },
      context: {},
    } as never);

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body as string).payload;
    expect(payload).toEqual({
      intent_project_id: "proj-7",
      intent_resource_id: "ds-1",
      intent_resource_type: "dataset",
    });
  });

  it("throws 400 when projectId is missing", async () => {
    await expect(
      loader({ request: req(), params: {}, context: {} } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("re-throws a 504 and returns the URL fallback on other failures", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) });
    await expect(
      loader({ request: req(), params: { projectId: "proj-7" }, context: {} } as never),
    ).rejects.toMatchObject({ status: 504 });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const result = await loader({
      request: req(),
      params: { projectId: "proj-7" },
      context: {},
    } as never);
    expect(result.project_id).toBe("proj-7");
    expect(result.deeplink_project_id).toBe("proj-7");
    expect(result.state).toBe("anonymous");
  });
});
