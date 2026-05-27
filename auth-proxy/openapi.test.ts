/**
 * Test plan — `/openapi.json` schema completeness
 *
 * | # | Scenario | Status |
 * |---|---|---|
 * | 1 | Serves a valid OpenAPI 3.x document | ✓ existing |
 * | 2 | Documents `POST /api/auth/token` (M2M) with success + error responses | ✓ existing |
 * | 3 | Documents PAT lifecycle endpoints (`/api/auth/pats[/{id}]`) | ✓ existing |
 * | 4 | Registers reusable schemas + the `userBearer` security scheme | ✓ existing |
 * | 5 | Excludes `/health` and the wildcard proxy from the spec | ✓ existing |
 * | 6 | Documents `GET /api/auth/login` (workos: returns authorize URL; dev: returns FE-redirect URL) | → Stage 1 |
 * | 7 | Documents `POST /api/auth/callback` (request `{code, state?}`, response `{access_token, expires_in}`) | → Stage 1 |
 * | 8 | Documents `POST /api/auth/refresh` (request: Bearer; response `{access_token, expires_in}` — NOT a `refresh_token`) | → Stage 1 |
 * | 9 | Documents `POST /api/auth/logout` (request: Bearer; response 204) | → Stage 1 |
 * | 10 | Documents the `X-New-Access-Token` + `X-New-Token-Expires-In` response headers on `POST /api/orgs` | → Stage 2 |
 *
 * **Notes for the agent:**
 * - Row #8: the OpenAPI schema asserts the OQ1 (b) invariant in machine-readable form — the response shape does NOT include a `refresh_token` field. If anyone in the future tries to add `refresh_token` to the response, this test fails.
 * - Row #10: `X-New-Access-Token` is documented as an OPTIONAL response header on `POST /api/orgs` 201, with a note about R6 (header-logging redaction).
 * - The spec is generated from Zod schemas in `lib/schemas.ts` via `@asteasolutions/zod-to-openapi`. Add the new schemas there; the spec test asserts the generated output.
 */

import { describe, expect, it, vi } from "vitest";

// Mock jose so app.ts importing lib/auth doesn't try to fetch a JWKS at load time
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import { app } from "./app.ts";

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<
    string,
    Partial<Record<"get" | "post" | "delete" | "put" | "patch", OpenApiOperation>>
  >;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

interface OpenApiOperation {
  responses: Record<string, { content?: Record<string, unknown> }>;
  requestBody?: { content?: Record<string, unknown> };
  security?: Array<Record<string, string[]>>;
}

async function fetchSpec(): Promise<{ status: number; body: OpenApiSpec }> {
  const res = await app.fetch(new Request("http://localhost/openapi.json"));
  return { status: res.status, body: (await res.json()) as OpenApiSpec };
}

describe("/openapi.json", () => {
  it("serves a valid OpenAPI 3.x document", async () => {
    const { status, body } = await fetchSpec();
    expect(status).toBe(200);
    expect(body.openapi).toMatch(/^3\.\d+\.\d+$/);
    expect(body.info.title).toContain("auth-proxy");
    expect(body.info.version).toBeTruthy();
    expect(body.paths).toBeDefined();
  });

  it("documents POST /api/auth/token with success + error responses", async () => {
    const { body } = await fetchSpec();
    const op = body.paths["/api/auth/token"]?.post;
    expect(op).toBeDefined();
    expect(op?.responses["200"]).toBeDefined();
    expect(op?.responses["400"]).toBeDefined();
    expect(op?.responses["401"]).toBeDefined();
    expect(op?.responses["404"]).toBeDefined();
    // Body advertises both form-encoded (RFC 6749) and JSON
    expect(
      op?.requestBody?.content?.["application/x-www-form-urlencoded"],
    ).toBeDefined();
    expect(op?.requestBody?.content?.["application/json"]).toBeDefined();
  });

  it("documents PAT lifecycle endpoints", async () => {
    const { body } = await fetchSpec();
    const post = body.paths["/api/auth/pats"]?.post;
    const get = body.paths["/api/auth/pats"]?.get;
    const del = body.paths["/api/auth/pats/{id}"]?.delete;

    expect(post?.responses["201"]).toBeDefined();
    expect(get?.responses["200"]).toBeDefined();
    expect(del?.responses["204"]).toBeDefined();

    // PAT endpoints require user-bearer auth; presence of `security` is the
    // wire-level guarantee that PATs/M2M tokens are not interchangeable here.
    expect(post?.security?.[0]).toHaveProperty("userBearer");
    expect(get?.security?.[0]).toHaveProperty("userBearer");
    expect(del?.security?.[0]).toHaveProperty("userBearer");
  });

  it("registers reusable schemas + the userBearer security scheme", async () => {
    const { body } = await fetchSpec();
    const schemas = body.components?.schemas ?? {};
    for (const name of [
      "TokenRequest",
      "TokenResponse",
      "PatCreateRequest",
      "PatCreateResponse",
      "PatListItem",
      "PatListResponse",
      "ErrorResponse",
    ]) {
      expect(schemas).toHaveProperty(name);
    }
    expect(body.components?.securitySchemes).toHaveProperty("userBearer");
  });

  it("excludes /health and the wildcard proxy from the spec", async () => {
    const { body } = await fetchSpec();
    expect(body.paths["/health"]).toBeUndefined();
    // Spec only documents auth-proxy-owned endpoints; proxied paths
    // (e.g. /api/projects) are the FastAPI backend's contract.
    expect(body.paths["/api/projects"]).toBeUndefined();
  });
});
