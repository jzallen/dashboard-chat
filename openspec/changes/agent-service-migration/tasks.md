## 1. Rename Worker Service to Agent

- [x] 1.1 Rename `worker/` directory to `agent/` and update root `package.json` workspace entry from `"worker"` to `"agent"`
- [x] 1.2 Update `agent/package.json`: rename package from `dashboard-chat-worker` to `dashboard-chat-agent`, update `name` field
- [x] 1.3 Update `docker-compose.yml`: rename service `worker` → `agent`, container `dashboard-worker` → `dashboard-agent`, update image tag
- [x] 1.4 Update all Bazel `BUILD.bazel` files: rename `//worker:*` targets to `//agent:*`
- [x] 1.5 Update `MODULE.bazel` and `.bazelrc` if they reference the worker package path
- [x] 1.6 Update `turbo.json` if it references the worker workspace
- [x] 1.7 Update `.devcontainer/devcontainer.json` and any CI workflow files referencing `worker` service or directory

## 2. Add Vercel AI SDK Dependencies

- [x] 2.1 Add `ai` and `@ai-sdk/groq` to `agent/package.json` dependencies
- [x] 2.2 Add `zod` to `agent/package.json` dependencies (if not already present)
- [x] 2.3 Remove `eventsource-parser` from `agent/package.json` dependencies
- [x] 2.4 Run `npm install` at repo root to update the lockfile

## 3. Rewrite Agent Chat Handler with AI SDK

- [x] 3.1 Create `agent/lib/chat/tools.ts`: define all 18 tools using Zod schemas and AI SDK `tool()` helper, exported via `getTools(tableSchema: TableSchema)` factory function
- [x] 3.2 Rewrite `agent/lib/chat/handleChat.ts`: replace `SSEStreamWriter` and `streamLLMResponse` with `streamText` from `ai` + `toDataStreamResponse()`; remove `ChatClient` interface and `ChatCompletionRequest` type
- [x] 3.3 Delete `agent/lib/chat/clients/groq.ts` (replaced by `@ai-sdk/groq` provider)
- [x] 3.4 Update `agent/lib/chat/index.ts` exports to reflect removed/renamed modules
- [x] 3.5 Update `agent/index.ts` (Hono routes) to remove `GroqChatClient` instantiation; pass provider config to `handleChat` instead

## 4. Update Shared Chat Package

- [x] 4.1 Remove `ToolDefinition` type and `getToolDefinitions` function from `shared/chat/prompts.ts` (now agent-internal Zod tools)
- [x] 4.2 Remove `getSystemPrompt` from `shared/chat/` if it has been fully moved to `agent/lib/chat/prompts.ts` (verify no other consumers)
- [x] 4.3 Retain `Message` type in `shared/chat/types.ts` if still used by both agent and frontend; otherwise consolidate into `frontend/src/core/chat/types.ts`
- [x] 4.4 Update `shared/chat/index.ts` exports to reflect removals

## 5. Update Frontend: Env Var and Client Rename

- [x] 5.1 Rename env var `VITE_CHAT_WORKER_URL` → `VITE_CHAT_AGENT_URL` in `frontend/.env*` files and `frontend/src/http/config.ts` (or wherever `CHAT_BASE_URL` is sourced)
- [x] 5.2 Update `frontend/src/core/chat/client.ts`: rename module comment "Chat Worker API Client" → "Chat Agent API Client"; update any `workerClient` variable names to `agentClient` in call sites
- [x] 5.3 Update `frontend/src/ui/context/ChatContext` (or equivalent): rename internal references from worker to agent

## 6. Update Frontend: SSE Stream Parser for AI SDK Format

- [x] 6.1 Rewrite `frontend/src/core/chat/services/chatStream.ts`: replace custom `{type: "content"|"tool_calls"|"done"|"error"}` parsing with AI SDK data stream line parsing (`0:` text delta, `9:` tool call, `d:` finish, `e:` step finish)
- [x] 6.2 Update `SSEHandlers` interface if signatures change (e.g. `onToolCall` vs accumulating into `onDone`)
- [x] 6.3 Ensure `ToolCall` type in `frontend/src/core/chat/types.ts` is compatible with AI SDK `{toolCallId, toolName, args}` format (rename fields if needed)

## 7. Update Tests

- [x] 7.1 Delete `agent/test/chat/clients/groq.test.ts` (client removed)
- [x] 7.2 Rewrite `agent/test/chat/handleChat.test.ts`: mock `streamText` from `ai`; assert `toDataStreamResponse()` is returned; test request validation
- [x] 7.3 Rewrite `agent/test/chat/prompts.test.ts` → `agent/test/chat/tools.test.ts`: assert Zod tool schemas have correct structure for representative tools; verify `getTools()` factory builds column enums correctly
- [x] 7.4 Rewrite `frontend/src/core/chat/__tests__/chatStream.test.ts`: update fixtures from custom SSE format to AI SDK data stream format; verify `onContent`, `onDone`, and tool call scenarios
- [x] 7.5 Update `frontend/src/core/chat/__tests__/chat.test.ts` if it references worker terminology or old SSE event shapes

## 8. Terminology Sweep

- [x] 8.1 Search for `worker` (case-insensitive) across `frontend/src/`, `agent/`, `shared/` and update all remaining references to `agent` (comments, JSDoc, variable names, log messages)
- [x] 8.2 Search for `CHAT_WORKER` across all files and replace with `CHAT_AGENT`
- [x] 8.3 Update `openspec/specs/chat-worker-client/` — rename the spec directory to `chat-agent-client/` to match the new terminology (or note this is handled at archive/sync time)
- [x] 8.4 Update `docs/DESIGN.md` and any other docs referencing the worker service

## 9. Verification

- [x] 9.1 Run `npm run build` from repo root — verify agent and frontend build cleanly
- [x] 9.2 Run `npm run test` — verify all JS tests pass (agent + frontend)
- [x] 9.3 Run `cd backend && uv run pytest` — verify no backend tests broken by rename
- [x] 9.4 Run `docker compose up` and verify agent service starts, health endpoint responds, and a chat message streams successfully end-to-end
- [x] 9.5 Run `bazel build //...` and `bazel test //...` — verify Bazel targets resolve correctly after rename
