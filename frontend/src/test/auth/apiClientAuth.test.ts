import { ApiClient, ApiError } from "../../lib/shared/apiClient";

describe("API client auth headers", () => {
  it("uses the provided fetchFn for requests", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: "ok" }), { status: 200 }),
      );

    const client = new ApiClient("http://test", { fetchFn: mockFetch });
    await client.get("/test");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test/test");
    expect(init.method).toBe("GET");
  });

  it("throws ApiError on non-ok response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("Server Error", { status: 500 }));

    const client = new ApiClient("http://test", { fetchFn: mockFetch });
    await expect(client.get("/test")).rejects.toThrow(ApiError);
  });

  it("throws ApiError with status 401 on Session expired error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Session expired"));

    const client = new ApiClient("http://test", { fetchFn: mockFetch });
    try {
      await client.get("/test");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(401);
    }
  });

  it("unwraps data field by default", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: "123" } }), { status: 200 }),
      );

    const client = new ApiClient("http://test", { fetchFn: mockFetch });
    const result = await client.get<{ id: string }>("/test");
    expect(result).toEqual({ id: "123" });
  });

  it("returns full response when unwrapData is false", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "123", extra: true }), {
          status: 200,
        }),
      );

    const client = new ApiClient("http://test", {
      fetchFn: mockFetch,
      unwrapData: false,
    });
    const result = await client.get<{ id: string; extra: boolean }>("/test");
    expect(result).toEqual({ id: "123", extra: true });
  });
});
