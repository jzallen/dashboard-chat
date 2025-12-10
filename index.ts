// Cloudflare Worker - Quill Take Home Project
// Backend: Tool calling with Groq + SSE streaming

import { createChatHandler } from "./src/lib/chat/index";

interface Env {
  GROQ_API_KEY: string;
  CORS_ORIGIN: string;
}

export type ChatHandlerFactory = (env: Env) => (request: Request) => Promise<Response>;

interface FetchOptions {
  chatHandlerFactory?: ChatHandlerFactory;
}

// ============================================================================
// Worker Entry Point
// ============================================================================

export async function handleFetch(
  request: Request,
  env: Env,
  { chatHandlerFactory = createChatHandler }: FetchOptions = {}
): Promise<Response> {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const url = new URL(request.url);

  // Health check
  if (url.pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Chat endpoint
  if (url.pathname === "/chat" && request.method === "POST") {
    const handleChat = chatHandlerFactory(env);
    return handleChat(request);
  }

  return new Response("Not Found", { status: 404 });
}

export default {
  fetch: (request: Request, env: Env) => handleFetch(request, env),
};
