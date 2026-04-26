// Chat Agent — Hono server for chat streaming via Groq (Vercel AI SDK)
// Session management is handled by Stream.io (frontend-side)

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { authMiddleware } from "./lib/auth";
import { createChatHandler } from "./lib/chat";
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

const handleChat = createChatHandler({ GROQ_API_KEY });

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
