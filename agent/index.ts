// Chat Agent — Hono server for chat streaming via Groq (Vercel AI SDK)
// Session management is handled by Stream.io (frontend-side)

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { authMiddleware } from "./lib/auth";
import { createChatHandler, presentationStateLogFor } from "./lib/chat";
import { createPresentationStateRoutes } from "./lib/chat/presentationStateRoutes";
import { selectThreadPersister } from "./lib/chat/threadPersisterDispatch";
import { logImageIdentity } from "./version";

logImageIdentity("dashboard-agent");

const app = new Hono();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "8787", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error("[agent] GROQ_API_KEY is required but not set");
  process.exit(1);
}

// Wire ThreadEventPersister via capability-presence dispatch (ADR-017).
// Logs the choice once at startup; no NODE_ENV branching.
const { persister: threadPersister, kind: threadPersisterKind } = selectThreadPersister({
  REDIS_URL: process.env.REDIS_URL,
  REDIS_STREAM_MAXLEN: process.env.REDIS_STREAM_MAXLEN,
});
console.debug(`[ThreadEventPersister] selected adapter: ${threadPersisterKind}`);

const chatEnv = { GROQ_API_KEY, threadPersister };
const handleChat = createChatHandler(chatEnv);
const presentationStateLog = presentationStateLogFor(chatEnv);

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
// Reflect-only directive log (ADR-015 / dc-x3y.2.2)
// ---------------------------------------------------------------------------
// Co-located with the in-process Map storage in this worker. Headless
// consumers reach this endpoint via the FE proxy chain
// (nginx in production, vite dev-server in development) which routes
// /api/channels/{id}/presentation-state directly to the agent rather than
// the FastAPI backend. Persistence backend choice: in-process Map (matches
// C.1's same-process Stream.io persistence model). Replace with a Redis-backed
// `PresentationStateLog` when the worker scales horizontally.

app.route("/", createPresentationStateRoutes(presentationStateLog));

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
