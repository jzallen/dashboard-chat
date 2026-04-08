# ADR-004: SSE over WebSocket for Chat Streaming

## Status

Accepted

## Context and Problem Statement

Chat responses stream token-by-token with interleaved tool calls. The system needs a streaming protocol that delivers tokens from server to client efficiently while remaining compatible with standard HTTP infrastructure.

## Decision Drivers

- Unidirectional streaming pattern (server to client) after the initial request
- Compatibility with standard proxies, CDNs, and HTTP infrastructure
- No connection upgrade handshake required
- Native support in the Vercel AI SDK via `streamText().toDataStreamResponse()`

## Considered Options

1. **Server-Sent Events (SSE)** (selected)
2. **WebSocket**

### Option 1: SSE

- Good, because it is HTTP-native and works through standard proxies and CDNs
- Good, because it requires no connection upgrade handshake
- Good, because the Vercel AI SDK's `streamText().toDataStreamResponse()` produces SSE natively
- Good, because the chat pattern is inherently unidirectional (server to client) after the request
- Bad, because each message requires a new HTTP POST (no persistent connection)

### Option 2: WebSocket

- Good, because it supports bidirectional communication on a persistent connection
- Good, because it avoids repeated connection setup overhead
- Bad, because it requires a connection upgrade handshake
- Bad, because it has compatibility issues with some proxies and CDNs
- Bad, because the bidirectional capability is unnecessary for the chat streaming pattern

## Decision Outcome

Chosen option: **Server-Sent Events (SSE)**, because the chat pattern is inherently unidirectional after the initial request, and SSE is HTTP-native with no connection upgrade overhead, working natively with the Vercel AI SDK.

### Consequences

- **Good:** Simple HTTP-based streaming that works through standard infrastructure without special proxy configuration
- **Bad:** Each message requires a new HTTP POST; this is acceptable because chat messages are discrete request-response pairs. Real-time bidirectional features (typing indicators, presence) are handled by Stream.io instead

## Confirmation

Verify that chat token streaming works through the CDN/proxy layer without dropped connections. Confirm that the Vercel AI SDK SSE output is consumed correctly by the frontend.

## Related

- [ADR-001: Hono over Express for Chat Worker](adr-001-hono-over-express.md) -- Hono provides the SSE streaming runtime
