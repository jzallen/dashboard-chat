# ADR-051: Operations List as the Canonical Transform IR

**Status:** Proposed
**Originating wave:** DESIGN (application/component scope; brownfield evaluation)
**Companion artifacts:**
- Evaluation: `docs/feature/transform-operations-ir/design/evaluation.md`
- C4 component topology: `docs/feature/transform-operations-ir/design/c4-component.md`
- Wave decisions: `docs/feature/transform-operations-ir/design/wave-decisions.md`
- Composes with: `docs/decisions/adr-007-ibis-for-sql-generation.md`, `docs/decisions/adr-026-ibis-as-only-sql-compiler.md`

> **Scope (this phase): the Dataset staging tier only.** Every decision below —
> the canonical operations list, the `sequence` column, the M-inbound parser, the
> adapter-args sidecars, the dispatch-catalog renderer, and boundary validation —
> applies to the `transforms` table that feeds the staging layer. The View and
> Report tiers are explicitly **out of scope for now** and unchanged by this ADR;
> they remain document-per-entity structured IRs (see decision 6). Extending the
> operations model to View/Report — including normalizing their embedded-JSON
> operations into first-class rows — is a separate proposal, to be designed and
> reconciled with this one later.

## Context

Model changes to a dataset are expressed today as rows in the `transforms`
table — one operation per row, discriminated by `transform_type`
(`filter | clean | alias | map`) with a structured `expression_config`
(`backend/app/repositories/metadata/transform_record.py:19-78`;
`backend/app/models/transform.py:17-84`). A fixed three-stage renderer
(`backend/app/models/dataset_sql.py:78-138`) turns these rows into an ibis
`Table` and then into DuckDB SQL (MUTATE → FILTER → RENAME).

The agreed destination is an explicit, tool-agnostic **list of operations** as
the canonical, persisted intermediate representation (IR). The end-to-end target
flow is:

```
Excel → M (Power Query) → parse → [neutral list of operations] → ibis renderer → ibis → SQL
```

M (inbound) and ibis (outbound) join **through** the persisted operations list,
never by inspecting a compiled ibis expression. This formalizes a structure that
already partially exists, rather than introducing a new one.

Three problems motivate the decision:

1. **Operation order is non-commutative but pinned to a fragile clock.** The
   MUTATE-stage clean/map operations compose order-dependently
   (`dataset_sql.py:108-110`) yet are ordered solely by `created_at`
   (`dataset_sql.py:104-107`, `repository.py:619`), with no explicit order
   column on the table or the ORM relationship
   (`dataset_record.py:106-108`). Batch inserts can collide on the timestamp.
2. **Translation rules are triplicated.** `CleaningExpression` repeats the same
   `match self.operation` spine in `_validate`, `as_ibis_expr`, and
   `to_display_sql` (`backend/app/types.py:138-267`); adding an operation means
   editing three methods in lockstep.
3. **Validation happens too late.** Operation shape is validated only when the
   renderer constructs `CleaningExpression(...)`, and failures degrade to a
   `"-- Error generating SQL"` comment (`dataset_sql.py:46-50`). Malformed
   operations persist silently and surface as broken SQL far from the write.

## Decision drivers

- **Operations are the source of truth; ibis/SQL are always derived.** This is
  the hard invariant. The compiled ibis expression must always be reproducible
  from the persisted operations. Nothing downstream is ever read back or stored
  as authority.
- **Tool-agnosticism.** The neutral operation must carry only customer intent,
  free of any single render target's vocabulary, so that both M (inbound) and
  ibis (outbound) — and any future target — join through the same list.
- **Determinism by construction.** Inherited from ADR-026: every SQL artifact is
  produced by a deterministic in-code compiler; no stored executable SQL, no
  stored mini-language.
- **Brownfield economy.** The `transforms` table is already the operations log.
  Refine it; do not fork the write path, the outbox events, and the dbt /
  query-engine sync onto a parallel table for no capability gain.

## Decision

### 1. Operations list is the canonical, persisted IR — on the existing table

The `transforms` table is the canonical operations list. Add an explicit
**`sequence: int NOT NULL`** column; order the load and the renderer by
`sequence`; keep `created_at` for provenance only. Backfill existing rows with
`ROW_NUMBER()` partitioned by `dataset_id` ordered by `created_at`. `sequence`
scope is **per dataset**. A new parallel `operations` table is rejected: it
forks every consumer and creates two sources of truth during transition,
violating the hard invariant.

> `sequence` is assigned to every operation for a uniform IR, but is *required*
> only for the non-commutative MUTATE arm. Filter (WHERE conjunction) and alias
> (RENAME map) operations are commutative within their stage.

### 2. M-inbound / ibis-derived data flow

A **bounded M parser** is the only inbound writer besides direct use-case
authoring. It recognizes the subset of M (Power Query) that maps to the
operation vocabulary and emits neutral operations. The ibis renderer is strictly
outbound. Neither M nor ibis inspects the other's artifact — they meet only at
the persisted operations list.

**Directionality (this phase).** Only the **inbound** path (M → operations) is
required for the Excel→SQL flow and is in scope. An outbound operations→M
renderer is admitted by the dispatch catalog (decision 4) but is deferred; ibis
remains the sole render target that must be complete in this phase. ADR-007's
dialect-agnostic rendering applies to the ibis (outbound-SQL) target; it does not
extend to M output until the outbound M renderer is taken up.

**Out-of-vocabulary behavior (parser contract).** When the parser encounters an
M construct outside the operation vocabulary (e.g. a join, pivot, or type-engine
step), it **rejects the import at parse time with a structured error naming the
unsupported construct** — it never silently drops the construct, never
partially imports, and never emits a placeholder operation. A partial import
would violate the hard invariant (the persisted operations would no longer
faithfully represent the source). The exact construct→operation mapping table is
DISTILL/DELIVER scope; the *behavior* (reject, name the construct, no silent
drop) is fixed here.

### 3. Internal-only, sparse adapter-args sidecars

Two sidecar tables, `operation_ibis_args` and `operation_m_args`, each FK'd to an
operation row with `ON DELETE CASCADE`, hold **only** per-instance shaping deltas
a target needs that are not part of customer intent (e.g. ibis `.strip()`
ASCII-only vs M `Text.Trim` whitespace semantics; case modes routed through
custom DuckDB UDFs at `types.py:191,206-210`). They are:

- **per-operation** (not transform-level — the transform-level shared-args table
  is rejected as too coupled);
- **per-target** (never a shared blob — an M delta must not pollute the ibis
  path or vice-versa);
- **sparse** (a row exists only on divergence; absence means "render the neutral
  operation faithfully");
- **internal-only** (never customer-facing; never in `Transform.serialize()`).

Decision rule: if removing it would change *what the customer asked for*, it is
intent and belongs in the operation; if removing it would only change *how
faithfully a target reproduces that intent*, it is a shaping delta and belongs in
that target's sidecar.

### 4. Renderer boundary: rules in code, one dispatch catalog, one visitor per target

The triplicated `CleaningExpression` rules collapse to a **single dispatch
catalog** keyed by the operation discriminator; each entry co-locates the
operation's validate + ibis-render + display-render + M-render rules. Each target
(ibis, M, display) is a **visitor** dispatching on the discriminator. Adding an
operation is one catalog entry; adding a target is one new visitor.

**Rules-as-data is rejected.** Storing the operation→ibis/M translation logic in
tables or a config DSL reintroduces a stored mini-language / interpreter —
forbidden by ADR-026. Operations are data; rendering is code.

### 5. Validation moves to the application boundary

Operation shape is validated **before persistence** via a Pydantic discriminated
union over the operation discriminator (mirroring `ViewFilterVariant`,
`view.py:154-214`). Malformed operations are rejected with a structured error at
the use-case boundary (`create_transforms` / `update_transforms`), never
persisted, never silently degraded. The `"-- Error generating SQL"` fallback at
`dataset_sql.py:46-50,57-59` becomes a true (ideally unreachable) invariant guard
rather than the de-facto validation layer.

### 6. Scope: Dataset staging tier only, for the time being

The operations IR is **Dataset-staging-scoped**. For the time being, every
decision in this ADR applies *only* to the `transforms` table and the staging
renderer; the View and Report tiers are unchanged. View (`view.py`) and Report
(`report.py`, `report_ibis_compiler.py`) remain separate structured IRs in the
same ibis-compiler **family** — they share the discipline (operations-as-data,
rendering-as-code, SQL always derived, no stored executable SQL) but not a table.
Only staging carries the non-commutative MUTATE chain that needs `sequence`.
Cross-tier operation sequencing is a non-goal of this ADR.

Today View/Report persist their operations as embedded-JSON arrays on a single
entity row (`columns` / `joins` / `filters` / `grain` on `views`;
`columns_metadata` on `reports`) — document-per-entity, not row-per-operation.
Bringing those tiers onto the operations model means first normalizing those
arrays into first-class operation rows; that normalization, and the subsequent
M → IR → ibis reconciliation for View/Report, is deferred to a separate proposal
and is intentionally not decided here.

## Non-goals

- **Merging View/Report into the operations table.** They are siblings in the
  ibis-compiler family, not rows in the operations list (decision 6). Their
  structured-aggregate shape does not carry the staging `sequence` invariant —
  though note View joins are themselves declaration-ordered (the compiler chains
  them in list order at `backend/app/use_cases/view/sql_generator.py:237-241`), so
  any future normalization of that tier inherits its own ordering concern. That
  work is a separate proposal, not this ADR.
- **A general M bridge.** Only the bounded vocabulary subset is importable
  (Constraints). M joins, pivots, and type engines are out of scope until
  explicitly added to the vocabulary.
- **An outbound operations→M renderer in this phase.** Admitted by the catalog,
  deferred (decision 2, Directionality).
- **Reintroducing stored executable translation logic.** Rules-as-data is
  rejected (decision 4); this is a permanent non-goal inherited from ADR-026.

## Constraints

- **Bounded M parser.** Only the M subset mapping to the operation vocabulary is
  importable. M's broader surface (joins, pivots, type engines) is out of scope
  until explicitly added to the vocabulary. Out-of-vocabulary M is rejected at
  parse time, never half-imported.
- **Determinism requires `sequence`.** The explicit order column is mandatory;
  `created_at` is insufficient (batch-insert timestamp collisions, missing-value
  tolerance at `dataset_sql.py:106`).

## Considered options

### Operations model
- **A. Extend `transforms` with `sequence` (CHOSEN).** Single write path,
  determinism by construction, smallest migration.
- **B. New parallel `operations` table (rejected).** Forks every consumer; two
  sources of truth during transition; no new capability.
- **C. Keep `created_at`, document the convention (rejected).** Leaves the
  determinism hole open.

### Adapter-args sidecars
- **A. Per-operation, per-target, sparse sidecars (CHOSEN).**
- **B. Transform-level shared args table (rejected).** Couples the two targets;
  re-confirmation of an upstream rejection.
- **C. Encode deltas in `expression_config` (rejected).** Contaminates the
  canonical IR with target-specific knowledge.

### Renderer boundary
- **A. Single dispatch catalog + one visitor per target (CHOSEN).**
- **B. Keep three separate methods (rejected).** Triplication and drift persist.
- **C. Rules as data / translation tables (rejected).** Stored mini-language;
  forbidden by ADR-026.

## Consequences

### Positive
- The IR becomes the single, deterministic, tool-agnostic authority; ibis and M
  both join through it.
- Operation order is well-defined by construction, not by clock.
- Adding an operation is one catalog entry; adding a render target is one
  visitor.
- Malformed operations are rejected at the boundary, not silently degraded.
- No fork of the write path, outbox events, or downstream sync.

### Negative / accepted trade-offs
- A migration (one column + backfill) and an `order_by(sequence)` everywhere
  transforms load.
- Two new sparse sidecar tables and a left-join in each renderer.
- A refactor of `types.py:120-267` to collapse the three `match` blocks into the
  catalog.

### Operational
- No new runtime dependency. ibis is already ratified (ADR-007) and extended
  (ADR-026). No external integration introduced — no contract-test annotation
  required.
- **Migration is not as trivial as a column add.** DISTILL/DELIVER must resolve,
  before the migration lands: (a) the `sequence` assignment formula
  (recommend gap-tolerant `ROW_NUMBER() * gap_size` over fractional indexing
  unless mid-list reordering is frequent); (b) safety for operations inserted
  concurrently with the backfill (new rows must receive a non-NULL `sequence`,
  not default to NULL); (c) deployment ordering so loaders that
  `order_by(sequence)` do not run against un-backfilled rows; (d) a rollback path
  if the backfill fails mid-stream. These are implementation concerns, but the
  ADR records that they are required, not optional.

## Cross-decision composition

- **ADR-051 ↔ ADR-007 — builds on.** ADR-007 ratified ibis as the staging-tier
  SQL compiler. ADR-051 formalizes the *input* to that compiler as a canonical,
  sequenced operations list and the *rendering* as a dispatch catalog. The ibis
  pipeline (`dataset_sql.py`) is unchanged in spirit; its iteration order moves
  from `created_at` to `sequence`.
- **ADR-051 ↔ ADR-026 — composes within.** ADR-026 mandates ibis as the only SQL
  compiler with no stored executable SQL. ADR-051 stays inside that stance: the
  operations list is *data*, not executable SQL; ibis/SQL are always derived. The
  rejection of rules-as-data is a direct application of ADR-026's prohibition on
  stored mini-languages. ADR-026 MR-5 already retired the parallel `model_sql.py`
  CTE compiler, so the operations IR feeds DuckDB-preview and dbt-eject through a
  single renderer.

## Acceptance Criteria

Behavioral outcomes the implementation must satisfy (WHAT, not HOW; verified in
DISTILL/DELIVER):

- **Determinism.** Given a persisted operations list, compiling it to ibis SQL
  yields a byte-identical result across repeated compilations and across a
  load → recompile round-trip.
- **Reproducibility invariant.** The compiled ibis expression is always derivable
  from the persisted operations alone; no path reads SQL or a compiled ibis
  expression back as authority.
- **Ordered render.** Operations render in `sequence` order; two MUTATE
  operations on the same `target_column` produce different SQL when their
  `sequence` is swapped (order is honored, not clock-derived).
- **Validation at the boundary.** A malformed operation (missing required field,
  unknown discriminator value) is rejected at the use-case boundary with a
  structured error and is **not** persisted; it never degrades to a
  `"-- Error generating SQL"` comment.
- **Renderer completeness.** Every operation discriminator is handled by every
  active visitor; an operation a visitor cannot render is a build-time failure,
  not a silent skip.
- **Sidecar fidelity.** Where a sidecar row exists, removing it causes the render
  to drift from the neutral intent in a way a test detects (the sidecar's
  reason-to-exist is pinned).
- **Bounded parser.** An out-of-vocabulary M construct is rejected at parse time
  with an error naming the construct; it is never silently dropped or partially
  imported.

## Earned Trust — probes the design mandates

Probes split by the wave that can execute them:

**DESIGN-deliverable (executable without new runtime):**
1. **Renderer-completeness probe.** Static check: every operation discriminator
   has an entry in every active visitor. A skipped operation breaks
   reproducibility.
4. **Substrate-divergence probe.** Each sidecar's reason-to-exist (e.g. ibis
   `.strip()` vs M `Text.Trim`) is pinned by a test that exercises the specific
   divergence.

**DELIVER-gated (depend on the `sequence` migration and the M parser existing):**
2. **M ↔ operations round-trip probe.** Bounded subset is stable; out-of-
   vocabulary M is rejected at parse time, not dropped.
3. **Reproducibility probe.** Operation list → byte-identical ibis SQL across
   runs (extends the existing dbt-staging row-equivalence tests). Wired as a
   continuous test: `compile(ops) == compile(load_and_recompile(ops))`.

The validation-at-boundary fix (decision 5) is itself the write-path probe: the
system refuses to persist an operation it cannot render.

## Open questions

1. `sequence` assignment strategy — gap-tolerant integers vs fractional indexing
   for cheap mid-list reordering. Resolved at DISTILL/DELIVER.
2. Whether the outbound M renderer is in scope now or deferred; the inbound
   bounded parser is the immediate driver for the Excel→SQL flow.

## References

- `backend/app/models/transform.py:17-84` — `Transform` domain model.
- `backend/app/repositories/metadata/transform_record.py:19-78` — ORM record.
- `backend/app/models/dataset_sql.py:44-138` — ibis renderer + `created_at` sort.
- `backend/app/types.py:120-267` — triplicated `CleaningExpression` rules.
- `backend/app/models/view.py:154-214` — `ViewFilterVariant` boundary-validation
  pattern to mirror.
- `backend/app/models/report.py`,
  `backend/app/use_cases/report/report_ibis_compiler.py` — sibling structured IR.
- `backend/app/repositories/metadata/repository.py:619,657-671` — transform load
  order + batch create.
- `backend/migrations/versions/001_initial_schema.py:88-106` — `transforms` DDL.
- `docs/decisions/adr-007-ibis-for-sql-generation.md`,
  `docs/decisions/adr-026-ibis-as-only-sql-compiler.md`.
