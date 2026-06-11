// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet, apiPatch, apiPost, apiUpload } from "./backendClient";

/** A minimal 2xx Response whose JSON body is an empty envelope. */
function okJson(body: unknown = { data: null }) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** A non-2xx Response carrying a JSON error body. */
function errJson(status: number, body: unknown = { error: "boom" }) {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

describe("backendClient — cookie session transport", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => okJson());
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const init = (): RequestInit => fetchSpy.mock.calls[0][1] as RequestInit;
  const headers = (): Record<string, string> =>
    (init().headers ?? {}) as Record<string, string>;

  it("apiGet sends credentials:'include' so the httpOnly auth_token cookie rides", async () => {
    await apiGet("/api/projects");
    expect(init().credentials).toBe("include");
    expect(headers().Authorization).toBeUndefined();
  });

  it("apiPatch sends credentials:'include' and no Authorization", async () => {
    await apiPatch("/api/datasets/d1", { display_name: "x" });
    expect(init().credentials).toBe("include");
    expect(headers().Authorization).toBeUndefined();
  });

  it("apiPost sends credentials:'include' and no Authorization", async () => {
    await apiPost("/api/datasets/d1/archive");
    expect(init().credentials).toBe("include");
    expect(headers().Authorization).toBeUndefined();
  });

  it("apiUpload sends credentials:'include' and no Authorization", async () => {
    await apiUpload("/api/uploads", new FormData());
    expect(init().credentials).toBe("include");
    expect(headers().Authorization).toBeUndefined();
  });

  it("never builds an Authorization header even when a token arg is passed (the param is a no-op seam)", async () => {
    await apiGet("/api/projects", "left-over-token");
    expect(headers().Authorization).toBeUndefined();
  });

  it("throws ApiError {status, body} on a non-2xx, still an Error with the original message", async () => {
    fetchSpy.mockResolvedValueOnce(errJson(404, { detail: "missing" }));

    const err = await apiGet("/api/orgs/me").catch((e) => e as unknown);

    // The catalog's call sites read err.message + rely on instanceof Error.
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).body).toEqual({ detail: "missing" });
    expect((err as Error).message).toContain("404");
  });

  it("apiPost throws ApiError carrying the parsed error body", async () => {
    fetchSpy.mockResolvedValueOnce(errJson(409, { code: "taken" }));

    const err = await apiPost("/api/orgs", { name: "Acme" }).catch((e) => e as unknown);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual({ code: "taken" });
  });

  it("ApiError.body is null when the error body is not JSON-parseable", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    const err = await apiGet("/api/projects").catch((e) => e as unknown);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).body).toBeNull();
  });
});
