import { createGroq } from "@ai-sdk/groq";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  streamText,
  type ToolSet,
} from "ai";

import { backendClient } from "./backend-client";
import { type DispatchContext, dispatcherRegistry } from "./dispatchers";
import type { ChatEvent } from "./events";
import { pipeChatStream } from "./pipeChatStream";
import {
  inProcessPresentationStateLog,
  type PresentationStateLog,
} from "./presentationState";
import { getConversationalSystemPrompt, getReportSystemPrompt, getSystemPrompt, getViewSystemPrompt } from "./prompts";
import { getReportTools } from "./reportToolDefinitions";
import { noopThreadPersister, type ThreadEventPersister } from "./threadPersister";
import { getConversationalTools, getTools } from "./tools";
import type { TableSchema } from "./types";
import { getViewTools } from "./viewToolDefinitions";

type ContextType = "dataset" | "view" | "report" | null;

interface ChatRequest {
  messages: ModelMessage[];
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
   * Sampling temperature for the Groq model. Production default is 0.3 —
   * 0 was found too literal (users phrase prompts abstractly and the agent
   * needs interpretive freedom), 0.4 (the previous hardcoded value) drifted
   * too far for the dataset-layer harness's retry-with-rephrase budget.
   * The dataset-layer integration suite pins this to 0 for determinism.
   */
  GROQ_TEMPERATURE?: number;
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

const DEFAULT_GROQ_TEMPERATURE = 0.3;

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
    // Null context or missing tableSchema — conversational mode with resolve_dataset tool.
    // pipeChatStream intercepts the resolve_dataset tool-input-available chunk and emits
    // a `data-agent-request` typed part instead of leaking the tool call to the FE.
    systemPrompt = getConversationalSystemPrompt();
    tools = getConversationalTools();
  }

  // Build DispatchContext. emit() pushes onto a buffer that pipeChatStream
  // drains as `data-chat-event` typed parts, preserving causal order with
  // upstream chunks (replaces the v4 `8:` annotation channel).
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
    temperature: env.GROQ_TEMPERATURE ?? DEFAULT_GROQ_TEMPERATURE,
    maxOutputTokens: 1024,
  });

  const persister = env.threadPersister ?? noopThreadPersister;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      await pipeChatStream({
        upstream: result.toUIMessageStream(),
        writer,
        eventBuffer,
        channelId,
        persister,
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
