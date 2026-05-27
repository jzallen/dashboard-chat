/**
 * Build the auth-proxy OpenAPI 3.x spec from the Zod schemas in schemas.ts.
 *
 * Only the auth-proxy's owned surface is documented here:
 *   POST   /api/auth/token
 *   POST   /api/auth/pats
 *   GET    /api/auth/pats
 *   DELETE /api/auth/pats/{id}
 *   GET    /api/auth/login
 *   POST   /api/auth/callback
 *   POST   /api/auth/refresh
 *   POST   /api/auth/logout
 *
 * Grouping in source order is by audience: M2M (token), PAT lifecycle,
 * then the end-user auth flow.
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
  AuthCallbackRequestSchema,
  AuthLoginResponseSchema,
  AuthTokenIssuedSchema,
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

  // GET /api/auth/login — begin the user-auth flow
  registry.registerPath({
    method: "get",
    path: "/api/auth/login",
    tags: ["auth"],
    summary: "Begin the user-auth flow",
    description:
      "Returns the URL the frontend should navigate the user to in order to authenticate. In `AUTH_MODE=workos` the URL points at the WorkOS hosted authorize endpoint and carries a one-shot CSRF `state` that the subsequent `/api/auth/callback` must echo back. In `AUTH_MODE=dev` the URL points back at the frontend callback with the synthetic `dev-auth-code`, short-circuiting the WorkOS round-trip.",
    responses: {
      200: {
        description: "Redirect URL for the user-auth flow.",
        content: { "application/json": { schema: AuthLoginResponseSchema } },
      },
    },
  });

  // POST /api/auth/callback — exchange an auth code for a user token
  registry.registerPath({
    method: "post",
    path: "/api/auth/callback",
    tags: ["auth"],
    summary: "Exchange an auth code for a user access token",
    description:
      "Completes the OIDC round-trip started by `/api/auth/login`. The auth-proxy validates the code with WorkOS (or accepts the synthetic `dev-auth-code` in `AUTH_MODE=dev`), mints a fresh end-user JWT, and persists the resulting refresh token server-side keyed by the JWT's `sid`. The refresh token is NEVER returned in the response — only the access token and its lifetime.",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: AuthCallbackRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "Access token issued.",
        content: { "application/json": { schema: AuthTokenIssuedSchema } },
      },
      400: errorJson(
        "Malformed body, missing/invalid code, or CSRF state mismatch.",
      ),
    },
  });

  // POST /api/auth/refresh — silently re-issue a still-valid user token
  registry.registerPath({
    method: "post",
    path: "/api/auth/refresh",
    tags: ["auth"],
    summary: "Silently re-issue a user access token",
    description:
      "Exchanges the Bearer (a still-valid end-user JWT carrying a `sid`) for a freshly-minted one. The auth-proxy looks the session up server-side and uses the persisted WorkOS refresh token to obtain new access claims — the refresh token itself never crosses the wire, so the response schema deliberately omits any `refresh_token` field.",
    security: [{ [USER_BEARER_SCHEME]: [] }],
    responses: {
      200: {
        description: "New access token issued.",
        content: { "application/json": { schema: AuthTokenIssuedSchema } },
      },
      401: errorJson(
        "Missing/invalid Bearer, unknown session, or expired session.",
      ),
    },
  });

  // POST /api/auth/logout — drop the server-held session
  registry.registerPath({
    method: "post",
    path: "/api/auth/logout",
    tags: ["auth"],
    summary: "End the current user session",
    description:
      "Deletes the server-side session entry keyed by the Bearer's `sid`, so subsequent `/api/auth/refresh` attempts with the same access token fail with `invalid_session`. Idempotent — returns 204 whether or not the Bearer was valid; the FE only needs the signal that the server let go.",
    security: [{ [USER_BEARER_SCHEME]: [] }],
    responses: {
      204: { description: "Session ended. No body." },
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
