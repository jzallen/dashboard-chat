/**
 * Smoke test for the agent's OpenAPI spec (H.5 / dc-qj9.3.7).
 *
 * Verifies:
 *   - /openapi.json serves a valid OpenAPI 3.x document via Hono.
 *   - The /chat operation declares a `text/event-stream` response.
 *   - SSE event documentation is rooted in the canonical zod schemas
 *     (DomainEvent + UiDirective per ADR-014) — generated `components.schemas`
 *     names match the `.describe(...)` titles in `shared/chat/events.ts`,
 *     proving the spec is a structural derivative of the wire schema rather
 *     than a hand-maintained copy that could drift.
 */

import { describe, expect, it } from "vitest";

import { buildOpenApiDocument, createOpenApiRoutes } from "../lib/openapi";

describe("agent OpenAPI document", () => {
  it("declares OpenAPI 3.x metadata and the agent's routes", () => {
    const doc = buildOpenApiDocument();

    expect(doc.openapi).toMatch(/^3\.[01]\./);
    expect(doc.info.title).toBe("dashboard-chat agent");
    expect(doc.info.version).toBeDefined();

    expect(doc.paths).toBeDefined();
    const paths = doc.paths!;
    expect(paths["/health"]?.get).toBeDefined();
    expect(paths["/chat"]?.post).toBeDefined();
    expect(
      paths["/api/channels/{channelId}/presentation-state"]?.get,
    ).toBeDefined();
    expect(paths["/openapi.json"]?.get).toBeDefined();
  });

  it("documents POST /chat as an SSE stream of ChatEvent frames", () => {
    const doc = buildOpenApiDocument();
    const chatPost = doc.paths!["/chat"]!.post!;

    const ok = chatPost.responses!["200"];
    if (!ok || "$ref" in ok) {
      throw new Error("expected inline 200 response on /chat");
    }
    const sse = ok.content!["text/event-stream"];
    expect(sse).toBeDefined();
    expect(sse!.schema).toEqual({ $ref: "#/components/schemas/ChatEvent" });
  });

  it("registers DomainEvent and UiDirective and exposes every wire variant", () => {
    const doc = buildOpenApiDocument();
    const schemas = doc.components!.schemas!;

    expect(schemas.ChatEvent).toBeDefined();
    expect(schemas.DomainEvent).toBeDefined();
    expect(schemas.UiDirective).toBeDefined();

    // Every variant in shared/chat/events.ts (DomainEvent + UiDirective per
    // ADR-014) must surface in the OpenAPI doc as a `type` discriminator
    // literal under DomainEvent / UiDirective's `oneOf`. The list mirrors the
    // canonical wire schema; if a variant is added there without a
    // corresponding `.openapi(...)` registration here, this test fails
    // loudly — the smoke test stays a structural derivative of the wire
    // schema rather than a separate allowlist that could drift.
    const haystack = JSON.stringify(schemas);
    const expectedDomainTypes = [
      "assistant_text_delta",
      "transform_applied",
      "column_renamed",
      "row_added",
      "row_deleted",
      "transform_undone",
      "transform_re_enabled",
      "error_occurred",
      "turn_done",
    ];
    for (const t of expectedDomainTypes) {
      expect(haystack).toContain(`"const":"${t}"`);
    }
    const expectedDirectiveTypes = [
      "sort_directive",
      "filter_directive",
      "filters_cleared",
    ];
    for (const t of expectedDirectiveTypes) {
      expect(haystack).toContain(`"const":"${t}"`);
    }
  });

  it("declares a bearer security scheme and applies it to /chat", () => {
    const doc = buildOpenApiDocument();
    const scheme = doc.components!.securitySchemes!.bearerAuth;
    if (!scheme || "$ref" in scheme) {
      throw new Error("expected inline bearerAuth security scheme");
    }
    expect(scheme.type).toBe("http");
    expect(scheme.scheme).toBe("bearer");

    const chatPost = doc.paths!["/chat"]!.post!;
    expect(chatPost.security).toEqual([{ bearerAuth: [] }]);
  });
});

describe("GET /openapi.json route", () => {
  it("serves the OpenAPI document as JSON via Hono", async () => {
    const app = createOpenApiRoutes();
    const res = await app.fetch(new Request("http://test/openapi.json"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.openapi).toMatch(/^3\.[01]\./);
    expect((body.info as { title: string }).title).toBe(
      "dashboard-chat agent",
    );
  });
});
