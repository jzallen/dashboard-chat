# C4 diagrams — log-coverage-and-quality (DESIGN, application scope)

**Wave:** DESIGN · **Feature:** log-coverage-and-quality (DC-103) · **Author:** Morgan (nw-solution-architect) · **2026-06-20**

> **Topology is UNCHANGED.** This feature introduces **no new containers** and no
> new network hops. The five existing surfaces (auth-proxy, backend, agent,
> ui-state, ui) gain a logging adapter + a correlation-id binding seam. The only
> new artifact is the shared contract package `shared/logging/`, which is a
> build-time dependency, not a runtime container. The diagrams below annotate the
> **logging / correlation-id flow** over the existing topology.

## Level 1 — System Context (logging & correlation-id flow)

```mermaid
C4Context
  title System Context — observability sweep (logging + correlation id)
  Person(operator, "Operator / On-call / Security reviewer", "Diagnoses requests and audits decisions by grepping one correlation_id across services")
  System_Boundary(dc, "Dashboard Chat") {
    System(app, "Dashboard Chat", "5 surfaces emitting one shared LogRecord envelope, all lines carrying one correlation_id")
  }
  System_Ext(client, "Browser client", "Sends requests; receives correlation_id on error responses")
  System_Ext(sink, "Log sink (FUTURE — OUT of scope)", "Loki/ELK/CloudWatch; envelope is sink-portable but not stood up here")

  Rel(client, app, "Sends request (optionally with X-Request-Id)")
  Rel(app, client, "Echoes correlation_id on error responses (header/body)")
  Rel(app, operator, "Emits stdout JSON LogRecord lines (one correlation_id per request)")
  Rel(operator, app, "Reads logs: grep <correlation_id> across surfaces; sets LOG_LEVEL at runtime")
  Rel(app, sink, "Ships JSON lines to (FUTURE follow-up)")
```

## Level 2 — Container (correlation-id propagation + envelope emission)

```mermaid
C4Container
  title Container — correlation-id propagation and LogRecord emission (existing topology, unchanged)
  Person(operator, "Operator / Security reviewer")
  System_Ext(client, "Browser client")

  Container_Boundary(dc, "Dashboard Chat") {
    Container(ui, "ui (RRv7 SSR)", "Node + consola", "createLogger (existing); fixes server-side LOG_LEVEL; logs /bff/* + SSR failures; injects X-Request-Id on hops")
    Container(authproxy, "auth-proxy", "Hono + pino", "MINTS correlation id at ingress; logs every JWT/PAT/M2M decision; redaction serializer; preserves KPI + startup-identity lines")
    Container(agent, "agent", "Hono + pino", "Logs chat.turn.start/ok at INFO, tool/model at DEBUG; carries correlation id on SSE")
    Container(uistate, "ui-state", "Hono + pino", "Logs Redis/SSE ops; extends existing requestIdMiddleware; kills silent catches")
    Container(backend, "backend", "FastAPI + stdlib logging dictConfig", "Request-lifecycle + DomainException logs; correlation_id via ContextVar; LOG_LEVEL via dictConfig")
    Component(shared, "shared/logging", "TS package (build-time)", "LogRecord + Logger + LogLevel + redaction ruleset + createLogger contract")
  }

  Rel(client, authproxy, "Request (X-Request-Id optional)", "HTTPS")
  Rel(client, ui, "Request / SSR navigation", "HTTPS")
  Rel(authproxy, backend, "Forwards request + X-Request-Id", "HTTP")
  Rel(authproxy, agent, "Forwards request + X-Request-Id", "HTTP")
  Rel(ui, agent, "Relays /bff/chat + X-Request-Id", "HTTP/SSE")
  Rel(ui, authproxy, "Relays /api/* + X-Request-Id", "HTTP")
  Rel(uistate, backend, "Calls + X-Request-Id", "HTTP")

  Rel(authproxy, operator, "Emits LogRecord (correlation_id)", "stdout JSON")
  Rel(backend, operator, "Emits LogRecord (correlation_id)", "stdout JSON")
  Rel(agent, operator, "Emits LogRecord (correlation_id)", "stdout JSON")
  Rel(uistate, operator, "Emits LogRecord (correlation_id)", "stdout JSON")
  Rel(ui, operator, "Emits LogRecord (correlation_id)", "stdout JSON")

  Rel(ui, shared, "imports contract", "build-time")
  Rel(authproxy, shared, "imports contract", "build-time")
  Rel(agent, shared, "imports contract", "build-time")
  Rel(uistate, shared, "imports contract", "build-time")
```

## Level 3 — Component (the logging subsystem on one Node surface)

The subsystem of interest: how a line emitted deep in handler code acquires the
correlation id and passes through redaction before emit. Shown for a Node service
(auth-proxy); the Python backend is the same shape with `ContextVar` + dictConfig
JSON formatter in place of `AsyncLocalStorage` + pino.

```mermaid
C4Component
  title Component — logging subsystem on a Node surface (auth-proxy shown)
  Container_Boundary(svc, "auth-proxy (Hono + pino)") {
    Component(ingress, "Correlation-id middleware", "Hono middleware", "Reads X-Request-Id or mints once at ingress; opens AsyncLocalStorage scope for the request")
    Component(handler, "Auth decision handlers", "lib/auth.ts, lib/m2m.ts, lib/pat.ts", "Calls logger.info/warn with reason + principal_id; no id in signature")
    Component(factory, "createLogger(channel)", "shared/logging contract + pino adapter", "channel -> event.module; method -> log.level; reads ALS for correlation_id")
    Component(redact, "Redaction serializer", "pino redact / serializer seam", "Drops/masks authorization, cookie, *token*, *secret*, password, raw email BEFORE emit")
    Component(emit, "Emit", "pino stdout", "One LogRecord JSON line; coexists with existing KPI + startup-identity writes")
    Component(kpi, "KPI/startup writers (UNCHANGED)", "process.stdout.write", "ADR-053/D7 preserved verbatim")
  }
  System_Ext(operatorlogs, "stdout")

  Rel(ingress, handler, "invokes within ALS scope")
  Rel(handler, factory, "logger.info(action, attributes)")
  Rel(factory, redact, "builds LogRecord, injects correlation_id from ALS, then")
  Rel(redact, emit, "redacted record")
  Rel(emit, operatorlogs, "writes JSON line")
  Rel(kpi, operatorlogs, "writes KPI/identity lines (unchanged)")
```

## Notes on diagram fidelity

- Every arrow carries a verb. No abstraction levels are mixed.
- `shared/logging` is drawn as a Component inside the boundary in L2 only to show
  the build-time dependency; it is **not** a runtime container.
- The "FUTURE log sink" appears in L1 only to mark the sink-portability seam (D3/Q3
  OUT of scope) and is explicitly not built.
