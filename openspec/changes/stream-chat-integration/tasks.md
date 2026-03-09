## Phase 1: Backend — Stream Auth Token Endpoint

### 1. Configuration & Dependencies

- [x] 1.1 Add `STREAM_API_KEY` and `STREAM_API_SECRET` to `backend/app/config.py` Settings class (optional fields, default None)
- [x] 1.2 Add `PyJWT` to `backend/pyproject.toml` dependencies (for HS256 signing)
- [x] 1.3 Add `STREAM_API_KEY`, `STREAM_API_SECRET` to `docker-compose.yml` backend environment (empty defaults for dev)
- [x] 1.4 Add `VITE_STREAM_API_KEY` to `docker-compose.yml` frontend environment

### 2. Token Endpoint

- [x] 2.1 Create `backend/app/routers/stream_token.py` with `GET /api/auth/stream-token` — reads auth context, signs JWT with `{ user_id: user.id }` using STREAM_API_SECRET, returns `{ token }`. Follow existing router patterns.
- [x] 2.2 Mount stream token router in `backend/app/main.py`
- [x] 2.3 Write tests for stream token endpoint (authenticated returns token, unauthenticated returns 401, missing config returns 503)

## Phase 2: Frontend — Stream SDK Setup

### 3. Stream Client Initialization

- [x] 3.1 Install `stream-chat` and `stream-chat-react` packages in frontend workspace (`npm install stream-chat stream-chat-react -w frontend`)
- [x] 3.2 Create `frontend/src/lib/stream/StreamProvider.tsx` — initializes `StreamChat` client with `VITE_STREAM_API_KEY`, fetches Stream token from backend (`GET /api/auth/stream-token`), calls `client.connectUser()`. Wraps children in Stream's `<Chat>` provider.
- [x] 3.3 Add `StreamProvider` to the frontend provider tree (wrap inside `AuthProvider` so auth context is available for token fetch)
- [x] 3.4 Create `frontend/src/lib/stream/useStreamClient.ts` — hook to access the initialized Stream client from context

### 4. Session Context

- [x] 4.1 Create `frontend/src/lib/stream/useSessionContext.ts` — manages current Stream channel (project-scoped), exposes `currentChannel`, `createSession()`, `isFrozen`, `switchSession(channelId)`
- [x] 4.2 Implement channel creation: `client.channel("messaging", \`project_${projectId}_${uuid()}\`, { projectId, createdAt, frozenAt: null })` with `channel.watch()`
- [x] 4.3 Implement lazy freeze check: on session load, check last message timestamp > 24hr → set `frozenAt` via `channel.updatePartial()`
- [x] 4.4 Implement session auto-creation: when project loads and no active (non-frozen) channel exists for the project, create one automatically

## Phase 3: Chat Panel — Stream SDK Primitives

### 5. Replace Chat Panel with Stream Components

- [x] 5.1 Refactor `frontend/src/ui/components/ChatPanel/index.tsx` to render Stream SDK `ChannelList` (filtered by project), `Channel`, `MessageList`, and `MessageInput` instead of custom message list and input form
- [x] 5.2 Configure `ChannelList` filter: `{ type: "messaging", "custom.projectId": projectId }`, sort by `last_message_at` descending
- [x] 5.3 Visually distinguish frozen sessions in `ChannelList` (e.g., lock icon, muted style) using a custom channel preview component
- [x] 5.4 Disable `MessageInput` when `isFrozen` is true (conditionally render or use Stream's `channelConfig` to disable sends)
- [x] 5.5 Delete `frontend/src/ui/components/ChatPanel/MessageBubble.tsx`
- [x] 5.6 Delete `frontend/src/ui/components/ChatPanel/ChatEmptyState.tsx` (Stream SDK handles empty channel state)

### 6. SSE Overlay for Streaming

- [x] 6.1 Create `frontend/src/lib/stream/useSSEOverlay.ts` — hook that manages streaming state (`isStreaming`, `streamingContent`). Renders a temporary text block below Stream's `MessageList` during active SSE turns.
- [x] 6.2 Create `frontend/src/ui/components/ChatPanel/SSEOverlay.tsx` — simple component that shows streaming text with a cursor animation, positioned below the message list
- [x] 6.3 On SSE "done" event: clear overlay, write assistant message to Stream channel, overlay disappears as Stream message appears

## Phase 4: Chat Engine Refactor

### 7. Refactor useChatEngine for Stream

- [x] 7.1 Modify `useChatEngine` to build API message history from Stream channel messages (not in-memory `messages[]` state). Map Stream messages to `{ role, content, tool_calls }` format.
- [x] 7.2 Modify `handleSubmit`: user message goes to Stream channel first (`channel.sendMessage()`), then POST /chat is called with history from Stream + entity context
- [x] 7.3 Modify `handleSubmit` onDone callback: write assistant message to Stream channel with `custom.tool_calls` metadata (replacing `logChatTurn()` call)
- [x] 7.4 Remove `sessionIdRef` — session identity is now the Stream channel, managed by `useSessionContext`
- [x] 7.5 Delete `frontend/src/core/chat/services/sessionLogger.ts`
- [x] 7.6 Modify `registerDatasetId` to NOT reset session (remove `sessionIdRef.current = null` on line 109)

### 8. Entity Context Decoupling

- [x] 8.1 Create or refactor `useEntityContext` hook — tracks `projectId`, `entityType`, `entityId`, `tableSchema` independently of session state
- [x] 8.2 Wire `useEntityContext` into `useChatEngine` — `handleSubmit` reads entity context for the POST /chat payload instead of using `tableSchemaRef` directly
- [x] 8.3 Update `DatasetView` registration calls to use `useEntityContext` instead of `registerDatasetId` / `registerTableSchema`

## Phase 5: Table Panel — Operations Log

### 9. Operations Log Component

- [x] 9.1 Create `frontend/src/ui/components/TablePanel/OperationsLog.tsx` — subscribes to the active Stream channel, filters messages for `custom.tool_calls`, displays chronological log entries (tool name, key args, result, timestamp)
- [x] 9.2 Implement dedup logic: tool calls from SSE (immediate execution) are tracked by `tool_call.id`. When the same tool_call.id arrives from Stream (write-behind), skip re-execution but update the log entry as "persisted".
- [x] 9.3 Integrate `OperationsLog` into the Table Panel layout (collapsible panel, below or beside the table)
- [x] 9.4 On session switch (via ChannelList), clear and repopulate operations log from the new channel's messages

## Phase 6: Worker Cleanup

### 10. Delete Session Infrastructure

- [x] 10.1 Delete `worker/lib/sessions/redis-store.ts`
- [x] 10.2 Delete `worker/lib/sessions/s3-store.ts`
- [x] 10.3 Delete `worker/lib/sessions/flusher.ts`
- [x] 10.4 Delete `worker/lib/sessions/index.ts` (SessionManager)
- [x] 10.5 Delete `worker/lib/sessions/types.ts`
- [x] 10.6 Remove session CRUD routes from `worker/index.ts` (POST /sessions, POST /sessions/:id/turns, GET /sessions/:id, GET /sessions)
- [x] 10.7 Remove `SessionManager` instantiation and lifecycle (start/stop) from `worker/index.ts`
- [x] 10.8 Remove `REDIS_URL` and `S3_BUCKET_LOGS` from worker environment config
- [x] 10.9 Remove `ioredis` and S3 session-related dependencies from worker `package.json`

### 11. Docker Compose Cleanup

- [x] 11.1 Remove `redis` service from `docker-compose.yml`
- [x] 11.2 Remove `redis_data` volume from `docker-compose.yml`
- [x] 11.3 Remove `redis` from Worker's `depends_on` in `docker-compose.yml`
- [x] 11.4 Remove `REDIS_URL` from Worker environment in `docker-compose.yml`

## Phase 7: Testing & Verification

### 12. Tests

- [x] 12.1 Write frontend tests for `useSessionContext` — channel creation, freeze detection, session switching
- [x] 12.2 Write frontend tests for refactored `useChatEngine` — message flow through Stream, SSE overlay lifecycle, tool call metadata write-behind
- [x] 12.3 Write frontend tests for `OperationsLog` — filters tool calls from channel messages, dedup with SSE-delivered tool calls
- [x] 12.4 Verify existing Worker tests pass (POST /chat handler unchanged)
- [x] 12.5 Verify existing backend tests pass (no backend changes beyond stream token endpoint)
- [ ] 12.6 Manual E2E: send chat message → see in Stream MessageList → refresh page → see history → tool call appears in operations log → switch session → history updates
