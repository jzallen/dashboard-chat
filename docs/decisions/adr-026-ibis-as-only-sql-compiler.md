<!-- DES-ENFORCEMENT : exempt -->
# ADR-026: Ibis as the Only SQL Compiler

**Status:** Accepted
**Date:** 2026-05-11
**Originating wave:** DESIGN (entered directly per CLAUDE.md brownfield routing; architecture decision with cause known)
**Bead:** TBD (assigned at MR-1 kickoff)
**Companion artifacts:**
- Source research: `docs/research/deterministic-sql-construction-architecture.md`
- Prior research (CEL evaluation, ADOPT_SIMPLER): `docs/research/ibis-cel-deterministic-sql.md`
- Precedent this ADR generalizes: `docs/decisions/adr-007-ibis-for-sql-generation.md`
- Sibling-style ADRs: `docs/decisions/adr-020-metadata-repository-split.md`, `docs/decisions/adr-025-named-query-objects.md`
- Feature directory (created at MR-1 kickoff): `docs/feature/ibis-as-only-sql-compiler/` (TBD)

## Context

SQL is constructed in **ten distinct sites** across four tiers of the codebase
— staging, view, report, query-engine DDL, and lake-repository internals —
with three different determinism postures. The research doc's §1.7 inventory
table is the authoritative enumeration; the salient summary:

* **Staging tier — already ibis-compiled.** `backend/app/models/dataset_sql.py:44-66`
  turns a dataset's `name` + `schema_config` + `transforms` into DuckDB SQL via
  `ibis.table(...).mutate(...).filter(...).rename(...)` then
  `ibis.to_sql(dialect="duckdb")`. Every user-supplied value flows through ibis
  literals, never substring interpolation. **Deterministic-typed.** This is
  ADR-007 applied end-to-end.
* **View tier — hand-rolled f-strings.** `backend/app/use_cases/view/sql_generator.py:106-161`
  builds SELECT/FROM/JOIN/WHERE by f-string concatenation. The WHERE branch at
  `sql_generator.py:160` is the primary determinism gap:
  ```python
  conditions.append(f"{col_ref} {op} '{f.value}'")
  ```
  `f.value` originates from the agent's `addFilter` tool surface
  (`agent/lib/chat/viewToolDefinitions.ts:106`, `value: z.string().optional()`)
  and is interpolated unescaped into both the persisted view SQL and the dbt
  eject. **Non-deterministic (WHERE), quasi-deterministic elsewhere on this
  path.**
* **Report tier — free-form LLM-emitted SQL.** `backend/app/use_cases/report/create_report.py:24,77`
  accepts `sql_definition: str` from the agent
  (`agent/lib/chat/reportToolDefinitions.ts:58`, `sqlDefinition: z.string()`),
  validates only the source-reference shape, and persists it as the report's
  SQL definition. The `addDimension` / `addMeasure` tools
  (`agent/lib/chat/reportToolDefinitions.ts:92-125`) exist as the *intended*
  structured replacement but **have no backend dispatcher today** — they are
  dormant. **Non-deterministic.**
* **Query-engine DDL and lake-repository internals.** Quasi-deterministic with
  defensive `quote_ident()` and validated identifiers; not customer-facing for
  the lake-repo paths; deliberate bounded-template designs. Lake-repo column
  interpolation (`backend/app/repositories/lake/repository.py:214-247` and
  `:266-277`) has a small hygiene gap (Gap 3 in the research doc).
* **dbt model SQL (parallel cleaning-op compiler).**
  `backend/app/use_cases/project/_dbt/model_sql.py:13-207` re-implements the
  cleaning operations as dbt CTEs with literal escaping
  (`.replace("'", "''")`). It is a *parallel compiler* to the staging tier's
  ibis pipeline — same input (`expression_config`), different output (dbt CTE
  vs ibis SQL). Both must stay in sync as new operations are added.

The agent's value is **creative tool selection plus typed parameter selection
plus multi-step composition**; SQL emission is currently inconsistent —
sometimes ibis (staging), sometimes hand-rolled f-strings (view), sometimes
LLM-emitted text (report). The architecture's tier discipline lives in the
tool surface but is undermined the moment the SQL emission layer accepts
free-form text from the agent.

Research doc §1.7 tabulates the ten paths; §2 maps each agent tool to its
backend handler and SQL path; §3 names the three concrete gaps; §5 walks
through two worked examples showing how agent dynamism is preserved when the
SQL-emission layer is ibis end-to-end.

## Decision drivers

* **Determinism by construction.** Every SQL artifact the system emits — view
  SQL, report SQL, dbt eject, query-engine DDL — must be produced by a
  deterministic compiler, regardless of whether the trigger is a human, an
  agent, or a sync loop. (Research doc §3 Gap 1, Gap 2.)
* **Agent dynamism preservation.** The agent's value-add lives at tool
  selection, typed parameter selection, multi-step composition, and
  conversational repair — not at SQL emission. The destination architecture
  preserves all four. (Research doc §5.)
* **Single SQL compiler per dialect.** One ibis → DuckDB compiler for the
  eject path; one ibis → Postgres compiler for the query-engine sync. No
  parallel hand-rolled compiler shadows it (closes the `model_sql.py` /
  `dataset_sql.py` divergence hazard).
* **SQL injection defense by construction, not by post-hoc validation.** Ibis
  literals close `ViewFilter.value` (Gap 1) and `createReport.sqlDefinition`
  (Gap 2) without requiring a sqlglot AST-validation pass or a regex audit.
* **dbt eject fidelity.** Customer-visible SQL stays customer-faithful; the
  eject path is part of the SQL contract, not an afterthought. The ibis
  output must round-trip through dbt's `{{ ref(...) }}` macro shape without
  loss.
* **Earned Trust (principle 12).** No new substrate dependency. Ibis is
  already ratified by ADR-007 and in production at the staging tier. This ADR
  extends ibis's reach across the codebase; it does not introduce a new
  technology. ADR-019's probe contract is unaffected.
* **CLAUDE.md constraints honored.** The use-case decorator stack
  (`@handle_returns` / `@with_repositories`), `RepositoryContainer`,
  `RestrictedSession` injection, and org-scoping discipline are all unchanged
  — this ADR sits **below** all of them at the SQL-compilation layer.

## Considered options

Transcribed and condensed from research doc §4.

### A — Closed tool surface, ibis-only big-bang

Every backend handler becomes a typed Pydantic dispatcher; every dispatcher
composes ibis ops; the report tier's `addDimension` / `addMeasure` tools are
wired up; `createReport.sqlDefinition` is removed; all three migrations land
in one MR.

**Verdict:** Right destination, wrong delivery cadence. Adopt as the target
shape; do not ship in a single MR. The view-tier and report-tier migrations
have meaningfully different risk profiles and the dbt-eject contract change
deserves its own MR boundary.

### B — Tiered ibis adoption. **CHOSEN, composed with Option A as destination.**

Tier-by-tier migration. Staging is done (ADR-007). View next (MR-1; closes
Gap 1). dbt intermediate next (MR-2). Report tier next (MR-3; closes Gap 2).
Lake hygiene (MR-4) and the `model_sql.py` reconciliation (MR-5) round out
the sequence.

**Verdict:** Same destination as A, deliverable iteratively, fixes the
highest-severity gap first, keeps each MR bounded and individually
shippable.

### C — Hybrid with policy guard

Keep f-strings where validated; add a Pydantic validator on
`ViewFilter.value` and a `.replace("'", "''")` defense at
`sql_generator.py:160`; layer a sqlglot AST-validation pass over
`createReport.sqlDefinition`.

**Verdict:** Doesn't fix Gap 2 — raw SQL is the problem, and sqlglot AST
validation is post-hoc syntactic policing, not deterministic construction.
Leaves two parallel compilers (Path 1 ibis vs Path 3 f-strings) — a known
maintenance hazard already in tension with Path 10 (`model_sql.py`).
Acceptable as a 1-day stopgap before MR-1 ships, not a destination.

### D — Two-mode ibis-first with manual-SQL escape hatch

Default ibis tools; an explicit "manual-SQL-needed" capability the backend
admits behind a heavy-review path.

**Verdict:** Reject. The escape hatch IS `createReport.sqlDefinition` today
(de facto). Codifying it makes the gap permanent. Heavy-review paths in an
autonomous-agent context are an oxymoron. The expressiveness-vs-determinism
tension the user raised is solved by *expressive ibis composition*, not by a
SQL escape hatch — **ibis is itself the dynamic surface**.

### Why Option B wins

Determinism and agent dynamism are not a trade-off because they live at
different layers. Determinism is enforced at the SQL-emission layer (ibis
owns it). Dynamism lives at the tool-selection and parameter-selection
layers (the LLM owns those). Option B migrates the SQL-emission layer
without touching the tool surface — the agent's typed creativity at the
staging tier today is the proof of concept for what view and report should
look like.

## Decision outcome

**Option B — tiered ibis adoption, with Option A as the destination
architecture.**

### What this means

**1. dbt macro emission via an ibis-source plugin.** The dbt intermediate
layer's current post-render `sql.replace(ref_id, "{{ ref('...') }}")`
(`backend/app/use_cases/project/_dbt/intermediate.py:34-38`, today reached
only via the legacy `view.sql_definition` fallback) is replaced by an
ibis-native rendering path. The chosen shape is an ibis `Source` subclass /
custom-backend hook that renders dbt-ref placeholders as `{{ ref('...') }}`
macros directly in the compiled SQL, eliminating the regex round-trip. The
exact subclass shape — `Source` vs. a custom-backend hook — is MR-2 design
scope, not this ADR's concern. The ibis extensibility surface is documented
at <https://ibis-project.org/concepts/backends> and
<https://ibis-project.org/how-to/extending/>.

**2. No backfill, no grandfather, no flag-gate for legacy report SQL.**
Pre-production codebase; no users depend on the legacy authoring surface.
In-place reports authored against the old `createReport.sqlDefinition` shape
are throwaway. MR-3 removes `sqlDefinition` from the tool schema and from
the backend use case in one cut. Any existing report rows with raw SQL are
cleared as part of the MR.

**3. No free-text `expr` escape hatches on `addDimension` / `addMeasure`.**
The dormant tool definitions at `agent/lib/chat/reportToolDefinitions.ts:101`
(`addDimension.expr`) and `:123` (`addMeasure.expr`) are removed in MR-3.
Structured composition only:

* `addDimension` takes `column` + `semanticType` (categorical/time) +
  `timeGranularity` (for time dimensions only). No `expr`.
* `addMeasure` takes an aggregation function (`sum` / `count` /
  `count_distinct` / `avg` / `min` / `max`) + a column reference + an
  optional filter. No `expr`.

**Forward-looking principle (not in MR-1–5 scope).** If a future requirement
surfaces a semantic computation that cannot be expressed structurally — the
research doc's example is `revenue * tax_rate` — the answer is to extend the
structured schema with a typed `ComputedField` discriminated-union variant,
**not** to reintroduce a free-text `expr` field. The discriminated union
gives the compiler something it can typecheck; the free-text field gives the
compiler something to be afraid of.

**4. Direct ratification.** This ADR is **Accepted** at write-time. The
research doc is the evidence base; this ADR is the decision. No Proposed →
Accepted handshake.

## The agent-dynamism contract

Mirroring research doc §5, with the same partition.

**Agent dynamism lives at:**

1. **Tool selection.** Given a fuzzy prompt — *"clean up the orders data"* —
   the LLM decides whether to invoke `trimWhitespace`, `standardizeCase`,
   `fillNulls`, `mapValues`, or several, and in what order.
2. **Typed parameter selection.** Given `mapValues`, the LLM decides which
   column, what `from → to` mappings, and how many. The schema is fixed;
   the values inside the schema are the LLM's reasoning surface.
3. **Multi-step composition.** A prompt may trigger a sequence: `addColumn`
   then `addFilter` then `applyCleaningTransform`. The LLM owns sequencing.
4. **Conversational repair.** User feedback amends the typed-tool sequence
   — *"actually only for last quarter"* triggers an `addFilter` with a
   `time_column` parameter.

**Agent dynamism does NOT live at:**

1. **SQL emission.** Ever. Ibis owns this end-to-end after MR-3 lands. The
   LLM does not see a SQL token.
2. **Schema authorship.** Tables are typed at ingest (`schema_config`). The
   LLM picks columns from existing schemas; it does not define them at
   runtime.
3. **Tier crossing.** Tools are typed *by tier* —
   `applyCleaningTransform` cannot reach a JOIN, `addFilter` on a view
   cannot reach a `GROUP BY`. Tier discipline lives in the tool surface
   itself, not in SQL the LLM has to write correctly.
4. **Free-form expression.** No `expr` field at any tier. Future semantic
   computations land as typed `ComputedField` variants.

Research doc §5 walks through two worked examples (cleaning + view
composition; reports with dimensions and measures) showing the partition in
practice; not re-transcribed here.

## Consequences

### Positive

* **Closes Gap 1.** The `ViewFilter.value` injection vector at
  `backend/app/use_cases/view/sql_generator.py:160` disappears after MR-1;
  values flow through ibis literals.
* **Closes Gap 2.** The free-form `createReport.sqlDefinition` surface
  disappears after MR-3; reports compile via
  `ibis.Table.group_by(dims).aggregate(measures)`.
* **Closes ADR-007's caveat.** ADR-007's Consequences section noted "Complex
  transforms may need raw SQL escape hatches"; ADR-026 supersedes that
  caveat — the answer is structured composition all the way down, not an
  escape hatch.
* **Reconciles `model_sql.py` with the ibis pipeline.** MR-5 has
  `backend/app/use_cases/project/_dbt/model_sql.py:13-207` consume
  `dataset_sql.build_staging_sql()` rather than re-derive the cleaning
  operations as dbt CTEs. Eliminates the known parallel-compiler divergence
  hazard.
* **Single SQL-compilation vocabulary across the codebase.** Three SQL
  emitters (ibis-staging, view-fstrings, raw-report) collapse to one
  (ibis-everywhere).
* **dbt eject contract becomes a first-class compiler output.** The
  `{{ ref(...) }}` shape is emitted by the compiler, not patched in by
  post-render regex.

### Negative / accepted trade-offs

* **L-sized implementation across 5 MRs.** MR-1 (M), MR-2 (S), MR-3 (L),
  MR-4 (S), MR-5 (S). MR-3 is the largest because it builds the
  `ReportIbisCompiler` and wires the dormant `addDimension` / `addMeasure`
  dispatchers.
* **Dormant tool dispatchers must be implemented.** `addDimension` and
  `addMeasure` exist as agent-side tool definitions
  (`agent/lib/chat/reportToolDefinitions.ts:92-125`) but have no backend
  handler today. MR-3 builds the dispatcher; the design surface is fresh,
  with no legacy behaviour to preserve.
* **One-time ibis-source plugin investment.** The dbt-macro rendering path
  (MR-2 scope) requires a custom ibis `Source` subclass / backend hook.
  Small in scope but unfamiliar in shape; the ibis extensibility docs cited
  above are the starting point.
* **The agent loses the option of emitting free-form SQL.** Some future
  report patterns will need backend-side structured-schema extension before
  the agent can express them. The forward-looking `ComputedField` discriminated
  union is the answer when that pressure arrives; until then, the structured
  schema is the contract.

### Operational

* **No new runtime dependency.** Ibis is already in use at the staging tier
  per ADR-007.
* **No deployment-topology change.** ADR-016's compose stack is untouched.
* **No DEVOPS contract-test annotation needed.** No external integration is
  introduced or modified by this ADR.

### Earned-Trust note

This ADR introduces no new substrate dependency, no new external adapter,
no new I/O boundary. ADR-019's probe contract is unaffected. The migration
is a structural relocation of SQL emission onto an already-ratified
compiler — ibis was probed and ratified by ADR-007's staging-tier adoption
and has been in production since.

## MR roadmap

| MR | Scope | Size | Depends on |
|---|---|---|---|
| MR-1 | `ViewIbisCompiler` replaces `ViewSQLGenerator`; closes Gap 1 | M | This ADR |
| MR-2 | dbt intermediate ibis-source plugin (replaces post-render regex / `ViewSQLGenerator(ref_mode=True)` shim) | S | MR-1 |
| MR-3 | `ReportIbisCompiler` + wire `addDimension` / `addMeasure` dispatchers; remove `createReport.sqlDefinition` and `expr` escape hatches; closes Gap 2 | L | MR-1 |
| MR-4 | Apply `quote_ident()` consistently in lake-repo (closes Gap 3) | S | none |
| MR-5 | Reconcile `model_sql.py` with the ibis pipeline (consume `dataset_sql.build_staging_sql()`) | S | MR-1, MR-3 |

MR-1 is the next dispatch. MR-4 has no dependencies and can land in parallel
with MR-1 / MR-2 / MR-3 at the implementer's discretion.

## Cross-decision composition

* **ADR-026 ↔ ADR-007 — generalizes and supersedes the caveat.** ADR-007
  ratified ibis for the staging tier and noted "Complex transforms may need
  raw SQL escape hatches" as an accepted negative consequence. ADR-026
  extends the mandate to **all customer-visible SQL surfaces** (view, report,
  dbt eject) and supersedes the escape-hatch caveat. ADR-007 remains the
  precedent; ADR-026 is its corollary across the rest of the codebase.
* **ADR-026 ↔ ADR-020 — independent.** ADR-020 splits the metadata
  persistence layer into eight per-aggregate repositories; ADR-026 governs
  the SQL-compilation layer at the use-case boundary. Orthogonal layers,
  orthogonal concerns. No coordination cost.
* **ADR-026 ↔ ADR-025 — independent.** ADR-025 governs SQLAlchemy `Select`
  construction for metadata reads (the persistence layer); ADR-026 governs
  ibis SQL construction for data-plane queries (the data-materialization
  layer). Two distinct query engines, two distinct layers.
* **ADR-026 ↔ prior CEL research (`docs/research/ibis-cel-deterministic-sql.md`)
  — builds on.** The CEL doc recommended ADOPT_SIMPLER ("typed Pydantic
  dispatchers, no CEL"). This ADR answers the next question — *"what do
  those dispatchers compile to?"* — with **ibis, end-to-end, tier-by-tier**.
  CEL is not revisited; the dispatchers compose ibis ops, not CEL
  expressions.

## Open questions

1. **Bead assignment.** This ADR is Accepted; bead id assigned at MR-1
   kickoff and back-filled here.
2. **Specific ibis-source subclass shape.** Whether the dbt-ref renderer is
   built as a `Source` subclass or a custom-backend hook is resolved at
   MR-2 design time; the ibis extensibility docs are the starting point.
3. **`ComputedField` discriminated-union variant.** Not in MR-1–5 scope.
   Lands when a concrete use case surfaces requiring a semantic computation
   that the structured `addDimension` / `addMeasure` shape cannot express
   (the research doc's example: `revenue * tax_rate`). At that point the
   answer is a typed discriminated-union variant, **not** a reintroduced
   free-text field.

## References

* **Source signal.** `docs/research/deterministic-sql-construction-architecture.md`
  §1.7 (ten-path inventory), §2 (tool → handler → SQL-path map), §3 (Gap 1,
  Gap 2, Gap 3), §5 (agent-dynamism worked examples), §6 (five-step
  roadmap).
* **Prior research.**
  `docs/research/ibis-cel-deterministic-sql.md` — CEL evaluation, recommendation
  ADOPT_SIMPLER. ADR-026 builds on this; CEL is not adopted, not revisited.
* **Precedent.** `docs/decisions/adr-007-ibis-for-sql-generation.md` — ibis
  ratified for the staging tier; ADR-026 generalizes the mandate.
* **Sibling-style ADRs.**
  `docs/decisions/adr-020-metadata-repository-split.md`,
  `docs/decisions/adr-025-named-query-objects.md`.
* **Ibis extensibility surface.**
  <https://ibis-project.org/concepts/backends> ,
  <https://ibis-project.org/how-to/extending/>.
* **sqlglot** (mentioned in research doc §4 Option C as stopgap; not
  adopted): <https://github.com/tobymao/sqlglot>.
* **Files in scope across the 5 MRs.**
  * MR-1: `backend/app/use_cases/view/sql_generator.py`,
    `backend/app/use_cases/view/create_view.py`,
    `backend/app/models/view.py`,
    `backend/tests/use_cases/view/test_sql_generator.py`.
  * MR-2: `backend/app/use_cases/project/_dbt/intermediate.py`, plus the
    new ibis-source module (path TBD at MR-2 design time).
  * MR-3: `agent/lib/chat/reportToolDefinitions.ts`,
    `backend/app/use_cases/report/create_report.py`, new
    `backend/app/use_cases/report/report_ibis_compiler.py` (or equivalent).
  * MR-4: `backend/app/repositories/lake/repository.py`.
  * MR-5: `backend/app/use_cases/project/_dbt/model_sql.py`,
    `backend/app/models/dataset_sql.py`.
* **Affected feature artifacts (post-implementation).**
  `docs/feature/ibis-as-only-sql-compiler/` (TBD, created at MR-1 kickoff).
* **Constraint sources.** CLAUDE.md (Backend conventions, decorator stack,
  `RepositoryContainer`, `RestrictedSession`, org-scoping discipline).
