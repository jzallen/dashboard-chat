import { get, ApiError } from "../../lib/api/client";
import { ensureFreshToken, _resetRefreshState } from "../../lib/api/fetchUtils";

describe("401 interceptor with coalesced refresh", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let locationSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    _resetRefreshState();
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

  function ok(data: unknown) {
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function unauthorized() {
    return new Response("Unauthorized", { status: 401 });
  }

  function refreshOk(accessToken = "new-access", refreshToken = "new-refresh", expiresIn = 300) {
    return new Response(
      JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  it("recovers from a single 401 by refreshing and replaying", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "valid-refresh");

    mockFetch
      // 1st call: original request → 401
      .mockResolvedValueOnce(unauthorized())
      // 2nd call: refresh → success
      .mockResolvedValueOnce(refreshOk())
      // 3rd call: replayed request → success
      .mockResolvedValueOnce(ok("hello"));

    const result = await get<string>("/test");

    expect(result).toBe("hello");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify the replayed request used the new token
    const replayCall = mockFetch.mock.calls[2];
    expect(replayCall[1].headers.Authorization).toBe("Bearer new-access");

    // localStorage updated
    expect(localStorage.getItem("auth_token")).toBe("new-access");
    expect(localStorage.getItem("auth_refresh_token")).toBe("new-refresh");
  });

  it("coalesces concurrent 401s into a single refresh call", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "valid-refresh");

    // Both initial requests return 401, refresh succeeds, both replays succeed
    mockFetch
      .mockResolvedValueOnce(unauthorized()) // request A → 401
      .mockResolvedValueOnce(unauthorized()) // request B → 401
      .mockResolvedValueOnce(refreshOk())    // single refresh
      .mockResolvedValueOnce(ok("A"))        // replay A
      .mockResolvedValueOnce(ok("B"));       // replay B

    const [a, b] = await Promise.all([
      get<string>("/a"),
      get<string>("/b"),
    ]);

    expect(a).toBe("A");
    expect(b).toBe("B");

    // Refresh endpoint called exactly once (coalesced)
    const refreshCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => url.includes("/api/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("hard-logs out when no refresh token is available", async () => {
    localStorage.setItem("auth_token", "expired-token");
    // No refresh token → immediate hard logout

    mockFetch.mockResolvedValueOnce(unauthorized());

    await expect(get("/test")).rejects.toThrow(ApiError);

    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_refresh_token")).toBeNull();
  });

  it("hard-logs out when refresh endpoint returns error (after retry)", async () => {
    vi.useFakeTimers();
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "bad-refresh");

    mockFetch
      .mockResolvedValueOnce(unauthorized())                          // original request → 401
      .mockResolvedValueOnce(new Response("fail", { status: 400 }))   // refresh attempt 1 → fail
      .mockResolvedValueOnce(new Response("fail", { status: 400 }));  // refresh retry → fail

    const promise = get("/test");

    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const resultPromise = expect(promise).rejects.toThrow(ApiError);

    // Advance past the 5s retry delay inside ensureFreshToken
    await vi.advanceTimersByTimeAsync(6000);

    await resultPromise;
    expect(localStorage.getItem("auth_token")).toBeNull();
    vi.useRealTimers();
  });

  it("does not infinitely retry — replayed 401 causes immediate logout", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "valid-refresh");

    mockFetch
      .mockResolvedValueOnce(unauthorized()) // original → 401
      .mockResolvedValueOnce(refreshOk())    // refresh → ok
      .mockResolvedValueOnce(unauthorized()); // replayed request → still 401

    await expect(get("/test")).rejects.toThrow(ApiError);

    // Only one refresh call, no infinite loop
    const refreshCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => url.includes("/api/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);

    // Logged out
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("skips refresh if token is still fresh", async () => {
    // Set token with plenty of remaining TTL (> 60s)
    localStorage.setItem("auth_token", "still-valid-token");
    localStorage.setItem("auth_refresh_token", "some-refresh");
    localStorage.setItem("auth_token_expires_at", String(Date.now() + 300_000));

    const result = await ensureFreshToken();

    // Should return current token without making any fetch
    expect(result).toBe("still-valid-token");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles 429 rate-limit with longer retry delay", async () => {
    vi.useFakeTimers();
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("auth_refresh_token", "valid-refresh");

    // First refresh returns 429, second succeeds
    mockFetch
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(refreshOk("recovered-token", "recovered-refresh", 300));

    const promise = ensureFreshToken();

    // Let the first fetch resolve
    await vi.advanceTimersByTimeAsync(10);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // After 5s (standard delay), retry should NOT have happened yet (429 uses 12s)
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // After 12s total, retry should fire
    await vi.advanceTimersByTimeAsync(7_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result).toBe("recovered-token");
    expect(localStorage.getItem("auth_token")).toBe("recovered-token");

    vi.useRealTimers();
  });
});
