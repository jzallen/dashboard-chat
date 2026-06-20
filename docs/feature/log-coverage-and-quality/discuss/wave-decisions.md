# DISCUSS Decisions — log-coverage-and-quality

**Wave:** DISCUSS · **Area:** cross-cutting (infra/observability) · **Feature type:** Cross-cutting · **Walking skeleton:** No (brownfield; envelope already exists)

## Source & routing note (read first)

Promoted from **DC-103** ("Analyze Log Coverage and Quality"). Entered at DISCUSS
per the CLAUDE.md brownfield routing matrix (new cross-cutting concern; not a bug
with a known cause, not a pure refactor). A grounded per-service audit was run
first (agent, auth-proxy, backend, ui, ui-state) and is the evidence base for the
job, journey, stories, and slices. The audit + a draft PRD were initially captured
as a Linear Project Document for reference; **these `docs/feature/` artifacts are
the single source of truth** and the Linear document is removed once they land
(SSOT model).

## Key Decisions

- **[D1] Light JTBD bridge, not full DIVERGE.** The need is a well-evidenced
  cross-cutting quality sweep, not a contested product opportunity. Added
  **JOB-004** to `docs/product/jobs.yaml` with three dimensions + four forces; no
  multi-job opportunity study. (see: `jtbd-job-stories.md`, `jtbd-four-forces.md`)
- **[D2] Standardize on the existing `ui/` envelope.** `ui/app/lib/log.ts` already
  defines the ECS/OTel `LogRecord` (`@timestamp`, `log.level`, `event.module`,
  `event.action`, `attributes`). This feature **lifts and generalizes** it to the
  other four surfaces rather than inventing one. (Anchor finding; carried into every
  artifact.)
- **[D3] Scope = structured logs + one correlation id. Full tracing and a log sink
  are OUT.** OpenTelemetry spans/exporter and standing up Loki/ELK/CloudWatch are
  explicit non-goals for this sweep; the envelope is sink-portable for a later
  follow-up. (see: `story-map.md` §guardrails)
- **[D4] Six elephant-carpaccio slices; the safety net ships first.** The redaction
  guard + the Node logger are born **inside Slice 01 (auth-proxy)** — the
  highest-value blind spot *and* highest credential-leak risk — then reused by every
  later slice. No pure `@infrastructure` slice. (see: `story-map.md`,
  `prioritization.md`)
- **[D5] Order by risk-then-value-then-enable.** Slice 01 (auth-proxy + redaction)
  first; Slice 02 (correlation id) second as the cross-stack enabler whose mint
  point lives in 01's ingress; Slices 03–06 are per-surface gap closures by
  descending value. (see: `prioritization.md`)
- **[D6] Operator/observability journey is cross-cutting, catalogued as provisional
  J-008 — not promoted to product SSOT.** Like token-expiry and org-switching, it is
  a cross-cutting concern rather than an end-user product flow. The feature-level
  contract lives at `journey-observability-sweep.yaml`; recorded in
  `journeys/_inventory.md`. (see: `journeys/_inventory.md`)
- **[D7] Coexist with, don't replace, existing log conventions.** The KPI-event JSON
  lines (`auth-proxy app.ts:838-848`) and the startup image-identity lines are
  preserved; the structured logger is additive. (see: `user-stories.md` US-2 AC2.4,
  `shared-artifacts-registry.md`)

## Requirements Summary

- **Primary job:** Trace any request and audit any decision across services through
  consistent, correlatable logs (JOB-004).
- **Walking skeleton scope:** none — the logger/envelope already exists in `ui/`;
  each slice extends it to one more surface or cross-cutting capability.
- **Feature type:** Cross-cutting (Node ×4 surfaces + Python backend).

## Technical approach (for DESIGN to ratify)

- **Envelope:** the `ui/` `LogRecord` shape, emitted by a `createLogger(channel)`
  factory per stack — Node logger (pino *or* a lifted `ui/` consola module — **Q1**),
  Python `logging.config.dictConfig` + JSON formatter with the same field names.
- **Correlation id:** minted at auth-proxy ingress (generalize `app.ts:958`),
  propagated by header on every hop, bound per-request via `AsyncLocalStorage`
  (Node) / `contextvars` (Python), echoed on error responses.
- **Redaction:** one sensitive-key ruleset applied in each serializer before emit;
  regression-tested from Slice 01.
- **Levels:** `LOG_LEVEL` env var honoured by every service (incl. ui SSR, fixing
  the `localStorage`-only limitation); default INFO.

## Constraints Established

- The structured `LogRecord` stream is the only diagnosis surface; one envelope,
  same field names across stacks.
- The correlation id is minted **once** (auth-proxy) and only ever propagated
  downstream — never re-minted mid-stack.
- Credentials are never an artifact that enters a log; redaction runs in the one
  place every line passes through.
- INFO = critical-path entry/exit only; detail at DEBUG (off by default) — to avoid
  swapping silence for noise.
- Coverage is measured against the critical-path catalogue, not log-line counts;
  any descoped path is logged in its slice brief (no silent caps).
- Pre-existing KPI-event and startup-identity log lines are preserved unchanged.

## Open Questions (carried to DESIGN/DISTILL)

- **Q1 (Node logger):** pino vs lifting `ui/`'s consola logger into a shared module.
  Bounded by a pre-slice SPIKE in Slice 01.
- **Q2 (tracing scope):** stop at structured logs + correlation id now (recommended);
  OpenTelemetry as a follow-up.
- **Q3 (log sink):** stdout JSON sufficient for this sweep; sink (Loki/ELK/CloudWatch)
  deferred — envelope is portable when added.
- **Q4 (regression lint):** add a CI guard forbidding bare `console.*` / `print()`
  outside logger modules? Tracked as a leading indicator in `outcome-kpis.md`.

## Upstream Changes

- No DISCOVER artifacts exist for this feature (cross-cutting brownfield sweep). No
  prior DISCUSS/DESIGN decision changed. JOB-004 is additive to `jobs.yaml`;
  J-008 is catalogued as provisional in `journeys/_inventory.md` (not promoted).

## Hand-off

- **To DESIGN** (`/nw-design`, lightweight): a short ADR ratifying (a) the Node
  logger choice (Q1) and (b) the `ui/` `LogRecord` envelope as the cross-service
  standard + the correlation-id binding mechanism. The envelope already exists, so
  DESIGN is confirmation, not greenfield architecture.
- **To DISTILL** (`/nw-distill`): BDD acceptance tests from
  `journey-observability-sweep.feature` + the per-slice AC, and a `roadmap.json`
  ordered per `prioritization.md`. The redaction regression test and the
  end-to-end correlation-id assertion are first-class DISTILL deliverables.
- **To DEVOPS** (KPIs only): `outcome-kpis.md`.
