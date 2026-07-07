// @vitest-environment happy-dom
// The onboarding HTTP adapter routes the driver's backend-shaped paths through
// the same-origin /ui-server/* brokers (the URL flip), while preserving the
// OnboardingClient contract the pure driver depends on: a 2xx returns the
// unwrapped JSON:API payload; a non-2xx throws ApiError(status, body). RED until
// the adapter is implemented (DC-130/131/133).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import { onboardingClient } from "./onboarding-client";

/** A 2xx Response whose JSON body is a JSON:API envelope. */
function okJson(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body } as unknown as Response;
}

/** A non-2xx Response carrying a JSON error body. */
function errJson(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

describe("onboardingClient — /api → /ui-server URL flip", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => okJson({ data: null }));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  const url = () => fetchSpy.mock.calls[0][0] as string;
  const init = () => fetchSpy.mock.calls[0][1] as RequestInit;

  it("GET /api/orgs/me hits the same-origin /ui-server/orgs/me broker (not /api)", async () => {
    await onboardingClient.get("/api/orgs/me");
    expect(url()).toBe("/ui-server/orgs/me");
    expect(init().method).toBe("GET");
    expect(init().credentials).toBe("include");
  });

  it("GET /api/projects hits the same-origin /ui-server/projects broker (not /api)", async () => {
    await onboardingClient.get("/api/projects");
    expect(url()).toBe("/ui-server/projects");
  });

  it("POST /api/orgs hits the same-origin /ui-server/orgs broker (not /api), carrying the body", async () => {
    await onboardingClient.post("/api/orgs", { name: "Acme" });
    expect(url()).toBe("/ui-server/orgs");
    expect(init().method).toBe("POST");
    expect(init().credentials).toBe("include");
    expect(JSON.parse(init().body as string)).toEqual({ name: "Acme" });
  });

  it("POST /api/projects hits the same-origin /ui-server/projects broker (not /api)", async () => {
    await onboardingClient.post("/api/projects", {
      name: "My First Project",
    });
    expect(url()).toBe("/ui-server/projects");
  });
});

describe("onboardingClient — non-/api path is a contract violation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson({ data: null })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("throws naming the offending path when the driver hands a non-/api path", () => {
    expect(() => onboardingClient.get("/ui-server/orgs/me")).toThrow(
      /\/ui-server\/orgs\/me/,
    );
  });
});

describe("onboardingClient — OnboardingClient contract preserved", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unwraps the JSON:API envelope on a 2xx GET → flat { id, name }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okJson({
          data: { type: "orgs", id: "org-7", attributes: { name: "Acme" } },
        }),
      ),
    );
    const body = await onboardingClient.get("/api/orgs/me");
    expect(body).toEqual({ id: "org-7", name: "Acme" });
  });

  it("unwraps the JSON:API envelope on a 2xx POST → flat { id, name }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okJson(
          {
            data: { type: "orgs", id: "org-7", attributes: { name: "Acme" } },
          },
          201,
        ),
      ),
    );
    const body = await onboardingClient.post("/api/orgs", {
      name: "Acme",
    });
    expect(body).toEqual({ id: "org-7", name: "Acme" });
  });

  it("throws ApiError(status, body) on a non-2xx GET (the driver maps the definitive answer)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        errJson(404, {
          errors: [{ status: "404", title: "Organization not found" }],
        }),
      ),
    );
    const err = await onboardingClient
      .get("/api/orgs/me")
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).body).toEqual({
      errors: [{ status: "404", title: "Organization not found" }],
    });
  });

  it("throws ApiError(status, body) on a non-2xx POST (the driver maps the definitive answer)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        errJson(409, {
          errors: [{ status: "409", title: "Organization name already taken" }],
        }),
      ),
    );
    const err = await onboardingClient
      .post("/api/orgs", { name: "Acme" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual({
      errors: [{ status: "409", title: "Organization name already taken" }],
    });
  });
});
