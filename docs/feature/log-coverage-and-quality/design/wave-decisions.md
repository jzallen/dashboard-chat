# DESIGN Decisions — log-coverage-and-quality

**Wave:** DESIGN (application scope, propose mode) · **Feature:** DC-103 · **Author:** Morgan (nw-solution-architect) · **2026-06-20**
**Job:** JOB-004 · **ADRs:** ADR-053, ADR-054 (both Proposed) · **Status:** awaiting peer review (Atlas) + user ratification of Q1

This is a **lightweight confirmation DESIGN**: the envelope already exists in
`ui/app/lib/log.ts`; this wave ratifies it as the cross-service standard and resolves
the open questions from DISCUSS (Q1 primary). No greenfield architecture.

## Key Decisions

- **[D1] Q1 verdict — pino for the three server Node surfaces; retain consola in
  `ui/`.** auth-proxy, agent, ui-state adopt pino behind a shared
  `createLogger(channel)` contract; `ui/` keeps consola (isomorphic, already emits
  the envelope). "One logger everywhere" is met at the **envelope + factory-contract**
  layer, not the library layer. (ADR-053)
- **[D2] Ratify the `ui/` `LogRecord` as the cross-service envelope (DISCUSS D2).**
  Promote the TS contract to `shared/logging/` (`@dashboard-chat/shared-logging`),
  mirroring `shared/chat/`. Python matches the same field names via `dictConfig` + a
  JSON formatter — the contract is the field names, not a shared Python package.
  (ADR-053)
- **[D3] Correlation id rides the existing `X-Request-Id` header, minted once at the
  auth-proxy ingress, never re-minted.** Aligns to live plumbing (auth-proxy
  `app.ts:959`, ui-state `requestIdMiddleware`) rather than introducing
  `x-correlation-id`. Surfaces in logs as `attributes.correlation_id`
  (header↔attribute name split is intentional and documented). (ADR-054)
- **[D4] Ambient per-request binding — `AsyncLocalStorage` (Node) /
  `correlation_id` `ContextVar` (Python, mirroring `_auth_user`).** A line emitted
  deep in a use case carries the id without threading it through signatures.
  (ADR-054)
- **[D5] One redaction ruleset in `shared/logging/`, two thin adapters.** A
  `redactionKeys`/`RedactionConfig` data struct + a pure `redact()`/`maskValue()`
  helper (`authorization`, `cookie`, `*token*`, `*secret*`, `password`, raw `email`)
  implemented **once** and wrapped by both the pino serializer and the consola
  `ecsJsonReporter`. Born Slice 01 with a production-shaped regression test that runs
  against both adapters and asserts identical redacted output; re-asserted per
  surface. (ADR-053)
- **[D6] `LOG_LEVEL` honoured at runtime by all five surfaces; default INFO.** Fixes
  `ui/`'s `configuredLevel()` server-side limitation (reads only `localStorage`
  today). (ADR-053)
- **[D7] Adopt the no-console/print CI lint now (warn → error post-migration).**
  Resolves DISCUSS Q4 as adopt-now: ESLint `no-console` (Node) + Ruff `T20`
  (Python), allow-listing logger modules and the KPI/startup-identity lines.
- **[D8] Confirm Q2 (tracing) and Q3 (log sink) OUT.** Envelope is sink-portable;
  `correlation_id` is the migration seam to a future OTel `trace_id`. No change.

## Architecture Summary

- **Pattern.** Cross-cutting adapter behind a shared contract (ports-and-adapters at
  the logging seam): one `LogRecord` envelope + `createLogger(channel)` contract in
  `shared/logging/`; each surface supplies its own emit backend (pino / consola /
  Python JSON formatter). Correlation id bound via ambient request context.
- **Paradigm.** Multi-paradigm, preserved: TS services (pino, house style), `ui/`
  (consola), Python (stdlib `logging` + `dictConfig`). No paradigm rewrite.
- **Topology.** UNCHANGED — no new containers, no new hops. `shared/logging/` is a
  build-time package, not a runtime service.
- **Key components.** Shared envelope/contract + redaction (`shared/logging/`); pino
  adapters on auth-proxy/agent/ui-state; consola retained in `ui/`; Python JSON
  formatter + `dictConfig` + request middleware on backend; correlation middleware
  (Node) + `ContextVar` (Python).

## Reuse Analysis (HARD GATE)

| Component | Overlapping existing (file:line) | Verdict |
|---|---|---|
| `LogRecord`/`Logger`/`LogLevel`/redaction/`createLogger` contract | `ui/app/lib/log.ts` | EXTEND → promote to `shared/logging/` |
| Node emit backend (pino) | none (auth-proxy stdout KPI only; agent `console.warn`; ui-state none) | CREATE NEW (thin adapter) |
| `ui/` logger | `ui/app/lib/log.ts` consola | EXTEND (keep; import shared contract; fix server `LOG_LEVEL`) |
| Redaction ruleset + helper | none (no centralized redaction) | CREATE NEW (one ruleset in `shared/logging/`, two thin adapters) |
| Correlation middleware (Node) | auth-proxy `app.ts:959`, ui-state `flow-router.ts:21` | EXTEND (generalize mint; ui-state middleware extended, not replaced) |
| Correlation binding (Python) | `_auth_user` ContextVar (`backend/app/auth/context.py:5`) | EXTEND (mirror with `correlation_id` ContextVar) |
| Python JSON formatter + `dictConfig` | none (stdlib logging, no dictConfig) | CREATE NEW |
| Backend request middleware | none (`auth/middleware.py` logs nothing) | CREATE NEW |

Default is EXTEND. Net-new is limited to: pino adapters, the redaction step, the
Python formatter/dictConfig, and the backend request middleware — each with no
existing component to extend.

## Technology Stack

| Choice | License | Rationale |
|---|---|---|
| pino (auth-proxy, agent, ui-state) | MIT | Fastest mainstream Node JSON logger; native JSON; first-class `redact`; hot-path headroom (SSE/Redis). |
| consola (retained in `ui/`) | MIT | Already shipped; isomorphic; human-readable default; already emits the exact envelope. |
| `pino-pretty` (dev only) | MIT | Readable dev output; production emits raw JSON. |
| Python stdlib `logging` + `dictConfig` + JSON formatter | PSF | No new dependency; standard structured-logging path; `LOG_LEVEL` control. |
| ESLint `no-console` / Ruff `T20` (lint) | MIT | Enforcement of "log through the envelope" (Q4). |

No proprietary technology. No new runtime container.

## Constraints Established

- One envelope, same field names across stacks; output is stdout JSON lines
  (sink-portable, sink not built).
- Correlation id minted once (auth-proxy), only ever propagated downstream.
- Credentials never enter a log; redaction runs in the one serializer seam every
  line passes through.
- INFO = critical-path entry/exit only; detail at DEBUG (off by default).
- KPI-event and startup-identity lines preserved unchanged; logging additive.
- Logging non-blocking on hot/SSE paths; no browser-console logs in production;
  tenant context as attributes only.

## Upstream Changes

- No DISCUSS assumption was overturned. One **refinement** (not a reversal): the
  correlation id aligns to the existing `X-Request-Id` header rather than a new
  `x-correlation-id`, because two services already speak `X-Request-Id` — DISCUSS
  listed both as candidates (`wave-decisions.md` technical approach), so this is a
  pin within the stated option space, not a change. No `upstream-changes.md`
  required.
- Q1 is resolved (pino + retain consola) — pending user ratification.
- Q4 recommended for adoption now (was "leading indicator").

## Hand-offs

- **To DISTILL:** BDD acceptance tests from the per-slice AC + the observability
  journey; first-class deliverables are the **redaction regression test**
  (production-shaped inputs, Slice 01) and the **cross-service correlation-id
  integration assertion** (Slice 02, K1). `roadmap.json` ordered per
  `prioritization.md` (Slice 01 → 02 → 03–06).
- **To DEVOPS:** no external integration introduced — no contract-test annotation.
  The CI no-console/print lint (Q4) is a DEVOPS gate-promotion decision. Validate the
  `AsyncLocalStorage` non-blocking claim on the SSE path under load (the must-not-
  regress latency guardrail).
- **Open for DISTILL/DEVOPS:** (1) confirm the `X-Request-Id` header↔`correlation_id`
  attribute name split is acceptable to operators (vs renaming); (2) the Slice 02
  SPIKE must validate `AsyncLocalStorage` context survival across long-lived SSE
  streams before the binding is relied upon.
