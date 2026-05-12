import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/http/apiClient";

import { createDataCatalog } from "../client";

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({ data }),
    text: () => Promise.resolve(JSON.stringify({ data })),
  };
}

function mockErrorResponse(status: number, body: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe("project methods", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("listProjects", () => {
    it("fetches all projects", async () => {
      const projects = [
        { id: "proj-1", name: "Project 1" },
        { id: "proj-2", name: "Project 2" },
      ];
      mockFetch.mockResolvedValue(mockResponse(projects));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.listProjects();

      expect(mockFetch).toHaveBeenCalledWith("/api/projects", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      expect(result).toEqual(projects);
    });

    it("returns empty array when no projects exist", async () => {
      mockFetch.mockResolvedValue(mockResponse([]));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.listProjects();

      expect(result).toEqual([]);
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500));

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.listProjects()).rejects.toThrow(ApiError);
    });
  });

  describe("getProject", () => {
    it("fetches a project by id", async () => {
      const project = {
        id: "proj-1",
        name: "Project 1",
        description: "A test project",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      };
      mockFetch.mockResolvedValue(mockResponse(project));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.getProject("proj-1");

      expect(mockFetch).toHaveBeenCalledWith("/api/projects/proj-1", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      expect(result).toEqual(project);
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404));

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.getProject("proj-999")).rejects.toThrow(ApiError);
    });

    it("throws ApiError with parsed title from error body", async () => {
      mockFetch.mockResolvedValue(
        mockErrorResponse(404, { title: "Project not found" }),
      );

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.getProject("proj-999")).rejects.toThrow(
        "Project not found",
      );
    });
  });
});
