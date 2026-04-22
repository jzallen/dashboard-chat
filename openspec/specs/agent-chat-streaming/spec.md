## Purpose

Provides the agent service's chat-streaming capability — the LLM loop that turns user chat requests and table schema into a streaming response with typed tool calls. It standardises on the Vercel AI SDK (Groq provider, Zod-typed tool definitions) so the frontend consumes a well-defined data stream.

## Requirements

### Requirement: Agent service uses Vercel AI SDK for chat streaming
The agent service SHALL use the Vercel AI SDK (`ai` package with `@ai-sdk/groq` provider) for all LLM interactions. The custom `GroqChatClient` class and `SSEStreamWriter` class SHALL be removed. The `eventsource-parser` dependency SHALL be removed.

#### Scenario: Chat request handled by streamText
- **WHEN** the agent receives a `POST /chat` request with `messages` and `tableSchema`
- **THEN** the agent SHALL call `streamText` from the `ai` package with the `@ai-sdk/groq` provider
- **AND** SHALL pass the system prompt, conversation messages, and Zod-typed tool definitions
- **AND** SHALL return `result.toDataStreamResponse()` as the HTTP response

#### Scenario: Model configuration
- **WHEN** the agent initialises the Groq provider
- **THEN** it SHALL use model `llama-3.3-70b-versatile`
- **AND** temperature SHALL be `0.4` and maxTokens SHALL be `1024`
- **AND** the GROQ_API_KEY environment variable SHALL be passed to the provider constructor

### Requirement: Tool definitions use Zod schemas via AI SDK tool() helper
The agent service SHALL define all chat tools using the AI SDK `tool()` helper with Zod parameter schemas. Plain JSON Schema tool definitions SHALL be removed. Tool definitions SHALL be exported from `agent/lib/chat/tools.ts` via a `getTools(tableSchema: TableSchema)` factory function that builds column-specific enum constraints at request time.

#### Scenario: Type-safe tool parameters
- **WHEN** a tool definition is created for a column-specific operation (e.g. `filterTable`)
- **THEN** the column parameter SHALL use `z.enum(columnIds as [string, ...string[]])` built from the live table schema
- **AND** the tool SHALL be defined with `tool({ description, parameters })` from the `ai` package
- **AND** TypeScript SHALL infer the parameter types from the Zod schema at compile time

#### Scenario: Tool definitions passed to streamText
- **WHEN** `streamText` is called to handle a chat request
- **THEN** the `tools` option SHALL receive the result of `getTools(tableSchema)`
- **AND** `toolChoice` SHALL be `"auto"`

### Requirement: Agent response uses AI SDK data stream format

The agent service SHALL respond with the AI SDK data stream format via `toDataStreamResponse()`. The format is extended with a new `r:` prefix for agent-initiated data requests.

#### Scenario: Streaming text content

- **WHEN** the LLM streams text tokens
- **THEN** the response SHALL emit `0:"<token>"` lines per the AI SDK data stream protocol
- **AND** the response Content-Type SHALL be `text/plain; charset=utf-8` with the `x-vercel-ai-data-stream: v1` header set by `toDataStreamResponse()`

#### Scenario: Streaming tool calls

- **WHEN** the LLM emits a tool call
- **THEN** the response SHALL emit a `9:[{toolCallId, toolName, args}]` line per the AI SDK data stream protocol
- **AND** the complete tool call SHALL be emitted as a single event after streaming is complete

#### Scenario: Stream completion

- **WHEN** the LLM finishes generating
- **THEN** the response SHALL emit `e:{finishReason, usage, isContinued}` followed by `d:{finishReason, usage}`
- **AND** the stream SHALL close cleanly

#### Scenario: Agent emits data request

- **WHEN** the LLM determines it needs additional context (e.g., dataset schema)
- **THEN** the agent SHALL emit `r:{"type":"<request_type>","params":{...}}`
- **AND** the agent SHALL emit `d:{"finishReason":"request"}` immediately after
- **AND** the stream SHALL close

#### Scenario: Request finish reason distinguishes from normal completion

- **WHEN** the stream finishes with `finishReason:"request"`
- **THEN** the frontend SHALL treat this as "pending fulfillment" rather than "conversation complete"
- **AND** the frontend SHALL fulfill the request and re-submit

#### Scenario: LLM error during streaming

- **WHEN** the Groq API returns an error or the stream fails
- **THEN** the agent SHALL emit an error event in the AI SDK data stream format
- **AND** the HTTP response status SHALL reflect the error (non-2xx or stream-level error)
