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

function mock204() {
  return { ok: true, status: 204 };
}

describe("sqlAccess methods", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("enableSqlAccess", () => {
    it("sends POST with empty body", async () => {
      const status = { enabled: true, connection_string: "postgres://..." };
      mockFetch.mockResolvedValue(mockResponse(status));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.enableSqlAccess("proj-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/proj-1/sql-access",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(result).toEqual(status);
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500));

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.enableSqlAccess("proj-1")).rejects.toThrow(ApiError);
    });
  });

  describe("disableSqlAccess", () => {
    it("sends DELETE and returns undefined for 204", async () => {
      mockFetch.mockResolvedValue(mock204());

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.disableSqlAccess("proj-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/proj-1/sql-access",
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        },
      );
      expect(result).toBeUndefined();
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(403));

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.disableSqlAccess("proj-1")).rejects.toThrow(ApiError);
    });
  });

  describe("getSqlAccess", () => {
    it("fetches sql access status", async () => {
      const status = { enabled: true, connection_string: "postgres://..." };
      mockFetch.mockResolvedValue(mockResponse(status));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.getSqlAccess("proj-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/proj-1/sql-access",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );
      expect(result).toEqual(status);
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404));

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.getSqlAccess("proj-1")).rejects.toThrow(ApiError);
    });
  });

  describe("syncSqlAccess", () => {
    it("sends POST with empty body", async () => {
      const status = { enabled: true, synced: true };
      mockFetch.mockResolvedValue(mockResponse(status));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.syncSqlAccess("proj-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/proj-1/sql-access/sync",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(result).toEqual(status);
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500));

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.syncSqlAccess("proj-1")).rejects.toThrow(ApiError);
    });
  });

  describe("regenerateSqlCredentials", () => {
    it("sends POST with empty body", async () => {
      const status = { enabled: true, password: "new-pass" };
      mockFetch.mockResolvedValue(mockResponse(status));

      const catalog = createDataCatalog(mockFetch);
      const result = await catalog.regenerateSqlCredentials("proj-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/proj-1/sql-access/credentials",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(result).toEqual(status);
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500));

      const catalog = createDataCatalog(mockFetch);
      await expect(catalog.regenerateSqlCredentials("proj-1")).rejects.toThrow(ApiError);
    });
  });

});
