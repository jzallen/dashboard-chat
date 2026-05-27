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

interface OpenApiObjectSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
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

  it("documents GET /api/auth/login returning a redirect URL", async () => {
    const { body } = await fetchSpec();
    const op = body.paths["/api/auth/login"]?.get;
    expect(op).toBeDefined();
    expect(op?.responses["200"]).toBeDefined();
    // Response is a JSON envelope carrying the URL the FE follows
    // (workos: WorkOS authorize URL; dev: short-circuit FE callback URL).
    const content = op?.responses["200"]?.content?.["application/json"] as
      | { schema?: { $ref?: string } }
      | undefined;
    expect(content?.schema?.$ref).toContain("AuthLoginResponse");
    expect(body.components?.schemas).toHaveProperty("AuthLoginResponse");
  });

  it("documents POST /api/auth/refresh, and the issued-token schema has NO refresh_token field", async () => {
    const { body } = await fetchSpec();
    const op = body.paths["/api/auth/refresh"]?.post;
    expect(op).toBeDefined();
    expect(op?.responses["200"]).toBeDefined();
    expect(op?.responses["401"]).toBeDefined();
    expect(op?.security?.[0]).toHaveProperty("userBearer");

    const resJson = op?.responses["200"]?.content?.["application/json"] as
      | { schema?: { $ref?: string } }
      | undefined;
    expect(resJson?.schema?.$ref).toContain("AuthTokenIssued");

    // The schema the wire contract refers to MUST NOT expose a
    // refresh_token field. This is the spec-level expression of the
    // invariant that the WorkOS refresh token never leaves the
    // auth-proxy — defence-in-depth alongside the HTTP-layer and
    // provider-boundary tests.
    const schemas = body.components?.schemas ?? {};
    const issued = schemas["AuthTokenIssued"] as OpenApiObjectSchema | undefined;
    expect(issued).toBeDefined();
    expect(Object.keys(issued?.properties ?? {})).not.toContain("refresh_token");
    expect(issued?.required ?? []).not.toContain("refresh_token");
  });

  it("documents POST /api/auth/logout as a 204-no-content Bearer-gated endpoint", async () => {
    const { body } = await fetchSpec();
    const op = body.paths["/api/auth/logout"]?.post;
    expect(op).toBeDefined();
    expect(op?.responses["204"]).toBeDefined();
    // Idempotent by design: the FE just wants to know the server let go,
    // so the spec advertises only the 204. No request body, Bearer-gated.
    expect(op?.requestBody).toBeUndefined();
    expect(op?.security?.[0]).toHaveProperty("userBearer");
  });

  it("documents POST /api/auth/callback with code+state in, token out", async () => {
    const { body } = await fetchSpec();
    const op = body.paths["/api/auth/callback"]?.post;
    expect(op).toBeDefined();
    expect(op?.responses["200"]).toBeDefined();
    expect(op?.responses["400"]).toBeDefined();

    const reqJson = op?.requestBody?.content?.["application/json"] as
      | { schema?: { $ref?: string } }
      | undefined;
    expect(reqJson?.schema?.$ref).toContain("AuthCallbackRequest");

    const resJson = op?.responses["200"]?.content?.["application/json"] as
      | { schema?: { $ref?: string } }
      | undefined;
    expect(resJson?.schema?.$ref).toContain("AuthTokenIssued");

    const schemas = body.components?.schemas ?? {};
    expect(schemas).toHaveProperty("AuthCallbackRequest");
    expect(schemas).toHaveProperty("AuthTokenIssued");
  });
});
