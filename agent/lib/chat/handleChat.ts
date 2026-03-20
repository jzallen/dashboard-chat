import { createGroq } from "@ai-sdk/groq";
import { type CoreMessage, streamText, type ToolSet } from "ai";

import { getConversationalSystemPrompt,getSystemPrompt, getViewSystemPrompt } from "./prompts";
import { getTools } from "./tools";
import type { TableSchema } from "./types";
import { getViewTools } from "./viewToolDefinitions";

type ContextType = "dataset" | "view" | null;

interface ChatRequest {
  messages: CoreMessage[];
  tableSchema?: TableSchema | null;
  contextType?: ContextType;
  contextId?: string | null;
}

interface Env {
  GROQ_API_KEY: string;
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  const { messages, tableSchema, contextType, contextId } = (await request.json()) as ChatRequest;

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages must be a non-empty array" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fork system prompt and tools based on contextType
  let systemPrompt: string;
  let tools: ToolSet | undefined;

  if (contextType === "view") {
    systemPrompt = getViewSystemPrompt();
    tools = getViewTools();
  } else if (contextType === "dataset" && tableSchema?.columns) {
    systemPrompt = getSystemPrompt(tableSchema);
    tools = getTools(tableSchema);
  } else {
    // Null context or missing tableSchema — conversational only, no tools
    systemPrompt = getConversationalSystemPrompt();
    tools = undefined;
  }

  const groq = createGroq({ apiKey: env.GROQ_API_KEY });

  const result = streamText({
    model: groq("llama-3.3-70b-versatile"),
    system: systemPrompt,
    messages,
    ...(tools ? { tools, toolChoice: "auto" as const } : {}),
    temperature: 0.4,
    maxTokens: 1024,
  });

  return result.toDataStreamResponse();
}
