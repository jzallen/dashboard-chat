## MODIFIED Requirements

### Requirement: Dedicated chat agent API client
The frontend SHALL have a dedicated API client module (`lib/chat/client.ts`) that consolidates all HTTP communication with the chat agent service. This client SHALL be the single point of entry for session CRUD and SSE streaming. The chat module SHALL also own chat types and prompt definitions.

#### Scenario: Session creation through chat client
- **WHEN** a chat session needs to be created
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_AGENT_URL}/sessions` with `project_id` and optional `dataset_id`
- **AND** the request SHALL use `ApiClient` from `@/shared/apiClient` with `withAuth` for auth handling
- **AND** return the created `ChatSession` object

#### Scenario: Turn logging through chat client
- **WHEN** a chat turn needs to be logged
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_AGENT_URL}/sessions/${sessionId}/turns` with the turn payload
- **AND** the request SHALL use `ApiClient` from `@/shared/apiClient` with `withAuth` for auth handling

#### Scenario: Session retrieval through chat client
- **WHEN** a chat session is requested by ID
- **THEN** the chat client SHALL send a `GET` request to `${CHAT_AGENT_URL}/sessions/${sessionId}`
- **AND** the request SHALL use `ApiClient` from `@/shared/apiClient` with `withAuth` for auth handling
- **AND** return the `ChatSession` object with its turns

#### Scenario: Session listing through chat client
- **WHEN** sessions are listed with optional filters
- **THEN** the chat client SHALL send a `GET` request to `${CHAT_AGENT_URL}/sessions` with query parameters (`project_id`, `dataset_id`)
- **AND** the request SHALL use `ApiClient` from `@/shared/apiClient` with `withAuth` for auth handling
- **AND** return an array of `ChatSession` objects

### Requirement: SSE chat streaming via chat agent client
The chat client SHALL provide a `fetchChatStream()` function for initiating SSE chat streams with the agent service. This function SHALL use `withEagerAuth(fetch)` to proactively refresh tokens before establishing the stream.

#### Scenario: Chat stream request with eager auth
- **WHEN** `fetchChatStream()` is called with messages and optional table schema
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_AGENT_URL}/chat` with `Content-Type: application/json`
- **AND** the request SHALL use `withEagerAuth(fetch)` to ensure fresh auth before streaming
- **AND** the request SHALL use `mode: "cors"`
- **AND** return the raw `Response` for AI SDK data stream consumption

#### Scenario: Chat stream with dataset context
- **WHEN** `fetchChatStream()` is called with `contextType: "dataset"` and `contextId: "ds-123"`
- **THEN** the request body SHALL include `{ messages, contextType: "dataset", contextId: "ds-123", tableSchema: <schema> }`

#### Scenario: Chat stream with view context omits tableSchema
- **WHEN** `fetchChatStream()` is called with `contextType: "view"` and `contextId: "view-456"`
- **THEN** the request body SHALL include `{ messages, contextType: "view", contextId: "view-456" }`
- **AND** `tableSchema` SHALL be omitted from the body

#### Scenario: Chat stream with null context
- **WHEN** `fetchChatStream()` is called with `contextType: null`
- **THEN** the request body SHALL include `{ messages, contextType: null, contextId: null }`
- **AND** `tableSchema` SHALL be omitted

#### Scenario: Chat stream error on non-OK response
- **WHEN** the chat stream response has a non-OK status
- **THEN** `fetchChatStream()` SHALL throw an `Error` with the HTTP status code

#### Scenario: Chat stream error on missing body
- **WHEN** the chat stream response has no body
- **THEN** `fetchChatStream()` SHALL throw an `Error` indicating no response body

### Requirement: SSE stream parsing reads AI SDK data stream format
The `readSSEStream()` function in `ChatContext/services/chatStream.ts` SHALL parse the AI SDK data stream format emitted by `toDataStreamResponse()`. The custom `{type: "content" | "tool_calls" | "done"}` format SHALL no longer be supported.

#### Scenario: Text content parsed from AI SDK stream
- **WHEN** a `0:"<token>"` line is received in the stream
- **THEN** `readSSEStream` SHALL decode the JSON string token
- **AND** accumulate it into the running content string
- **AND** call `handlers.onContent` with the accumulated content

#### Scenario: Tool calls parsed from AI SDK stream
- **WHEN** a `9:[{toolCallId, toolName, args}]` line is received
- **THEN** `readSSEStream` SHALL parse the tool call array
- **AND** store the tool calls for delivery at stream completion

#### Scenario: Stream completion via finish event
- **WHEN** a `d:{finishReason, usage}` line is received
- **THEN** `readSSEStream` SHALL call `handlers.onDone` with accumulated content and collected tool calls

#### Scenario: Stream parsing decoupled from API client
- **WHEN** `useChatEngine` needs to process an SSE stream
- **THEN** it SHALL call `fetchChatStream()` from `@/chat` to get the Response
- **AND** call `readSSEStream()` from `ChatContext/services/chatStream` to parse the stream
- **AND** these two functions SHALL have no direct dependency on each other

### Requirement: Chat module owns types and prompts
The `lib/chat/` module SHALL export chat-related type definitions (`ToolCall`, `TableSchema`, `Message`, `CASE_OPERATIONS`) and prompt generation functions (`getSystemPrompt`) that were previously in the `shared/chat/` workspace package. The `ToolDefinition` type and `getToolDefinitions` function SHALL no longer be exported from the frontend chat module, as tool definitions are now Zod-based and agent-internal.

#### Scenario: Frontend code imports chat types from @/chat
- **WHEN** frontend code needs `ToolCall`, `TableSchema`, or other chat types
- **THEN** it SHALL import from `@/chat/types` or `@/chat`
- **AND** the types SHALL be compatible with the AI SDK data stream tool call format

## RENAMED Requirements

### Requirement: Dedicated chat agent API client
FROM: Dedicated chat worker API client
TO: Dedicated chat agent API client

### Requirement: SSE chat streaming via chat agent client
FROM: SSE chat streaming through chat client
TO: SSE chat streaming via chat agent client
