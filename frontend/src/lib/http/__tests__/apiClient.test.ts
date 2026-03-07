import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClient, ApiError } from "../apiClient";

describe("ApiClient", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function okResponse(data: unknown) {
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data }),
      text: () => Promise.resolve(JSON.stringify({ data })),
    };
  }

  function errorResponse(status: number, body: Record<string, string> = {}) {
    return {
      ok: false,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  }

  describe("GET", () => {
    it("constructs correct request with baseUrl and headers", async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 1 }));
      const client = new ApiClient("https://api.example.com", { fetchFn: mockFetch });

      const result = await client.get("/items");

      expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/items", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      expect(result).toEqual({ id: 1 });
    });
  });

  describe("POST", () => {
    it("constructs correct request with JSON body", async () => {
      mockFetch.mockResolvedValue(okResponse({ created: true }));
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.post("/items", { name: "test" });

      expect(mockFetch).toHaveBeenCalledWith("/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });
      expect(result).toEqual({ created: true });
    });
  });

  describe("PATCH", () => {
    it("constructs correct request with JSON body", async () => {
      mockFetch.mockResolvedValue(okResponse({ updated: true }));
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.patch("/items/1", { name: "updated" });

      expect(mockFetch).toHaveBeenCalledWith("/items/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "updated" }),
      });
      expect(result).toEqual({ updated: true });
    });
  });

  describe("DELETE (del)", () => {
    it("returns undefined for 204 status", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.del("/items/1");

      expect(mockFetch).toHaveBeenCalledWith("/items/1", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      expect(result).toBeUndefined();
    });

    it("handles non-204 response normally", async () => {
      mockFetch.mockResolvedValue(okResponse({ deleted: true }));
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.del("/items/1");

      expect(result).toEqual({ deleted: true });
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(errorResponse(404));
      const client = new ApiClient("", { fetchFn: mockFetch });

      await expect(client.del("/items/1")).rejects.toThrow(ApiError);
    });
  });

  describe("response unwrapping", () => {
    it("unwraps { data: payload } when unwrapData is true (default)", async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 1, name: "test" }));
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.get("/items/1");

      expect(result).toEqual({ id: 1, name: "test" });
    });

    it("does not unwrap when unwrapData is false", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: 1 }, meta: {} }),
        text: () => Promise.resolve(""),
      });
      const client = new ApiClient("", { fetchFn: mockFetch, unwrapData: false });

      const result = await client.get("/items/1");

      expect(result).toEqual({ data: { id: 1 }, meta: {} });
    });

    it("returns raw JSON when response has no data key", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [1, 2, 3] }),
        text: () => Promise.resolve(""),
      });
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.get("/items");

      expect(result).toEqual({ items: [1, 2, 3] });
    });
  });

  describe("error handling", () => {
    it("throws ApiError with status on non-ok response", async () => {
      mockFetch.mockResolvedValue(errorResponse(400));
      const client = new ApiClient("", { fetchFn: mockFetch });

      try {
        await client.get("/items");
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(400);
      }
    });

    it("uses title field from error body as message", async () => {
      mockFetch.mockResolvedValue(errorResponse(404, { title: "Not found" }));
      const client = new ApiClient("", { fetchFn: mockFetch });

      await expect(client.get("/items/1")).rejects.toThrow("Not found");
    });

    it("uses type field when no title", async () => {
      mockFetch.mockResolvedValue(errorResponse(422, { type: "validation_error" }));
      const client = new ApiClient("", { fetchFn: mockFetch });

      await expect(client.get("/items")).rejects.toThrow("validation_error");
    });

    it("uses default message for non-JSON error body", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      const client = new ApiClient("", { fetchFn: mockFetch });

      await expect(client.get("/items")).rejects.toThrow("Request failed with status 500");
    });

    it("re-throws Session expired as ApiError(401)", async () => {
      mockFetch.mockRejectedValue(new Error("Session expired"));
      const client = new ApiClient("", { fetchFn: mockFetch });

      try {
        await client.get("/items");
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(401);
        expect((e as ApiError).message).toBe("Session expired");
      }
    });

    it("re-throws Session expired from del() as ApiError(401)", async () => {
      mockFetch.mockRejectedValue(new Error("Session expired"));
      const client = new ApiClient("", { fetchFn: mockFetch });

      await expect(client.del("/items/1")).rejects.toThrow(ApiError);
    });
  });

  describe("uploadFile", () => {
    it("sends FormData with file and additional fields", async () => {
      mockFetch.mockResolvedValue(okResponse({ uploaded: true }));
      const client = new ApiClient("", { fetchFn: mockFetch });
      const file = new File(["content"], "test.csv", { type: "text/csv" });

      const result = await client.uploadFile("/upload", file, { project_id: "proj-1" });

      expect(result).toEqual({ uploaded: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "/upload",
        expect.objectContaining({ method: "POST" }),
      );
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.body).toBeInstanceOf(FormData);
      expect(callArgs.headers).toBeUndefined();
    });
  });

  describe("fetch (raw)", () => {
    it("returns raw Response without processing", async () => {
      const rawResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ "Content-Type": "application/zip" }),
      };
      mockFetch.mockResolvedValue(rawResponse);
      const client = new ApiClient("https://api.example.com", { fetchFn: mockFetch });

      const result = await client.fetch("/download", { method: "GET" });

      expect(result).toBe(rawResponse);
      expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/download", { method: "GET" });
    });
  });
});
