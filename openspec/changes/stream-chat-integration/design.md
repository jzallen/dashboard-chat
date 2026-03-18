## Context

The platform has three services: React frontend (Vite), FastAPI backend, and Hono Worker. Chat currently flows as: Frontend POST /chat → Worker → Groq SSE → Frontend. Tool calls execute client-side against TanStack Table (7 sync tools) or the Backend API (11 async cleaning tools). Session infrastructure (Redis store, S3 archival, flusher) lives in the Worker.

The frontend tracks active dataset/view/report via `useChatEngine` refs (`datasetIdRef`, `projectIdRef`, `tableSchemaRef`). The dbt-layers feature added entity context awareness (datasets, views, reports within projects) but session identity is still tied to dataset — switching datasets resets the session.

Stream.io is a managed chat platform with a React SDK (`stream-chat-react`) providing `ChannelList`, `MessageList`, `MessageInput` components, and a Node/Python server SDK for token generation. Messages support `custom` data (arbitrary JSON) up to 5 KB total per message.

## Goals / Non-Goals

**Goals:**
- Replace custom session infrastructure with Stream.io managed persistence
- Provide session browsing and conversation history via Stream SDK primitives
- Separate tool call display (table panel) from conversation display (chat panel)
- Scope sessions to projects, allowing conversations to span datasets/views/reports
- Preserve SSE streaming for live token delivery and instant tool call execution

**Non-Goals:**
- Multi-user collaboration within a session (future feature)
- Tool call replay to reconstruct table state on page refresh (table state comes from backend transforms + staging SQL)
- Migrating existing S3 JSONL session logs into Stream (let them age out)
- Using Stream's AI features (AIStates, StreamingMessageView) — we use SSE overlay instead

## Decisions

### D1: MVVM Pattern — Stream as Model, Worker as ViewModel, Stream SDK as View

**Decision:** Adopt an MVVM architecture where Stream.io is both the persistence layer (Model) and the rendering layer (View via React SDK). The Worker remains the ViewModel (receives messages, calls Groq, returns tool calls). SSE is the operational channel for live turns; Stream is the persistence and display channel for history.

**Rationale:**
- Stream SDK primitives (ChannelList, MessageList, MessageInput) handle 80%+ of chat UI with zero custom components
- Stream persistence eliminates all custom session infrastructure (456 lines)
- SSE remains for instant tool call delivery — Stream's round-trip latency (200-500ms for message.new) is too slow for table operations
- The Worker stays stateless and has no Stream dependency

**Alternative rejected:** Stream-only (no SSE). Would add 200-500ms latency to every tool call due to Stream round-trip. Also requires Worker to have Stream SDK dependency and manage progressive message updates (rate limit concerns at 50-100 tokens/sec).

### D2: Tool Calls as Metadata on Assistant Messages, Not Separate Messages

**Decision:** Tool calls are stored in `custom.tool_calls` on the assistant's Stream message. The Chat Panel ignores `custom` and renders only `text`. The Table Panel reads `custom.tool_calls` for its operations log.

**Rationale:**
- Keeps message count 1:1 with conversation turns (no proliferation of tool-call-only messages)
- Chat Panel uses Stream's default text rendering — zero custom message components
- Tool call payloads are small (~200-500 bytes) and fit within the 5 KB message limit alongside assistant text
- Table Panel can query channel messages and filter client-side for those with `custom.tool_calls`

**Data format:**
```json
{
  "text": "I've filtered the table to show rows where age > 25.",
  "user": { "id": "assistant" },
  "custom": {
    "tool_calls": [
      {
        "name": "filterTable",
        "args": { "column": "age", "operator": ">", "value": 25 },
        "result": "Filtered age > 25"
      }
    ]
  }
}
```

### D3: Session Scoped to Project, Entity Context Tracked Separately

**Decision:** Stream channels (sessions) are created per project, not per dataset. The active entity (dataset/view/report) is tracked in a separate `useEntityContext` hook and sent with each POST /chat request.

**Rationale:**
- Users working with dbt layers naturally move between datasets, views, and reports within a project. Session-per-dataset would fragment conversations.
- The Worker only needs the current entity's table schema — it doesn't care about session scope.
- `registerDatasetId()` currently resets `sessionIdRef` to null (line 108-110 in useChatEngine.tsx). This behavior is removed; entity changes no longer trigger session resets.

**Channel ID format:** `project_{projectId}_{sessionUUID}`

### D4: Lazy Session Freezing (Check on Access)

**Decision:** Sessions freeze lazily — when a user opens a session, the application checks the last message timestamp. If > 24 hours ago, it sets `frozenAt` on the channel's custom data and renders read-only.

**Rationale:**
- No background job or cron needed (simpler infrastructure)
- Nobody cares if a session is frozen until someone looks at it
- Stream channels persist indefinitely regardless of frozen state — freezing is a UI/application concern

**Implementation:**
```typescript
const lastMessage = channel.state.messages[channel.state.messages.length - 1];
const isStale = Date.now() - lastMessage.created_at > 24 * 60 * 60 * 1000;
if (isStale && !channel.data.frozenAt) {
  await channel.updatePartial({ set: { frozenAt: new Date().toISOString() } });
}
```

### D5: SSE Overlay for Streaming Text, Not Stream AI Features

**Decision:** During an active SSE turn, the Chat Panel shows a temporary overlay component below the Stream MessageList with the streaming assistant text. When the turn completes and the message is written to Stream, the overlay disappears.

**Rationale:**
- Stream's AI features (AIStates, StreamingMessageView) require the Worker to progressively update a Stream message, which means 50-100 API calls/second during streaming — rate limit and latency concerns
- SSE overlay is purely local (no API calls, no latency)
- The transition from overlay to Stream message is a brief moment; acceptable UX tradeoff
- Keeps the Worker completely decoupled from Stream

**Implementation:** A `useSSEOverlay` hook in the Chat Panel manages the overlay state. It renders a simple streaming text component at the bottom of the MessageList when `isStreaming` is true. On turn completion, it clears the overlay and the Stream message appears via the channel subscription.

### D6: Frontend Writes to Stream (Not Worker)

**Decision:** The frontend writes both user and assistant messages to Stream. The Worker has no Stream dependency.

**Rationale:**
- The frontend is the only place that has both the LLM response AND tool execution results
- Mirrors the current `sessionLogger.ts` fire-and-forget pattern
- Keeps the Worker stateless — it receives messages, calls Groq, streams back
- The Stream React SDK is already loaded in the frontend; no additional dependency needed
- Risk: if the browser closes before write-behind completes, the last turn is lost. Acceptable — the turn's side effects (cleaning transforms) are already persisted via the Backend API.

### D7: Stream Auth via Backend Token Minting

**Decision:** The Backend mints Stream JWT tokens via a `GET /api/auth/stream-token` endpoint using the existing auth context.

**Rationale:**
- Stream requires server-side token signing (the API secret must not be exposed to the frontend)
- The Backend already has auth middleware that validates Bearer tokens and extracts user identity
- The token endpoint is ~20 lines of code using PyJWT (HS256 signing with Stream secret)
- No need for the `stream-chat` Python SDK — JWT signing is trivial

**Token payload:** `{ "user_id": "<user.id>" }` signed with `STREAM_API_SECRET` using HS256.

### D8: No Migration of Existing S3 Session Logs

**Decision:** Existing JSONL session logs in S3 are not migrated to Stream. They remain in S3 and age out naturally.

**Rationale:**
- Session logs are debug/audit artifacts, not user-facing history (no UI ever displayed them)
- Migration would require parsing JSONL, mapping to Stream messages, creating channels — significant effort for data nobody has accessed
- Once the new system is live, all new sessions are in Stream

## Component Architecture

```
┌────────────────────────────────────────────────────────────┐
│                       FRONTEND                              │
│                                                             │
│  ┌────────────────┐  ┌─────────────────────────────────┐   │
│  │ StreamProvider  │  │  useSessionContext()             │   │
│  │ (StreamChat     │  │  - currentChannel               │   │
│  │  client init)   │  │  - createSession()              │   │
│  └────────────────┘  │  - isFrozen                      │   │
│                       │  - freezeIfStale()               │   │
│                       └─────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────┐  ┌────────────────────────────┐  │
│  │ Chat Panel            │  │ Table Panel                 │  │
│  │                       │  │                             │  │
│  │ Stream SDK:           │  │ TanStack Table (unchanged)  │  │
│  │  ChannelList          │  │                             │  │
│  │  MessageList          │  │ useOperationsLog():         │  │
│  │  MessageInput ────────│──│─► channel.on("message.new") │  │
│  │                       │  │   filter custom.tool_calls  │  │
│  │ useSSEOverlay():      │  │   display log entries       │  │
│  │  streaming text       │  │                             │  │
│  │  during active turn   │  │ Tool execution:             │  │
│  │                       │  │  SSE → executeToolCalls()   │  │
│  └──────────────────────┘  └────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ useEntityContext()                                    │  │
│  │  projectId, entityType, entityId, tableSchema         │  │
│  │  (unchanged by session switches)                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ useChatEngine() (refactored)                          │  │
│  │  - Hydrates messages from Stream channel on mount     │  │
│  │  - Sends POST /chat with Stream history + entity ctx  │  │
│  │  - Writes assistant msg to Stream on turn completion  │  │
│  │  - Manages SSE overlay state                          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬──────────────────────────┘
                                  │
                    SSE (POST /chat, unchanged)
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                       WORKER                                 │
│                                                              │
│  POST /chat → handleChat() → Groq SSE → Response stream     │
│  (NO changes. NO Stream dependency. NO session management.)  │
│                                                              │
│  DELETED: session routes, SessionManager, Redis store,       │
│           S3 store, flusher, Redis/S3 config                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       BACKEND                                │
│                                                              │
│  NEW: GET /api/auth/stream-token                             │
│       → validates Bearer token                               │
│       → signs Stream JWT with STREAM_API_SECRET              │
│       → returns { token: "..." }                             │
│                                                              │
│  NEW config: STREAM_API_KEY, STREAM_API_SECRET               │
│                                                              │
│  Everything else unchanged.                                  │
└─────────────────────────────────────────────────────────────┘
```
