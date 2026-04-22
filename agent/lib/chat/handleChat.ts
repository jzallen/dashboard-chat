import { createGroq } from "@ai-sdk/groq";
import { type CoreMessage, streamText, type ToolSet } from "ai";

import { getConversationalSystemPrompt, getReportSystemPrompt, getSystemPrompt, getViewSystemPrompt } from "./prompts";
import { getConversationalTools, getTools } from "./tools";
import type { AgentRequest, TableSchema } from "./types";
import { getReportTools } from "./reportToolDefinitions";
import { getViewTools } from "./viewToolDefinitions";

type ContextType = "dataset" | "view" | "report" | null;

interface ChatRequest {
  messages: CoreMessage[];
  tableSchema?: TableSchema | null;
  contextType?: ContextType;
  contextId?: string | null;
  thread_id?: string | null;
  project_id?: string | null;
}

interface Env {
  GROQ_API_KEY: string;
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  const { messages, tableSchema, contextType, contextId, thread_id, project_id } =
    (await request.json()) as ChatRequest;

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages must be a non-empty array" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fork system prompt and tools based on contextType
  let systemPrompt: string;
  let tools: ToolSet | undefined;
  let interceptResolveDataset = false;

  if (contextType === "report") {
    systemPrompt = getReportSystemPrompt(tableSchema);
    tools = getReportTools();
  } else if (contextType === "view") {
    systemPrompt = getViewSystemPrompt();
    tools = getViewTools();
  } else if (contextType === "dataset" && tableSchema?.columns) {
    systemPrompt = getSystemPrompt(tableSchema);
    tools = getTools(tableSchema);
  } else {
    // Null context or missing tableSchema — conversational mode with resolve_dataset tool
    systemPrompt = getConversationalSystemPrompt();
    tools = getConversationalTools();
    interceptResolveDataset = true;
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

  const upstreamResponse = result.toDataStreamResponse();

  // When resolve_dataset interception is NOT active, pass through directly
  if (!interceptResolveDataset) {
    return upstreamResponse;
  }

  // Transform the stream to intercept resolve_dataset tool calls.
  // When found, inject an `r:` line and change the finish reason to "request".
  return transformStreamForResolveDataset(upstreamResponse);
}

/**
 * Transforms an AI SDK data stream response to intercept resolve_dataset tool calls.
 *
 * When a `9:` (tool call) line contains a resolve_dataset call, the stream emits:
 *   r:{"type":"resolve_dataset","params":{"name":"..."}}
 *   d:{"finishReason":"request"}
 * instead of the normal tool call + finish events.
 */
function transformStreamForResolveDataset(upstreamResponse: Response): Response {
  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) return upstreamResponse;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = "";
  let foundResolveDataset: AgentRequest | null = null;

  const transformedStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line) {
          controller.enqueue(encoder.encode("\n"));
          continue;
        }

        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) {
          controller.enqueue(encoder.encode(line + "\n"));
          continue;
        }

        const prefix = line.slice(0, colonIdx);
        const payload = line.slice(colonIdx + 1).trim();

        // Intercept tool call lines to detect resolve_dataset
        if (prefix === "9" && payload) {
          try {
            const calls = JSON.parse(payload) as Array<{
              toolCallId: string;
              toolName: string;
              args: Record<string, unknown>;
            }>;
            const resolveCall = calls.find((c) => c.toolName === "resolve_dataset");
            if (resolveCall) {
              foundResolveDataset = {
                type: "resolve_dataset",
                params: resolveCall.args,
              };
              // Emit the r: request line instead of the 9: tool call line
              controller.enqueue(
                encoder.encode(`r:${JSON.stringify(foundResolveDataset)}\n`),
              );
              continue;
            }
          } catch {
            // Not valid JSON, pass through
          }
        }

        // Intercept done line to change finish reason when resolve_dataset was found
        if (prefix === "d" && foundResolveDataset) {
          controller.enqueue(
            encoder.encode(`d:${JSON.stringify({ finishReason: "request" })}\n`),
          );
          continue;
        }

        // Pass through all other lines
        controller.enqueue(encoder.encode(line + "\n"));
      }
    },
    flush(controller) {
      if (buffer) {
        controller.enqueue(encoder.encode(buffer));
      }
    },
  });

  const readable = upstreamBody.pipeThrough(transformedStream);

  return new Response(readable, {
    headers: upstreamResponse.headers,
  });
}
