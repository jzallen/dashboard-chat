# Slice 02 — End-to-end correlation id

**Story:** US-1 · **Sub-job:** SJ-1 · **Surface:** cross-cutting · **Effort:** ~1 day

## Goal (one sentence)
Mint one correlation id at the auth-proxy ingress and propagate + bind it through every downstream service so all log lines for a request share it and it appears on error responses.

## IN scope
- Mint a correlation id at the auth-proxy ingress (generalize `app.ts:958`) when absent on `x-request-id`/`x-correlation-id`; reuse when present.
- Propagate it as a header on every upstream hop (auth-proxy → backend/agent/ui-state).
- Bind it per-request: `AsyncLocalStorage` (Node services) / `contextvars` (Python backend), mirroring the existing `_auth_user` ContextVar.
- Attach it to every log line emitted within the request.
- Echo it on error HTTP responses (header and/or body).
- Align the key name with ui-state's existing `request_id` (`flow-router.ts`).

## OUT scope
- OpenTelemetry spans/trace context (OUT per D3 — a single id, not full tracing).
- Per-service critical-path log content (Slices 03–06 add the lines; this slice makes them correlatable).

## Learning hypothesis
**Disproves** that one id minted at ingress can be propagated and bound across **both** stacks (`AsyncLocalStorage` + `contextvars`) so that a line emitted deep in a backend use case carries it **without** threading the id through every function signature. If binding leaks or breaks across an async boundary, the propagation design needs rework.
**Confirms** (if it succeeds) that `grep <id>` lights up the whole stack.

## Acceptance criteria
- AC1: The id is minted once at ingress and never re-minted downstream.
- AC2: A request traversing ≥2 services has one shared `correlation_id` on every emitted log line (integration assertion).
- AC3: Error responses on every surface carry the `correlation_id`.
- AC4: A log line emitted inside a backend use case (no id in its signature) still carries the id via `contextvars`.

## Dependencies
Benefits-from Slice 01 (mint point lives in the auth-proxy ingress hardened there). Blocks the *full trace value* of Slices 03–06 (each can ship its own logging independently, but the id only spans the stack once this lands).

## Pre-slice SPIKE
Not required, but validate the async-boundary behavior of `AsyncLocalStorage` across the SSE streaming path (agent/ui-state) early — long-lived streams must keep the bound id.

## Reference class
Request-context binding via `AsyncLocalStorage` (Node) and `contextvars` (Python) is a standard pattern; the repo already uses a `_auth_user` ContextVar in the backend and a `requestIdMiddleware` in ui-state to copy from.
