## Context

The chat backend ("worker") was originally scaffolded as a Cloudflare Worker but runs as a standard Hono/Node.js process. Its core responsibility — receive a message array + table schema, call Groq, stream the response back — is hand-rolled:

- `GroqChatClient`: raw `fetch` to Groq's OpenAI-compatible endpoint + `EventSourceParserStream` for SSE parsing
- `SSEStreamWriter`: manual tool-call accumulation (Groq streams arguments char-by-char) and custom event format (`{type: "content" | "tool_calls" | "done" | "error"}`)
- `shared/chat/prompts.ts`: tool definitions as plain JSON Schema objects (no compile-time validation)

The frontend `readSSEStream` parses this custom format. Tool execution is fully client-side — the agent fires one LLM call per turn and streams the result; there is no server-side tool execution loop.

**Constraint**: Tools execute in the browser (TanStack Table mutations). The service is not an agentic loop — it is a streaming chat endpoint. This rules out full agent orchestration frameworks (LangGraph, Mastra) which assume server-side tool execution.

## Goals / Non-Goals

**Goals:**
- Replace ~200 lines of custom streaming/accumulation code with Vercel AI SDK primitives
- Move tool definitions to Zod schemas (type-safe, validated at compile time)
- Rename the service and all references from "worker" to "agent"
- Adopt consistent "agent" / "agent client" terminology in frontend code and env vars
- Keep the frontend chat architecture unchanged (custom engine, client-side tool execution)

**Non-Goals:**
- Switching LLM provider (stays on Groq)
- Introducing server-side tool execution or an agentic loop
- Adopting `useChat` hook on the frontend (too invasive; custom engine stays)
- Migrating to a different runtime (stays on Hono/Node.js)
- Changing session management (stays frontend-owned)

## Decisions

### 1. Vercel AI SDK (`ai` + `@ai-sdk/groq`) over alternatives

| Option | Verdict |
|---|---|
| Official Groq SDK only | Replaces fetch boilerplate but not accumulation or type safety |
| OpenAI SDK pointed at Groq | Same as above; indirect |
| Vercel AI SDK | Handles streaming, tool accumulation, Zod schemas, `toDataStreamResponse()` in one package |
| LangChain/Mastra | Wrong abstraction — assumes server-side tool execution loop |

The Vercel AI SDK is provider-agnostic (`@ai-sdk/groq` is a thin provider adapter), has first-class Hono support, and replaces all three custom components (`GroqChatClient`, `SSEStreamWriter`, manual accumulation).

### 2. AI SDK data stream protocol over keeping the custom SSE format

Two viable approaches:

**Option A** — Use `streamText` → `toDataStreamResponse()`. Frontend updates its parser.

**Option B** — Use `streamText` + `fullStream` async iterator, emit current custom `{type: "content"|"tool_calls"|"done"}` format. Frontend unchanged.

Option B is safer (fewer files changed) but perpetuates bespoke protocol. Option A is recommended:
- `toDataStreamResponse()` is one line server-side vs. custom `SSEStreamWriter` (80 lines)
- Frontend `readSSEStream` is 60 lines regardless of which format it parses
- The AI SDK data stream format is better documented and supported
- Positions frontend to optionally adopt `useChat` in future without protocol change

The frontend `ChatContext` / `useChatEngine` remains custom — only `readSSEStream` changes.

### 3. Zod schemas via `tool()` helper, tools stay in the agent package

Current plain JSON Schema objects have no compile-time validation. Zod schemas with `tool()` from `ai` catch parameter mismatches at build time and serve as single source of truth for both the LLM schema and TypeScript types.

Tools remain in `agent/lib/chat/tools.ts` (not moved to `shared/`). The frontend does not import tool definitions — it receives parsed tool call results from the stream. Tools reference column names dynamically, making them per-request rather than static exports.

### 4. Service rename: `worker` → `agent`

Rename scope:
- Directory: `worker/` → `agent/`
- Docker Compose service: `worker` → `agent`, container `dashboard-worker` → `dashboard-agent`
- npm workspace: `"worker"` → `"agent"` in root `package.json`
- npm package name: `dashboard-chat-worker` → `dashboard-chat-agent` in `agent/package.json`
- Env var: `CHAT_WORKER_URL` → `CHAT_AGENT_URL` (frontend + devcontainer + any CI references)
- Frontend module comments, JSDoc, and variable names (`workerClient` → `agentClient`, etc.)
- Spec: `chat-worker-client` spec updated to reflect agent terminology

Bazel `BUILD.bazel` targets that reference `//worker:*` must be updated to `//agent:*`.

### 5. `shared/chat/` package disposition

The `shared/chat/` workspace is already partially superseded — the `chat-worker-client` spec moved types and prompts to `frontend/src/core/chat/`. With AI SDK tool definitions moving to Zod in the agent package, `shared/chat/` becomes a thin shim or can be removed. Decision: retain `shared/chat/` for the `Message` type (used by both agent and frontend) but remove `ToolDefinition` / `getToolDefinitions` after migration; `getSystemPrompt` moves to `agent/lib/chat/` exclusively.

## Risks / Trade-offs

**AI SDK data stream format is less transparent** → The format (`0:"text"`, `9:[...]`, `d:{...}`) is more compact but less readable than `{type: "content", content: "..."}`. Mitigate: document the format mapping in `chatStream.ts` comments.

**Frontend SSE parser rewrite** → `readSSEStream` and its tests change significantly. Mitigate: tests cover the same behaviour; parser logic is isolated in `services/chatStream.ts`.

**Zod tool definitions with dynamic column enums** → Some tool parameters enumerate actual column names as Zod enums built at request time (`z.enum(columns.map(c => c.id) as [string, ...string[]])`). This requires a factory function rather than static `tool()` definitions. Mitigate: wrap in `getTools(tableSchema: TableSchema)` factory, same pattern as current `getToolDefinitions`.

**`eventsource-parser` removal** → Currently used only in `GroqChatClient`. AI SDK replaces this. No other usages expected.

## Migration Plan

1. Rename `worker/` directory → `agent/`, update all import paths, docker-compose, npm workspace, Bazel targets
2. Add `ai` and `@ai-sdk/groq` to `agent/package.json`; remove `eventsource-parser`
3. Rewrite `agent/lib/chat/tools.ts` with Zod schemas using `tool()` helper
4. Rewrite `agent/lib/chat/handleChat.ts` using `streamText` + `toDataStreamResponse()`
5. Delete `agent/lib/chat/clients/groq.ts` and `SSEStreamWriter` class
6. Update frontend `readSSEStream` to parse AI SDK data stream format
7. Rename env var `CHAT_WORKER_URL` → `CHAT_AGENT_URL` everywhere
8. Update frontend comments/variable names from "worker" to "agent"
9. Update `shared/chat/` — remove `ToolDefinition`/`getToolDefinitions` exports; keep `Message` type
10. Update tests: agent tests rewritten for new handler, frontend `chatStream.test.ts` updated for new format

No rollback complexity — the service port and request shape are unchanged. Frontend and backend are unaffected beyond the env var rename.
