import { get } from "../../lib/dataCatalog/client";
import { ApiError } from "../../lib/shared/apiClient";

describe("API client auth headers", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("sends no Authorization header when no token in localStorage", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: "ok" }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    await get("/test");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("sends Bearer header when token is present in localStorage", async () => {
    localStorage.setItem("auth_token", "my-test-token");

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: "ok" }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    await get("/test");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer my-test-token");
  });

  it("clears localStorage and redirects on 401 response", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_user", '{"id":"u1"}');

    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );
    vi.stubGlobal("fetch", mockFetch);

    // Mock window.location.href
    const locationSpy = vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "",
    } as Location);

    await expect(get("/test")).rejects.toThrow(ApiError);

    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_user")).toBeNull();

    locationSpy.mockRestore();
  });
});
