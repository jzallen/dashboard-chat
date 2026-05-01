/**
 * Build the auth-proxy OpenAPI 3.x spec from the Zod schemas in schemas.ts.
 *
 * Only the auth-proxy's owned surface is documented here:
 *   POST   /api/auth/token
 *   POST   /api/auth/pats
 *   GET    /api/auth/pats
 *   DELETE /api/auth/pats/{id}
 *
 * The wildcard proxy and /health are intentionally excluded — they aren't
 * part of the auth-proxy's published contract. The FastAPI backend exposes
 * its own OpenAPI for the proxied surface.
 *
 * The document is built once at module load (no I/O, cheap) and reused
 * for every /openapi.json request.
 */
import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
  ErrorResponseSchema,
  PatCreateRequestSchema,
  PatCreateResponseSchema,
  PatListResponseSchema,
  TokenRequestSchema,
  TokenResponseSchema,
} from "./schemas.ts";

const USER_BEARER_SCHEME = "userBearer";

function buildRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", USER_BEARER_SCHEME, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "End-user JWT (NOT a PAT, NOT an M2M token). PAT lifecycle endpoints reject other bearer kinds with 403 so a leaked credential cannot mint another.",
  });

  const errorJson = (description: string) => ({
    description,
    content: { "application/json": { schema: ErrorResponseSchema } },
  });

  // POST /api/auth/token — OAuth2 client_credentials grant
  registry.registerPath({
    method: "post",
    path: "/api/auth/token",
    tags: ["auth"],
    summary: "Mint an M2M access token",
    description:
      "OAuth2 client_credentials grant (RFC 6749 §4.4). Flag-gated by `M2M_ENABLED`; returns 404 when disabled. Accepts `application/x-www-form-urlencoded` (the spec-mandated shape) or `application/json` (ergonomic alternative).",
    request: {
      body: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": { schema: TokenRequestSchema },
          "application/json": { schema: TokenRequestSchema },
        },
      },
    },
    responses: {
      200: {
        description: "Access token issued.",
        content: { "application/json": { schema: TokenResponseSchema } },
      },
      400: errorJson(
        "Malformed body, unsupported grant_type, or missing credentials.",
      ),
      401: errorJson("Invalid client credentials."),
      404: errorJson("M2M endpoint disabled (M2M_ENABLED is not `true`)."),
    },
  });

  // POST /api/auth/pats — issue PAT
  registry.registerPath({
    method: "post",
    path: "/api/auth/pats",
    tags: ["auth"],
    summary: "Issue a Personal Access Token",
    description:
      "Mints a PAT on behalf of the authenticated user. Requires a real user JWT — PATs and M2M tokens are explicitly rejected (403) so a leaked credential cannot regenerate itself.",
    security: [{ [USER_BEARER_SCHEME]: [] }],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: PatCreateRequestSchema } },
      },
    },
    responses: {
      201: {
        description: "PAT minted. The bearer token is returned once.",
        content: { "application/json": { schema: PatCreateResponseSchema } },
      },
      400: errorJson("Missing or invalid body."),
      401: errorJson("Missing or invalid Authorization header."),
      403: errorJson(
        "Caller is not an end-user (PAT or M2M token presented).",
      ),
      404: errorJson("PAT API disabled."),
    },
  });

  // GET /api/auth/pats — list user's PATs
  registry.registerPath({
    method: "get",
    path: "/api/auth/pats",
    tags: ["auth"],
    summary: "List the authenticated user's PATs",
    security: [{ [USER_BEARER_SCHEME]: [] }],
    responses: {
      200: {
        description: "PAT records owned by the authenticated user.",
        content: { "application/json": { schema: PatListResponseSchema } },
      },
      401: errorJson("Missing or invalid Authorization header."),
      403: errorJson("Caller is not an end-user."),
      404: errorJson("PAT API disabled."),
    },
  });

  // DELETE /api/auth/pats/{id} — revoke a PAT
  registry.registerPath({
    method: "delete",
    path: "/api/auth/pats/{id}",
    tags: ["auth"],
    summary: "Revoke a Personal Access Token",
    security: [{ [USER_BEARER_SCHEME]: [] }],
    request: {
      params: z.object({
        id: z.string().openapi({
          param: { name: "id", in: "path" },
          description: "PAT identifier returned at creation.",
        }),
      }),
    },
    responses: {
      204: { description: "PAT revoked. No body." },
      401: errorJson("Missing or invalid Authorization header."),
      403: errorJson("Caller is not an end-user."),
      404: errorJson(
        "PAT not found, not owned by caller, or API disabled.",
      ),
    },
  });

  return registry;
}

export const openApiDocument = new OpenApiGeneratorV3(
  buildRegistry().definitions,
).generateDocument({
  openapi: "3.0.3",
  info: {
    title: "Dashboard Chat — auth-proxy",
    version: "1.0.0",
    description:
      "Token issuance and PAT lifecycle endpoints exposed by the dashboard-chat auth-proxy. The wildcard proxy to the FastAPI backend is intentionally undocumented here; consume the backend's own OpenAPI for that surface.",
  },
});
