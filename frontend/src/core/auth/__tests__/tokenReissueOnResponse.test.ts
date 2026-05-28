import { withAuth } from "@/auth/withAuth";

/**
 * Stage 2 — server-driven token reissue via response headers.
 *
 * auth-proxy injects `X-New-Access-Token` (+ `X-New-Token-Expires-In`) on the
 * org-create response. `withAuth` is the single authenticated-fetch wrapper, so
 * it is the single consumer site: on EVERY response, when the header is present
 * and non-empty, it updates the stored token + expiry via the existing
 * tokenStorage primitives. No new flow.
 */
describe("withAuth — token reissue from X-New-Access-Token response header", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    mockFetch = vi.fn();
  });

  function responseWith(headers: Record<string, string>, status = 201) {
    return new Response(JSON.stringify({ id: "org-new" }), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  it("consumes X-New-Access-Token + X-New-Token-Expires-In and updates storage", async () => {
    localStorage.setItem("auth_token", "stale-token");
    mockFetch.mockResolvedValue(
      responseWith({
        "X-New-Access-Token": "fresh-token",
        "X-New-Token-Expires-In": "3600",
      }),
    );

    const authed = withAuth(mockFetch);
    const before = Date.now();
    await authed("/api/orgs", { method: "POST" });

    expect(localStorage.getItem("auth_token")).toBe("fresh-token");
    const expiry = Number(localStorage.getItem("auth_token_expires_at"));
    // Stored as an absolute ms timestamp ~ now + expires_in*1000 (tokenRefresh convention).
    expect(expiry).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
  });

  it("returns the original response unchanged to the caller", async () => {
    localStorage.setItem("auth_token", "stale-token");
    mockFetch.mockResolvedValue(
      responseWith({
        "X-New-Access-Token": "fresh-token",
        "X-New-Token-Expires-In": "3600",
      }),
    );

    const authed = withAuth(mockFetch);
    const res = await authed("/api/orgs", { method: "POST" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "org-new" });
  });

  it("leaves the stored token untouched when no reissue header is present", async () => {
    localStorage.setItem("auth_token", "stale-token");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const authed = withAuth(mockFetch);
    await authed("/api/projects", { method: "GET" });

    expect(localStorage.getItem("auth_token")).toBe("stale-token");
    expect(localStorage.getItem("auth_token_expires_at")).toBeNull();
  });

  it("ignores an empty X-New-Access-Token header", async () => {
    localStorage.setItem("auth_token", "stale-token");
    mockFetch.mockResolvedValue(
      responseWith({ "X-New-Access-Token": "", "X-New-Token-Expires-In": "3600" }, 200),
    );

    const authed = withAuth(mockFetch);
    await authed("/api/orgs", { method: "POST" });

    expect(localStorage.getItem("auth_token")).toBe("stale-token");
  });

  it("updates the token even without an expires-in header", async () => {
    localStorage.setItem("auth_token", "stale-token");
    mockFetch.mockResolvedValue(responseWith({ "X-New-Access-Token": "fresh-token" }, 201));

    const authed = withAuth(mockFetch);
    await authed("/api/orgs", { method: "POST" });

    expect(localStorage.getItem("auth_token")).toBe("fresh-token");
  });
});
