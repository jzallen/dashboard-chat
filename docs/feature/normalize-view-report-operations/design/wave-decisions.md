# DESIGN Wave Decisions — Normalize View/Report Operations (application scope)

**Wave:** DESIGN (application/component scope) · **Mode:** PROPOSE
**Author:** Morgan (nw-solution-architect) · **Date:** 2026-06-18
**Type:** brownfield evaluation (`wave:refactor`)
**Builds on:** domain pass — Option B, two aggregates sharing a typed
Derived-Relation kernel (`domain-model.md`, not re-litigated).
**Companion deliverables:** `evaluation.md`, `c4-component.md`,
`docs/decisions/adr-052-normalize-view-report-operations-ir.md`.

---

## Key Decisions

| # | Decision | Choice | Rejected alternatives |
|---|---|---|---|
| 1 | Normalized table shape | **Shared component tables keyed by `(parent_type, parent_id)`** — `relation_columns`/`_filters`/`_joins`/`_grain` shared; `relation_aggregations` report-only | 1A keep JSON / type Report dicts only (doesn't deliver flat IR); 1B parallel per-aggregate tables (re-duplicates kernel in schema) |
| 2 | Flat IR ordering | **`sequence` on joins only** (per-parent, declaration-ordered); `position` on columns (presentation); none on filters/grain/aggregations | 2A global `sequence` everywhere (correctness order on commutative components, meaningless across tables); 2C partial-order DAG (over-engineered) |
| 3 | Business-rule placement | **Confirm app-boundary placement; promote Report `columns_metadata` to Pydantic discriminated unions over `semantic_role`** (ADR-051 dec 5); retire hand-rolled `validate_columns_metadata` | keeping dict-soup + free-function validation (the diagnosed debt) |
| 4 | Renderer boundary | **One kernel visitor + report extension composes it** (ADR-051 dec 4); dispatch catalog per discriminator | 4A two independent compilers (kernel-render duplication); 4C merged compiler with mode branch (re-couples lifecycles) |
| 5 | Migration shape | **Expand/contract; joins backfilled by array position (not `created_at`); JSON cols retained one release** | timestamp-ordered backfill (loses declaration order); drop-JSON-immediately (no rollback safety) |

The throughline: realize the domain pass's Derived-Relation kernel **in the
schema and the renderer** — shared component tables express the kernel,
report-only aggregation is the additive structure, the report visitor *composes*
the kernel visitor. "Order is data only where the compiler honors it" — the
precise per-component reconciliation with ADR-051's global staging `sequence`.

---

## Reuse Analysis (hard gate — summary; full table in `evaluation.md`)

**Result: PASS.** Every overlap is EXTEND / REUSE / REPLACE / SHRINK of an
existing View artifact or the shared `DependencyService`.

- **EXTEND/promote:** `ViewColumn`→`ProjectionColumn`, `ViewJoin`→`Join`(+sequence),
  `ViewGrain`→`Grain`, `DependencyService`→kernel composition service (+no-mart-to-mart arm).
- **REUSE as-is:** `ViewFilterVariant` discriminated union (shared to both roles);
  the ADR-051 `sequence` *pattern* (applied to `relation_joins` only, NOT the staging table).
- **REPLACE:** `views.*`/`reports.columns_metadata` JSON columns → normalized rows;
  `validate_columns_metadata` → discriminated-union validation.
- **SHRINK:** `ReportIbisCompiler` → report-extension (keeps only aggregate-over-grain).
- **KEEP at app boundary:** `report_type`, `ReportRequiresDimension`, `InvalidReportReference`.

**CREATE NEW (justified):** 5 `relation_*` component tables (the user's explicit
ask; JSON arrays being replaced); `relation_aggregations` (report-only additive
structure the domain pass left open); the kernel render-module home (no current
module owns cross-role rendering — `sql_generator.py` owns it, `report_ibis_compiler.py`
duplicates it).

---

## Constraints (inherited + honored)

| Source | Constraint | How honored |
|---|---|---|
| ADR-026 | ibis is the only SQL compiler; no stored executable SQL; rules-as-data rejected | Component rows are data; SQL always re-derived; dispatch catalog is code, not a stored translation table; ibis-literal filter closure preserved unchanged (`sql_generator.py:328-364`) |
| ADR-051 | Operations-as-canonical-IR (staging tier) | Finding 2 operative decision STANDS (no fold into `transforms`); decision 4 (catalog + visitor) and decision 5 (boundary validation) applied verbatim; per-component `sequence` reconciliation |
| ADR-007 | ibis is the SQL generator | Kernel visitor + report extension emit via `ibis.to_sql(dialect="duckdb")` as today |
| `alembic-migration` skill | org_id indexing, SQLite/PG compat | Every component row carries indexed `org_id`; composite `(org_id, parent_type, parent_id)` index; `parent_type` String+CHECK; `uuidv7()` PK default; polymorphic cascade repository-enforced |
| Domain pass (Option B) | Two aggregates, shared kernel; rules at app layer | Shared *tables* (persistence sharing), NOT an aggregate merge; discriminator named `parent_type` not `kind` to avoid implying the rejected god-aggregate |

---

## Upstream Changes (pushbacks / amendments to prior passes)

- **ADR-051 decision 6 / non-goals — TAKEN UP, not amended.** ADR-051 explicitly
  deferred View/Report normalization to "a separate proposal." This ADR is that
  proposal. ADR-051's operative decision (don't fold into `transforms`) is
  preserved verbatim; only the deferral is closed.
- **Domain pass OQ-1 — RESOLVED.** "Whether the aggregation specialization is a
  nullable column-set on a shared table or an additive sidecar" → **additive
  sidecar** (`relation_aggregations`, report-only). Resolved in favor of the
  additive table because a nullable column-set on `relation_columns` would
  re-introduce mode-conditional fields (the Option-A smell).
- **No change required to the domain model.** This pass consumes the settled
  aggregate boundary and ubiquitous language without modification.

---

## Open questions (routed downstream)

| # | Question | Route |
|---|---|---|
| OQ-1 | Normalize `source_refs` into a `relation_sources` table (DFS→SQL)? | Separable follow-on; later pass / DELIVER stretch |
| OQ-2 | `fact`/`dimension` `report_type` — structural or label? | DISTILL (compiler ignores it today) |
| OQ-3 | `relation_grain` cardinality — one row per parent vs per key | DISTILL (one-per-parent matches `ViewGrain` 1:1) |
| OQ-4 | Polymorphic-cascade enforcement — repository path + CHECK vs trigger vs fallback to per-parent tables | DELIVER with the migration |

---

## Handoff

- **To solution-architect-reviewer (Atlas):** peer review of Decisions 1–5,
  the Reuse gate, and the ADR-051/ADR-026 composition.
- **To DISTILL (acceptance-designer):** the Acceptance Criteria in ADR-052
  (reproducibility, render-equivalence byte-identical across the migration,
  join-order honored, boundary-rejection, renderer-completeness, single-row
  write, tenant scoping) are the behavioral specs to turn into BDD tests.
  Render-equivalence is a characterization test that MUST exist before the
  renderer merge (brownfield walking-skeleton rule).
- **No DEVOPS / platform-architect handoff:** no external integration, no new
  runtime dependency, no topology change.
