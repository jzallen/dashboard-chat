<!-- DES-ENFORCEMENT : exempt -->
# ADR-025: Named Query Objects for Non-Trivial Reads

**Status:** Proposed
**Date:** 2026-05-11
**Originating wave:** DESIGN (entered directly per CLAUDE.md brownfield routing; refactor with cause known)
**Bead:** TBD (assigned at DELIVER kickoff)
**Companion artifacts:**
- ADR-020 (composes): `docs/decisions/adr-020-metadata-repository-split.md`
- First call site (post-ADR-020): `backend/app/repositories/metadata/project_repository.py`
- Second call site (legacy facade): `backend/app/repositories/metadata/repository.py`
- Sibling helper the convention composes with: `backend/app/repositories/metadata/_pagination.py`

## Context

ADR-020 splits the 866-LOC `MetadataRepository` god-object into eight
per-aggregate repositories. With that split landing, a pattern is now visible
that the god-object's homogeneity hid: a meaningful subset of repository read
methods carry **non-trivial query logic** that is not really "infrastructure"
and not really "use-case business logic" — it is **query-flavored business
logic that is currently homeless**.

Concrete instance — `ProjectRepository.list_projects`
(`backend/app/repositories/metadata/project_repository.py`, lines 68–108):

* **Optional filters.** `org_id` (multi-tenant scope) and `cursor` (keyset
  pagination boundary) are each wired as `if x is not None: query =
  query.where(...)` chains.
* **Default eager-load projection.** `selectinload(ProjectRecord.datasets)
  .load_only(DatasetRecord.id, .name, .description, .project_id,
  .schema_config)` — a column-level projection shape that is not the default
  ORM shape and that other reads of "projects with dataset summaries" will
  want to share.
* **Ordering default.** `ProjectRecord.id.desc()` — load-bearing because
  `id` is UUIDv7 and the ordering doubles as chronological.
* **Has-more probe.** `limit + 1` then slice — composed with `paginate_by_id`
  (`backend/app/repositories/metadata/_pagination.py`).
* **Input validation boundary.** `decode_cursor` raises `InvalidCursor`
  (`backend/app/utils/pagination.py`) on malformed cursors; the query builder
  is the natural place for that boundary to be crossed.

Each of those items is a small invariant or default. Today they live as
procedural prose in the method body. They are duplicated verbatim in the
legacy `MetadataRepository.list_projects`
(`backend/app/repositories/metadata/repository.py`, lines 78–127) — and the
legacy copy additionally still has the pre-`paginate_by_id` inline has-more
math (`if limit is not None: has_more = len(projects) > limit; projects =
projects[:limit]; next_cursor = encode_cursor(projects[-1].id) if has_more
and projects else None`) that the `_pagination.py` extraction missed when it
landed. That divergence — same logical query, two procedural bodies, one
already drifted — is the empirical signal that the logic deserves a single
home.

The pattern's value scales with ADR-020. Every new per-aggregate repository
(`DatasetRepository`, `TransformRepository`, `SessionRepository`,
`ReportRepository`, `ViewRepository`, …) is likely to have 1+ reads with the
same shape: ≥1 optional filter, a column-projected eager-load, a default
ordering, a has-more probe, a validated cursor input. Today's `if`-chains
are pre-duplication; ratifying a convention now is cheaper than retrofitting
it across eight aggregates later.

## Decision drivers

* **Maintainability — modularity.** Each non-trivial query's invariants,
  defaults, projection shape, and conditional filter assembly get one home
  with one name.
* **Maintainability — analyzability.** Caller code reads as a domain-language
  sentence (`ProjectsWithDatasetsQuery().with_org_scope(org).with_cursor(c)
  .with_default_ordering().with_limit_probe(limit).compile()`) instead of a
  20-line procedure.
* **Reusability across the ADR-020 facade transition.** During Phase B of
  ADR-020 the new per-aggregate repository and the `_LegacyMetadataFacade`
  coexist. One query class consumed by both proves the abstraction is real
  duplication-elimination, not speculative.
* **Dependency-inversion compliance preserved.** Query classes are pure
  builders — no session, no I/O, no async. The repository method retains
  the I/O boundary; `@handle_repository_exceptions` stays on the repository,
  not on the query class.
* **Conway's Law.** Single-team brownfield; the convention is internal to
  the persistence layer. No team boundary impacted.
* **Earned Trust (principle 12).** No new substrate dependency. Query classes
  build SQLAlchemy `Select`s; the existing repository-level execution path
  and its probes (where applicable) carry forward unchanged. The convention
  is a structural refactor, not a substrate change.
* **CLAUDE.md constraints honored.** `RestrictedSession` injection,
  `RepositoryContainer` registration, `@handle_repository_exceptions`,
  `with_repositories` decorator stack, and org-scoping discipline are all
  preserved verbatim — query classes sit *below* all of them.

## Considered options

### α — Named query objects with fluent `with_*` API + accumulator. **Chosen.**

For each repository read method whose query has >1 optional filter OR a
projection beyond default columns, introduce a class named
`<ResultShape>Query`. Caller chains `with_*` methods (returning `Self`,
no-op when the input is `None`); each `with_*` appends a builder step to a
private `_steps: list[Callable[[Select], Select]]`. `compile()` returns
`functools.reduce(lambda q, step: step(q), self._steps, base_select)`.

```python
class ProjectsWithDatasetsQuery:
    """Lists projects with their dataset summaries, ordered chronologically.

    Pure builder. No session, no I/O. Consumed by both
    ProjectRepository.list_projects and the legacy facade's delegation.
    """

    def __init__(self) -> None:
        self._steps: list[Callable[[Select], Select]] = []

    def with_org_scope(self, org_id: str | None) -> "Self":
        if org_id is not None:
            self._steps.append(lambda q: q.where(ProjectRecord.org_id == org_id))
        return self

    def with_cursor(self, cursor: str | None) -> "Self":
        if cursor is not None:
            cursor_id = decode_cursor(cursor)  # may raise InvalidCursor
            self._steps.append(lambda q: q.where(ProjectRecord.id < cursor_id))
        return self

    def with_default_ordering(self) -> "Self":
        self._steps.append(lambda q: q.order_by(ProjectRecord.id.desc()))
        return self

    def with_limit_probe(self, limit: int | None) -> "Self":
        if limit is not None:
            self._steps.append(lambda q: q.limit(limit + 1))
        return self

    def compile(self) -> Select:
        base = select(ProjectRecord).options(
            selectinload(ProjectRecord.datasets).load_only(
                DatasetRecord.id,
                DatasetRecord.name,
                DatasetRecord.description,
                DatasetRecord.project_id,
                DatasetRecord.schema_config,
            )
        )
        return reduce(lambda q, step: step(q), self._steps, base)
```

**Pros:** caller reads as a domain sentence; invariants and defaults declared
once; conditional no-op-when-`None` is handled at append-time, so `compile()`
has no `if`-tests; future siblings (`DatasetsForProjectQuery`,
`TransformsForDatasetQuery`, …) inherit the pattern; one query class can
serve multiple call sites (today: new repo + legacy facade); pure builder is
trivially unit-testable in isolation if a projection invariant ever becomes
product-critical.

**Cons:** ~40 LOC per query class; one indirection (the `_steps` lambda
fold) — a debugger session has to step through `reduce` to see filter order.

### β — Inline `if`-chains (status quo)

Keep `if x is not None: query = query.where(...)` chains in each repository
method.

**Rejected.** The homeless-logic problem persists. The legacy/new divergence
on `list_projects` pagination math (the inline has-more block that drifted
past `_pagination.py`) is the existence proof that inline chains drift
silently. Per ADR-020 the count of such methods grows by aggregate; β is
pre-duplication today and post-duplication next quarter.

### γ — `sa.true()` no-op predicate trick

Replace conditional `if`s with always-applied predicates that collapse to a
tautology when the input is `None`:

```python
query = query.where(ProjectRecord.org_id == org_id if org_id else sa.true())
```

**Rejected.** Deletes the `if`s in place but doesn't give the logic a home.
Invariants (org-scope rule, default ordering, projection shape) are still
anonymous, still co-located with execution, still duplicated across call
sites. Solves the smallest visible symptom and ignores the disease.

### δ — `functools.reduce` over a local list of filter lambdas, in place

```python
filters: list[Callable[[Select], Select]] = []
if org_id is not None:
    filters.append(lambda q: q.where(ProjectRecord.org_id == org_id))
if cursor is not None:
    filters.append(lambda q: q.where(ProjectRecord.id < decode_cursor(cursor)))
query = reduce(lambda q, f: f(q), filters, query)
```

**Rejected.** Strictly better than β for readability inside one method, but
strictly worse than α once a second call site appears — the `filters` list
construction is itself the thing that wants a name. δ deletes the `if`s
without creating the named domain object; the invariants remain anonymous
inside a method body.

### ε — Full Specification pattern (boolean-composable predicates)

Each filter is a `Specification` object with `and_`, `or_`, `not_`
combinators; the repository assembles a specification tree and translates
it to SQLAlchemy `where` clauses.

**Rejected as over-engineered for current scale.** No call site today
combines filters with `or_` or `not_`; the combinators would carry no weight.
Revisit when actual filter combinatorics appear (search endpoints, ad-hoc
filter builders for a `/projects?filter=` style query) — and even then, ε
composes *on top of* α (a query class can be specified to assemble a
specification tree) rather than replacing it.

### ζ — Discriminated-union match expression on a filters dataclass

Pass a `@dataclass` of optional filters, then `match` over it inside the
repository.

**Rejected as Python-ergonomically awkward.** `match` over `Optional[...]`
fields requires guard clauses for each field; the resulting code is longer
than α and reads less domain-fluently. Not idiomatic for incremental
`Select` chaining.

## Decision outcome

**Option α — named query objects with fluent `with_*` API + accumulator.**

### When to introduce a query class

A repository read method gets a `<ResultShape>Query` class when it has
**either**:

* **>1 optional filter** (e.g., `org_id` + `cursor`; `project_id` +
  `status`; `dataset_id` + `since`), **OR**
* **A projection beyond default columns** (any `selectinload` /
  `joinedload` with `load_only(...)`, or any explicit
  `.options(...)` chain).

Trivial single-filter queries (`get_X_by_id`, `X_exists`, simple existence
checks) keep their inline form. The rough quantitative threshold is **~3
lines of conditional filter logic OR a non-trivial projection** — kept as
guidance, not as a static-analysis rule (see Open question 3).

### Naming convention

`<ResultShape>Query`. The name describes **what the query produces**, not
what it filters or where it lives. The `Query` suffix signals the role.

Examples expected to emerge as ADR-020 phases land:

* `ProjectsWithDatasetsQuery` (ratifying instance)
* `DatasetsForProjectQuery`
* `TransformsForDatasetQuery`
* `SessionsForProjectQuery`
* `ReportsForViewQuery`

A name like `ProjectFilters` or `ProjectQueryBuilder` is **not** the
convention — both lose the result-shape information that makes the call site
read as a sentence.

### Location

Co-locate with the repository module while the aggregate has one query
class; extract to a `_queries/` subpackage when the second arrives. The
rule is:

* **1 query class** → defined inline in the repository module
  (`backend/app/repositories/<aggregate>/<aggregate>_repository.py`).
  Python prefers flat files until they become painful; a one-file
  subpackage is structural over-design that reads as Java/C# scar
  tissue, not Python convention.
* **2+ query classes** → extract all of them to
  `backend/app/repositories/<aggregate>/_queries/<snake_case_name>.py`
  (one class per file), re-exported from `_queries/__init__.py`.
  Underscore-prefixed `_queries/` signals repository-internal, same
  precedent as `_pagination.py`, `_mappers.py`, `_base.py`.

The class name retains the `Query` suffix in either layout so call sites
read fluently (`ProjectsWithDatasetsQuery().with_org_scope(...)...`).

For the ratifying instance: `ProjectsWithDatasetsQuery` lives inline in
`backend/app/repositories/metadata/project_repository.py` (one query
class for the Project aggregate today). If/when a sibling joins
(`ProjectsByMemberQuery`, etc.), both move to `_queries/` in the same MR
that introduces the second.

### Contract — what each query class owns

1. **Invariants.** E.g., "org scoping applied when `org_id` is provided;
   no scope applied when `None`." The exact invariant is per-query; the
   point is that it is declared on the query class, not implicit in the
   method body.
2. **Default projection.** The `selectinload` + `load_only(...)` shape,
   declared inside `compile()`'s `base = select(...)` so the projection
   travels with the result-shape identity.
3. **Conditional filter assembly.** `with_*` methods that no-op when the
   input is `None` (or whatever the per-filter "absent" sentinel is).
4. **Computed semantics.** The has-more probe (`limit + 1`) is expressed
   as `with_limit_probe(limit)` so the off-by-one is owned by the query,
   not by every caller.
5. **Input validation.** `with_cursor` invokes `decode_cursor`; malformed
   cursors raise `InvalidCursor` through the query class boundary. The
   query class is the right home for "this input must parse"; it is *not*
   the home for "this caller is unauthorized".

### Contract — what query classes DO NOT own

1. **Execution.** The repository method calls `query.compile()` then runs
   `await self._session.execute(...)`. Query classes have no `session`,
   no `await`, no `__aenter__`.
2. **I/O exception wrapping.** `@handle_repository_exceptions` stays on
   the repository method. Query-class code can raise `InvalidCursor` and
   any built-in exception its inputs already raise (`ValueError`,
   `TypeError`); it does not raise `MetadataRepositoryError`.
3. **Result mapping.** Dict construction, summary projection
   (`_mappers.project_to_dict`, `_mappers.dataset_summary`) stays in the
   repository method. The query produces records; the repository shapes
   them for the use-case layer.
4. **Pagination consumption.** A query class produces a `Select`. The
   repository consumes the executed records through `paginate_by_id` /
   `paginate_composite` (`_pagination.py`). The two compose:

   ```python
   query = (
       ProjectsWithDatasetsQuery()
       .with_org_scope(org_id)
       .with_cursor(cursor)
       .with_default_ordering()
       .with_limit_probe(limit)
       .compile()
   )
   result = await self._session.execute(query)
   projects, next_cursor, has_more = paginate_by_id(list(result.scalars().all()), limit)
   ```

### Fluent vs. accumulator — why both

The **fluent** surface (`with_*` returning `Self`) is for the caller:
reading order matches reasoning order. The **accumulator** internal
(`self._steps: list[Callable[[Select], Select]]` folded by
`functools.reduce` at `compile()` time) is for the implementation:
conditional-no-op-when-`None` lives at append-time, so `compile()` has
no `if`-tests scattered through it. The two together let the caller read
as a sentence and the implementer read as a flat reduce.

### Composition with existing helpers

* **`_pagination.py` (`paginate_by_id`, `paginate_composite`)** — composes
  with query classes; consumes execution results. Not owned by the query
  class.
* **`_mappers.py`** — composes with query classes at the repository method,
  not inside `compile()`. Mapping is "executed-record → dict"; the query
  is "`Select`".
* **`@handle_repository_exceptions`** — stays on the repository method; the
  query class itself is exception-free of `MetadataRepositoryError`.

## Consequences

### Positive

* **Caller code reads as a domain-language sentence.** The five-line
  `ProjectsWithDatasetsQuery().with_org_scope(org).with_cursor(c)
  .with_default_ordering().with_limit_probe(limit).compile()` replaces 12
  lines of procedural `if`s.
* **Invariants and defaults declared once.** Org-scope rule, default
  ordering, projection shape, and has-more probe arithmetic live in one
  class shared across all call sites.
* **Multiple call sites share one query class today.** The ratifying
  instance is consumed by **both** `ProjectRepository.list_projects` (new
  per-aggregate file) **and** `MetadataRepository.list_projects` (legacy
  facade — lines 78–127). The legacy file's drifted inline has-more math
  is replaced by the same `compile() → paginate_by_id` composition the new
  file uses. The duplication-elimination claim is empirical, not
  speculative.
* **Future siblings inherit the pattern naturally.** Every new aggregate
  repository's complex reads land into `_queries/` with the same shape.
* **The convention is testable in isolation if it ever needs to be.**
  Query classes are pure builders; characterization tests at the repository
  boundary cover them transitively today, and direct unit tests are available
  if a projection or filter invariant becomes product-critical without an
  exercising consumer.

### Negative / accepted trade-offs

* **~40 LOC per query class.** Acceptable once the method has a non-trivial
  projection or >1 optional filter; not acceptable for `get_X_by_id`. The
  threshold rule (Decision §"When to introduce a query class") gatekeeps.
* **One indirection (the `_steps` lambda fold).** Debugging a `compile()`
  result requires unwrapping the `_steps` list. Mitigated by the per-step
  lambda being small and locally inspectable.
* **A second concept ("query class") joins the repository internals
  vocabulary.** Already-existing peers: `_mappers`, `_pagination`, `_base`,
  `_record` modules. The convention is consistent with the existing
  underscore-prefixed-module discipline; the marginal vocabulary cost is
  low.

### Operational

* **No new runtime dependency.** `functools.reduce` is stdlib;
  `typing.Self` is already used elsewhere in the codebase under
  `from __future__ import annotations`.
* **No migration.** The first instance refactors two methods that share a
  query; it can land as a single PR with no behavioural change.
* **No DEVOPS contract-test annotation.** No external integration is
  introduced or modified.
* **No deployment-topology change.** ADR-016's 5-service compose stack is
  untouched.

### Earned-Trust note

This refactor introduces no new substrate dependency, no new external
adapter, no new I/O boundary. ADR-019's probe contract is unaffected. The
convention is a structural relocation of existing logic; the substrate
guarantees it relies on (SQLAlchemy `Select` chaining, `selectinload` +
`load_only` projection semantics, `functools.reduce` evaluation order) are
already exercised by every existing repository test. No new probe is
warranted; existing repository-level characterization tests
(`backend/tests/repositories/test_project_repository.py`) cover the
ratifying instance transitively.

## Cross-decision composition (intentional)

* **ADR-025 ↔ ADR-020 — directly composes.** ADR-020's per-aggregate split
  is the natural carrier for this convention. Each new aggregate
  repository's complex reads get their own `_queries/` subdirectory under
  the aggregate's module. ADR-025 is **post-ADR-020**: it would not have
  paid for itself against the 866-LOC god-object (one giant file already
  hid every smell), and it pays for itself trivially once aggregates have
  their own modules. The ratifying instance lives in **both** sides of
  ADR-020's transitional facade — the new file and the legacy file — which
  is precisely the use case where one shared query class earns its keep.
* **ADR-025 ↔ ADR-019 — independent.** ADR-019's probe contract is at the
  substrate boundary (`dbtRunner`, `dbt-duckdb`, MinIO httpfs); ADR-025 is
  at the persistence-layer query-construction boundary. The two share no
  surface.
* **ADR-025 ↔ ADR-007 — independent.** Ibis is the SQL generator for
  runtime data-materialization; query classes are SQLAlchemy `Select`
  builders for the metadata persistence layer. Two distinct query engines,
  two distinct layers.
* **ADR-025 ↔ in-flight `extract-dataset-query-port` design** —
  independent. The query-port extraction is about the *Dataset model
  layer's* query-execution interface; ADR-025 is about the repository
  layer's `Select` construction. Orthogonal.

## Open questions

1. **Multi-aggregate join queries.** Hypothetical
   `DatasetWithTransformsAndReportsQuery` would touch three aggregates and
   has no obvious owning `_queries/` directory under any single aggregate.
   Two plausible homes: (a) a top-level `backend/app/repositories/_queries/`
   for cross-aggregate reads; (b) the "primary" aggregate's `_queries/`
   directory by analytical convention. **Defer** until a concrete case
   emerges; the choice is data-driven, not principles-driven.
2. **Query-class unit tests vs. repository-level coverage.** Query classes
   are pure builders; in principle they are trivially unit-testable. In
   practice, the existing per-aggregate repository tests
   (`backend/tests/repositories/test_*_repository.py`) exercise the query
   classes transitively, and direct query-class tests would mostly assert
   "this `Select` has these `where` clauses" — implementation-coupled and
   low-signal. **Suggested rule:** characterization tests at the repository
   boundary cover the query class transitively by default; add direct
   query-class tests only when a projection or filter invariant becomes
   product-critical (e.g., "org-scope MUST be applied" as a security
   invariant — but that level of invariant probably wants a `pytest-archon`
   structural rule, not a unit test).
3. **Architectural-enforcement rule for inline `if`-chains.** Should a
   `pytest-archon` rule ban `if x is not None: query = query.where(...)`
   chains exceeding ~3 conditional filters? **Probably not enforceable as a
   static rule** — the rule's premise ("non-trivial enough to deserve a
   query class") is judgement-laden, and pytest-archon's import-graph
   contracts are the wrong granularity. **Rely on code review** at the PR
   boundary; promote to a rule only if the convention is violated in
   practice across multiple PRs after the first instance lands.
4. **Bead assignment.** This ADR is Proposed; bead id assigned at DELIVER
   kickoff and back-filled here.

## References

* **Pattern provenance.** Fowler, "Query Object" — *Patterns of Enterprise
  Application Architecture* (2002). CQRS "Read Model" concept — Greg Young.
* **Composes with.** ADR-020 (per-aggregate split) —
  `docs/decisions/adr-020-metadata-repository-split.md`.
* **Sibling helper.**
  `backend/app/repositories/metadata/_pagination.py` (`paginate_by_id`,
  `paginate_composite`) — query classes produce a `Select`; pagination
  consumes the executed records.
* **First call site (new file).**
  `backend/app/repositories/metadata/project_repository.py::ProjectRepository.list_projects`
  (lines 68–108).
* **Second call site (legacy facade).**
  `backend/app/repositories/metadata/repository.py::MetadataRepository.list_projects`
  (lines 78–127) — also retires the inline pre-`paginate_by_id` has-more
  math that the `_pagination.py` extraction missed.
* **Input-validation boundary.**
  `backend/app/utils/pagination.py::decode_cursor` /
  `app.utils.pagination.InvalidCursor`.
* **Underscore-prefixed-module precedent.** `_pagination.py`, `_mappers.py`,
  `_base.py` (post-ADR-020) — `_queries/` follows the same convention.
* **Architecture brief.** `docs/product/architecture/brief.md`
  (`## Application Architecture`).
* **CLAUDE.md constraints.** Repository pattern, decorator stack,
  `RestrictedSession` injection, org-scoping discipline (all preserved
  verbatim).
