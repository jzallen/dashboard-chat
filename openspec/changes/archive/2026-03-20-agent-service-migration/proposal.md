## Why

The chat backend ("worker") originated as a Cloudflare Worker but is now a standard Hono/Node.js service — the name no longer reflects its purpose. Simultaneously, the service hand-rolls ~200 lines of Groq streaming and tool-call accumulation that the Vercel AI SDK provides out of the box with better type safety, replacing raw `fetch` with a maintained, provider-agnostic abstraction.

## What Changes

- **BREAKING** Rename the `worker/` service directory and all references to `agent/` — docker-compose service name, npm workspace, package name, env var prefix, and import paths
- Replace the raw `fetch`-based `GroqChatClient` and `SSEStreamWriter` with Vercel AI SDK (`ai` + `@ai-sdk/groq`) in the agent service
- Replace plain JSON tool schemas in `shared/chat/prompts.ts` with Zod-defined tools using the AI SDK `tool()` helper
- **BREAKING** Update the SSE stream format: frontend switches from custom `data: {type, content}` parsing to the AI SDK data stream format (`toDataStreamResponse()` / `useChat` compatible)
- Update frontend `readSSEStream` and `fetchChatStream` to match the new stream protocol
- Rename terminology throughout: "worker client" → "agent client", `CHAT_WORKER_URL` → `CHAT_AGENT_URL`, file/module names reflecting "agent" role
- Update `chat-worker-client` spec to reflect renamed service and new stream protocol

## Capabilities

### New Capabilities

- `agent-chat-streaming`: The agent service processes chat requests using Vercel AI SDK — Zod-typed tool definitions, provider-agnostic model config, and `streamText` / `toDataStreamResponse` for SSE output

### Modified Capabilities

- `chat-worker-client`: Requirements updated to reflect agent service rename (URL, module names, env vars) and new AI SDK stream format consumed by the frontend

## Impact

- **`worker/`** directory → `agent/` (full rename, all files)
- **`shared/chat/`** — tool definitions rewritten with Zod + AI SDK `tool()`; types updated for new message format
- **`frontend/src/lib/chat/`** — `client.ts`, `chatStream.ts`, env var references updated for new stream format and agent URL
- **`docker-compose.yml`** — service renamed from `worker` to `agent`, port/env unchanged
- **`package.json` (root)** — workspace updated from `worker` to `agent`
- **`openspec/specs/chat-worker-client/`** — spec updated (or renamed) to reflect agent terminology
- Dependencies added: `ai`, `@ai-sdk/groq`, `zod` (in agent package)
- Dependencies removed: `eventsource-parser` (replaced by AI SDK streaming)
