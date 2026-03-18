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

  /** Helper: JSON:API single-resource response */
  function jsonapiSingleResponse(
    type: string,
    id: string,
    attributes: Record<string, unknown>,
  ) {
    const body = {
      data: { type, id, attributes },
      links: { self: `/api/${type}/${id}` },
    };
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  }

  /** Helper: JSON:API list response */
  function jsonapiListResponse(
    type: string,
    items: { id: string; attributes: Record<string, unknown> }[],
  ) {
    const body = {
      data: items.map((i) => ({ type, id: i.id, attributes: i.attributes })),
      links: { self: `/api/${type}?page[size]=50`, next: null, prev: null },
      meta: { page: { size: 50, has_more: false } },
    };
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  }

  /** Legacy helper for backward compat tests */
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
      mockFetch.mockResolvedValue(
        jsonapiSingleResponse("items", "1", { name: "test" }),
      );
      const client = new ApiClient("https://api.example.com", {
        fetchFn: mockFetch,
      });

      const result = await client.get("/items");

      expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/items", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      expect(result).toEqual({ id: "1", name: "test" });
    });
  });

  describe("POST", () => {
    it("constructs correct request with JSON body", async () => {
      mockFetch.mockResolvedValue(
        jsonapiSingleResponse("items", "1", { created: true }),
      );
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.post("/items", { name: "test" });

      expect(mockFetch).toHaveBeenCalledWith("/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });
      expect(result).toEqual({ id: "1", created: true });
    });
  });

  describe("PATCH", () => {
    it("constructs correct request with JSON body", async () => {
      mockFetch.mockResolvedValue(
        jsonapiSingleResponse("items", "1", { name: "updated" }),
      );
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.patch("/items/1", { name: "updated" });

      expect(mockFetch).toHaveBeenCalledWith("/items/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "updated" }),
      });
      expect(result).toEqual({ id: "1", name: "updated" });
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

  describe("JSON:API unwrapping", () => {
    it("unwraps single JSON:API resource to flat object", async () => {
      mockFetch.mockResolvedValue(
        jsonapiSingleResponse("projects", "p1", {
          name: "My Project",
          description: null,
        }),
      );
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.get("/projects/p1");

      expect(result).toEqual({
        id: "p1",
        name: "My Project",
        description: null,
      });
    });

    it("unwraps array of JSON:API resources to flat objects", async () => {
      mockFetch.mockResolvedValue(
        jsonapiListResponse("projects", [
          { id: "p1", attributes: { name: "A" } },
          { id: "p2", attributes: { name: "B" } },
        ]),
      );
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.get("/projects");

      expect(result).toEqual([
        { id: "p1", name: "A" },
        { id: "p2", name: "B" },
      ]);
    });

    it("passes through plain data without attributes key", async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 1, name: "plain" }));
      const client = new ApiClient("", { fetchFn: mockFetch });

      const result = await client.get("/items/1");

      expect(result).toEqual({ id: 1, name: "plain" });
    });
  });

  describe("response unwrapping", () => {
    it("does not unwrap when unwrapData is false", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: 1 }, meta: {} }),
        text: () => Promise.resolve(""),
      });
      const client = new ApiClient("", {
        fetchFn: mockFetch,
        unwrapData: false,
      });

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
      mockFetch.mockResolvedValue(
        errorResponse(422, { type: "validation_error" }),
      );
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

      await expect(client.get("/items")).rejects.toThrow(
        "Request failed with status 500",
      );
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
      mockFetch.mockResolvedValue(
        jsonapiSingleResponse("uploads", "u1", { uploaded: true }),
      );
      const client = new ApiClient("", { fetchFn: mockFetch });
      const file = new File(["content"], "test.csv", { type: "text/csv" });

      const result = await client.uploadFile("/upload", file, {
        project_id: "proj-1",
      });

      expect(result).toEqual({ id: "u1", uploaded: true });
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
      const client = new ApiClient("https://api.example.com", {
        fetchFn: mockFetch,
      });

      const result = await client.fetch("/download", { method: "GET" });

      expect(result).toBe(rawResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/download",
        { method: "GET" },
      );
    });
  });
});
