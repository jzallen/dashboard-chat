// OpenAPI 3.1 spec generated from the existing zod schemas (H.5 / dc-qj9.3.7).
//
// The agent's surface today is `/health`, `POST /chat` (SSE), and the
// reflect-only directive log `GET /api/channels/:channelId/presentation-state`
// (ADR-015). This module reuses the canonical zod schemas in
// `@dashboard-chat/shared-chat` so SSE event documentation stays a structural
// derivative of the wire schema (DomainEvent + UiDirective per ADR-014) rather
// than a hand-maintained copy that would drift the way dc-ora documented.

import {
  DomainEventSchema,
  UiDirectiveSchema,
} from "@dashboard-chat/shared-chat/events";
import { Hono } from "hono";
import { z } from "zod";
import { createDocument, extendZodWithOpenApi } from "zod-openapi";

extendZodWithOpenApi(z);

// ---- Component refs -----------------------------------------------------
//
// Wrapping the imported schemas with `.openapi({ ref })` returns a NEW
// schema instance carrying the registration metadata; the originals in
// `shared/chat/events.ts` are left untouched (adding `ref` there would
// couple the wire schema to this consumer). ChatEvent is rebuilt on top of
// the registered refs so the SSE response references both components by
// name rather than inlining their variants.

const DomainEventRef = DomainEventSchema.openapi({
  ref: "DomainEvent",
  description:
    "State-change outcomes worth replaying or persisting (ADR-014).",
});

const UiDirectiveRef = UiDirectiveSchema.openapi({
  ref: "UiDirective",
  description:
    "Render instructions with no backend correlate; ephemeral (ADR-014).",
});

const ChatEventRef = z.union([DomainEventRef, UiDirectiveRef]).openapi({
  ref: "ChatEvent",
  description:
    "Wire-level union of DomainEvent and UiDirective. Each SSE `data:` " +
    "frame carries one ChatEvent JSON-encoded.",
});

// ---- Request / response schemas (agent-local; not in shared/) -----------

const ChatRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant", "tool"]),
          content: z.unknown(),
        }),
      )
      .min(1)
      .describe("Conversation history; non-empty."),
    tableSchema: z.unknown().nullable().optional(),
    contextType: z
      .enum(["dataset", "view", "report"])
      .nullable()
      .optional(),
    contextId: z.string().nullable().optional(),
    thread_id: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
  })
  .openapi({ ref: "ChatRequest" });

const ErrorResponseSchema = z
  .object({ error: z.string() })
  .openapi({ ref: "ErrorResponse" });

const HealthResponseSchema = z
  .object({ status: z.literal("ok") })
  .openapi({ ref: "HealthResponse" });

const PresentationStateEntrySchema = z
  .object({
    channel_id: z.string(),
    last_event_at: z.string().nullable(),
    directives: z.array(UiDirectiveRef),
  })
  .openapi({
    ref: "PresentationStateEntry",
    description:
      "Reflect-only per-channel directive log (ADR-015 / dc-x3y.2.2).",
  });

// ---- Document -----------------------------------------------------------

export const AGENT_OPENAPI_VERSION = "1.0.0";

export function buildOpenApiDocument() {
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "dashboard-chat agent",
      version: AGENT_OPENAPI_VERSION,
      description:
        "Hono service that streams chat completions over SSE and exposes a " +
        "reflect-only UI-directive log. Schema-first contract per Epic H " +
        "(dc-qj9.3.7).",
    },
    paths: {
      "/health": {
        get: {
          summary: "Liveness probe",
          responses: {
            "200": {
              description: "Service is up.",
              content: {
                "application/json": { schema: HealthResponseSchema },
              },
            },
          },
        },
      },
      "/chat": {
        post: {
          summary: "Stream a chat turn over Server-Sent Events.",
          description:
            "Each SSE frame carries a ChatEvent (DomainEvent or UiDirective " +
            "per ADR-014). Domain events are persistable; UI directives are " +
            "ephemeral render instructions. Authorization: Bearer JWT " +
            "(dev-token-static in AUTH_MODE=dev).",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: ChatRequestSchema },
            },
          },
          responses: {
            "200": {
              description:
                "SSE stream of ChatEvent frames terminated by a turn_done " +
                "DomainEvent.",
              content: {
                "text/event-stream": {
                  schema: ChatEventRef,
                },
              },
            },
            "400": {
              description: "Invalid request body.",
              content: {
                "application/json": { schema: ErrorResponseSchema },
              },
            },
            "401": {
              description: "Missing or invalid bearer token.",
              content: {
                "application/json": { schema: ErrorResponseSchema },
              },
            },
          },
        },
      },
      "/api/channels/{channelId}/presentation-state": {
        get: {
          summary:
            "Read the reflect-only UI-directive log for a Stream.io channel.",
          description:
            "Returns directives appended by the worker for the given channel " +
            "in arrival order, plus the timestamp of the last append. " +
            "Backed by an in-process Map (ADR-015).",
          security: [{ bearerAuth: [] }],
          requestParams: {
            path: z.object({
              channelId: z
                .string()
                .describe("Stream.io channel identifier."),
            }),
          },
          responses: {
            "200": {
              description: "Directive log entry for the channel.",
              content: {
                "application/json": {
                  schema: PresentationStateEntrySchema,
                },
              },
            },
            "400": {
              description: "Missing channel_id.",
              content: {
                "application/json": { schema: ErrorResponseSchema },
              },
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "Serve this OpenAPI document.",
          responses: {
            "200": {
              description: "OpenAPI 3.1 document describing the agent.",
              content: { "application/json": {} },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  });
}

export function createOpenApiRoutes(): Hono {
  const document = buildOpenApiDocument();
  const app = new Hono();
  app.get("/openapi.json", (c) => c.json(document));
  return app;
}
