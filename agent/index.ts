// Chat Agent — Hono server for chat streaming via Groq (Vercel AI SDK)
// Session management is handled by Stream.io (frontend-side)

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { authMiddleware } from "./lib/auth";
import { createChatHandler } from "./lib/chat";
import { selectPresentationStateLog } from "./lib/chat/presentationStateDispatch";
import { createPresentationStateRoutes } from "./lib/chat/presentationStateRoutes";
import { selectThreadPersister } from "./lib/chat/threadPersisterDispatch";
import { createOpenApiRoutes } from "./lib/openapi";
import { logImageIdentity } from "./version";

logImageIdentity("dashboard-agent");

const app = new Hono();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "8787", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL;

if (!GROQ_API_KEY) {
  console.error("[agent] GROQ_API_KEY is required but not set");
  process.exit(1);
}

if (!AUTH_PROXY_URL) {
  console.error(
    "[agent] AUTH_PROXY_URL is required but not set " +
      "(tool dispatchers cannot reach the backend without it)",
  );
  process.exit(1);
}

// GROQ_TEMPERATURE override: production default is 0.3 (set in handleChat).
// Tests pin to 0 for determinism (see backend/tests/integration/dataset_layer/
// conftest.py). Invalid / out-of-range values fall back to the default.
const GROQ_TEMPERATURE = (() => {
  const raw = process.env.GROQ_TEMPERATURE;
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
    console.warn(
      `[agent] GROQ_TEMPERATURE=${raw} is invalid (expected 0-2 finite); using default`,
    );
    return undefined;
  }
  return parsed;
})();

// Wire ThreadEventPersister via capability-presence dispatch (ADR-017).
// Logs the choice once at startup; no NODE_ENV branching.
const { persister: threadPersister, kind: threadPersisterKind } = selectThreadPersister({
  REDIS_URL: process.env.REDIS_URL,
  REDIS_STREAM_MAXLEN: process.env.REDIS_STREAM_MAXLEN,
});
console.debug(`[ThreadEventPersister] selected adapter: ${threadPersisterKind}`);

// Wire PresentationStateLog via the same capability-presence dispatch (F.3 /
// ADR-015). Multi-replica deployments need Redis so directives appended on
// one replica are visible to GET /api/channels/{id}/presentation-state on
// any other replica; in-process Map is preserved as a single-replica dev
// fallback when REDIS_URL is unset.
const { log: presentationStateLog, kind: presentationStateKind } =
  selectPresentationStateLog({
    REDIS_URL: process.env.REDIS_URL,
    PRESENTATION_STATE_MAXLEN: process.env.PRESENTATION_STATE_MAXLEN,
  });
console.debug(`[PresentationStateLog] selected adapter: ${presentationStateKind}`);

const chatEnv = {
  GROQ_API_KEY,
  GROQ_TEMPERATURE,
  AUTH_PROXY_URL,
  threadPersister,
  presentationStateLog,
};
const handleChat = createChatHandler(chatEnv);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(
  "*",
  cors({
    origin: CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use("*", authMiddleware);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/health", (c) => c.json({ status: "ok" }));

// ---------------------------------------------------------------------------
// Chat (Groq SSE handler — unchanged)
// ---------------------------------------------------------------------------

app.post("/chat", async (c) => {
  return handleChat(c.req.raw);
});

// ---------------------------------------------------------------------------
// Reflect-only directive log (ADR-015 / dc-x3y.2.2 / F.3)
// ---------------------------------------------------------------------------
// Headless consumers reach this endpoint via the FE proxy chain (nginx in
// production, vite dev-server in development) which routes
// /api/channels/{id}/presentation-state directly to the agent rather than the
// FastAPI backend. The backing store is selected by `selectPresentationStateLog`
// above: Redis when REDIS_URL is set (multi-replica safe; reads on replica B
// see writes from replica A), in-process Map otherwise (single-replica dev).

app.route("/", createPresentationStateRoutes(presentationStateLog));

// ---------------------------------------------------------------------------
// OpenAPI spec (Epic H — schema-first contracts; dc-qj9.3.7)
// ---------------------------------------------------------------------------
// Public — `/openapi.json` is allowlisted in `PUBLIC_PATHS` so partner SDK
// generators can fetch the contract without needing a token.

app.route("/", createOpenApiRoutes());

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.debug(`[agent] Listening on http://localhost:${info.port}`);
});

process.on("SIGTERM", () => {
  console.debug("[agent] Shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.debug("[agent] Shutting down...");
  process.exit(0);
});
