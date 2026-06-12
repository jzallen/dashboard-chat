import { createGroq } from "@ai-sdk/groq";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  streamText,
  type ToolSet,
} from "ai";

import { backendClient } from "./backend-client";
import { fetchTableSchema } from "./datasetSchema";
import { type DispatchContext, dispatcherRegistry } from "./dispatchers";
import type { ChatEvent } from "./events";
import { pipeChatStream } from "./pipeChatStream";
import {
  inProcessPresentationStateLog,
  type PresentationStateLog,
} from "./presentationState";
import { getConversationalSystemPrompt, getReportSystemPrompt, getSystemPrompt, getViewSystemPrompt } from "./prompts";
import { getReportTools } from "./reportToolDefinitions";
import { requestLog } from "./requestLog";
import {
  assertScopeHeaderFallbackSunset,
  buildScopeHeaderFallbackEvent,
  extractActiveScope,
} from "./scope";
import { noopThreadPersister, type ThreadEventPersister } from "./threadPersister";
import { getConversationalTools, getTools } from "./tools";
import type { TableSchema } from "./types";
import { getViewTools } from "./viewToolDefinitions";

// DWD-3 compile-time sunset: defense-in-depth. If the agent boots with the
// flag still on past the sunset date, crash at module load — BEFORE the HTTP
// server binds. agent/index.ts also calls this; two import-sites so a future
// refactor that drops one doesn't silently extend the migration window.
assertScopeHeaderFallbackSunset();

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
  AUTH_PROXY_URL: string;
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

  // DWD-3 + ADR-029 §4 — every chat turn MUST carry an active scope. The
  // header is set EXCLUSIVELY by uiStateClient.activeScopeHeader on the FE
  // (the lint rule forbids manual header sets elsewhere). During the
  // migration window the body's project_id is honored as a fallback;
  // SCOPE_HEADER_FALLBACK_SUNSET enforces flag removal.
  const scopeResult = extractActiveScope(request, {
    project_id,
    contextType,
    contextId,
  });
  if (!scopeResult.ok) {
    requestLog.append({
      ts: new Date().toISOString(),
      scope: null,
      session_id: thread_id ?? null,
      thread_id: thread_id ?? null,
      status: scopeResult.status,
    });
    return new Response(JSON.stringify({ error: scopeResult.error }), {
      status: scopeResult.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { scope, used_body_fallback } = scopeResult;
  if (used_body_fallback) {
    // K-J002-5 observability — the fallback path is the migration-window
    // signal. The team watches the rate trend to zero before flipping the
    // flag off (and then removing this path at the sunset date).
    const event = buildScopeHeaderFallbackEvent(request);
    console.warn(
      JSON.stringify({
        level: "warn",
        ...event,
      }),
    );
  }
  requestLog.append({
    ts: new Date().toISOString(),
    scope,
    session_id: thread_id ?? null,
    thread_id: thread_id ?? null,
    status: 200,
  });

  // Resolve the dataset id BEFORE the prompt fork so it can drive prompt
  // selection (slice-3). Resource shape: when the active scope carries a
  // dataset resource, use it; otherwise fall back to the body's contextId for
  // forward-compat with the legacy body-shape during the migration window.
  const resolvedDatasetId =
    scope.resource_type === "dataset"
      ? scope.resource_id ?? undefined
      : contextType === "dataset"
        ? contextId ?? undefined
        : undefined;

  // The backend client is needed before the prompt fork (the agent may fetch
  // the dataset schema itself) and again below for the dispatch context.
  const jwt = extractJwt(request);
  const backend = backendClient({ authProxyUrl: env.AUTH_PROXY_URL, jwt });

  // Fork system prompt and tools based on contextType
  let systemPrompt: string;
  let tools: ToolSet | undefined;

  if (contextType === "report") {
    systemPrompt = getReportSystemPrompt(tableSchema);
    tools = getReportTools();
  } else if (contextType === "view") {
    systemPrompt = getViewSystemPrompt();
    tools = getViewTools();
  } else if (contextType === "dataset" && (tableSchema?.columns || resolvedDatasetId)) {
    // Dataset in scope → transform-capable prompt + tools. Prefer a
    // caller-supplied tableSchema (fast path, no GET); otherwise the agent is
    // self-sufficient and fetches the columns from the backend itself
    // (slice-3 — the durable fix for the cookie-only ui/ POST that omits
    // tableSchema). A failed fetch degrades to conversational + logs, so a
    // broken fetch is diagnosable rather than a silent repeat of the bug.
    let schema: TableSchema | null = tableSchema?.columns ? tableSchema : null;
    if (!schema && resolvedDatasetId) {
      try {
        schema = await fetchTableSchema(resolvedDatasetId, backend);
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "dataset_schema_fetch_failed",
            datasetId: resolvedDatasetId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        schema = null;
      }
    }
    if (schema) {
      systemPrompt = getSystemPrompt(schema);
      tools = getTools(schema);
    } else {
      systemPrompt = getConversationalSystemPrompt();
      tools = getConversationalTools();
    }
  } else {
    // Null context or no dataset in scope — conversational mode with
    // resolve_dataset tool. pipeChatStream intercepts the resolve_dataset
    // tool-input-available chunk and emits a `data-agent-request` typed part
    // instead of leaking the tool call to the FE.
    systemPrompt = getConversationalSystemPrompt();
    tools = getConversationalTools();
  }

  // Build DispatchContext. emit() pushes onto a buffer that pipeChatStream
  // drains as `data-chat-event` typed parts, preserving causal order with
  // upstream chunks (replaces the v4 `8:` annotation channel).
  const eventBuffer: ChatEvent[] = [];
  const channelId = thread_id ?? "";
  const presentationStateLog = env.presentationStateLog ?? inProcessPresentationStateLog;
  const dispatchCtx: DispatchContext = {
    jwt,
    datasetId: resolvedDatasetId,
    // DWD-3 / IC-J002-7: projectId now flows from X-Active-Scope, never from
    // the body post-sunset. project_id from body is only present here
    // because extractActiveScope already consumed it via the fallback path.
    projectId: scope.project_id,
    contextType: contextType === "report" ? "report" : contextType === "dataset" ? "dataset" : "project",
    backend,
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
