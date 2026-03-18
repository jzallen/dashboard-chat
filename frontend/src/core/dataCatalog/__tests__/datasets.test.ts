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

describe("dataset methods", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("listDatasets", () => {
    it("fetches all datasets without project filter", async () => {
      const datasets = [{ id: "ds-1" }, { id: "ds-2" }];
      mockFetch.mockResolvedValue(mockResponse(datasets));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.listDatasets();

      expect(mockFetch).toHaveBeenCalledWith("/api/datasets", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      expect(result).toEqual(datasets);
    });

    it("appends project_id query param when provided", async () => {
      mockFetch.mockResolvedValue(mockResponse([]));

      const catalog = createDataCatalog(mockFetch);
      await catalog.listDatasets("proj-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets?project_id=proj-123",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500));

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.listDatasets()).rejects.toThrow(ApiError);
    });
  });

  describe("getDataset", () => {
    it("fetches a dataset by id with no options", async () => {
      const dataset = { id: "ds-1", name: "Test" };
      mockFetch.mockResolvedValue(mockResponse(dataset));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.getDataset("ds-1");

      expect(mockFetch).toHaveBeenCalledWith("/api/datasets/ds-1", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      expect(result).toEqual(dataset);
    });

    it("appends include_transforms query param", async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: "ds-1" }));

      const catalog = createDataCatalog(mockFetch);
      await catalog.getDataset("ds-1", { includeTransforms: true });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1?include_transforms=true",
        expect.any(Object),
      );
    });

    it("appends preview params when includePreview is true", async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: "ds-1" }));

      const catalog = createDataCatalog(mockFetch);
      await catalog.getDataset("ds-1", {
        includePreview: true,
        previewLimit: 50,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1?include_preview=true&preview_limit=50",
        expect.any(Object),
      );
    });

    it("does not append preview_limit without includePreview", async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: "ds-1" }));

      const catalog = createDataCatalog(mockFetch);
      await catalog.getDataset("ds-1", { previewLimit: 50 });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1",
        expect.any(Object),
      );
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404));

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.getDataset("ds-1")).rejects.toThrow(ApiError);
    });
  });

  describe("updateDataset", () => {
    it("sends PATCH with update data", async () => {
      const updated = { id: "ds-1", name: "Updated" };
      mockFetch.mockResolvedValue(mockResponse(updated));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.updateDataset("ds-1", { name: "Updated" });

      expect(mockFetch).toHaveBeenCalledWith("/api/datasets/ds-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      });
      expect(result).toEqual(updated);
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(400));

      const catalog = createDataCatalog(mockFetch);
      await expect(
        catalog.updateDataset("ds-1", { name: "x" }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("createTransform", () => {
    it("sends POST with transform wrapped in array", async () => {
      mockFetch.mockResolvedValue(mockResponse(null));

      const transform = { type: "rename", config: { from: "a", to: "b" } };
      const catalog = createDataCatalog(mockFetch);
      await catalog.createTransform("ds-1", transform as any);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1/transforms",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transforms: [transform] }),
        },
      );
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(422));

      const catalog = createDataCatalog(mockFetch);
      await expect(
        catalog.createTransform("ds-1", {} as any),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("updateTransform", () => {
    it("sends PATCH with transform id and update data", async () => {
      mockFetch.mockResolvedValue(mockResponse(null));

      const catalog = createDataCatalog(mockFetch);
      await catalog.updateTransform("ds-1", "tf-1", {
        config: { value: 42 },
      } as any);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1/transforms",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: [{ id: "tf-1", config: { value: 42 } }],
          }),
        },
      );
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(400));

      const catalog = createDataCatalog(mockFetch);
      await expect(
        catalog.updateTransform("ds-1", "tf-1", {} as any),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("deleteTransform", () => {
    it("sends PATCH with deleted status", async () => {
      mockFetch.mockResolvedValue(mockResponse(null));

      const catalog = createDataCatalog(mockFetch);
      await catalog.deleteTransform("ds-1", "tf-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1/transforms",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: [{ id: "tf-1", status: "deleted" }],
          }),
        },
      );
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404));

      const catalog = createDataCatalog(mockFetch);
      await expect(
        catalog.deleteTransform("ds-1", "tf-1"),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("toggleTransform", () => {
    it("sends enabled status when toggling on", async () => {
      mockFetch.mockResolvedValue(mockResponse(null));

      const catalog = createDataCatalog(mockFetch);
      await catalog.toggleTransform("ds-1", "tf-1", true);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1/transforms",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: [{ id: "tf-1", status: "enabled" }],
          }),
        },
      );
    });

    it("sends disabled status when toggling off", async () => {
      mockFetch.mockResolvedValue(mockResponse(null));

      const catalog = createDataCatalog(mockFetch);
      await catalog.toggleTransform("ds-1", "tf-1", false);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1/transforms",
        expect.objectContaining({
          body: JSON.stringify({
            updates: [{ id: "tf-1", status: "disabled" }],
          }),
        }),
      );
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500));

      const catalog = createDataCatalog(mockFetch);
      await expect(
        catalog.toggleTransform("ds-1", "tf-1", true),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("previewCleaningTransform", () => {
    it("sends POST with preview config and returns response", async () => {
      const previewResponse = { columns: ["a"], rows: [[1]] };
      mockFetch.mockResolvedValue(mockResponse(previewResponse));

      const config = { transform_type: "clean", params: {} };
      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.previewCleaningTransform(
        "ds-1",
        config as any,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1/transforms/preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        },
      );
      expect(result).toEqual(previewResponse);
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(422));

      const catalog = createDataCatalog(mockFetch);
      await expect(
        catalog.previewCleaningTransform("ds-1", {} as any),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("createCleaningTransforms", () => {
    it("sends POST with array of transforms", async () => {
      mockFetch.mockResolvedValue(mockResponse(null));

      const transforms = [
        { type: "trim", config: {} },
        { type: "lowercase", config: {} },
      ];
      const catalog = createDataCatalog(mockFetch);
      await catalog.createCleaningTransforms("ds-1", transforms as any);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/datasets/ds-1/transforms",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transforms }),
        },
      );
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(400));

      const catalog = createDataCatalog(mockFetch);
      await expect(
        catalog.createCleaningTransforms("ds-1", []),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("listDatasetsForProject", () => {
    it("fetches datasets for a specific project", async () => {
      const datasets = [{ id: "ds-1" }, { id: "ds-2" }];
      mockFetch.mockResolvedValue(mockResponse(datasets));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.listDatasetsForProject("proj-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/proj-123/datasets",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );
      expect(result).toEqual(datasets);
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(403));

      const catalog = createDataCatalog(mockFetch);
      await expect(
        catalog.listDatasetsForProject("proj-123"),
      ).rejects.toThrow(ApiError);
    });
  });
});
