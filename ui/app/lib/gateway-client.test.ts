// @vitest-environment happy-dom
// The browser transport to the same-origin /ui-server/* gateway. Its read leg does
// NOT unwrap the JSON:API envelope — the /ui-server read broker (brokerGet) owns
// that transform, so gatewayGet returns the (already-flat) body verbatim. These
// tests lock that pass-through contract plus the error mapping.
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import { gatewayGet, gatewayPost } from "./gateway-client";

const handleUnauthorized = vi.hoisted(() => vi.fn());
vi.mock("../auth/unauthorized", () => ({ handleUnauthorized }));

/** A 2xx Response whose JSON body is returned verbatim by `.json()`. */
function okJson(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body } as unknown as Response;
}

/** A non-2xx Response carrying a JSON error body. */
function errJson(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  handleUnauthorized.mockReset();
});

describe("gatewayGet — pass-through read (broker owns the unwrap)", () => {
  it("returns the response body verbatim without unwrapping a JSON:API envelope", async () => {
    const flat = { id: "org-7", name: "Acme" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson(flat)),
    );

    await expect(gatewayGet("/ui-server/orgs/me")).resolves.toEqual(flat);
  });

  it("does NOT flatten a body that still carries a `data` envelope — it is returned as-is", async () => {
    const enveloped = { data: { type: "orgs", id: "org-7" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson(enveloped)),
    );

    await expect(gatewayGet("/ui-server/orgs/me")).resolves.toEqual(enveloped);
  });

  it("throws ApiError(status, body) on a non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errJson(404, { error: "no org" })),
    );

    const err = await gatewayGet("/ui-server/orgs/me").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).body).toEqual({ error: "no org" });
  });

  it("trips handleUnauthorized on a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errJson(401, null)),
    );

    await gatewayGet("/ui-server/orgs/me").catch(() => {});
    expect(handleUnauthorized).toHaveBeenCalledOnce();
  });
});

describe("gatewayPost — raw body (callers read their own data.id)", () => {
  it("returns the RAW decoded body, envelope intact", async () => {
    const enveloped = { data: { type: "projects", id: "proj-1" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson(enveloped, 201)),
    );

    await expect(
      gatewayPost("/ui-server/projects", { name: "Alpha" }),
    ).resolves.toEqual(enveloped);
  });
});
