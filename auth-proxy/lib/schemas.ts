/**
 * Zod schemas for the auth-proxy public surface.
 *
 * These schemas are the single source of truth for request and response
 * shapes on /api/auth/token and /api/auth/pats[/:id]. lib/openapi.ts
 * consumes them to emit the OpenAPI 3.x spec served at /openapi.json.
 *
 * extendZodWithOpenApi(z) is called once here so the .openapi() chain
 * method is available on every schema after this module is imported.
 */
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

// ── /api/auth/token (OAuth2 client_credentials grant) ─────────────────

export const TokenRequestSchema = z
  .object({
    grant_type: z.literal("client_credentials").openapi({
      description:
        "OAuth2 grant type. Must be `client_credentials` (RFC 6749 §4.4).",
      example: "client_credentials",
    }),
    client_id: z
      .string()
      .min(1)
      .openapi({ description: "OAuth2 client identifier." }),
    client_secret: z
      .string()
      .min(1)
      .openapi({ description: "OAuth2 client secret." }),
  })
  .openapi("TokenRequest");

export const TokenResponseSchema = z
  .object({
    access_token: z
      .string()
      .openapi({ description: "Signed RS256 JWT bearer token." }),
    token_type: z
      .literal("Bearer")
      .openapi({ description: "Token type. Always `Bearer`." }),
    expires_in: z.number().int().positive().openapi({
      description: "Lifetime in seconds before the access token expires.",
      example: 3600,
    }),
  })
  .openapi("TokenResponse");

// ── /api/auth/pats[/:id] (Personal Access Tokens) ────────────────────

export const PatCreateRequestSchema = z
  .object({
    name: z.string().min(1).openapi({
      description: "Human-readable label for the PAT.",
      example: "ci-deploy-key",
    }),
    expires_in_seconds: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .openapi({
        description:
          "Optional TTL in seconds. Omit or pass null for a non-expiring PAT.",
        example: 86400,
      }),
  })
  .openapi("PatCreateRequest");

export const PatCreateResponseSchema = z
  .object({
    id: z.string().openapi({ description: "PAT identifier (server-assigned)." }),
    token: z.string().openapi({
      description:
        "Bearer token. Returned ONCE on creation; not recoverable later.",
    }),
    name: z.string(),
    created_at: z.string().openapi({ description: "ISO-8601 timestamp." }),
    expires_at: z.string().nullable().openapi({
      description: "ISO-8601 timestamp; null when the PAT does not expire.",
    }),
  })
  .openapi("PatCreateResponse");

export const PatListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    created_at: z.string(),
    expires_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
  })
  .openapi("PatListItem");

export const PatListResponseSchema = z
  .object({
    pats: z.array(PatListItemSchema),
  })
  .openapi("PatListResponse");

// ── Error envelope (shared across endpoints) ─────────────────────────

export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({
      description:
        "Stable, machine-readable error code (e.g. `invalid_client`, `invalid_request`).",
    }),
    error_description: z
      .string()
      .optional()
      .openapi({ description: "Human-readable detail. Optional." }),
  })
  .openapi("ErrorResponse");
