# Wave Decisions — `ibis-as-only-sql-compiler` — DISTILL

**Feature:** ibis-as-only-sql-compiler
**Wave:** DISTILL (acceptance test design)
**Date:** 2026-05-11
**Author:** Quinn (nw-acceptance-designer), under crew dispatch
**Prior wave:** DESIGN (ratified as [ADR-026](../../../decisions/adr-026-ibis-as-only-sql-compiler.md) on 2026-05-11, merged at `ef65252`)
**Routing:** per [docs/research/nwave-brownfield-approach.md](../../../research/nwave-brownfield-approach.md) §"Routing matrix", refactoring with ratified architecture enters at DISTILL — DIVERGE/DISCOVER/DISCUSS/DESIGN are not re-run.

---

## Reconciliation Result

**Reconciliation passed — 0 contradictions.**

ADR-026 §"Decision outcome" enumerates four contracts (tier-by-tier ibis adoption; dbt macro emission via ibis-source plugin; no backfill / no grandfather / no flag-gate for legacy report SQL; no free-text `expr` escape hatches on `addDimension` / `addMeasure`). Each is expressible as one or more observable outcomes a scenario can assert. Acceptance scenarios derive verbatim from those contracts plus the §"MR roadmap" sequencing (5 MRs, MR-1 + MR-3 carry new behavior). No back-propagation question opened against ADR-026; no [`adr-026-distill-blocker.md`](../../../research/adr-026-distill-blocker.md) was written.

DISCUSS / DIVERGE / DISCOVER were intentionally skipped per CLAUDE.md brownfield routing (refactoring with ratified ADR enters at DISTILL). DEVOPS and SPIKE were never run — this is a behavior-preserving refactor with no new substrate dependency, no new external integration, no new deployment topology, per ADR-026 §"Consequences → Operational". Story-to-scenario traceability is skipped (no user stories — the contract source is the ADR).

---

## Decisions

### [DWD-1] Walking-skeleton strategy: Strategy C — Real local + skip-when-unavailable

The walking skeleton runs against a real local DuckDB engine via the existing
v2 driver pattern (the dbt-test-validation Phase-0/Phase-1 driver
infrastructure at `backend/tests/integration/dataset_layer/eject/` is already
production for in-process dbtRunner + DuckDB profile seeding). For Phase 01's
walking-skeleton acceptance, the ibis compiler's output is rendered to SQL,
the dbt eject is produced through the existing `_dbt` pipeline, and the
intermediate model is evaluated against seeded orders data through DuckDB.

**Why Strategy C and not A/B**:
* Strategy A (real I/O always-on, no skip) would fail in CI environments
  without DuckDB-able fixtures and would burn unnecessary compose stack
  spin-up time for what is fundamentally a compile-then-evaluate test.
* Strategy B (in-memory doubles) would silently pass even if the ibis
  compiler emitted broken SQL — Mandate 6 litmus test (Dim 9d). Disqualified
  for the same reason ADR-019's Strategy C disqualified mock-only paths.
* Strategy C is what the v2 driver already established for dbt-test-validation
  and what ADR-019 ratified for in-process probes. Reuse it.

Walking-skeleton scenario tagged `@walking_skeleton @driving_adapter` per the
test-design-mandates skill convention. Milestone scenarios tagged `@pending`
at the Feature level; unpend per phase in the roadmap.

### [DWD-2] Test location: `tests/acceptance/ibis-as-only-sql-compiler/` (new suite, created in Phase 01)

The DISTILL artifacts (`.feature` files, this doc, roadmap.json,
upstream-issues.md) live at `docs/feature/ibis-as-only-sql-compiler/distill/`
per the nwave feature-directory convention.

The executable acceptance suite (step-glue + conftest + pyproject.toml) will
be created at `tests/acceptance/ibis-as-only-sql-compiler/` in Phase 01 as
part of MR-1. It is a NEW suite, not an extension of
`tests/acceptance/dbt-test-validation/`, because:

* The driving ports are different — view-creation use case + report-creation
  use case (this feature) vs `DatasetLayerHarness.eject_and_test` /
  `validate_after` (dbt-test-validation). Sharing a suite would conflate
  contracts that have no overlap.
* The dependency closure is smaller — this suite needs DuckDB + ibis but NOT
  Pandera, NOT dbtRunner-as-probed-substrate. A dedicated suite means a
  tighter `pyproject.toml`.
* The convention established by ADR-019's DISTILL pass at
  `tests/acceptance/dbt-test-validation/` is "one suite per feature, owned
  pyproject.toml". Follow it.

The merge queue's backend gate (`./tools/test/test.sh --backend`) does NOT run
acceptance suites by default; acceptance suites run via
`cd tests/acceptance/ibis-as-only-sql-compiler && uv run --no-project pytest`
per the CLAUDE.md acceptance-suite pattern.

### [DWD-3] Walking-skeleton contract: filter clause present in BOTH compiled SQL and dbt eject — plus row-level equivalence

The walking skeleton asserts THREE outcomes, not just wiring:

1. The compiled view SQL contains the expected WHERE clause restricting
   region to "west".
2. The customer's dbt export contains an intermediate model file whose SQL
   ALSO restricts region to "west" (the dbt-ref renderer path).
3. Evaluating the compiled view against seeded orders data returns ONLY the
   "west" rows.

**Why three assertions, not one**: ADR-026 §"Decision outcome" item 1 binds
the dbt-eject path into the contract surface ("dbt eject fidelity. The ibis
output must round-trip through dbt's `{{ ref(...) }}` macro shape without
loss"). A wiring-only assertion (e.g., "the eject ran") would leave the
ref-macro-emission gap uncovered. The third assertion (row equivalence)
catches the case where the SQL is syntactically valid but semantically wrong
— the customer-faithfulness invariant from ADR-026 §"Decision drivers → dbt
eject fidelity".

This is a TIGHTER walking-skeleton contract than dbt-test-validation's DWD-9
(which was scoped to `models_built >= 1 AND tests_run >= 1` wiring proof).
Justification: this feature's contract is SQL correctness, not test-execution
plumbing. Row-level evaluation is the contract surface. The fixture is
deterministic (one CSV file, three regions) so non-determinism is not a risk
the way it was for the chat-driven walking skeleton in ADR-019.

### [DWD-4] Injection-vector scenario: assert at compiler-output level AND at evaluation level — choose ibis literal escaping as the closure mechanism

The `@security_invariant` scenario in `milestone-1-view-ibis-compiler.feature`
asserts FOUR observable outcomes:

1. The compiled view SQL is well-formed and executable.
2. Evaluating the compiled view against seeded orders data returns zero rows
   (the injection payload `'; DROP TABLE projects; --` is not a region value).
3. The `projects` table is still present and unchanged after evaluation
   (the DROP TABLE was not executed).
4. The persisted view definition stores the injection payload as the filter's
   literal value, not as embedded SQL syntax.

**Closure mechanism**: per ADR-026 §"Decision drivers → SQL injection defense
by construction" and §"Decision outcome", the closure is **ibis literal
escaping** — `f.value` flows through `ibis.literal(...)` (or the implicit
literal coercion inside `table.filter(table.region == value)`), not through
f-string interpolation. NO separate Pydantic validator on the `value` field is
required for the injection contract. NO `.replace("'", "''")` defense is
introduced. NO sqlglot post-hoc AST validation is introduced (rejected as
Option C in ADR-026).

This is a HARD constraint for DELIVER. If the implementer reaches for any of
the three rejected defenses to make the scenario green, that is a sign the
ibis composition is wrong and should be revisited — not a sign that the
contract needs to be relaxed.

The DELIVER reviewer (per Phase 01 manual review gate in roadmap.json) is
specifically directed to verify the closure mechanism is ibis literal
escaping.

### [DWD-5] Deprecation-contract test: backend USE-CASE boundary (not Pydantic schema layer)

The `@deprecation_contract` scenario in `milestone-2-report-ibis-compiler.feature`
asserts that a `createReport` call carrying the deprecated `sqlDefinition`
field is rejected with a structured error.

**Boundary choice — use-case-level rejection**: the rejection happens inside
`app.use_cases.report.create_report` (the use-case facade) rather than at the
Pydantic schema layer (controller boundary). Justification:

* The Pydantic schema for the HTTP request body could simply omit the
  `sql_definition` field — Pydantic ignores unknown fields by default.
  That's invisible to the analyst (silent drop) and doesn't satisfy the
  contract that the analyst sees a NAMED deprecation error.
* The use-case boundary is the cleanest place to emit a structured
  deprecation error that names the deprecated field. The decorator stack
  (`@handle_returns` / `@with_repositories`) returns it through the existing
  Result/Failure path, where the controller renders it as a 400 with a
  structured body.
* The agent's TS tool schema also drops the field in MR-3 (per ADR-026
  §"Decision outcome" item 2 — `createReport.sqlDefinition` is removed from
  the tool schema). So in practice the agent will not send the field after
  MR-3; the use-case-level rejection is the defense-in-depth contract for
  any caller (curl, headless PAT, internal scripts) that has not been
  updated.

The boundary contract for the `expr`-removed assertion is different and
documented separately in the milestone-2 feature docblock: the `expr` field
on `addDimension` / `addMeasure` is removed at the AGENT'S TOOL-SCHEMA layer
(Zod schema in `agent/lib/chat/reportToolDefinitions.ts`), because that is
the first port the analyst's call hits and there is no symmetric backend
endpoint that receives `expr` today (the dispatchers don't exist; MR-3 wires
them up WITHOUT the field).

---

## Citations & sources

The decisions above derive from:

* **[ADR-026](../../../decisions/adr-026-ibis-as-only-sql-compiler.md)** §"Decision drivers", §"Decision outcome" (4 items), §"Consequences → Positive" (closes Gap 1, closes Gap 2, reconciles model_sql.py), §"MR roadmap" (5-MR sequencing), §"References → Files in scope across the 5 MRs".
* **[`docs/research/deterministic-sql-construction-architecture.md`](../../../research/deterministic-sql-construction-architecture.md)** §1.7 (ten-path inventory), §3 (Gap 1 / Gap 2 / Gap 3), §5 (where agent dynamism lives — informs dispatcher boundaries), §6 (5-step roadmap).
* **[`docs/research/nwave-brownfield-approach.md`](../../../research/nwave-brownfield-approach.md)** §"Routing matrix" (refactoring → DESIGN → DISTILL → DELIVER), §"The Iron Rule and characterization tests" (Feathers brownfield pattern — relevant to Phase 02 and Phase 05's characterization-test exit criteria).
* **[ADR-007](../../../decisions/adr-007-ibis-for-sql-generation.md)** (precedent — ibis ratified for staging tier; not re-litigated here).
* **CLAUDE.md** Backend conventions (decorator stack, RepositoryContainer, RestrictedSession, org-scoping — all unchanged by this refactor per ADR-026 §"Decision drivers → CLAUDE.md constraints honored").
* **dbt-test-validation precedent**: `docs/feature/dbt-test-validation/distill/wave-decisions.md` (DWD-1, DWD-2, DWD-8, DWD-9 informed the strategy/location/scope decisions above).

---

## Scope of acceptance scenarios

| MR | New behavior contract? | Acceptance scenarios in this DISTILL pass? |
|---|---|---|
| MR-1 ViewIbisCompiler | YES — closes Gap 1, new compiler, Pydantic discriminated union | 5 scenarios in `milestone-1-view-ibis-compiler.feature` + walking skeleton |
| MR-2 dbt ibis-source plugin | NO — behavior-preserving refactor, walking-skeleton + milestone-1 dbt-eject-equivalence scenario covers the customer-visible invariant | 0 new scenarios (characterization tests in DELIVER) |
| MR-3 ReportIbisCompiler | YES — closes Gap 2, new compiler, dispatcher wiring, `sqlDefinition` removed, `expr` removed | 5 scenarios in `milestone-2-report-ibis-compiler.feature` |
| MR-4 lake-repo quote_ident | NO — internal hygiene, no customer-visible surface change | 0 new scenarios (repository unit tests cover it) |
| MR-5 model_sql.py reconciliation | NO — behavior-preserving refactor, eliminates parallel-compiler hazard | 0 new scenarios (characterization tests in DELIVER, per CLAUDE.md brownfield) |

**Total acceptance scenarios authored in this DISTILL pass: 11** (1 walking skeleton + 5 milestone-1 + 5 milestone-2). One milestone-1 scenario is a Scenario Outline with 12 example rows (the operator coverage matrix), so the effective example count is 22.

**Error-path coverage**: 5 of 11 scenarios are error/rejection-shaped
(injection-vector closure, malformed operator rejection, sqlDefinition
deprecation rejection, empty-dimensions rejection, expr-field rejection) =
**45%**, comfortably above the 40% test-design-mandates floor.

---

## Hand-off

**Next wave**: `/nw-deliver` (nw-software-crafter) — implements the
ViewIbisCompiler, then the ibis-source plugin, then the ReportIbisCompiler,
then the lake-repo hygiene fix, then the model_sql.py reconciliation. Outside-In
TDD: walking skeleton MUST go GREEN first; each milestone scenario unpends
one at a time per phase.

**Recipient package for DELIVER**:
* This file (`wave-decisions.md`) — strategy + boundary decisions
* `roadmap.json` — 5-phase sequencing with exit criteria + manual review gates
* The three `.feature` files — scenario SSOT
* `upstream-issues.md` — back-propagation log (empty as of DISTILL hand-off)
* ADR-026 + the research doc — unchanged, governing
* The v2 driver infrastructure at `backend/tests/integration/dataset_layer/eject/` (precedent for Strategy C)

**Out of scope for DELIVER (do NOT change)**:
* ADR-024 (rebalance closed yesterday)
* ADR-025 (named query objects — sibling concern, different layer per ADR-026 §"Cross-decision composition")
* ADR-026 itself (Accepted, immutable)
* The Pandera per-turn validation test home (Phase 4b of dbt-test-validation already ported it)
* The CEL evaluation (rejected; preserved in `docs/research/ibis-cel-deterministic-sql.md` because the worked examples are still load-bearing)
