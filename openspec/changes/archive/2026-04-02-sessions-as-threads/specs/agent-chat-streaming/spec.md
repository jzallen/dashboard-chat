## MODIFIED Requirements

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
