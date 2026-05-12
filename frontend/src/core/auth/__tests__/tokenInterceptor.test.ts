import { createTokenRefresher } from "@/auth/tokenRefresh";
import { withAuth } from "@/auth/withAuth";
import { ApiClient, ApiError } from "@/http/apiClient";

describe("401 interceptor with coalesced refresh", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let locationSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    // Prevent actual navigation
    locationSpy = vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "",
    } as Location);
  });

  afterEach(() => {
    locationSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /** Create a client with auth-wrapped fetch, like production code does. */
  function createAuthedClient() {
    return new ApiClient("", {
      fetchFn: withAuth((...args: Parameters<typeof fetch>) => fetch(...args)),
    });
  }

  function ok(data: unknown) {
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function unauthorized() {
    return new Response("Unauthorized", { status: 401 });
  }

  function refreshOk(
    accessToken = "new-access",
    refreshToken = "new-refresh",
    expiresIn = 300,
  ) {
    return new Response(
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiresIn,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  it("recovers from a single 401 by refreshing and replaying", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "valid-refresh");

    mockFetch
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(refreshOk())
      .mockResolvedValueOnce(ok("hello"));

    const client = createAuthedClient();
    const result = await client.get<string>("/test");

    expect(result).toBe("hello");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const replayCall = mockFetch.mock.calls[2];
    expect(replayCall[1].headers.Authorization).toBe("Bearer new-access");

    expect(localStorage.getItem("auth_token")).toBe("new-access");
    expect(localStorage.getItem("auth_refresh_token")).toBe("new-refresh");
  });

  it("coalesces concurrent 401s into a single refresh call", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "valid-refresh");

    mockFetch
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(refreshOk())
      .mockResolvedValueOnce(ok("A"))
      .mockResolvedValueOnce(ok("B"));

    const client = createAuthedClient();
    const [a, b] = await Promise.all([
      client.get<string>("/a"),
      client.get<string>("/b"),
    ]);

    expect(a).toBe("A");
    expect(b).toBe("B");

    const refreshCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/api/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("hard-logs out when no refresh token is available", async () => {
    localStorage.setItem("auth_token", "expired-token");

    mockFetch.mockResolvedValueOnce(unauthorized());

    const client = createAuthedClient();
    await expect(client.get("/test")).rejects.toThrow(ApiError);

    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_refresh_token")).toBeNull();
  });

  it("hard-logs out when refresh endpoint returns error", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "bad-refresh");

    mockFetch
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response("fail", { status: 400 }));

    const client = createAuthedClient();
    await expect(client.get("/test")).rejects.toThrow(ApiError);
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("does not infinitely retry — replayed 401 causes immediate logout", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "valid-refresh");

    mockFetch
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(refreshOk())
      .mockResolvedValueOnce(unauthorized());

    const client = createAuthedClient();
    await expect(client.get("/test")).rejects.toThrow(ApiError);

    const refreshCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/api/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);

    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("skips refresh if token is still fresh", async () => {
    localStorage.setItem("auth_token", "still-valid-token");
    localStorage.setItem("auth_refresh_token", "some-refresh");
    localStorage.setItem("auth_token_expires_at", String(Date.now() + 300_000));

    const ensureFreshToken = createTokenRefresher();
    const result = await ensureFreshToken();

    expect(result).toBe("still-valid-token");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles 429 rate-limit with longer retry delay", async () => {
    vi.useFakeTimers();
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "valid-refresh");

    mockFetch
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        refreshOk("recovered-token", "recovered-refresh", 300),
      );

    const ensureFreshToken = createTokenRefresher();
    const promise = ensureFreshToken();

    await vi.advanceTimersByTimeAsync(10);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(7_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result).toBe("recovered-token");
    expect(localStorage.getItem("auth_token")).toBe("recovered-token");

    vi.useRealTimers();
  });
});
