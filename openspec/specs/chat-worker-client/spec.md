# chat-worker-client Specification

## Purpose
Dedicated frontend API client module (`lib/chat/client.ts`) that consolidates all HTTP communication with the chat worker service, providing session CRUD and SSE streaming. The chat module also owns chat types and prompt definitions.

## Requirements

### Requirement: Dedicated chat worker API client
The frontend SHALL have a dedicated API client module (`lib/chat/client.ts`) that consolidates all HTTP communication with the chat worker service. This client SHALL be the single point of entry for session CRUD and SSE streaming. The chat module SHALL also own chat types and prompt definitions.

#### Scenario: Session creation through chat client
- **WHEN** a chat session needs to be created
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_URL}/sessions` with `project_id` and optional `dataset_id`
- **AND** the request SHALL use `ApiClient` from `@/shared/apiClient` with `withAuth` for auth handling
- **AND** return the created `ChatSession` object

#### Scenario: Turn logging through chat client
- **WHEN** a chat turn needs to be logged
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_URL}/sessions/${sessionId}/turns` with the turn payload
- **AND** the request SHALL use `ApiClient` from `@/shared/apiClient` with `withAuth` for auth handling

#### Scenario: Session retrieval through chat client
- **WHEN** a chat session is requested by ID
- **THEN** the chat client SHALL send a `GET` request to `${CHAT_URL}/sessions/${sessionId}`
- **AND** the request SHALL use `ApiClient` from `@/shared/apiClient` with `withAuth` for auth handling
- **AND** return the `ChatSession` object with its turns

#### Scenario: Session listing through chat client
- **WHEN** sessions are listed with optional filters
- **THEN** the chat client SHALL send a `GET` request to `${CHAT_URL}/sessions` with query parameters (`project_id`, `dataset_id`)
- **AND** the request SHALL use `ApiClient` from `@/shared/apiClient` with `withAuth` for auth handling
- **AND** return an array of `ChatSession` objects

### Requirement: SSE chat streaming through chat client
The chat client SHALL provide a `fetchChatStream()` function for initiating SSE chat streams with the worker service. This function SHALL use `withEagerAuth(fetch)` to proactively refresh tokens before establishing the stream.

#### Scenario: Chat stream request with eager auth
- **WHEN** `fetchChatStream()` is called with messages and table schema
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_URL}/chat` with `Content-Type: application/json`
- **AND** the request SHALL use `withEagerAuth(fetch)` to ensure fresh auth before streaming
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
- **THEN** it SHALL call `fetchChatStream()` from `@/chat` to get the Response
- **AND** call `readSSEStream()` from `ChatContext/services/chatStream` to parse the stream
- **AND** these two functions SHALL have no direct dependency on each other

### Requirement: Chat module owns types and prompts
The `lib/chat/` module SHALL export chat-related type definitions (`ToolCall`, `ToolDefinition`, `TableSchema`, `Message`, `CASE_OPERATIONS`) and prompt generation functions (`getSystemPrompt`, `getToolDefinitions`) that were previously in the `shared/chat/` workspace package.

#### Scenario: Frontend code imports chat types from @/chat
- **WHEN** frontend code needs `ToolCall`, `TableSchema`, or other chat types
- **THEN** it SHALL import from `@/chat/types` or `@/chat`
- **AND** the types SHALL be identical to those previously at `shared/chat/types.ts`

#### Scenario: Frontend code imports prompts from @/chat
- **WHEN** frontend code needs `getSystemPrompt` or `getToolDefinitions`
- **THEN** it SHALL import from `@/chat/prompts` or `@/chat`
- **AND** the functions SHALL be identical to those previously at `shared/chat/prompts.ts`
