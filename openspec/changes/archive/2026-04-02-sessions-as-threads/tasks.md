## 1. Database Schema & Models

- [x] 1.1 Create `ProjectMemoryRecord` ORM model in `backend/app/repositories/metadata/project_memory_record.py` (id, project_id, org_id, stream_channel_id, created_at) following existing conventions (UUIDv7 PK, String(36), indexes)
- [x] 1.2 Create `SessionRecord` ORM model in `backend/app/repositories/metadata/session_record.py` (id, memory_id, stream_thread_id, owner_id, title, org_id, created_at, last_active_at) with FK to project_memories
- [x] 1.3 Create Alembic migration for `project_memories` and `sessions` tables with indexes (ix_project_memories_org_id, ix_sessions_memory_id, ix_sessions_owner_id, ix_sessions_org_id, UNIQUE on project_id, UNIQUE on stream_channel_id)
- [x] 1.4 Register new ORM models in Alembic `env.py` imports

## 2. Outbox Event & Memory Provisioning

- [x] 2.1 Add `ProjectCreated` event class to `backend/app/repositories/outbox/events.py` with fields: project_id, org_id, created_by
- [x] 2.2 Add `submit_project_created_event()` method to `OutboxRepository`
- [x] 2.3 Register `ProjectCreated` in the `to_event()` mapping function
- [x] 2.4 Add `compactId` utility to backend (strip hyphens from UUID) for channel ID generation
- [x] 2.5 Create `provision_project_memory` use case in `backend/app/use_cases/project/` — creates Stream channel, inserts `project_memories` row, marks event processed
- [x] 2.6 Integrate memory provisioning into `create_project` use case — emit `ProjectCreated` event, call `provision_project_memory` synchronously
- [x] 2.7 Write backfill script to create `project_memories` rows for all existing projects

## 3. Memory & Session Repository Methods

- [x] 3.1 Add memory repository methods to `MetadataRepository`: `get_project_memory(project_id)`, `create_project_memory(project_id, org_id, stream_channel_id)`
- [x] 3.2 Add session repository methods to `MetadataRepository`: `create_session(memory_id, stream_thread_id, owner_id, org_id)`, `list_sessions(memory_id, org_id, cursor, limit)`, `get_session(session_id)`, `update_session(session_id, update_data)`

## 4. Session Management Use Cases

- [x] 4.1 Create `get_project_memory` use case — returns memory metadata for a project, validates org access
- [x] 4.2 Create `create_session` use case — sends root message to Stream channel (creating thread), inserts session row, returns session metadata
- [x] 4.3 Create `list_sessions` use case — queries sessions table by memory_id + org_id, cursor-paginated, ordered by last_active_at desc
- [x] 4.4 Create `update_session` use case — validates ownership, updates title and/or last_active_at

## 5. Backend API Endpoints

- [x] 5.1 Add `GET /api/projects/{project_id}/memory` route — returns stream_channel_id and created_at
- [x] 5.2 Add `POST /api/projects/{project_id}/sessions` route — creates session, returns 201
- [x] 5.3 Add `GET /api/projects/{project_id}/sessions` route — lists sessions with cursor pagination
- [x] 5.4 Add `PATCH /api/projects/{project_id}/sessions/{session_id}` route — updates title (owner-only)
- [x] 5.5 Add `GET /api/projects/{project_id}/datasets/search` route — searches datasets by name within project
- [x] 5.6 Add controller methods for memory and session endpoints in `HTTPController`

## 6. Backend Tests

- [x] 6.1 Test `ProjectCreated` outbox event creation and reconstruction
- [x] 6.2 Test `provision_project_memory` use case (happy path, idempotent, Stream failure)
- [x] 6.3 Test `create_project` integration with memory provisioning
- [x] 6.4 Test session CRUD use cases (create, list, update, ownership enforcement)
- [x] 6.5 Test `get_project_memory` use case (happy path, not found, org scoping)
- [x] 6.6 Test dataset search endpoint (single match, multiple matches, no matches, org scoping)

## 7. Frontend: Project Selection & Memory Resolution

- [x] 7.1 Add `useProjectMemory` query hook — calls `GET /api/projects/{project_id}/memory`, returns stream_channel_id
- [x] 7.2 Add project selection UI as chat entry point — display project picker when no project selected, gate chat access
- [x] 7.3 Update routing so navigating to chat area without a project shows the picker

## 8. Frontend: Session Management

- [x] 8.1 Add `useCreateSession` mutation hook — calls `POST /api/projects/{project_id}/sessions`
- [x] 8.2 Add `useSessions` query hook — calls `GET /api/projects/{project_id}/sessions` with cursor pagination
- [x] 8.3 Add `useUpdateSession` mutation hook — calls `PATCH /api/projects/{project_id}/sessions/{session_id}`
- [x] 8.4 Update `SessionList` component to query backend API instead of Stream `queryChannels`
- [x] 8.5 Update `SessionList` to display owner, title, and last_active_at for each session
- [x] 8.6 Implement inline title editing in session list (owner-only, optimistic updates)

## 9. Frontend: Chat Context Refactor

- [x] 9.1 Update `channelId.ts` — change format from `chat_{compactOrgId}_{sessionHash}` to `proj_{compactOrgId}_{compactProjectId}` for memory channels
- [x] 9.2 Refactor `useChatEngine` — replace `createChannel` with `createSession` (calls backend, watches thread), replace `loadChannel` with `loadSession` (loads thread within memory channel)
- [x] 9.3 Update `ChatContext` to manage session state (thread reference) instead of channel state
- [x] 9.4 Update entity context tracking to be per-session — context passed in chat requests, not stored on channel custom data
- [x] 9.5 Update "New Session" to create a new thread in the current project (not a new channel)
- [x] 9.6 Update title auto-set logic to call `PATCH /api/projects/{project_id}/sessions/{session_id}` instead of `channel.updatePartial`
- [x] 9.7 Remove session freezing UI and inactivity-related logic

## 10. Extended SSE Protocol & Dataset Resolution

- [x] 10.1 Add `r:` prefix support to agent SSE response — emit `r:{type, params}` followed by `d:{finishReason:"request"}`
- [x] 10.2 Add `resolve_dataset` request type to agent system prompt and tool definitions
- [x] 10.3 Update agent chat handler to accept `thread_id` and `project_id` in request payload
- [x] 10.4 Update frontend `readSSEStream` to handle `r:` prefix and `finishReason:"request"`
- [x] 10.5 Implement frontend fulfillment loop — receive `r:` request, fetch data from backend, re-submit chat with thread_id and resolved context
- [x] 10.6 Wire up `resolve_dataset` fulfillment — call dataset search endpoint, handle single/multiple/no matches
- [x] 10.7 Add error handling for unfulfillable requests — timeout, network errors, graceful agent fallback

## 11. Frontend Tests

- [x] 11.1 Test `useProjectMemory`, `useCreateSession`, `useSessions`, `useUpdateSession` hooks
- [x] 11.2 Test `SessionList` component with backend-sourced data
- [x] 11.3 Test `readSSEStream` handling of `r:` prefix and `finishReason:"request"`
- [x] 11.4 Test fulfillment loop for `resolve_dataset` (single match, multiple, error cases)

## 12. Agent Tests

- [x] 12.1 Test `r:` prefix emission for dataset resolution requests
- [x] 12.2 Test agent handles `thread_id` and `project_id` in request payload
- [x] 12.3 Test agent processes re-submitted request with resolved dataset schema
