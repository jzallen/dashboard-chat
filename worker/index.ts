// Chat Worker — Hono server with session management
// Handles chat streaming (Groq SSE), session lifecycle (Redis + S3)

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { authMiddleware } from "./lib/auth";
import { createChatHandler } from "./lib/chat";
import { SessionManager } from "./lib/sessions/index";
import type { CreateSessionRequest, LogTurnRequest } from "./lib/sessions/types";

const app = new Hono();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "8787", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error("[worker] GROQ_API_KEY is required but not set");
  process.exit(1);
}

const handleChat = createChatHandler({ GROQ_API_KEY });

const sessionManager = new SessionManager({
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  s3: {
    endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
    bucket: process.env.S3_BUCKET_LOGS || "dashboard-chat.logs",
    region: process.env.S3_REGION || "us-east-1",
  },
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(
  "*",
  cors({
    origin: CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

app.use("*", authMiddleware);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/health", (c) => c.json({ status: "ok" }));

// ---------------------------------------------------------------------------
// Chat (existing Groq SSE handler — unchanged)
// ---------------------------------------------------------------------------

app.post("/chat", async (c) => {
  return handleChat(c.req.raw);
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

app.post("/sessions", async (c) => {
  const body = await c.req.json<CreateSessionRequest>();
  const session = await sessionManager.createSession(body.project_id, body.dataset_id);
  return c.json(session, 201);
});

app.post("/sessions/:id/turns", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json<LogTurnRequest>();
  try {
    const turn = await sessionManager.logTurn(sessionId, body);
    return c.json(turn, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes("not found")) {
      return c.json({ error: err.message }, 404);
    }
    throw err;
  }
});

app.get("/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  const session = await sessionManager.getSession(sessionId);
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(session);
});

app.get("/sessions", async (c) => {
  const datasetId = c.req.query("dataset_id");
  if (!datasetId) return c.json({ error: "dataset_id query param required" }, 400);
  const sessions = await sessionManager.listSessions(datasetId);
  return c.json(sessions);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start() {
  await sessionManager.start();

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.debug(`[worker] Listening on http://localhost:${info.port}`);
  });
}

async function shutdown() {
  console.debug("[worker] Shutting down...");
  await sessionManager.stop();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start().catch((err) => {
  console.error("[worker] Failed to start:", err);
  process.exit(1);
});
