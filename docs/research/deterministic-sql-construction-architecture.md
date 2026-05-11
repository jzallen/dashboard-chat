# Architecting Deterministic SQL Construction Across Staging / View / Report Tiers

**Status:** RESEARCH
**Date:** 2026-05-11
**Branch:** `research/deterministic-sql-construction`
**Author:** automated research (codebase audit + architecture proposal)
**Companion to:** [`docs/research/ibis-cel-deterministic-sql.md`](./ibis-cel-deterministic-sql.md) (CEL evaluation — rejected; ADOPT_SIMPLER stands)

---

## Recommendation up front

**ADOPT_OPTION_B (Tiered ibis adoption) — composed with Option A as the destination model for tiers 2 & 3.**

The codebase is already partway there: the staging tier compiles via ibis end-to-end (`backend/app/models/dataset_sql.py:44-66`). The view tier collects structured input but renders SQL via hand-rolled f-strings in `ViewSQLGenerator` (`backend/app/use_cases/view/sql_generator.py:106-161`), and the report tier accepts a free-form SQL string emitted by the LLM (`backend/app/use_cases/report/create_report.py:24,77`). The fix is not a new framework — it is finishing a migration that's already half-done. **The first MR is medium-sized and replaces `ViewSQLGenerator` with an ibis compiler, closing a quasi-deterministic SQL-injection vector at `sql_generator.py:160` along the way.**

The architectural property the user asked about — agent dynamism preserved while SQL becomes deterministic — already exists at the staging tier and can be ported tier-by-tier. The agent's creativity lives in **tool selection**, **typed parameter selection**, and **multi-step composition**; ibis owns SQL emission everywhere.

---

## 1. Inventory: every SQL-construction path

The codebase has **nine** distinct SQL-construction sites grouped into four tiers. Determinism class follows the rubric in the brief.

### 1.1 Staging tier (Dataset → SQL)

**Path 1 — Ibis pipeline compiler.** `backend/app/models/dataset_sql.py:44-66`, `78-138`.
- **Mechanism:** ibis Table API (`ibis.table()` → `.mutate()` → `.filter()` → `.rename()` → `ibis.to_sql(dialect="duckdb")`).
- **Determinism:** **Deterministic-typed.** All user data flows through ibis literals, never substring interpolation.
- **Agent-reachable:** Yes (every cleaning / filter / alias transform tool reaches this).
- **Customer-facing:** Yes (the dbt eject pipeline emits this as `stg_*.sql`).
- **Notes:** `CleaningExpression.as_ibis_expr()` (`backend/app/types.py:195-223`) and `QueryBuilderJSON.as_ibis_filter()` (`backend/app/types.py:34-117`) use closed-world `match` statements over a fixed operator set. Custom DuckDB UDFs (`snake_case`, `title_case`, `kebab_case`) are registered as macros at connection time, not interpolated.

**Path 2 — dbt-bootstrap typed SELECT.** `backend/app/use_cases/project/_dbt/bootstrap_sql.py:40-60`.
- **Mechanism:** f-string with `_quote_ident()` / `_quote_literal()` defenses; PG type from a static `_PG_TYPE_MAP` (lines 18-25); S3 path validated by `_validate_s3_path()` regex (lines 29-37).
- **Determinism:** **Quasi-deterministic.** All variable inputs are validated/escaped before interpolation.
- **Agent-reachable:** No (eject-only).
- **Customer-facing:** Yes (DDL emitted to the customer's dbt project).

### 1.2 View tier (intermediate joins)

**Path 3 — `ViewSQLGenerator`.** `backend/app/use_cases/view/sql_generator.py:27-161`.
- **Mechanism:** Hand-rolled f-string concatenation across `_build_select`, `_build_from`, `_build_joins`, `_build_where`.
- **Determinism:** **Quasi-deterministic** for SELECT/FROM/JOIN (all identifiers double-quoted, source resolution is from a closed dict). **Non-deterministic** for WHERE.
- **Agent-reachable:** Yes (`createView`, `addFilter` tools per `agent/lib/chat/viewToolDefinitions.ts:43-106`).
- **Customer-facing:** Yes (rendered as `int_*.sql` in the dbt eject).
- **Critical line — `sql_generator.py:160`:**
  ```python
  conditions.append(f"{col_ref} {op} '{f.value}'")
  ```
  `f.value` originates from the `value` field of the `addFilter` tool (`viewToolDefinitions.ts:106`, `value: z.string().optional()`) and is parsed into a plain `ViewFilter` dataclass at `create_view.py:141-148` with no validation. A value containing `'` breaks the SQL; a crafted value injects arbitrary SQL into the persisted view definition and the dbt eject. **This is the primary determinism gap.**

**Path 4 — dbt intermediate model wrapper.** `backend/app/use_cases/project/_dbt/intermediate.py:11-40`.
- **Mechanism:** Calls `ViewSQLGenerator.generate_executable(view, ref_mode=True)`, then string-replaces source IDs with `{{ ref('...') }}` macros.
- **Determinism:** **Inherits from Path 3** — quasi-deterministic at best, vulnerable through the WHERE clause.
- **Customer-facing:** Yes (the dbt intermediate models the customer sees).

### 1.3 Report tier (mart / aggregations)

**Path 5 — Raw SQL acceptance.** `backend/app/use_cases/report/create_report.py:24,77`.
- **Mechanism:** None. `sql_definition: str` is accepted from the agent, validated only for source-reference shape (no report-to-report dependencies, `create_report.py:62-63`), then persisted.
- **Determinism:** **Non-deterministic.** The LLM writes the SQL.
- **Agent-reachable:** Yes (`createReport.sqlDefinition` per `agent/lib/chat/reportToolDefinitions.ts:58`, `sqlDefinition: z.string()` with no constraint).
- **Customer-facing:** Yes (rendered as `mart_*.sql` in dbt eject; visible in the customer's dbt project and any downstream BI tooling).

The `addDimension` / `addMeasure` tools (`reportToolDefinitions.ts:92-125`) exist as the *intended* structured replacement for raw `sqlDefinition`, but **no backend dispatcher routes them today** — they are dormant.

### 1.4 Query-engine DDL (PG + pg_duckdb sync)

**Path 6 — View-creation DDL.** `backend/app/use_cases/query_engine/sync_processor.py:52-95`.
- **Mechanism:** f-string + `quote_ident()` for schema/view/role names; S3 path validated; `select_expr` from Path 2.
- **Determinism:** **Quasi-deterministic** (defensive quoting on every variable input).
- **Agent-reachable:** No (sync-loop only, runs in worker).
- **Customer-facing:** Yes (DDL applied to the shared analytics PG instance).

### 1.5 Lake-repository internal queries

**Path 7 — Parquet preview / count / typeof.** `backend/app/repositories/lake/_pg_duckdb_query.py:31-41`, `backend/app/repositories/lake/repository.py:214-247`.
- **Mechanism:** f-string. S3 path validated upstream; column names interpolated with `"{column}"` quoting.
- **Determinism:** **Quasi-deterministic.** Column-name escaping is double-quote-only — it doesn't defend against a column name containing `"`.
- **Agent-reachable:** Yes (preview-related tools), but column names come from `dataset.schema_config`, not directly from the user.
- **Customer-facing:** No (internal profiling).

**Path 8 — Cleaning-transform preview SQL.** `backend/app/repositories/lake/repository.py:266-277` (transform-analysis predicates like `{col} != TRIM({col})`).
- **Mechanism:** f-string templates over a fixed set of CleaningExpression operations.
- **Determinism:** **Quasi-deterministic** (operations are closed-world; column names not escaped).
- **Customer-facing:** No.

**Path 9 — Parquet partition writes.** `backend/app/repositories/lake/repository.py:138-148`.
- **Mechanism:** `validate_identifier()` on every partition field; static template otherwise.
- **Determinism:** **Deterministic-templated.**
- **Customer-facing:** No.

### 1.6 dbt model SQL (cleaning transforms compiled to dbt CTEs)

**Path 10 — `model_sql.py` for staging-tier dbt.** `backend/app/use_cases/project/_dbt/model_sql.py:13-207`.
- **Mechanism:** f-string with explicit single-quote escaping (`.replace("'", "''")`) at every literal-interpolation site (`_fill_null_to_sql:184-191`, `_map_values_to_sql:194-207`).
- **Determinism:** **Quasi-deterministic.** Note: this is a *parallel* compiler to Path 1's ibis pipeline — same input (`expression_config`), different output (dbt CTE vs ibis SQL). Both must stay in sync as new operations are added.
- **Customer-facing:** Yes.

### 1.7 Summary table

| # | Tier | Path | File:line | Determinism | Customer-facing |
|---|---|---|---|---|---|
| 1 | Staging | Ibis compiler | `dataset_sql.py:44-66` | **Deterministic-typed** | Yes |
| 2 | Staging | dbt-bootstrap SELECT | `bootstrap_sql.py:40-60` | Quasi-deterministic | Yes |
| 3 | View | `ViewSQLGenerator` | `sql_generator.py:27-161` | **Non-deterministic (WHERE)** | Yes |
| 4 | View | dbt intermediate wrapper | `_dbt/intermediate.py:11-40` | Inherits Path 3 | Yes |
| 5 | Report | Raw SQL acceptance | `create_report.py:24,77` | **Non-deterministic** | Yes |
| 6 | DDL | Query-engine sync | `sync_processor.py:52-95` | Quasi-deterministic | Yes |
| 7 | Internal | Lake preview | `repository.py:214-247` | Quasi-deterministic | No |
| 8 | Internal | Lake transform-analysis | `repository.py:266-277` | Quasi-deterministic | No |
| 9 | Internal | Parquet partition write | `repository.py:138-148` | Deterministic-templated | No |
| 10 | Staging (dbt) | Cleaning → dbt CTE | `model_sql.py:13-207` | Quasi-deterministic | Yes |

### 1.8 Pydantic-dispatcher pattern: not present today

There is no discriminated-union dispatcher on the backend for SQL construction. `ViewFilter`, `ViewColumn`, `ViewJoin` are plain `@dataclass` (`backend/app/models/view.py`) with no Pydantic validation; `_parse_filters` (`create_view.py:139-148`) constructs them directly from raw dicts. The agent-side Zod enums (`agent/lib/chat/viewToolDefinitions.ts`, `dispatchers/cleaning.ts`) constrain the *outgoing* tool surface, but the backend re-validates only at the use-case boundary, not as a typed discriminated union.

---

## 2. Map: agent tool → backend handler → SQL path

| Tool (file:line) | Param shape | Backend route | Use case | SQL path | Determinism |
|---|---|---|---|---|---|
| `applyCleaningTransform` (`tools.ts:93-101`) | `column: string`, `operation: enum`, `config: object` | `POST /api/datasets/{id}/transforms` | `create_transforms.py:16` | Path 1 (ibis) | **Deterministic-typed** |
| `trimWhitespace` (`tools.ts:56-61`) | `column: enum` | same | same | Path 1 | **Deterministic-typed** |
| `standardizeCase` (`tools.ts:62-68`) | `column: enum`, `mode: enum` | same | same | Path 1 | **Deterministic-typed** |
| `fillNulls` (`tools.ts:76-82`) | `column: enum`, `fillValue: string` | same | same | Path 1 | **Deterministic-typed** (value flows through ibis literal) |
| `mapValues` (`tools.ts:83-92`) | `column: enum`, `mappings: [{from,to}]` | same | same | Path 1 | **Deterministic-typed** |
| `undoCleaningTransform` (`tools.ts:102-108`) | `action: enum`, `transformId?: string` | `PATCH /api/datasets/{id}/transforms/patch` | `update_transforms.py` | (no SQL — status flip) | n/a |
| `renameColumn` (`dispatchers/mutations.ts:90-133`) | `column: enum`, `newName: string` | same as transforms | same | Path 1 (RENAME stage) | **Deterministic-typed** |
| `addRow`, `deleteRow` (`tools.ts:44-55`) | `data: object` / `search: string` | not yet implemented | n/a | n/a | n/a |
| `createView` (`viewToolDefinitions.ts:43-53`) | `name`, `sourceRefs: string[]` | `POST /api/projects/{id}/views` | `create_view.py:21` | Path 3 (`ViewSQLGenerator`) | **Quasi-deterministic** |
| `addColumn` (`viewToolDefinitions.ts:54-64`) | structured | same | same | Path 3 | **Quasi-deterministic** |
| `addJoin` (`viewToolDefinitions.ts:?`) | structured | same | same | Path 3 (`_build_joins`) | Quasi-deterministic |
| `addFilter` (`viewToolDefinitions.ts:93-106`) | `column`, `operator`, `value: string` | same | same | Path 3 (`_build_where:160`) | **Non-deterministic** ⚠ |
| `createReport` (`reportToolDefinitions.ts:53-78`) | `sqlDefinition: string` (free-text SQL) | `POST /api/projects/{id}/reports` | `create_report.py:21` | Path 5 (raw) | **Non-deterministic** ⚠⚠ |
| `addDimension` (`reportToolDefinitions.ts:92-106`) | structured | not dispatched | n/a | (designed: ibis aggregation) | n/a |
| `addMeasure` (`reportToolDefinitions.ts:114-125`) | structured | not dispatched | n/a | (designed: ibis aggregation) | n/a |
| `sortTable`, `filterTable`, `clearFilters` (`dispatchers/ui.ts:44-133`) | structured | (frontend-only directives) | n/a | n/a | n/a |
| `resolve_dataset` (`tools.ts:13-23`) | `name: string` | (frontend-intercepted) | n/a | n/a | n/a |

**Two free-text params reach SQL.** Everything else is structured.

- `addFilter.value` (`viewToolDefinitions.ts:106`) — flows to `sql_generator.py:160` and is interpolated unescaped.
- `createReport.sqlDefinition` (`reportToolDefinitions.ts:58`) — flows directly to persisted SQL with zero validation.

**The agent's "creative surface" today.** For dataset cleaning, the agent picks among ~7 typed operations with closed-world enums for `mode`. For views, the agent composes typed columns/joins/filters but the *value* on a filter is unbounded. For reports, the agent writes SQL directly. **The dynamism is real at the staging tier and increasingly counterfeit at higher tiers** — at the report tier it's not "agent picks ibis ops" but "agent writes SQL", which is precisely what the user wants to eliminate.

---

## 3. The gap

Three paths, ranked by severity.

**Gap 1 — `ViewFilter.value` injection (S/M).**
- **Where:** `backend/app/use_cases/view/sql_generator.py:160`, with reach into `_dbt/intermediate.py:38` (the dbt eject) and the persisted `view.sql_definition` column.
- **What:** `f"{col_ref} {op} '{f.value}'"` interpolates a string from the agent's `addFilter` tool with no escaping. A `'` breaks SQL; a malicious payload injects.
- **Scope:** S if patched in place with `.replace("'", "''")`; **M if migrated to ibis** (the recommended fix).

**Gap 2 — `createReport.sqlDefinition` is free-form LLM SQL (M/L).**
- **Where:** `agent/lib/chat/reportToolDefinitions.ts:58` (tool surface) → `backend/app/use_cases/report/create_report.py:24,77` (persisted as-is) → dbt eject.
- **What:** The LLM emits arbitrary SQL. No syntax validation, no semantic validation, no tier-rule enforcement, no injection defense. The `addDimension` / `addMeasure` tools (designed for this) exist but are not wired up.
- **Scope:** M if we add a sqlglot AST-validation layer as a stopgap; **L if we build the dimension/measure → ibis aggregation compiler** (the destination architecture). The L path is what the user's framing requires.

**Gap 3 — Lake-repository column-name interpolation (S).**
- **Where:** `backend/app/repositories/lake/repository.py:214-247`, `:266-277`.
- **What:** Column names interpolated with double-quote-only escaping; not safe against names containing `"`. Internal-only, so blast radius is narrow, but should be tightened.
- **Scope:** S (apply `quote_ident()` consistently).

Paths 2, 6, 9, 10 (the "Quasi-deterministic" entries that DO have validation) are not gaps — they are deliberate bounded-template designs with explicit defenses. The CEL-evaluation doc's broader concern about "string concat is bad" doesn't translate uniformly: dbt-style templating with validated identifiers is a legitimate construction style. **The gaps are specifically the three sites where an agent-controlled value reaches SQL without a validating compiler in between.**

---

## 4. The balance: which option fits

### Option A — Closed tool surface, ibis-only construction
Every backend handler is a typed Pydantic dispatcher; every dispatcher composes ibis ops; agent dynamism = which tool + what typed parameter.
- **Pros:** Maximum determinism. One construction model across all tiers.
- **Cons:** Big-bang rewrite. Reports (Gap 2) need a new compiler from scratch. Risk of expressiveness loss for unmodeled report patterns.
- **Verdict:** Right destination, wrong delivery cadence. Adopt as the *target shape*; don't ship in one MR.

### Option B — Tiered ibis adoption (RECOMMENDED, composed with A)
Migrate tier-by-tier: staging is done; view next; report last. Each migration replaces an f-string compiler with an ibis compiler that takes the same structured input.
- **Pros:** Each MR is bounded and individually shippable. Closes Gap 1 in MR-1 (medium scope). Closes Gap 2 in MR-3 (the bigger lift, with `addDimension`/`addMeasure` already partly designed). The dbt eject pipeline keeps working tier-by-tier.
- **Cons:** Three MRs, not one. The "View tier" change requires care for dbt `{{ ref(...) }}` macro emission (currently done by string-substitution post-render at `_dbt/intermediate.py:38`).
- **Verdict:** **Recommended.** Same destination as A, deliverable iteratively, fixes the highest-severity gap first.

### Option C — Hybrid with policy guard
Keep f-strings where validated; add a small policy-validator pass to enforce that user-supplied substrings cannot reach SQL.
- **Pros:** Least code change. Closes Gap 1 with a `.replace("'", "''")` line and a Pydantic validator on `ViewFilter.value`.
- **Cons:** Doesn't fix Gap 2 (raw SQL is the problem). Leaves two parallel SQL compilers (Path 1 vs Path 3) — a known maintenance hazard already in tension with Path 10. Doesn't change the agent's incentive to emit SQL — it just sandboxes the badness.
- **Verdict:** Acceptable as a 1-day stopgap before MR-1 ships, not a destination.

### Option D — Two-mode agent: ibis-first with manual-SQL escape hatch
Default ibis tools; explicit "manual-SQL-needed" capability the backend rejects unless behind a heavy-review path.
- **Pros:** Addresses the user's "expressiveness vs determinism" tension explicitly. Preserves agent's ability to *attempt* anything.
- **Cons:** The escape hatch IS `createReport.sqlDefinition` today (de facto). Codifying it makes the gap permanent. Heavy-review paths in an autonomous-agent context are an oxymoron.
- **Verdict:** Reject. The user's framing — "we lose dynamism if we point to a one-size-fits-all view constructor" — is solved by *expressive ibis composition*, not by a SQL escape hatch. Ibis is itself the dynamic surface.

### Why Option B wins

The user's tension is between (a) deterministic SQL and (b) agent dynamism. **These aren't traded against each other — they happen at different layers.** Determinism is enforced at the SQL-emission layer (ibis owns it). Dynamism lives at the tool-selection and parameter-selection layers (the LLM owns those). Option B preserves both because it doesn't collapse anything: it migrates the SQL-emission layer to ibis without touching the tool surface. The agent already has typed creativity at the staging tier today, and that's the proof of concept for what the view and report tiers should look like.

The "one-size-fits-all view constructor" worry the user raised is a worry about **closing the tool surface too aggressively** (e.g., one `cleanData` tool instead of `trimWhitespace` + `standardizeCase` + `fillNulls` + …). That's an orthogonal design choice. Option B keeps the rich tool surface unchanged — it only changes *how the backend renders SQL from those tool calls*.

---

## 5. Where agent dynamism lives in this architecture

The user's reframed question implicitly asks: if we make SQL deterministic, what's left for the agent to do? Answer: a great deal, but at different layers than the LLM-emits-SQL pattern most agent demos use.

**Agent dynamism lives at:**

1. **Tool selection.** Given a fuzzy prompt — *"clean up the orders data"* — the LLM decides whether to invoke `trimWhitespace`, `standardizeCase`, `fillNulls`, `mapValues`, or several. The LLM also decides the order. This is a multi-step composition problem the LLM solves natively.
2. **Typed parameter selection.** Given `mapValues`, the LLM decides which column, what `from→to` mappings, and how many. The schema is fixed; the values inside the schema are the LLM's reasoning surface.
3. **Multi-step composition.** A prompt may trigger a sequence: `addColumn` to surface a hidden field, then `addFilter` to scope it, then `applyCleaningTransform` to standardize it. The LLM owns sequencing.
4. **Conversational repair.** The LLM interprets user feedback and amends the typed-tool sequence — *"actually only for last quarter"* triggers an `addFilter` with a `time_column` parameter.

**Agent dynamism does NOT live at:**

1. **SQL emission.** Ever. Ibis (or its analogs at higher tiers) owns this. The LLM does not see a SQL token.
2. **Schema authorship.** Tables are typed at ingest (`schema_config`). The LLM picks columns from existing schemas; it doesn't define them at runtime.
3. **Tier crossing.** Tools are typed *by tier* — `applyCleaningTransform` cannot reach a join, `addFilter` on a view cannot reach a GROUP BY. The architecture's tier discipline is in the tool surface itself, not in the SQL the LLM has to write correctly.
4. **Free-form expression.** `expr` fields like `addDimension.expr` (`reportToolDefinitions.ts:106`) are tempting but recreate the report-tier gap one tool down. They should be replaced with structured composition (`addDimension` takes `column` + `granularity`, never `expr`).

### Worked example: *"For the orders dataset, clean up phone numbers and email addresses, then build a view of orders joined to customers."*

The LLM decomposes this into:

1. `applyCleaningTransform(column='phone', operation='standardize_phone_format', config={...})` — a typed call to the staging tier. Backend resolves to `CleaningExpression(...).as_ibis_expr(...)` and `ibis.to_sql()`.
2. `applyCleaningTransform(column='email', operation='standardize_case', config={mode: 'lower'})` — same path.
3. `createView(name='orders_with_customers', sourceRefs=['orders', 'customers'])`.
4. `addJoin(left_ref='orders', left_column='customer_id', right_ref='customers', right_column='id', join_type='LEFT')`.
5. `addColumn(...)` calls for the projected columns.

After Option B is shipped, every one of these calls produces ibis-compiled SQL. The LLM's creativity — picking `standardize_phone_format` over `trim`, choosing `LEFT` over `INNER`, sequencing the steps — is fully preserved. The backend only got more disciplined.

### Worked example: *"Show me revenue by region last quarter."*

The LLM decomposes this into a report request. After Option B, this becomes:

1. `createReport(name='revenue_by_region', source_refs=[<view_id>])` — no `sqlDefinition`.
2. `addDimension(name='region', semanticType='categorical', column='region')`.
3. `addDimension(name='quarter', semanticType='time', column='order_date', timeGranularity='quarter')`.
4. `addMeasure(name='revenue', semanticType='sum', column='amount')`.
5. `addFilter(column='order_date', operator='>=', value='2026-01-01')`.

Backend compiles to `ibis.Table.group_by([...]).aggregate([...])` and emits via `ibis.to_sql()`. The LLM's job — knowing that "revenue by region last quarter" decomposes into one categorical dim, one time dim, one sum measure, and a date filter — is intact. What's gone is the LLM having to know DuckDB's `DATE_TRUNC` syntax.

---

## 6. Recommendation

**ADOPT_OPTION_B (Tiered ibis adoption, composed with Option A as destination).**

### Five-step implementation outline

1. **(MR-1, M)** Replace `ViewSQLGenerator` with `ViewIbisCompiler`. Same `View` input; output is `ibis.Table.select(...).filter(...).join(...)` rendered via `ibis.to_sql(dialect="duckdb")`. `ViewFilter.value` flows through ibis literals — closes Gap 1. Add a Pydantic discriminated union for `ViewFilter` operator (replaces today's plain dataclass + ad-hoc `f.operator.upper()`). Files: `backend/app/use_cases/view/sql_generator.py`, `backend/app/use_cases/view/create_view.py:139-148`, `backend/app/models/view.py`, `backend/tests/use_cases/view/test_sql_generator.py`. Mark `ViewSQLGenerator` deprecated and re-export the new class under the old name for one release.
2. **(MR-2, S)** Update `_dbt/intermediate.py:11-40` to consume the ibis compiler's output. The current post-render string-replace for `{{ ref(...) }}` macros becomes either an ibis pre-render hook (custom `Source` subclass that renders as a dbt macro) or a single targeted regex on the rendered SQL. Verify the dbt eject path produces equivalent customer-visible SQL.
3. **(MR-3, L)** Wire `addDimension` / `addMeasure` dispatchers and build the `ReportIbisCompiler`. Compile to `ibis.Table.group_by(dims).aggregate(measures)`. Reject `createReport.sqlDefinition` as a deprecated parameter; the backend raises `DeprecatedFreeFormSQL` if set. Update `agent/lib/chat/reportToolDefinitions.ts` to remove `sqlDefinition` from the tool schema. Add backfill plan for any existing reports with raw SQL (likely: grandfather behind a flag, no rewrite).
4. **(MR-4, S)** Apply `quote_ident()` consistently in `backend/app/repositories/lake/repository.py:214-277` (closes Gap 3). Internal-only, but a small hygiene win that brings the lake layer in line with `sync_processor.py`.
5. **(MR-5, S)** Reconcile `model_sql.py` (Path 10) with the ibis compiler. Today it's a parallel compiler that re-implements the cleaning operations as dbt CTEs with literal escaping. Goal: have `model_sql.py` *consume* `dataset_sql.build_staging_sql()` rather than re-derive. Eliminates a known divergence hazard.

### First MR shape (M)

**Branch:** `feat/view-ibis-compiler`.
**Scope:**
- `backend/app/use_cases/view/sql_generator.py` — rewrite as `ViewIbisCompiler` returning ibis.Table; keep a thin `ViewSQLGenerator` shim for one release.
- `backend/app/models/view.py` — `ViewFilter` becomes a Pydantic discriminated union over `operator`, with `value` typed per operator (str for comparisons, list for IN, None for IS NULL).
- `backend/app/use_cases/view/create_view.py:139-148` — `_parse_filters` calls Pydantic instead of dict→dataclass.
- `backend/tests/use_cases/view/test_sql_generator.py` — adapt; add a regression test for the SQL-injection vector (input `value="'; DROP TABLE x; --"` must round-trip safely or raise).
- `docs/decisions/adr-NNN-ibis-as-the-only-sql-compiler.md` — new ADR (separate from this research doc) ratifying the destination architecture.
**Out of scope for MR-1:** Reports, dbt-eject changes (those are MR-2/MR-3).

### Open questions for the user

1. **dbt macro emission**: today `_dbt/intermediate.py:38` does a post-render `sql.replace(ref_id, "{{ ref('...') }}")`. Should the ibis compiler emit `ibis.Source` placeholders that render as dbt macros directly, or is the post-render regex acceptable?
2. **Backfill policy for existing reports with raw `sql_definition`**: grandfather forever, grandfather behind a flag, or migrate via a one-time script that parses with `sqlglot` and rebuilds as `addDimension`/`addMeasure` calls? The third is dramatically more work and may not be feasible for hand-written SQL.
3. **`addDimension.expr` / `addMeasure.expr` (free-text expression fields, `reportToolDefinitions.ts:106,124`)**: keep as escape hatches with sqlglot AST validation, or remove entirely in favor of structured composition? The user's framing suggests "remove" — but some semantic computations (e.g., `revenue * tax_rate`) are awkward without an `expr` field.
4. **Should this research doc precede an ADR, or should the recommendation here be promoted directly to ADR-026?**

---

## Appendix: relationship to prior research

This document does **not** supersede [`docs/research/ibis-cel-deterministic-sql.md`](./ibis-cel-deterministic-sql.md). That doc evaluated CEL as a candidate technology and recommended ADOPT_SIMPLER (typed Pydantic dispatchers, no CEL). This doc accepts that recommendation and asks the next question: *"what do those typed dispatchers compile to?"* The answer is **ibis, end-to-end, tier-by-tier**, with the migration path in §6.

The CEL doc's claim that view SQL uses string concatenation in `sql_generator.py` (referenced in its §2.3) is verified here. The CEL doc's broader recommendation — "the agent's tool surface should be the closed-world DSL, not CEL on top of it" — is the same recommendation as this doc's Option A/B composition. They agree.
