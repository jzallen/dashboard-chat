## Purpose

Describes the frontend's chat-agent client — the browser-side module that POSTs chat requests, uses `withEagerAuth` to ensure fresh tokens before streaming, and returns the raw `Response` for AI SDK data-stream consumption. It is the sole entry point the UI uses to open a chat stream against the agent service.

## Requirements

### Requirement: SSE chat streaming via chat agent client

The chat client SHALL provide a `fetchChatStream()` function for initiating SSE chat streams with the agent service. This function SHALL use `withEagerAuth(fetch)` to proactively refresh tokens before establishing the stream.

#### Scenario: Chat stream request with eager auth

- **WHEN** `fetchChatStream()` is called with messages and optional table schema
- **THEN** the chat client SHALL send a `POST` request to `${CHAT_AGENT_URL}/chat` with `Content-Type: application/json`
- **AND** the request SHALL use `withEagerAuth(fetch)` to ensure fresh auth before streaming
- **AND** the request SHALL use `mode: "cors"`
- **AND** return the raw `Response` for AI SDK data stream consumption

#### Scenario: Chat stream includes contextType and contextId

- **WHEN** `fetchChatStream()` is called with `contextType: "dataset"` and `contextId: "ds-123"`
- **THEN** the request body SHALL include `{ messages, contextType: "dataset", contextId: "ds-123", tableSchema: <schema> }`

#### Scenario: Chat stream with view context omits tableSchema

- **WHEN** `fetchChatStream()` is called with `contextType: "view"` and `contextId: "view-456"`
- **THEN** the request body SHALL include `{ messages, contextType: "view", contextId: "view-456" }`
- **AND** `tableSchema` SHALL be omitted from the body

#### Scenario: Chat stream with null context sends null fields

- **WHEN** `fetchChatStream()` is called with `contextType: null`
- **THEN** the request body SHALL include `{ messages, contextType: null, contextId: null }`
- **AND** `tableSchema` SHALL be omitted

#### Scenario: tableSchema is optional in the request type

- **WHEN** `fetchChatStream()` type signature is inspected
- **THEN** `tableSchema` SHALL be an optional parameter (not required when `contextType` is null or "view")

#### Scenario: Chat stream error on non-OK response

- **WHEN** the chat stream response has a non-OK status
- **THEN** `fetchChatStream()` SHALL throw an `Error` with the HTTP status code

#### Scenario: Chat stream error on missing body

- **WHEN** the chat stream response has no body
- **THEN** `fetchChatStream()` SHALL throw an `Error` indicating no response body
