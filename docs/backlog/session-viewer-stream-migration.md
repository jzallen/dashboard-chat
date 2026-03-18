# Session Viewer: Migrate from Worker REST API to Stream Chat SDK

## Context

The `SessionList` and `SessionViewer` components (`frontend/src/ui/components/SessionViewer/`) still call the worker's REST API (`/sessions`, `/sessions/:id`) to list and display chat sessions. These endpoints were never implemented — the worker only has `/health` and `/chat` routes. Session persistence was moved to Stream Chat (channels + messages), but the viewer components were never updated to read from Stream.

The chat engine (`useChatEngine.tsx`) already writes messages to Stream channels via `writeToStream()` and reads history via `buildApiMessages()`. The `SessionViewer` just needs to use the same Stream SDK instead of the REST client.

## Current State

- `SessionList.tsx` calls `chatClient.listSessions(datasetId)` → `GET /worker/sessions?dataset_id=...` → 404
- `SessionViewer/index.tsx` calls `chatClient.getSession(sessionId)` → `GET /worker/sessions/:id` → 404
- Both create a `chatClient` via `createChatClient(withAuth(fetch))` which targets the worker
- Stream Chat is already connected and working (channels are created, messages are persisted)

## Changes

### 1. Replace REST calls with Stream SDK queries in `SessionList`

Use `StreamChat.queryChannels()` to list channels filtered by `projectId` and `datasetId` (stored as custom channel fields). Remove the `chatClient` dependency.

### 2. Replace REST calls with Stream SDK in `SessionViewer`

Use `channel.query()` to load a specific channel's message history. Render messages from Stream's message format instead of the `ChatTurn` type.

### 3. Remove unused `chatClient` methods

Remove `listSessions`, `getSession`, `createSession`, and `logTurn` from `frontend/src/core/chat/client.ts` — these target worker endpoints that don't exist. The `fetchChatStream` method stays (it's the SSE streaming endpoint that does exist).

### 4. Clean up related types

`ChatSession` and `ChatTurn` types in `frontend/src/core/chat/client.ts` can be removed once the viewer uses Stream's native types.

## Files

- `frontend/src/ui/components/SessionViewer/SessionList.tsx`
- `frontend/src/ui/components/SessionViewer/index.tsx`
- `frontend/src/core/chat/client.ts`
