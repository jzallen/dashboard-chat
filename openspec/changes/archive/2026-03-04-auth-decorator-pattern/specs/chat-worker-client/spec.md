## ADDED Requirements

### Requirement: Dedicated chat worker API client
The frontend SHALL have a dedicated API client module (`lib/api/chatClient.ts`) that consolidates all HTTP communication with the chat worker service. This client SHALL be the single point of entry for session CRUD and SSE streaming.

#### Scenario: Session creation through chat client
- **WHEN** a chat session needs to be created
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_URL}/sessions` with `project_id` and optional `dataset_id`
- **AND** the request SHALL use `withAuth(fetch)` for auth handling
- **AND** return the created `ChatSession` object

#### Scenario: Turn logging through chat client
- **WHEN** a chat turn needs to be logged
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_URL}/sessions/${sessionId}/turns` with the turn payload
- **AND** the request SHALL use `withAuth(fetch)` for auth handling

#### Scenario: Session retrieval through chat client
- **WHEN** a chat session is requested by ID
- **THEN** the chat client SHALL send a `GET` request to `${CHAT_URL}/sessions/${sessionId}`
- **AND** the request SHALL use `withAuth(fetch)` for auth handling
- **AND** return the `ChatSession` object with its turns

#### Scenario: Session listing through chat client
- **WHEN** sessions are listed with optional filters
- **THEN** the chat client SHALL send a `GET` request to `${CHAT_URL}/sessions` with query parameters (`project_id`, `dataset_id`)
- **AND** the request SHALL use `withAuth(fetch)` for auth handling
- **AND** return an array of `ChatSession` objects

### Requirement: SSE chat streaming through chat client
The chat client SHALL provide a `fetchChatStream()` function for initiating SSE chat streams with the worker service. This function SHALL use `withPreAuth(fetch)` to proactively refresh tokens before establishing the stream.

#### Scenario: Chat stream request with pre-auth
- **WHEN** `fetchChatStream()` is called with messages and table schema
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_URL}/chat` with `Content-Type: application/json`
- **AND** the request SHALL use `withPreAuth(fetch)` to ensure fresh auth before streaming
- **AND** the request SHALL use `mode: "cors"`
- **AND** return the raw `Response` for SSE stream consumption

#### Scenario: Chat stream error on non-OK response
- **WHEN** the chat stream response has a non-OK status
- **THEN** `fetchChatStream()` SHALL throw an `Error` with the HTTP status code

#### Scenario: Chat stream error on missing body
- **WHEN** the chat stream response has no body
- **THEN** `fetchChatStream()` SHALL throw an `Error` indicating no response body

### Requirement: SSE stream parsing remains in ChatContext
The `readSSEStream()` function and `SSEHandlers` interface SHALL remain in `ChatContext/services/chatStream.ts`. Stream parsing is a UI concern (it dispatches to React state updaters), not an API client concern.

#### Scenario: Stream parsing decoupled from API client
- **WHEN** `useChatEngine` needs to process an SSE stream
- **THEN** it SHALL call `fetchChatStream()` from `lib/api/chatClient` to get the Response
- **AND** call `readSSEStream()` from `ChatContext/services/chatStream` to parse the stream
- **AND** these two functions SHALL have no direct dependency on each other

### Requirement: Backward-compatible sessions re-export
During migration, `lib/api/sessions.ts` SHALL re-export all public symbols from `lib/api/chatClient.ts` to maintain backward compatibility with existing import paths.

#### Scenario: Existing sessions imports resolve
- **WHEN** code imports `createSession`, `logTurn`, `getSession`, or `listSessions` from `lib/api/sessions`
- **THEN** the imports SHALL resolve to the implementations in `lib/api/chatClient.ts` via re-exports
- **AND** the re-exports SHALL be marked `@deprecated`
