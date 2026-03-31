## Why

Chat messages are ephemeral — lost on page refresh. The team maintains ~570 lines of custom session infrastructure (Redis store, S3 JSONL archival, session flusher) with no UI for browsing conversation history. Users cannot revisit previous conversations, audit what operations were performed, or resume context after navigating away.

Stream.io provides managed chat persistence, real-time message delivery, and a React SDK with production-ready UI primitives (ChannelList, MessageList, MessageInput). By adopting Stream as the persistence and display layer, we eliminate custom session infrastructure, gain conversation history with zero custom UI, and introduce session browsing for audit purposes.

## What Changes

- **Replace custom session infrastructure with Stream.io** — Delete Redis store, S3 JSONL store, session flusher, and session manager (~456 lines in Worker). Remove Redis container from docker-compose. Messages persist in Stream channels.
- **Adopt Stream React SDK for chat display** — Replace custom ChatPanel components (MessageBubble, message list, input) with Stream's `ChannelList`, `MessageList`, and `MessageInput` primitives. Chat Panel renders pure conversation text; no custom message components needed.
- **Separate tool call display from chat** — Tool calls become metadata on assistant messages (`custom.tool_calls`). Chat Panel ignores this metadata and renders only text. Table Panel reads the same Stream channel, filters for messages with tool call metadata, and displays an operations log.
- **Scope sessions to projects, not datasets** — Sessions (Stream channels) are created per project, not per dataset. The active dataset/view/report is tracked separately as entity context and sent with each chat request to the Worker.
- **Add session lifecycle management** — Sessions freeze after 24 hours of inactivity (lazy check on access, application-enforced). Frozen sessions are read-only for audit. Users create new sessions for further changes.
- **Add Stream token minting endpoint** — Backend mints Stream JWT tokens using existing auth context, enabling the frontend to connect to Stream.
- **SSE streaming preserved** — Worker's POST /chat → Groq SSE streaming is unchanged. SSE delivers live tokens and tool calls to the frontend. Write-behind to Stream happens after turn completion.

## Capabilities

### New Capabilities
- `stream-chat-persistence`: Conversation messages persist in Stream.io channels. Users can browse session history via ChannelList, revisit past conversations, and see full message history on page refresh.
- `stream-chat-display`: Chat Panel uses Stream React SDK primitives for rendering conversation. Supports real-time message display, session switching, and message search via Stream's built-in features.
- `stream-auth-token`: Backend endpoint mints Stream JWT tokens for authenticated users, bridging existing auth (dev mode / WorkOS) to Stream's user model.
- `table-operations-log`: Table Panel reads tool call metadata from Stream channel messages and displays an operations log showing what table operations have been applied in the current session.
- `session-lifecycle`: Sessions are scoped to projects, freeze after 24 hours of inactivity (lazy on access), and are read-only once frozen. New sessions start from the current persisted table state.

### Modified Capabilities
- `chat-streaming`: SSE streaming from Worker to frontend is preserved. After turn completion, the frontend writes the assistant message (with tool call metadata) to the Stream channel as a write-behind operation.
- `entity-context-tracking`: Active dataset/view/report context is decoupled from session identity. Switching entities no longer resets the session. Entity context is sent with each POST /chat request for proper tool call generation.

### Removed Capabilities
- `redis-session-store`: Redis-backed session storage (2hr TTL, turn appending, active session tracking) is replaced by Stream persistence.
- `s3-session-archive`: S3 JSONL archival of sessions is replaced by Stream persistence.
- `session-flusher`: Periodic flushing of idle sessions from Redis to S3 is no longer needed.

## Impact

### Worker
- **Deleted**: Session manager, Redis store, S3 store, flusher (~456 lines), session CRUD routes
- **Deleted**: Redis dependency, S3 logs dependency
- **Unchanged**: POST /chat handler, Groq SSE streaming, chat prompts, tool definitions

### Frontend
- **New**: Stream React SDK integration (ChannelList, MessageList, MessageInput)
- **New**: SSE overlay hook for streaming text during active turns
- **New**: Table operations log component (reads tool_calls from Stream channel)
- **New**: Session context provider (current channel, session lifecycle)
- **Modified**: ChatPanel — replaced with Stream SDK primitives
- **Modified**: useChatEngine — hydrates from Stream on mount, writes to Stream on turn completion
- **Modified**: Entity context registration — decoupled from session identity
- **Deleted**: MessageBubble, ChatEmptyState, sessionLogger.ts

### Backend
- **New**: Stream token minting endpoint (~20 lines)
- **New**: Stream API key + secret in config/env vars

### Infrastructure
- **Deleted**: Redis container from docker-compose
- **Deleted**: redis_data volume
- **New**: Stream.io account (free tier for dev, $499/mo for production at 10K MAU)
- **New**: STREAM_API_KEY, STREAM_API_SECRET environment variables
