# ADR-054: Correlation-id binding mechanism across services

**Status:** Proposed (pending solution-architect-reviewer peer review + user ratification)
**Date:** 2026-06-20
**Wave:** DESIGN (application scope) · **Feature:** log-coverage-and-quality (DC-103)
**Job:** JOB-004 · **Relates to:** ADR-053 (envelope + logger), ADR-039 (ui-state naming)

## Context

US-1 / K1 require that every log line emitted while handling a request — including
lines emitted deep inside a backend use case or a long-lived SSE stream — carries
one shared correlation id, and that the id appears on error responses, so an
operator can `grep <id>` across all five surfaces and see the whole request.

The hard constraint (AC1.2, AC4 in Slice 02): the id must reach a line emitted deep
in a call stack **without being threaded through every function signature**. That
forces an ambient request-context binding, not parameter passing.

The codebase already has the seams:
- **auth-proxy** mints `c.req.raw.headers.get("x-request-id") || randomUUID()` at
  ingress (`app.ts:959`) and forwards `X-Request-Id` on the org-create path
  (`app.ts:974`).
- **ui-state** has `requestIdMiddleware` (Hono `requestId`, `headerName:
  "X-Request-Id"`, `flow-router.ts:21`) and persists `request_id` into the Redis
  FlowEventRecord (`redis.ts:67`).
- **backend** has the `_auth_user` `ContextVar` (`app/auth/context.py:5`) as the
  exact pattern to mirror for a request-scoped binding.

So the header name is already de-facto **`X-Request-Id`** in two services. The
DISCUSS draft mentioned `x-correlation-id` as an alternative; aligning to the
existing `X-Request-Id` avoids a rename and reuses live plumbing.

## Decision

**Mint once at ingress, propagate by `X-Request-Id` header, bind per-request via
ambient context, surface as `correlation_id` in logs and on error responses.**

1. **Mint point — auth-proxy ingress, once.** Generalize `app.ts:959`: read the id
   from inbound `X-Request-Id` (fall back to `X-Correlation-Id` for tolerance) and
   mint `randomUUID()` only when absent. Never re-mint downstream — every other
   service reads the inbound header and, only if absent (direct/test calls), mints
   its own. This is the **mint-once invariant** (AC1, Slice 02 AC1).

2. **Propagation — `X-Request-Id` on every upstream hop.** auth-proxy → backend,
   auth-proxy → agent, and ui→`/bff/*`→agent / ui→`/api/*`→auth-proxy all forward
   the header. Generalize the existing single-path forward (`app.ts:974`) into the
   shared upstream-request helper so all hops carry it.

3. **Binding seam — ambient request context (the no-threading guarantee).**
   - **Node services (auth-proxy, agent, ui-state):** a Hono middleware reads/mints
     the id and stores it in an **`AsyncLocalStorage<{ correlationId }>`** opened for
     the request scope. `createLogger(channel)` (ADR-053) reads the current store at
     emit time and injects `attributes.correlation_id` automatically. ui-state
     **extends** its existing `requestIdMiddleware` rather than adding a parallel one
     — same `X-Request-Id`, same store, so the existing `request_id` transition-log
     pattern is preserved and aligned (US-5 AC5.4), not replaced.
   - **Python backend:** a request middleware reads/mints the id into a
     **`correlation_id` `ContextVar`** mirroring `_auth_user`. The shared JSON
     formatter (ADR-053) reads the ContextVar and injects `correlation_id` on every
     record. A line emitted inside a use case (no id in its signature) carries the id
     because it is ambient (AC4, Slice 02). `contextvars` propagates correctly across
     `await` boundaries in asyncio — which the SSE streaming path relies on.

4. **SSE / long-lived streams.** `AsyncLocalStorage` context is preserved across the
   stream's async continuation as long as the stream handler runs inside the
   middleware-opened scope. Slice 02's SPIKE validates this on the agent
   `pipeChatStream` and ui-state pub/sub paths before relying on it (the documented
   risk). Logging on these paths stays non-blocking (pino async, fire-and-forget).

5. **Error-response echo.** Every surface echoes the id on error responses as the
   `X-Request-Id` response header and/or a `correlation_id` field in the error body
   (AC1.3 / Slice 02 AC3). auth-proxy already has the id at the response seam; the
   other services read it from their ambient store/ContextVar.

6. **Log field name.** The id surfaces in the envelope as `attributes.correlation_id`
   (stable, snake_case, consistent with `org_id`/`user_id`/`flow_id`). The wire
   header stays `X-Request-Id` (existing); the log attribute is `correlation_id`
   (operator-facing, per US-1). This header/attribute name split is intentional and
   documented so the two existing `X-Request-Id` producers need no rename.

## Alternatives considered

### A. Thread the id through every function signature
- **Against:** directly violates AC1.2/AC4 (no threading through signatures) and is
  unmaintainable across a backend use-case stack and SSE handlers. **Rejected.**

### B. Rename the wire header to `X-Correlation-Id` everywhere
- **For:** the log attribute and the header would match.
- **Against:** auth-proxy (`app.ts:959,974`) and ui-state (`flow-router.ts:21`,
  Redis `request_id`) already speak `X-Request-Id`; renaming touches live plumbing
  and the persisted Redis record for cosmetic alignment. The header↔attribute name
  split (decision §6) gets the operator-facing name without the rename.
  **Rejected.**

### C. OpenTelemetry trace context (`traceparent`) + propagators
- **For:** the industry-standard distributed-trace mechanism; future-proof.
- **Against:** explicitly OUT of scope (D3/Q2) — this sweep ships a single
  correlation id in structured logs, not spans/exporters. The `correlation_id`
  attribute is a clean migration point to a `trace_id` later. **Deferred to a
  follow-up**, not rejected on merit.

### D. Pass the id only on the wire, read it per-log-call from the request object
- **Against:** the request object is not reachable from a line emitted deep in a use
  case without threading it — the ambient store/ContextVar is exactly what removes
  that coupling. **Rejected** (it is alternative A in disguise).

## Consequences

**Positive**
- `grep <id>` lights up all five surfaces with one id (K1); no signature threading
  (AC1.2/AC4); reuses live `X-Request-Id` plumbing in two services and the
  `_auth_user` ContextVar pattern in the backend (max reuse, min new surface).
- Clean future migration to OTel `trace_id` (the attribute is already the seam).
- ui-state's existing transition-log/`request_id` pattern is extended, not
  duplicated (US-5 AC5.4).

**Negative / trade-offs**
- `AsyncLocalStorage` has a small per-request cost and must wrap the **entire**
  request handler (including the SSE continuation) to avoid context loss — the named
  risk the Slice 02 SPIKE de-risks.
- The header (`X-Request-Id`) ≠ the log attribute (`correlation_id`) name split is a
  documented gotcha; mitigated by stating it here and in the brief.
- Backend `contextvars` correctness across `await` is relied upon — standard asyncio
  behaviour, asserted by the Slice 02 integration test (AC4).

**Earned-trust note (probe the binding)**
- The mechanism's contract is "a line emitted with no id in its signature still
  carries the id." That is empirically proven by the **Slice 02 integration
  assertion** (K1): drive a request across ≥2 services and assert one
  `correlation_id` on every emitted line **and** on the error response. The SSE
  context-preservation claim is proven by the SPIKE exercising a long-lived stream,
  not by assumption. These are first-class DISTILL deliverables.
