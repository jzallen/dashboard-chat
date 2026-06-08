// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPatch, apiPost, apiUpload } from "./backendClient";

/** A minimal 2xx Response whose JSON body is an empty envelope. */
function okJson(body: unknown = { data: null }) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
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
});
