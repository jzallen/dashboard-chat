# Open Questions for DESIGN

DISCUSS-wave deliverable. Four questions DESIGN must resolve as ADRs before DISTILL. Each question lists the constraints, the candidate answers with tradeoffs, and a *recommendation from DISCUSS* — but the recommendation is non-binding; DESIGN owns the decision.

These questions correspond to addenda A1-A4 in `definition-of-ready.md`.

## Vocabulary note

This revision pass retired "harness" as a category descriptor and removed "nwave" from product-name positions. Throughout this document:

- The category is **failure simulation**.
- The module is the **failure-simulation registry**.
- The legacy env var `NWAVE_HARNESS_KNOBS` is being deprecated in US-CONSOL-4 (read with warning, behavior preserved for one release).
- The `/debug/*` endpoints are **inspection probes**, not failure simulation — same gate, different category.

---

## Q1: Does a defense-in-depth flag survive alongside `ENVIRONMENT`, and what is it named?

### Context

Today, `NWAVE_HARNESS_KNOBS=true` is the single boolean gate. US-CONSOL-2 introduces `ENVIRONMENT` as a higher-order tier discriminator. Two clean designs exist; both work; the choice is values-driven.

**Naming constraint (new in this revision)**: the legacy `NWAVE_HARNESS_KNOBS` env var is being deprecated regardless of which design DESIGN picks. The `NWAVE_` prefix mistakenly suggests the flag is part of the nwave-ai SDLC tooling; nwave-ai is a developer tool, not part of the system under development. Whatever flag (if any) survives must NOT carry `NWAVE_*`. The legacy name remains readable during the transition (US-CONSOL-4 phase 2) with a deprecation warning at startup.

### Candidates

#### Q1.a — `ENVIRONMENT` subsumes the flag (single-source)

Behavior: no companion flag survives. The failure-simulation registry reads only `ENVIRONMENT` and honors knobs when value is `dev` or `ci`. The compose dev overlay sets `ENVIRONMENT=dev`. `NWAVE_HARNESS_KNOBS` is read for one release with deprecation warning, then removed.

**Tradeoffs**:

- One source of truth. No interaction matrix to reason about.
- Removes the legacy flag entirely — no carrying-cost.
- Loses defense-in-depth: a single env-var typo or misconfigured deploy is again the only line of defense (just shifted from `NWAVE_HARNESS_KNOBS` to `ENVIRONMENT`).
- Migration cost: the existing compose file and CI config both set `NWAVE_HARNESS_KNOBS`. All of those must be updated.

#### Q1.b — Both gates compose with AND (defense-in-depth)

Behavior: knobs fire only when `ENVIRONMENT in {dev, ci}` **AND** the defense-in-depth flag is true. Either gate alone blocks knobs. The defense-in-depth flag is *not* `NWAVE_HARNESS_KNOBS` — see naming candidates below.

**Defense-in-depth flag name candidates** (DISCUSS recommends one; DESIGN picks):

| Candidate | Pros | Cons | DISCUSS verdict |
|---|---|---|---|
| `FAILURE_SIMULATION_ENABLED` | Self-documenting; aligns with module/registry naming; industry-standard term; long-but-clear | Verbose (24 chars) | **RECOMMENDED** |
| `INJECT_FAULTS` | Short, imperative, aligns with chaos-eng convention | "inject" alone is less clear than "failure simulation"; could be confused with dependency injection in a TS codebase | runner-up |
| `FAILURE_SIMULATION` | Even shorter, same vocabulary | Lacks the `_ENABLED` boolean semantic | runner-up |
| `TEST_KNOBS_ENABLED` | Matches existing "knob" colloquialism | "test" is overloaded; the knobs are not the tests themselves | rejected — collides with general test infrastructure |
| `DEV_KNOBS_ENABLED` | "dev" hints at the right environment | Redundant with `ENVIRONMENT=dev`; might mislead operators into setting it in non-dev tiers | rejected |

DISCUSS recommends `FAILURE_SIMULATION_ENABLED` — it pairs with the module naming (`shared/failure-simulation/`), the audit log namespace (`failure-simulation.fired`), and the manifest filename (`failure-simulation.manifest.ts`). Consistency across all surfaces.

**Tradeoffs of Q1.b**:

- True defense-in-depth: an attacker (or accidental config) needs two simultaneous misconfigurations.
- Migration is additive — existing `NWAVE_HARNESS_KNOBS=true` is read for one release with deprecation warning, then replaced by `FAILURE_SIMULATION_ENABLED=true`.
- Interaction matrix is 4x2 = 8 cases to reason about (and document).
- Devon must set two env vars locally; one is more error-prone. (Mitigation: the dev compose overlay sets both by default.)

#### Q1.c — Per-knob opt-in (most flexible)

Behavior: `ENVIRONMENT` is the master gate. In `dev` and `ci`, knobs are *available*; whether each *individual knob* fires can be further gated by per-knob env vars. The legacy `NWAVE_HARNESS_KNOBS` is treated as one such per-knob flag (or is deleted as redundant).

**Tradeoffs**:

- Most flexible — Devon can disable a specific knob in a specific local run.
- Adds complexity for marginal benefit; nobody asked for this.
- Multiplies the configuration surface that operators must understand.

### DISCUSS recommendation: Q1.b with `FAILURE_SIMULATION_ENABLED` as the defense-in-depth flag

Rationale: the user's original prompt explicitly framed concern #2 as "Defense-in-depth is missing: the only gate is a single env var." Q1.b adds the second gate as the prompt requests. The 4x2 interaction matrix is documentable in the ADR; the safety gain is worth the documentation cost. Q1.a is cleaner but doesn't address the explicit concern.

**Whichever design DESIGN selects (Q1.a or Q1.b)**: `NWAVE_HARNESS_KNOBS` is deprecated in US-CONSOL-4 phase 2. The env var name itself is incorrect — it suggests the gate belongs to nwave-ai (a developer tool), when in fact it gates production-runtime test behavior. This naming correction is non-negotiable per the user's revision prompt.

---

## Q2: Where does the module live, and does it co-locate with the inspection probes?

### Context

The failure-simulation registry is the central abstraction owning the manifest, the gate, and the audit emission. The 6 knobs live in two services today (`ui-state/` for 5 of them, `agent/` for the debug/inspection endpoints). The registry's home determines whether the two services share code, share a schema, or duplicate logic.

ADR-033 says source-tree directories are named for the body of source they contain. The registry is *not* "tests" — it ships in production builds and is gated off there. Test directories are explicitly the wrong home.

**Additional question (new in this revision)**: the `/debug/*` endpoints are *inspection probes*, not failure simulation. They share the ENVIRONMENT gate but are a different category. Where do they live?

### Candidates

#### Q2.a — `ui-state/lib/failure-simulation/` (single home, ui-state owns it)

Behavior: the registry lives in `ui-state/lib/failure-simulation/`. The agent service imports it via a shared package or relative path. The audit emission for agent-side knobs travels through ui-state. Inspection probes stay in `agent/lib/inspection/` (separate category, separate location, shared gate.)

**Tradeoffs**:

- Single owner, single location, single test surface.
- Cross-service import is awkward — agent doesn't otherwise depend on ui-state.
- Violates "source tree named for body of source it contains" if it's logically shared between services.

#### Q2.b — `shared/failure-simulation/` (cross-cutting shared package) — DISCUSS RECOMMENDED

Behavior: the registry lives in `shared/failure-simulation/` alongside the existing `shared/chat/` package. Both `ui-state/` and `agent/` import from it as a workspace dependency. Inspection probes live in `agent/lib/inspection/` and import the gate logic from `shared/failure-simulation/gate.ts` (gate-sharing, no category-mixing).

**Tradeoffs**:

- Honors the existing `shared/` convention (one precedent: `shared/chat/` per CLAUDE.md).
- Single source of truth across services.
- Manifest schema is naturally co-located with the gate logic.
- Inspection probes share the gate but stay categorically separate — clean boundary.
- Requires workspace dependency wiring (probably trivial given existing `@dashboard-chat/shared-chat`).

#### Q2.c — Per-service modules with shared schema only

Behavior: each service has its own `lib/failure-simulation/` implementing the gate locally; only the manifest schema (a TypeScript type, JSON schema, or YAML) lives in `shared/`.

**Tradeoffs**:

- Minimal coupling; each service evolves independently.
- Duplicates the gate logic and the audit emission.
- Drift risk: ui-state and agent could implement the gate inconsistently.

### DISCUSS recommendation: Q2.b (`shared/failure-simulation/`)

Rationale: a precedent already exists (`shared/chat/` per CLAUDE.md, "Single source of truth for the chat event schema"). The failure-simulation registry is exactly that pattern — single source of truth for cross-service test-mode behavior. Q2.a violates ADR-033's spirit (the registry is not logically owned by ui-state, just historically located there). Q2.c invites the drift problem the consolidation is meant to solve.

### Category boundary recommendation

The failure-simulation registry and the inspection probes share the ENVIRONMENT gate, but they are categorically distinct:

| Category | Purpose | Module home | What's in the manifest? | Audit log? |
|---|---|---|---|---|
| Failure simulation (write-side) | Force deterministic failures | `shared/failure-simulation/` | Yes — 6 knobs | Yes — `failure-simulation.*` |
| Inspection probes (read-side) | Observe internal state | `agent/lib/inspection/` | No — not knobs | No — request log already covers it |

Both consume the gate from `shared/failure-simulation/gate.ts`. Inspection probes register their Hono routes conditionally based on the same `ENVIRONMENT` check. The boundary is: anything that *forces* behavior is failure simulation (manifest-registered); anything that only *reads* state is an inspection probe (not manifest-registered).

DESIGN may choose to override this boundary — for example, co-locating inspection probes inside `shared/failure-simulation/` for simplicity. The cost is muddier category vocabulary; the gain is one fewer module. DISCUSS leans toward keeping them separate for vocabulary clarity, but flags it as a DESIGN call.

---

## Q3: What's the audit log sink?

### Context

US-CONSOL-3 specifies that every knob invocation emits a structured audit entry. The sink — where those entries are written — is a separate concern. Three candidates with different tradeoffs.

**Naming update (new in this revision)**: audit log event names are `failure-simulation.fired`, `failure-simulation.rejected`, `failure-simulation.unknown` (formerly `harness.knob.*`). The startup gate-verdict log is `failure-simulation.gate.enabled` / `.disabled` (formerly `harness.gate.*`).

### Candidates

#### Q3.a — Structured stdout (JSON lines) — DISCUSS RECOMMENDED

Behavior: the registry calls `console.log(JSON.stringify({...}))` on each invocation. Container logs collect the entries; operators query via standard log tooling.

**Tradeoffs**:

- Zero new infrastructure.
- Works in every environment (dev, ci, staging, production — though staging/prod only emit `rejected` entries).
- Already the dominant logging pattern in the codebase.
- Querying requires log-aggregation tooling that may not exist for local dev.
- Mixed with general request logs — needs structured fields (event name prefix `failure-simulation.`) to filter.

#### Q3.b — Dedicated Redis stream

Behavior: the registry pushes entries into a Redis stream (e.g. `ui-state:failure-simulation:audit`). The stream is read-only for operators; it has a TTL.

**Tradeoffs**:

- Queryable independently of general logs.
- Survives container restart (with appropriate stream config).
- Introduces a Redis dependency for the agent service (which doesn't currently use Redis the way ui-state does).
- Adds a new operational concern (stream pruning).

#### Q3.c — OpenTelemetry spans/events

Behavior: each knob invocation is emitted as an OTel span event (or a child span) attached to the originating request's trace.

**Tradeoffs**:

- Automatically correlated with the request trace (correlation id is "free").
- Integrates with whatever observability stack the project adopts.
- Requires OTel instrumentation that may not be present yet.
- Heavier dependency than the use case warrants.

### DISCUSS recommendation: Q3.a (structured stdout)

Rationale: zero new infrastructure, works everywhere, matches existing patterns. The use case is debugging acceptance scenarios and answering "did this knob fire in staging?" — both questions are well-served by structured JSON in container logs. The `failure-simulation.*` event-name prefix makes filtering trivial. Q3.b and Q3.c are over-engineered for the present need; either could be a future evolution if the team adopts a richer observability story.

---

## Q4: Naming scheme — header convention, event names, body fields

### Context

Today's surface uses three conventions: `X-Force-*` headers, `__harness_*` events, and `harness_force_*` body fields. The intent is the same across all three — force a deterministic failure at a port boundary. The conventions emerged organically.

ADR-029 says `X-Active-Scope` is a production contract header. The new naming scheme must remain visually distinct from production headers. Test-only knobs and production headers cannot collide.

The user's revision prompt explicitly noted: *"`X-Force-*` headers — already fine? Or rename to `X-Inject-*`? Your call."* and *"`harness_force_reissue_failures` body field → renamed (e.g. `force_reissue_failures` — verb-only)"* and *"force is precise."*

DISCUSS interprets this as: prefer verb-only naming; `X-Force-*` is the established precise convention for headers; events and body fields lose the `harness_` prefix.

### Decision (DISCUSS recommends, DESIGN ratifies)

#### Headers: keep `X-Force-*` (no rename)

Rationale:

- `X-Force-*` is already precise and self-documenting (`X-Force-Create-Session-Failure` reads as English).
- Adding a category prefix (`X-Inject-Force-*` or `X-Fault-Inject-*`) is verbose-redundant.
- The user's revision prompt explicitly stated "force is precise" — keeping the convention honors that.
- Wire-compatibility with existing acceptance scenarios is preserved — no test fixtures need updating for headers.
- Visual distinction from production headers (`X-Active-Scope`, `X-Org-Id`) is already strong; "force" cues test-only intent unambiguously.

Examples (unchanged from today):

| Knob canonical name | HTTP header |
|---|---|
| `force-create-project-failure` | `X-Force-Create-Project-Failure` |
| `force-list-sessions-failure` | `X-Force-List-Sessions-Failure` |
| `force-create-session-failure` | `X-Force-Create-Session-Failure` |

#### Events: drop the `__harness_` prefix → verb-only

Rationale:

- The `harness_` prefix is part of the overloaded "harness" vocabulary being retired.
- Verb-only names are precise without a category prefix (XState event names are already namespaced by the actor that handles them).
- The leading/trailing double-underscores (`__name__`) survive as the XState convention for synthetic/test-only events.

Renames (land in US-CONSOL-4 phase 2):

| Old name | New name |
|---|---|
| `__harness_force_failure__` | `__force_failure__` |
| `__harness_expire_token__` | `__expire_token__` |

#### Body fields: drop the `harness_` prefix → verb-only

Rationale: same as events.

Renames (land in US-CONSOL-4 phase 2):

| Old name | New name |
|---|---|
| `harness_force_reissue_failures` | `force_reissue_failures` |

#### Canonical manifest names (transport-agnostic)

The manifest's canonical name is verb-noun, kebab-case, transport-agnostic:

| Canonical name | Transport rendering |
|---|---|
| `force-create-project-failure` | header: `X-Force-Create-Project-Failure` |
| `force-list-sessions-failure` | header: `X-Force-List-Sessions-Failure` |
| `force-create-session-failure` | header: `X-Force-Create-Session-Failure` |
| `force-reissue-failures` | body field: `force_reissue_failures` |
| `force-failure-tag` | XState event: `__force_failure__` |
| `expire-token` | XState event: `__expire_token__` |

Devon writes the canonical name in the manifest; the registry knows how to render it per transport.

### Q4 candidates considered and rejected

#### Q4.alt-1 — Rename headers to `X-Inject-Force-*`

Rejected: verbose-redundant. "Force" already implies a deliberate test-only override; "inject" adds a syllable without adding clarity.

#### Q4.alt-2 — Rename headers to `X-Failure-Simulation-*`

Rejected: the category prefix matches the registry name (`shared/failure-simulation/`), which is internally consistent, but the wire-cost is high (every acceptance fixture changes) and the gain is small. If DESIGN concludes the category-prefix consistency is worth the wire-cost, this is a viable alternative — but DISCUSS leans toward keeping `X-Force-*` because the cost/benefit favors stability.

#### Q4.alt-3 — Keep events/body fields prefixed (`__harness_*`, `harness_*`)

Rejected: violates the user's explicit "retire harness as a category descriptor" instruction.

### DISCUSS final recommendation on Q4

- Headers: `X-Force-*` (unchanged)
- Events: drop `harness_` prefix → `__force_failure__`, `__expire_token__`
- Body fields: drop `harness_` prefix → `force_reissue_failures`
- Canonical manifest names: verb-noun, kebab-case, transport-agnostic

Migration: US-CONSOL-4 phase 2 lands the event and body-field renames atomically (production + acceptance fixtures in the same commit). Headers are unchanged.

---

## Summary table

| # | Question | DISCUSS recommendation | DESIGN owns final decision |
|---|---|---|---|
| Q1 | Defense-in-depth flag + name | Q1.b with `FAILURE_SIMULATION_ENABLED` | yes |
| Q2 | Module location + category boundary | Q2.b (`shared/failure-simulation/`); inspection probes stay in `agent/lib/inspection/` | yes |
| Q3 | Audit log sink | Q3.a (structured stdout) with `failure-simulation.*` event-name prefix | yes |
| Q4 | Naming scheme | Headers unchanged (`X-Force-*`); events/body fields drop `harness_` prefix | yes |

All four recommendations compose: Q1.b + Q2.b + Q3.a + Q4 (as recommended) is a coherent design. DESIGN may adopt all four, override any, or propose alternatives. The DISCUSS-wave deliverable does not block on these decisions — it surfaces them.

## Naming decisions made in this revision pass (for DESIGN to sanity-check)

These are decisions DISCUSS made under the user's instruction "make the reasonable call and continue" — they should be reviewed by DESIGN and either ratified into ADRs or overridden:

1. **Module category**: "failure simulation" (not "harness", not "test infrastructure", not "knobs subsystem")
2. **Module home (recommended)**: `shared/failure-simulation/`
3. **Manifest filename**: `failure-simulation.manifest.ts`
4. **Audit log event-name prefix**: `failure-simulation.*` (e.g. `failure-simulation.fired`)
5. **Gate startup log event names**: `failure-simulation.gate.enabled` / `failure-simulation.gate.disabled`
6. **Defense-in-depth flag name (if DESIGN picks Q1.b)**: `FAILURE_SIMULATION_ENABLED`
7. **HTTP header convention**: unchanged from today — keep `X-Force-*`
8. **XState event renames**: drop `__harness_` prefix → verb-only (`__force_failure__`, `__expire_token__`)
9. **Body field rename**: drop `harness_` prefix → `force_reissue_failures`
10. **`/debug/*` endpoint category**: "inspection probes" — distinct from failure simulation, shared ENVIRONMENT gate
11. **`NWAVE_HARNESS_KNOBS`**: deprecated in US-CONSOL-4 phase 2 (read with warning; behavior preserved one release; then removed)
