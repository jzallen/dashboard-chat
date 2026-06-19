# Domain Model — View / Report Disaggregation

**Wave:** DESIGN (domain scope) · **Mode:** PROPOSE
**Area:** backend · **Type:** brownfield evaluation (`wave:refactor`)
**Scope of this pass:** ubiquitous language + aggregate-boundary decision only.
Normalized-table / persistence / IR design is a separate downstream pass
(solution-architect). This document produces no DDL and no migrations.

This document settles one domain question: **is Report a specialization of
View (one aggregate, rule variation pushed to the application layer), or are
View and Report two sibling aggregates?** It establishes the ubiquitous
language, locates where the "slightly different business rules" actually live
today, and reconciles the answer with ADR-051 Finding 2.

All claims are backed by `file:line` evidence read during grounding.

---

## 1. The central tension (stated up front)

The user's hypothesis: *"reports are essentially views with slightly different
business rules at the application layer."*

ADR-051 Finding 2 (`docs/feature/transform-operations-ir/design/evaluation.md`
§6) argued the opposite for the *operations IR* question: View is "relational
composition," Report is "aggregation," they have "different vocabularies," and
should stay separate structured IRs.

**Both can be true at once, and that is the whole finding.** ADR-051 was
answering "should View/Report rows live in the *staging operations* table?" —
and the answer is still no. This pass answers a different question: "do View
and Report share a *domain concept and a value-object kernel*?" — and the
answer is yes. The single most important tension is that **ADR-051 conflated
two distinct claims**:

1. *(stands)* View/Report are not sequenced row/column-shaping operation lists,
   so they do not belong in the Dataset-staging `transforms` table.
2. *(overturned)* View/Report have "different vocabularies." They do not. They
   share one vocabulary — **a derived relation declared by a projection over
   sources, optionally filtered, with a declared grain** — and Report adds
   exactly one structural element on top: **aggregation of measures over that
   grain.**

The evidence for overturning claim 2 is in the code, below.

---

## 2. Evidence: the vocabularies already overlap, not diverge

ADR-051 Finding 2 rested on "different vocabularies, order-insensitive
structured aggregates." Grounding the current code shows three load-bearing
overlaps the prior finding did not weigh:

### 2.1 View already owns the aggregation vocabulary

The "aggregation is report-only" premise is false. View carries the full
grain/role taxonomy today:

- `GrainRole` enum — `Time | Dimension | Entity | Metric`
  (`backend/app/models/view.py:40-45`).
- `ViewGrain(time_column, dimensions)` (`view.py:68-70`).
- `assign_grain_roles` classifies every view column into
  Time / Dimension / Entity / **Metric** (`view/grain_service.py:8-48`).

Report's `columns_metadata` uses the role trichotomy **entity / dimension /
measure** (`report/column_validation.py:9-13`). "Measure" is View's "Metric";
"entity / dimension" are identical. The two models already speak the same
column-role language — View calls the measure role `Metric`, Report calls it
`measure`, and that naming drift is itself evidence of a missing shared
vocabulary, not of two different domains.

### 2.2 Report's aggregation is a View's grain taken one step further

- View compiles `select → join[declaration-ordered] → filter → grain`
  (`view/sql_generator.py:205-258`). The grain is declared but used only to
  *classify* columns (roles), not to GROUP BY.
- Report compiles `group_by(dimensions).aggregate(measures)`; entity-only
  reports fall through to a plain projection
  (`report/report_ibis_compiler.py:105-123`).

A Report is structurally a View whose declared grain keys (dimensions) become
GROUP BY keys and whose Metric/measure columns become aggregate expressions.
The report compiler's entity-only branch (`report_ibis_compiler.py:108-113`)
*is* a view-style projection with no aggregation. The pipelines are the same
relational algebra; Report applies one additional operator (aggregate-over-grain).

**Ordering precision (distinguishing from staging).** View's *joins* are
order-sensitive: the compiler iterates `view.joins` in declaration order
(`sql_generator.py:237-241`), so join order is intra-structure and
compiler-significant. Report's `columns_metadata`, by contrast, is a list whose
*order is incidental* — the compiler filters entries by `semantic_role`
(`report_ibis_compiler.py:105-107`), it does not iterate them as a sequence, so
a dimension or measure may appear anywhere in the list with identical output.
This is the load-bearing distinction from the Dataset-staging operations IR
(ADR-051 §3): staging has a *non-commutative cross-operation MUTATE chain*
requiring an explicit `sequence` column; View/Report have at most *intra-
structure* order (the join list) and never a cross-operation sequence. Neither
View nor Report belongs in the sequenced staging table — and this is why.

### 2.3 They already share an application service

Report does not have its own dependency model. `create_report` and
`update_report` import the **View's** `DependencyService`
(`report/create_report.py:27`, `report/update_report.py:13`) to validate
`source_refs`. The source-ref / composition vocabulary is literally one shared
service today. This is the strongest single signal: when two "separate"
aggregates share a domain service for their core compositional invariant, they
are roles of one concept, not strangers.

### 2.4 Where the genuine differences live (and what kind they are)

| Report-specific rule | Location | Domain invariant or application policy? |
|---|---|---|
| `report_type ∈ {fact, dimension}` | `report.py:41` | **Typed attribute** of the aggregate — a classification of the mart, not a structural rule. |
| Measures require ≥1 dimension (`ReportRequiresDimension`) | `create_report.py:128-131`; `report/exceptions.py:29-57` | **Domain invariant** — a dimensionless aggregation has no grain. But it is a *report-mode* invariant: it only applies when the aggregate is in "aggregating" mode. |
| No mart-to-mart references (`InvalidReportReference`) | `create_report.py:109-110`; `update_report.py:53-54` | **Application policy** on the dependency graph (a Report may not source another Report). View has the dual policy via circular-dependency detection (`dependency_service.py:38-64`). |
| `semantic_role`/`semantic_type` pair validity | `column_validation.py:26-50` | **Value-object invariant** that View enforces structurally (typed `ViewColumn` + `GrainRole`) but Report enforces by hand over raw dicts. |
| Default `materialization` (`ephemeral` vs `view`) | `view.py:293`; `report.py:46` | **Policy/default**, not structure. |

**Finding:** every "different business rule" is either (a) a typed attribute,
(b) a mode-conditional invariant, or (c) application policy on the dependency
graph. **None of them is a structural-vocabulary difference.** The one real
structural addition Report makes is the aggregate-over-grain operator (§2.2).

### 2.5 The asymmetry that is an accident, not a domain fact

View has typed value objects (`ViewColumn`, `ViewJoin`, `ViewFilterVariant`
discriminated union, `ViewGrain` — `view.py:51-203`). Report has **none** —
`columns_metadata: list[dict]` is raw dicts validated by a hand-rolled function
(`report.py:45`; `column_validation.py`). This is not a domain distinction; it
is **modeling debt**. Report was never given the value-object treatment View
received under ADR-026 MR-1. Any unification must lift Report's columns to the
same typed kernel, not preserve the dict-soup.

---

## 3. Ubiquitous language

The discovery above yields one shared concept with role-specialization.

### 3.1 Shared kernel (the language both speak)

| Term | Definition | Today |
|---|---|---|
| **Derived Relation** | A model-layer transformation declared by a projection over sources, deterministically compiled to ibis/SQL, never storing executable SQL as authority. The genus of which View and Report are species. | implicit — no shared type |
| **Source Ref** | A typed reference to an upstream relation (dataset or view) this relation composes from. | `source_refs: list[dict]` on both (`view.py:287`, `report.py:42`) |
| **Projection** | The ordered set of output columns the relation exposes, each binding a source column to an output name with a display/semantic type. | `ViewColumn` (typed) / `columns_metadata` (dicts) |
| **Column Role** | The semantic role a projected column plays in a grain: Entity, Dimension, Time, or Measure. | `GrainRole` (view) ≅ `semantic_role` (report) |
| **Filter** | A boundary-validated predicate (operator + value) restricting rows. | `ViewFilterVariant` (view only today) |
| **Grain** | The declared granularity: a time column plus dimension keys identifying one row of the relation. | `ViewGrain` (view) / implied by dimension columns (report) |
| **Composition** | Joining/declaring multiple sources into one relation; subject to dependency-graph validity (no cycles, no mart-to-mart). | `DependencyService` (shared) |

### 3.2 View-role language

| Term | Definition |
|---|---|
| **View** | An *intermediate* derived relation (dbt `ephemeral`/intermediate layer). A projection over sources with joins, filters, and a declared grain, **without** measure aggregation. Composable into other Views and into Reports. |
| **Join** | A declaration-ordered relational combination of two sources (`ViewJoin`, `sql_generator.py:237-241`). Order is compiler-significant — the "order-insensitive" claim is false here. |

### 3.3 Report-role language

| Term | Definition |
|---|---|
| **Report** | A *mart* derived relation (dbt mart layer) that **aggregates measures over a grain**. The terminal layer: it may source datasets and views but never another report. |
| **Report Type** | `fact` (event/measure-centric mart) or `dimension` (entity-attribute mart) — a classification attribute. |
| **Measure** | A projected column carrying an aggregation (`sum`, `count`, `count_distinct`, `avg`, `min`, `max` — `report_ibis_compiler.py:37-44`). The report-only specialization of View's `Metric` role: a Metric that has been *committed to an aggregation function*. |
| **Aggregation Grain** | The Report's dimensions, reused as GROUP BY keys. A Report with measures but no dimension violates the **measure-requires-grain** invariant. |

**Language reconciliation note:** View's `GrainRole.Metric` and Report's
`measure` role are the same concept at two layers of commitment — a Metric
becomes a Measure when an aggregation function is bound to it. The unified
language should name this explicitly rather than carry two words.

---

## 4. Aggregate-boundary options

Three structurally distinct options. Each respects: no stored executable SQL
(ADR-026); ibis-derived compilation; boundary validation (ADR-026 MR-1).

### Option A — One aggregate, `kind` discriminator, rules in application layer

A single `DerivedRelation` aggregate with a `kind ∈ {view, report}`
discriminator. Aggregation columns and `report_type` are nullable/optional and
meaningful only when `kind == report`. The measure-requires-grain rule, the
no-mart-to-mart rule, and fact/dimension typing live as application-layer
policy keyed on `kind`.

- **Pros:** Directly realizes the user's hypothesis. One projection/column/
  filter/grain kernel, one repository surface, one compiler family entry point.
  Eliminates the `GrainRole`/`semantic_role` and `Metric`/`measure` drift.
  Smallest conceptual surface.
- **Cons:** Mode-conditional invariants ("this field is required only when
  kind=report") are a classic aggregate smell — the invariant set is not
  uniform across instances. Risk of a god-aggregate accreting both layers'
  optional fields. Two *use-case lifecycles* (intermediate vs mart) get one
  type, which can blur the "Report is terminal, View is composable" rule.
- **Vernon rule pressure:** Rule 2 (true invariants in one boundary) is *weakly*
  satisfied — some invariants apply only in one mode. Rule 1 (model true
  invariants) is at risk because optional-by-mode fields dilute the invariant.

### Option B — Two aggregates sharing a value-object kernel (RECOMMENDED)

`View` and `Report` remain **distinct aggregate roots** (distinct lifecycles,
distinct terminality, distinct invariant sets), but both are composed from a
**shared, typed value-object kernel**: `ProjectionColumn`, `ColumnRole`,
`SourceRef`, `Filter`, `Grain`. Report's `Measure` is a value object in the
kernel that *extends* the column-role vocabulary with a bound aggregation.
`DerivedRelation` is the *ubiquitous concept* (the language) that both honor;
it need not be a single class.

- **Pros:** Honors that View and Report have genuinely different invariant sets
  and lifecycles (View is composable/intermediate; Report is terminal/aggregating)
  while killing the duplication that ADR-051 Finding 2 mistook for "different
  vocabularies." Lifts Report's dict-soup (`columns_metadata`) onto the same
  typed value objects View already has (§2.5) — the real modeling debt fix.
  Each aggregate's invariants stay uniform (no mode-conditional fields). The
  shared `DependencyService` (`dependency_service.py`) becomes the kernel's
  composition service, formalizing what is ad-hoc today.
- **Cons:** Requires extracting a shared kernel module (more types than Option
  A). Two repository surfaces persist. The relationship between the two
  aggregates must be explicitly mapped (Report depends-on View via SourceRef,
  ACL-free since both are in-context).
- **Vernon rule pressure:** Rule 1 & 2 (model true invariants; one boundary per
  consistency rule) — satisfied: each aggregate's invariants are uniform.
  Rule 3 (reference other aggregates by identity) — satisfied: Report references
  View by `SourceRef` id, never embeds it. Rule 4 (eventual consistency across
  aggregates) — satisfied: dependency validation already runs as a separate
  read-then-check, not a transactional invariant.

### Option C — Keep fully separate (status quo, ADR-051 Finding 2 as-is)

No shared kernel; View and Report stay independent in every respect, unified
only by "the ibis-compiler family."

- **Pros:** Zero refactor. Honors ADR-051 Finding 2 verbatim.
- **Cons:** Preserves the `GrainRole`/`semantic_role` and `Metric`/`measure`
  drift, the dict-soup asymmetry (§2.5), and the duplicated source-ref/
  composition handling. Leaves the user's hypothesis unaddressed and the
  shared `DependencyService` import (`create_report.py:27`) as an unexplained
  cross-context reach. **Rejected** — it ignores demonstrated overlap and the
  evidence that ADR-051's "different vocabularies" premise is false.

---

## 5. Recommendation

**Option B — two aggregates sharing a typed value-object kernel.**

Rationale, in priority order:

1. **It is the honest reading of the evidence.** The vocabularies overlap
   (§2.1–2.3), so full separation (Option C) is wrong. But the invariant sets
   and lifecycles genuinely differ (View composable/intermediate, Report
   terminal/aggregating, measure-requires-grain applies only to Report), so a
   single mode-switched aggregate (Option A) would carry non-uniform invariants
   — the exact smell Vernon's Rule 1/2 warn against.
2. **It pays down the real debt.** The actionable defect is not "two tables";
   it is Report's untyped `columns_metadata` (§2.5) and the role-vocabulary
   drift. Option B forces both onto the shared kernel.
3. **It keeps the user's intent.** "Reports are essentially views with slightly
   different business rules" becomes precise: Report and View *share the derived-
   relation kernel*; Report's only structural addition is aggregate-over-grain,
   and its "slightly different business rules" (fact/dimension typing,
   measure-requires-grain, no-mart-to-mart) are application-layer policy on top
   of the shared kernel — exactly as the user proposed, without collapsing two
   distinct lifecycles into one type.

The downstream solution-architect pass should design the normalized tables
around the **shared kernel value objects** (one normalized representation of
projection columns / filters / source-refs reused by both roles), with Report's
aggregation specialization as an additive structure. This domain pass does not
prescribe that table shape.

---

## 6. Reconciliation with ADR-051 Finding 2

**Verdict: amended, partially overturned.**

| ADR-051 Finding 2 claim | Verdict | Basis |
|---|---|---|
| View/Report are not sequenced row/column-shaping operation lists; they do not belong in the Dataset-staging `transforms` table | **STANDS** | They are declarative relations compiled in one shot (`sql_generator.py:205`, `report_ibis_compiler.py:63`); staging's non-commutative MUTATE chain (eval §3) is absent. The operations IR stays staging-scoped. |
| Only staging has the ordering invariant requiring `sequence` | **STANDS, with caveat** | View *joins* are declaration-ordered (`sql_generator.py:237-241`) — the brief already flagged the "order-insensitive" claim as partially false. View/Report have *intra-structure* order (join list) but not a cross-operation `sequence`; the distinction from staging holds. |
| View/Report have "different vocabularies" (relational composition vs aggregation) | **OVERTURNED** | They share the projection / column-role / source-ref / filter / grain vocabulary (§2.1–2.3); View already owns the Metric role and grain; the source-ref dependency service is literally shared (`create_report.py:27`). Aggregation is one *additional operator* over a shared kernel, not a separate vocabulary. |
| Keep View and Report as separate structured IRs in the same "family" | **AMENDED** | Keep them as separate *aggregates* (Option B agrees on distinct roots) but bind them to a **shared typed value-object kernel**, not merely a loose "compiler family." The kernel is the formalization of the vocabulary overlap ADR-051 missed. |

ADR-051's *operative decision* (do not merge View/Report into the staging
operations table) is untouched. What is overturned is its *justification by
vocabulary difference*; the correct justification is **lifecycle and ordering-
invariant difference**, which Option B preserves while still extracting the
shared kernel.

---

## 7. Reuse Analysis (DESIGN hard gate)

| Existing component | File:line | Overlap with proposed kernel | EXTEND vs CREATE NEW | Justification |
|---|---|---|---|---|
| `ViewColumn` (+ `DisplayType`, `GrainRole`) | `view.py:51-56`, `:27-45` | The typed projection-column + column-role value object | **EXTEND → promote to kernel** | Already the typed projection model. Generalize its role enum to cover Report's `measure` (= committed `Metric`) and move it to a shared kernel module both roles import. Do not fork a second column type. |
| `ViewFilterVariant` discriminated union | `view.py:154-214` | Boundary-validated filter value object | **REUSE as-is, share** | Already the boundary-validation pattern (ADR-026 MR-1). Reports have no filter model today; when they need one it is this, not a new union. |
| `ViewGrain` | `view.py:68-70` | Grain value object | **EXTEND → kernel** | The grain concept is shared; Report's "aggregation grain" is this grain's dimensions reused as GROUP BY keys. One value object. |
| `Report.columns_metadata: list[dict]` | `report.py:45` | Untyped projection — the debt | **REPLACE with kernel value objects** | Raw dicts validated by hand (`column_validation.py`). Lift onto the shared `ProjectionColumn`/`Measure` kernel; this is the central modeling-debt fix (§2.5). |
| `DependencyService` | `view/dependency_service.py:10-64` | Source-ref existence + cycle/mart-to-mart validation | **EXTEND → kernel composition service** | Already imported by both view and report use cases (`create_report.py:27`). Formalize as the shared composition service of the kernel; add the no-mart-to-mart arm (today inline in `create_report.py:109`) as a first-class method. |
| `ReportIbisCompiler` | `report/report_ibis_compiler.py:47` | Aggregate-over-grain compiler | **REUSE / keep role-specific** | The aggregation operator is Report's structural specialization. Keep it as the Report role's compiler; it consumes the shared kernel's typed columns instead of dicts. |
| `ViewIbisCompiler` | `view/sql_generator.py:96` | Relational-composition compiler | **REUSE / keep role-specific** | The View role's compiler. Shares the kernel inputs with the report compiler; no merge required. |
| `report_type`, `ReportRequiresDimension`, `InvalidReportReference` | `report.py:41`; `exceptions.py:29-57`; `create_report.py:109,128` | Report-only attributes/policy | **KEEP at Report aggregate / application layer** | These are the genuine "slightly different business rules." They stay as Report-aggregate invariants + application policy, exactly per the user's framing. |

**Gate result: PASS.** Every proposed kernel element is an EXTEND/promote of an
existing View value object or the shared `DependencyService`. The only
genuinely *new* artifact is the kernel *module boundary* itself (where the
shared value objects live), justified because no current module is the home for
cross-role types — today View owns them and Report reaches across or
re-implements with dicts.

---

## 8. Open questions for downstream passes

1. **Solution-architect (persistence/IR):** design the normalized projection-
   column / filter / source-ref tables around the shared kernel; decide whether
   the aggregation specialization is a nullable column-set on a shared table or
   an additive sidecar. (Out of scope here — no DDL in this pass.)
2. **Naming:** confirm the kernel concept name (`DerivedRelation` proposed) and
   whether `Metric`→`Measure` unifies to one term with an optional bound
   aggregation.
3. **`fact`/`dimension` report_type:** is this a true aggregate invariant
   (affecting allowed roles) or a pure label? Current code does not branch on it
   in the compiler — verify before the solution-architect pass treats it as
   structural.
