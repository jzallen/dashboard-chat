# NFR-M1: Chat Responsiveness

## Tag

M1 — Model: Performance

## Ambition

Deliver fast first-token response times for chat interactions so users experience a responsive modeling conversation.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Time from POST /chat to first SSE byte received by frontend |
| **Meter** | P95 latency over 100 requests during normal operation |
| **Must** | < 3 seconds |
| **Plan** | < 2 seconds |
| **Wish** | < 1 second |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Sends a chat message via POST /chat |
| **Environment** | Normal operation |
| **Artifact** | Chat worker (Hono SSE endpoint) |
| **Response** | System begins streaming response tokens via SSE |
| **Response Measure** | P95 first-byte latency < 3 s (Must) / < 2 s (Plan) / < 1 s (Wish) |

## Status

**Implemented** — Groq inference delivers sub-2s first token typically

## Verification Method

Measure P95 latency from POST /chat to first SSE byte received across 100 requests under normal load.

## Related

- [ADR-002: Groq over OpenAI](../decisions/adrs.md)
- [ADR-004: SSE Streaming](../decisions/adrs.md)
