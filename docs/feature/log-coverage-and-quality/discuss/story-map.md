# Story Map — log-coverage-and-quality

**Wave:** DISCUSS · **Area:** cross-cutting · **Job:** JOB-004 · **Scope:** structured logs + correlation id (full distributed tracing / log sink are OUT — see guardrails)

## Backbone (operator diagnosis loop, left → right)

```
 GET THE ID        →  TRACE IT          →  READ THE FAILURE   →  READ THE DECISION  →  RAISE DETAIL
 from error/report    one id, all          INFO entry/exit +      auth + business       LOG_LEVEL at
                      services             WARN/ERROR w/ ctx      reason + principal    runtime, safely
 ───────────         ───────────          ───────────            ───────────           ───────────
 correlation_id on   grep <id> across     no silent catches;     no credential ever    LOG_LEVEL=debug;
 the response        all 5 surfaces       happy path visible     in a log line         redaction guard
```

## Walking skeleton

Not a *new* end-to-end skeleton — this is brownfield, and one surface (`ui/`)
already has the structured logger (`ui/app/lib/log.ts`). The "skeleton" is that
existing `createLogger` → `LogRecord` envelope. Each slice extends the same
envelope to one more surface (or one more cross-cutting capability) without
forking it. There is **no greenfield rib to build first** — only ribs to
generalize.

## Slices (elephant-carpaccio — each ships end-to-end in ≤1 day; larger ones flagged to split)

| Slice | Title | Sub-job | Story | Surface | Learning hypothesis (disproves if it fails) |
|---|---|---|---|---|---|
| **01** | auth-proxy auth-decision logging + redaction guard | SJ-2, SJ-7 | US-2, US-7 | auth-proxy | Disproves that the `ui/` `LogRecord` envelope + a redaction guard can be lifted into a Node service and log **every** auth decision **without ever** serializing a credential. |
| **02** | End-to-end correlation id | SJ-1 | US-1 | cross-cutting | Disproves that one id minted at ingress can be propagated and bound (`AsyncLocalStorage`/`contextvars`) so **all** lines for a request share it across stacks. |
| **03** | backend request lifecycle + DomainException + `LOG_LEVEL` | SJ-4 | US-4 | backend | Disproves that DomainException outcomes can be logged centrally **without** turning normal 404s into ERROR noise (the silence-vs-noise edge). |
| **04** | agent chat-path happy-path trace | SJ-3 | US-3 | agent | Disproves that chat-turn boundaries can be logged coherently with `ui` using **shared** `event.action` keys (`shared/chat`). |
| **05** | ui-state Redis/SSE logging + kill silent catches | SJ-5 | US-5 | ui-state (+ ui chat/SSE) | Disproves that the best-effort `catch` blocks can all log **without** changing their best-effort (non-throwing) behavior. |
| **06** | ui SSR/BFF gap closure + server `LOG_LEVEL` | SJ-6 | US-6 | ui | Disproves that the SSR server can honour `LOG_LEVEL` (today `configuredLevel()` reads only `localStorage`) without shipping debug logs to the browser. |

## Dependency chain

```
  01 auth-proxy + redaction ─┬─> (redaction guard reused by every later slice)
                             │
  02 correlation id ─────────┼─> 03 backend   (backend lines bind the id via contextvars)
   (mint point lives in 01's ├─> 04 agent     (agent lines carry the id)
    auth-proxy ingress)      ├─> 05 ui-state  (align id key with existing request_id)
                             └─> 06 ui         (ui injects id on /bff + /api hops)
```

- **02 benefits-from 01** — the id is minted at the auth-proxy ingress, so the
  service touched first in Slice 01 is the natural mint point; 02 generalizes it.
- **03/04/05/06 blockedBy 02** for *full* trace value — each can ship its own
  service's logging independently, but the id only spans the stack once 02 lands.
  (They are sequenced after 02 in `prioritization.md` for this reason.)
- **All later slices reuse 01's redaction guard** — it is shipped first, on the
  highest-risk service, then re-asserted everywhere (carpaccio "ship the safety
  net first").

## Scope guardrails (confirmed "structured logs + correlation id only")

- **OUT:** full distributed tracing (OpenTelemetry spans/exporter) — a correlation
  id in structured logs now; OTel is a follow-up (open question Q2 in
  `wave-decisions.md`).
- **OUT:** standing up a log sink (Loki/ELK/CloudWatch) — stdout JSON is sufficient
  for this sweep; the envelope is sink-portable when one is added (Q3).
- **OUT:** rewriting the existing KPI-event pipeline — it is preserved and coexists
  (US-2 AC2.4).

## Non-story (cross-cutting guard, not a slice of its own)

The **redaction regression test** is delivered *inside* Slice 01 (it is what makes
auth-proxy logging safe) and re-asserted by Slices 02–06 (each new logger must keep
it green). It is not separately shippable user value — it is the safety net the
value rides on.

See `prioritization.md` for execution-order rationale and `../slices/` for the
per-slice briefs.
