# ADR-001: Hono over Express for Chat Worker

## Status

Accepted

## Context and Problem Statement

The chat agent needs a lightweight HTTP framework that handles SSE streaming efficiently and can deploy to edge runtimes (Cloudflare Workers). The framework must support Web Standard APIs natively and provide middleware for common concerns like CORS and authentication.

## Decision Drivers

- Edge runtime compatibility (Cloudflare Workers) without polyfills
- Native support for Web Standard Request/Response APIs
- Built-in SSE streaming support for chat token delivery
- Middleware availability for CORS and auth

## Considered Options

1. **Hono** (selected)
2. **Express**

### Option 1: Hono

- Good, because it is built for edge runtimes with zero Node.js-specific APIs
- Good, because it has native Request/Response support (Web Standards)
- Good, because it includes middleware for CORS and auth out of the box
- Bad, because it has less ecosystem support than Express

### Option 2: Express

- Good, because it has a large ecosystem with extensive middleware
- Good, because it is widely known and well-documented
- Bad, because it requires polyfills for Cloudflare Workers deployment
- Bad, because it has no native streaming support

## Decision Outcome

Chosen option: **Hono**, because it is purpose-built for edge runtimes with native Web Standard support and SSE streaming, eliminating the need for polyfills required by Express.

### Consequences

- **Good:** Worker code uses Web API patterns (`new Response()`, `ReadableStream`) rather than Node.js streams, ensuring portability across runtimes
- **Bad:** Hono's middleware API differs from Express -- simpler but with less ecosystem support

## Confirmation

Chat worker deploys to edge runtimes without polyfills. SSE streaming works natively via `ReadableStream` without Node.js stream adapters.

## Related

- [ADR-004: SSE over WebSocket for Chat Streaming](adr-004-sse-over-websocket.md) -- both address the streaming architecture
- [ADR-010: Bazel over Pure Turborepo](adr-010-bazel-over-pure-turborepo.md) -- build system for the worker
