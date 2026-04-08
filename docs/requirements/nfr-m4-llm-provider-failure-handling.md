# NFR-M4: LLM Provider Failure Handling

## Tag

M4 — Model: Reliability

## Ambition

Ensure users receive clear, timely feedback when the LLM provider is unavailable, preventing silent hangs in the chat interface.

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | Groq API |
| **Stimulus** | Returns 500, times out, or is unreachable |
| **Environment** | Normal operation with degraded external dependency |
| **Artifact** | Chat worker (Hono SSE endpoint) |
| **Response** | User receives a clear error message in the chat within 5 seconds; SSE connection closed cleanly |
| **Response Measure** | Error displayed within 5 s; no silent hang |

## Status

**Not implemented** — no timeout or fallback mechanism

## Verification Method

Simulate Groq API failures (500 response, timeout, network unreachable) and verify that the user receives an error message within 5 seconds and the SSE connection is closed cleanly.

## Related

- [ADR-002: Groq over OpenAI](../decisions/adrs.md)
