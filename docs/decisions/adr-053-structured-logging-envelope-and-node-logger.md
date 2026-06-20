# ADR-053: Cross-service structured-logging envelope + Node logger choice

**Status:** Proposed (pending solution-architect-reviewer peer review + user ratification)
**Date:** 2026-06-20
**Wave:** DESIGN (application scope) · **Feature:** log-coverage-and-quality (DC-103)
**Job:** JOB-004 · **Supersedes:** none · **Relates to:** ADR-054 (correlation-id binding), ADR-039 (ui-state naming), ADR-014 (chat vocabulary)

## Context

The DC-103 audit found logging coverage is uneven across the five surfaces. Only
`ui/` has a structured logger (`ui/app/lib/log.ts`, consola v3.4.2) emitting an
ECS/OTel-flavoured `LogRecord` (`@timestamp`, `log.level`, `event.module`,
`event.action`, `attributes`). The other four surfaces are blind spots:

| Surface | Today | Gap |
|---|---|---|
| auth-proxy | `process.stdout.write(JSON)` for KPI lines only; auth decisions silent | every JWT/PAT/M2M decision unlogged (`lib/auth.ts`, `lib/m2m.ts`, `lib/pat.ts`) |
| backend | stdlib `logging`, no dictConfig/JSON formatter; DomainException→HTTP silent | `main.py:151-161` maps exceptions to HTTP with no log; `@handle_returns` logs only `func.__name__` |
| ui-state | no logger; `requestIdMiddleware` mints `X-Request-Id` | Redis/SSE ops silent; empty `catch {}` swallow failures |
| agent | bare `console.warn` on error only | `chat.turn` boundaries, tool dispatch, Groq calls all silent |
| ui | consola logger exists | `configuredLevel()` reads only `localStorage` (no server-side `LOG_LEVEL`); `entry.server.tsx:49` bare `console.error` |

DISCUSS decision **D2** standardized on the existing `ui/` envelope and posed open
question **Q1**: for the Node services, adopt **pino** or **lift `ui/`'s consola
logger** into a shared module? This ADR resolves D2 (ratify the envelope) and Q1
(the Node logger).

The decision is constrained by these forces:
- The five surfaces are not one runtime. `ui/` is **isomorphic** (browser + SSR):
  bundle weight reaches the client, a human-readable console is the default
  developer experience, and `localStorage` is a real knob. The other three Node
  surfaces (auth-proxy, agent, ui-state) are **pure server processes**: stdout JSON
  to a (future) sink, no bundle constraint, and performance matters on SSE/hot
  paths (agent `pipeChatStream`, ui-state Redis pub/sub).
- Redaction (US-7) must run in exactly one serializer seam per logger, applied to
  **every** line before emit — the ergonomics of that hook differ by library.
- The KPI-event JSON lines (`auth-proxy app.ts:838-848`) and startup
  image-identity lines must be preserved unchanged (D7).

## Decision

**Two decisions, one contract.**

### 1. Ratify the `ui/` `LogRecord` as the cross-service envelope standard (D2)

The field set — `@timestamp` (ISO-8601), `log.level`, `event.module`,
`event.action` (stable dotted key), `attributes` (OTel-style bag) — is the
**single envelope** every surface emits. Promote the TypeScript contract to a
shared module **`shared/logging/`** (`@dashboard-chat/shared-logging`), mirroring
the `shared/chat/` precedent (ADR-014) for cross-service shared types. The module
exports: the `LogRecord` interface, the `Logger` interface, the `LogLevel` union,
the redaction contract (see §2 below), and the `createLogger(channel)`
factory **contract** (each service supplies its own emit backend behind it). Python
matches the **same field names** via `logging.config.dictConfig` + a JSON formatter
(see ADR-054 §Python and the brief) — the contract is the field names, not a shared
Python package.

The envelope is **sink-portable** but standing up a sink (Loki/ELK/CloudWatch) is
OUT of scope (D3/Q3). Output is stdout JSON lines.

### 2. Redaction is one ruleset implemented once, wrapped by two thin adapters

Redaction is **defined once** in `shared/logging/` as **data + a pure helper**,
consumed by **both** emit backends:

- `redactionKeys` (a `RedactionConfig` data struct) — the sensitive-key ruleset
  (`authorization`, `cookie`, `*token*`, `*secret*`, `password`, raw `email`) incl.
  glob/substring semantics. **Single source of truth**; a key is added here, nowhere
  else.
- `redact(attributes, config?)` / `maskValue(key, value)` — pure helpers, no I/O, no
  library coupling.
- **pino adapter** (auth-proxy/agent/ui-state): the serializer/`formatters` hook
  calls `redact()` before emit; pino's built-in `redact` paths are **not** the source
  of truth (they would drift from consola's).
- **consola adapter** (`ui/`): the `ecsJsonReporter` (`ui/app/lib/log.ts:76-83`)
  calls the **same** `redact()` before `JSON.stringify`.

→ **one ruleset, one implementation, two transports** — it is structurally
impossible to protect one surface but not the other.

### 3. Node logger: pino for the three pure-backend services; keep consola in `ui/` (Q1)

- **auth-proxy, agent, ui-state** adopt **pino** behind the shared
  `createLogger(channel)` contract. A thin adapter maps pino output to the
  `LogRecord` field names (`event.module`/`event.action`/`attributes`) and applies
  redaction in pino's serializer/`formatters`/`redact` hook.
- **`ui/`** keeps its existing **consola** logger (already shipped, isomorphic,
  human-readable by default). It conforms to the **same shared `LogRecord`
  contract** — `toEcsRecord()` already produces the exact field set — and imports
  the shared redaction ruleset + `LogLevel`/`LogRecord` types from
  `shared/logging/`.

"One logger everywhere" is satisfied at the **envelope + factory-contract** layer
(`shared/logging/`), which is the durable seam, **not** at the library layer. A
consumer greps one `LogRecord` shape across all five surfaces regardless of which
library emitted it (K7).

## Alternatives considered

### A. Lift `ui/`'s consola module into the shared package; use consola everywhere (Q1 option 2)
- **For:** literally one logger library; zero new dependency; `toEcsRecord()`
  already exists; smallest diff for the SPIKE.
- **Against:** consola is optimized for a CLI/browser developer console, not a
  high-throughput server JSON emitter. Its reporter pipeline allocates per line
  (the `ecsJsonReporter` re-`JSON.stringify`s through `console[method]`), which is
  the wrong shape for the agent SSE hot path and ui-state Redis pub/sub (the
  must-not-regress non-blocking-on-hot-paths guardrail). Redaction in consola means
  a custom reporter wrapping every call — workable but bespoke. **Rejected**: forces
  the browser-first library onto server hot paths to win a library-count metric that
  the shared *contract* already wins.

### B. pino everywhere, including `ui/` (drop consola)
- **For:** one server-grade library; pino is the Node JSON-logging standard
  (fastest mainstream logger, native JSON, first-class `redact` paths, broad
  ecosystem — pino-pretty, transports).
- **Against:** pino is a Node-runtime logger; `ui/` is isomorphic and its logger
  runs in the **browser** too. Forcing pino into the client bundle is weight +
  friction for no gain, and it would throw away the working, human-readable consola
  DX and the `localStorage` knobs. **Rejected**: wrong tool for the isomorphic
  surface; needless churn on a green surface.

### C. winston everywhere
- **For:** mature, transport-rich.
- **Against:** heavier and slower than pino; more configuration surface; no
  advantage here over pino for stdout JSON. The hot-path guardrail favours pino.
  **Rejected.**

### D. Per-service ad-hoc loggers, no shared contract
- **Against:** directly violates K7 (envelope consistency) and D2. The whole point
  of the feature is one envelope. **Rejected on sight.**

## Consequences

**Positive**
- K7 (envelope consistency, 5/5 surfaces) met at the contract layer, decoupled from
  library churn — `ui/` does not have to change loggers to comply.
- pino on the three server surfaces gives native JSON, a first-class redaction hook
  (US-7), and the throughput headroom the SSE/Redis hot paths need (non-blocking
  guardrail).
- The shared `LogRecord` + redaction ruleset live in **one** place
  (`shared/logging/`), so the redaction guard born in Slice 01 is imported, not
  re-implemented, by every later slice (K5).
- Existing KPI-event and startup-identity lines are untouched — pino is **additive**
  alongside the existing `process.stdout.write` lines (D7, AC2.4).

**Negative / trade-offs**
- Two logger libraries in the tree (pino + consola). Mitigated: they share one
  contract and one redaction ruleset; the boundary (server vs isomorphic) is sharp
  and documented here.
- pino's pretty output requires `pino-pretty` in dev; production emits raw JSON
  lines (which is the desired sink-portable shape).
- `shared/logging/` is a new shared workspace package; the Python backend cannot
  import it and must keep field names in sync by convention + the K7 schema check
  (the one cross-language seam — accepted, same as any polyglot contract).

**Enforcement (architecture-rule erosion guard)**
- A CI lint forbidding bare `console.*` (Node) / `print()` (Python) outside the
  logger modules is **recommended for adoption now** (DISCUSS Q4). Rationale: the
  feature's value is that *every* path logs through the envelope; without the lint,
  new `console.log`/`print` calls silently reintroduce blind spots and bypass
  redaction. Suggested tooling: ESLint `no-console` (allow-list the logger modules
  and the KPI-emit/startup-identity lines) for Node; Ruff `T20` (flake8-print) for
  Python. This is a leading indicator in `outcome-kpis.md`; promoting it to a hard
  gate is a DEVOPS-wave decision, but the rule is cheap and self-reinforcing — adopt
  now as warn, escalate to error once the surfaces are migrated.

**Earned-trust note (probe at composition root)**
- The redaction serializer is a contract every line depends on. Each service's
  logger module MUST ship the **redaction regression test** (Slice 01, re-run per
  surface) feeding **production-shaped** credential inputs (a real `Authorization`
  header value, a cookie, a PAT, an M2M secret) and asserting none serialize. This
  is the empirical proof the redaction adapter honours its contract — it is a
  first-class DISTILL deliverable, not a convention. The regression test runs
  against **both** the pino and consola adapters and asserts **identical** redacted
  output (the K5 contract), so any drift between the two transports fails before
  landing.
