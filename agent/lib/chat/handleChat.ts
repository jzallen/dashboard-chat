import { createGroq } from "@ai-sdk/groq";
import { type CoreMessage, streamText, type ToolSet } from "ai";

import { backendClient } from "./backend-client";
import { type DispatchContext, dispatcherRegistry } from "./dispatchers";
import type { ChatEvent } from "./events";
import {
  inProcessPresentationStateLog,
  type PresentationStateLog,
} from "./presentationState";
import { getConversationalSystemPrompt, getReportSystemPrompt, getSystemPrompt, getViewSystemPrompt } from "./prompts";
import { getReportTools } from "./reportToolDefinitions";
import { isDomainEvent, noopThreadPersister, type ThreadEventPersister } from "./threadPersister";
import { getConversationalTools, getTools } from "./tools";
import type { AgentRequest, TableSchema } from "./types";
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
  AUTH_PROXY_URL?: string;
  /**
   * Persists domain events onto the Stream.io thread before `turn_done` is
   * emitted (Epic C / dc-x3y.3.1). Defaults to a no-op when omitted, which is
   * the production default until Stream.io credentials are wired through —
   * `turn_done` is still emitted on the SSE stream so the user-facing turn
   * completes normally.
   */
  threadPersister?: ThreadEventPersister;
  /**
   * Per-channel reflect-only directive log (ADR-015 / dc-x3y.2.2). Worker UI
   * dispatchers append the emitted UiDirective here as a side effect of
   * `emit`. Defaults to the in-process Map singleton; tests inject a fresh
   * `InProcessPresentationStateLog` per case to avoid cross-test bleed.
   */
  presentationStateLog?: PresentationStateLog;
}

const TURN_DONE_REASON_BY_FINISH_REASON: Record<string, "stop" | "length" | "request" | "error"> = {
  stop: "stop",
  "tool-calls": "stop",
  length: "length",
  "content-filter": "stop",
  request: "request",
  error: "error",
  other: "stop",
};

function mapFinishReason(raw: string | undefined): "stop" | "length" | "request" | "error" {
  if (!raw) return "stop";
  return TURN_DONE_REASON_BY_FINISH_REASON[raw] ?? "stop";
}

function extractJwt(request: Request): string {
  const header = request.headers.get("Authorization") ?? request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice("bearer ".length).trim();
  }
  return "";
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

  // Build DispatchContext. emit() pushes onto a buffer that is drained into the
  // SSE response as `8:` annotation lines (chatStream.ts parses both `2:` and
  // `8:` JSON arrays as ChatEvent carriers).
  const jwt = extractJwt(request);
  const eventBuffer: ChatEvent[] = [];
  const channelId = thread_id ?? "";
  const presentationStateLog = env.presentationStateLog ?? inProcessPresentationStateLog;
  const dispatchCtx: DispatchContext = {
    jwt,
    datasetId: contextType === "dataset" ? contextId ?? undefined : undefined,
    projectId: project_id ?? undefined,
    contextType: contextType === "report" ? "report" : contextType === "dataset" ? "dataset" : "project",
    backend: backendClient({
      authProxyUrl: env.AUTH_PROXY_URL ?? "http://localhost:3000",
      jwt,
    }),
    emit: (event: ChatEvent) => {
      eventBuffer.push(event);
    },
    channelId,
    presentationState: presentationStateLog,
  };

  const dispatcherTools = dispatcherRegistry(dispatchCtx);
  const mergedTools: ToolSet | undefined =
    tools || Object.keys(dispatcherTools).length > 0
      ? ({ ...(tools ?? {}), ...dispatcherTools } as ToolSet)
      : undefined;

  const groq = createGroq({ apiKey: env.GROQ_API_KEY });

  const result = streamText({
    model: groq("llama-3.3-70b-versatile"),
    system: systemPrompt,
    messages,
    ...(mergedTools ? { tools: mergedTools, toolChoice: "auto" as const } : {}),
    temperature: 0.4,
    maxTokens: 1024,
  });

  const upstreamResponse = result.toDataStreamResponse();
  const responseWithEvents = injectEmittedEvents(upstreamResponse, eventBuffer);

  // When resolve_dataset interception is NOT active, persist + emit turn_done
  // on the responseWithEvents pipeline directly.
  const persister = env.threadPersister ?? noopThreadPersister;

  if (!interceptResolveDataset) {
    return wrapWithTurnDoneAndPersist(responseWithEvents, eventBuffer, channelId, persister);
  }

  // Transform the stream to intercept resolve_dataset tool calls, then wrap
  // with the turn_done + persistence transform so the captured finishReason
  // (potentially rewritten to "request") is reflected in the turn_done event.
  const responseWithRequestRewrite = transformStreamForResolveDataset(responseWithEvents);
  return wrapWithTurnDoneAndPersist(
    responseWithRequestRewrite,
    eventBuffer,
    channelId,
    persister,
  );
}

/**
 * Wraps the upstream SSE response so that any ChatEvents pushed to `buffer`
 * during streaming (by dispatcher execute() callbacks) are flushed into the
 * stream as `8:[event,...]` annotation lines. The frontend's chatStream.ts
 * already parses prefix `8` as ChatEvents.
 */
function injectEmittedEvents(upstream: Response, buffer: ChatEvent[]): Response {
  const upstreamBody = upstream.body;
  if (!upstreamBody) return upstream;

  const encoder = new TextEncoder();

  const flushBuffer = (controller: TransformStreamDefaultController<Uint8Array>): void => {
    if (buffer.length === 0) return;
    const events = buffer.splice(0, buffer.length);
    controller.enqueue(encoder.encode(`8:${JSON.stringify(events)}\n`));
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      flushBuffer(controller);
      controller.enqueue(chunk);
    },
    flush(controller) {
      flushBuffer(controller);
    },
  });

  return new Response(upstreamBody.pipeThrough(transform), {
    headers: upstream.headers,
  });
}

/**
 * Captures the upstream `d:` finishReason, then on stream close:
 *   1. Pushes `turn_done` into the shared buffer.
 *   2. Best-effort persists the buffered DomainEvents onto the Stream.io
 *      thread (per dc-x3y.3.1 / ADR-014 — UI directives are excluded).
 *   3. Flushes the `turn_done` (and any trailing buffered events) to the
 *      stream as an `8:` annotation line.
 *
 * Persistence is best-effort: if the persister rejects, the failure is logged
 * and `turn_done` is still emitted (exit criterion 6 — never block the
 * user-facing turn on persistence failure).
 *
 * Exported for direct unit testing of the persistence/finalization seam.
 */
export function wrapWithTurnDoneAndPersist(
  upstream: Response,
  buffer: ChatEvent[],
  channelId: string,
  persister: ThreadEventPersister,
): Response {
  const upstreamBody = upstream.body;
  if (!upstreamBody) return upstream;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let lineBuffer = "";
  let finishReasonRaw: string | undefined;

  const flushBuffer = (controller: TransformStreamDefaultController<Uint8Array>): void => {
    if (buffer.length === 0) return;
    const events = buffer.splice(0, buffer.length);
    controller.enqueue(encoder.encode(`8:${JSON.stringify(events)}\n`));
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Pass-through, but sniff `d:` lines to capture the final finishReason.
      controller.enqueue(chunk);
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("d:")) continue;
        try {
          const payload = JSON.parse(line.slice(2)) as { finishReason?: string };
          if (typeof payload.finishReason === "string") {
            finishReasonRaw = payload.finishReason;
          }
        } catch {
          // Non-JSON payload — leave finishReason undefined; mapper defaults to "stop".
        }
      }
    },
    async flush(controller) {
      // resolve_dataset interception rewrites finishReason to "request" — the
      // turn is pausing for FE data resolution, not ending. Skip turn_done +
      // persistence so the FE keeps its thinking indicator and the partial
      // turn isn't recorded as a checkpoint.
      const reason = mapFinishReason(finishReasonRaw);
      if (reason === "request") {
        flushBuffer(controller);
        return;
      }

      // Push turn_done into the buffer alongside any trailing dispatcher events.
      buffer.push({ type: "turn_done", reason });

      // Best-effort persistence — never blocks turn_done emission.
      const domainEvents = buffer.filter(isDomainEvent);
      if (channelId && domainEvents.length > 0) {
        try {
          await persister.persist(channelId, domainEvents);
        } catch (err) {
          console.error("[agent] thread persistence failed:", err);
        }
      }

      flushBuffer(controller);
    },
  });

  return new Response(upstreamBody.pipeThrough(transform), {
    headers: upstream.headers,
  });
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
