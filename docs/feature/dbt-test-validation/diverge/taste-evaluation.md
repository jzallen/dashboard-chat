# Taste Evaluation — `dbt-test-validation`

**Feature**: dbt-test-validation
**Phase**: DIVERGE Phase 4 — Taste Evaluation
**Date**: 2026-05-08

> **Locked weights and rubric BEFORE scoring.** Weights are derived from the JTBD opportunity scores produced in Phase 1, then locked. Scoring matrix is the recommendation source.

---

## 1. DVF Filter — Primary Triage

Score 1–5 per lens. Eliminate options with DVF total < 6.

| ID | Title | Desirability | Feasibility | Viability | Total | Status |
|---|---|---|---|---|---|---|
| A | dbt data tests via in-app `dbt test` | 4 | 3 | 4 | 11 | Survives |
| B | Pandera + dbt-test export translator | 4 | 4 | 4 | 12 | Survives |
| C | Eject-then-test | 5 | 2 | 4 | 11 | Survives |
| D | Materialized assertion tables (`dbt build`) | 3 | 2 | 3 | 8 | Survives |
| E | Fire-and-forget + Parquet golden-file diff | 3 | 5 | 3 | 11 | Survives |
| F | Worker-emitted validation_plan + dbt unit tests | 4 | 1 | 2 | 7 | Survives |

**No eliminations** — all six options clear the DVF=6 threshold. Six options survive into taste scoring.

### DVF rationale

| ID | D rationale | F rationale | V rationale |
|---|---|---|---|
| A | User explicitly named "use dbt sql tests"; clear expressed need. | dbt-against-DuckDB needs profiles wiring + materializing the staging model in the test loop; not blocked but not free. | Existing eject feature already commits the codebase to dbt — investing in dbt tests in-app reuses the muscle. |
| B | Pandera is already adjacent (harness imports pandas); developer-grade ergonomics. | Pandera 0.29 stable; translator-to-dbt is a real engineering effort (~200–400 LOC) but well-bounded. | Schema-as-code reviewable in PRs is a clear engineering-org hygiene win. |
| C | "Run the customer's first run" is a direct expression of JOB-001's strategic level. | Highest one-time cost: must seed DuckDB profile, parquet sources, env. Wall-clock budget tight. | Validates the export feature itself — strong differentiator for the eject-to-dbt narrative. |
| D | dbt-elementary's "tests are build artifacts" pattern is real but uncommon. | Hardest to fit our current pipeline — Ibis materializes on demand, we don't have a `dbt build` target. Material change to inner loop. | Materialized assertion tables persist in the warehouse — but our DuckDB is ephemeral; viability pathway unclear. |
| E | Snapshot tests are well-understood; user signaled "fire-and-forget" interest. | Lowest engineering cost — capture, commit, compare. | Re-blessing fatigue is a real failure mode. Doesn't speak dbt at all → O4 unmet. |
| F | Cohesive idea but invents a new chat-protocol artifact (validation_plan event) — high desirability score is for the elegance, not for it being asked. | Lowest feasibility — needs worker changes + new ChatEvent type + dbt unit-test generator + ADR-014 amendment. | Splitting validation across worker+dbt+pytest is a viability concern (three places to fail). |

---

## 2. Locked Weights — Justification

### Product type: Developer Tool, with JTBD-driven re-anchoring

This feature is test infrastructure for a developer-facing application. The scoring matrix uses the **developer-tool defaults** as a starting reference, then re-balances against the validated job — locking the result before any scoring runs.

**T5 — Durability across ejection — locked at 30%.** The JTBD analysis (Phase 1) established **O4 (reuse validation logic across the in-app ↔ ejected-dbt boundary) as the highest-importance outcome at score 16**, exceeding O3 (15) and O5 (12). The custom T5 criterion was added explicitly to score what JOB-001's strategic level demands. T5 weight tracks O4's opportunity score; under-weighting T5 would cause the matrix to under-represent the validated job. Other weights re-balanced from developer-tool defaults: T1=12.5%, T2=17.5%, T3=7.5%, T4=12.5%, DVF=20%.

| Criterion | Default (Dev-tool) | **Locked weight** | Rationale |
|---|---|---|---|
| DVF (avg) | 25% | **20%** | DVF already filtered the field; further DVF weighting double-counts. |
| T1 — Subtraction | 15% | **12.5%** | Standard reduced slightly to make room for the JTBD-anchored T5. The user's "the setup still feels messy" still pushes T1 to a meaningful weight. |
| T2 — Concept Count | 20% | **17.5%** | Adding a new concept (dbt-on-DuckDB-in-pytest, validation_plan event, Pandera↔dbt translator) is exactly what the user is signaling fatigue about. Slightly trimmed from default. |
| T3 — Progressive Disclosure | 15% | **7.5%** | Test infrastructure has no real "first interaction" surface — engineers learn it once. Reduced. |
| T4 — Speed-as-Trust | 25% | **12.5%** | CI wall-clock matters (AC1.6 = 5min) but not as much as in user-facing tools. Reduced. |
| **Custom T5 — Durability across ejection** | n/a | **30%** | **Added per the brief and locked at 30% to track O4=16, the highest-importance under-served outcome from the JTBD analysis.** The standard rubric does not cover "will this assertion survive a deliberate, specified, product feature?" T5 is added explicitly to score what the validated job demands. |

**Total: 100%.** The custom T5 substitutes for cuts from T3 + T4, plus 5% trimmed from DVF and small reductions from T1 + T2.

### T5 — Durability-through-ejection (custom rubric)

**Test**: How much of the validation logic ships unchanged into the customer's `dbt-project-export` zip?

| Score | Description |
|---|---|
| 5 | Validation logic IS the customer's dbt tests. 100% reuse, no translation step. |
| 4 | Most validation logic ships as-is; ≤ 20% requires translation/regeneration on export. |
| 3 | ~50% ships; the other half is in-app-only (Python, snapshots, etc.). |
| 2 | Validation logic is in-app-only; export ships a stub schema.yml the customer fills in. |
| 1 | Zero reuse — in-app validation and export are entirely disjoint test surfaces. |

---

## 3. Taste Scoring Matrix

> Scored against the 4 standard taste criteria + 1 custom (T5), under the weights locked in §2. Each cell justified in a one-line note below the matrix. **Weighted Total** = 0.20·DVF + 0.125·T1 + 0.175·T2 + 0.075·T3 + 0.125·T4 + 0.30·T5.

| Option | DVF (avg) | T1 Sub | T2 Concept | T3 Prog | T4 Speed | T5 Durab | Weighted Total |
|---|---|---|---|---|---|---|---|
| A — dbt data tests via in-app `dbt test` | 3.7 | 4 | 3 | 3 | 3 | 4 | **3.57** |
| B — Pandera + dbt-test export translator | 4.0 | 4 | 3 | 4 | 4 | 4 | **3.83** |
| C — Eject-then-test | 3.7 | 5 | 4 | 3 | 2 | 5 | **4.04** |
| D — Materialized assertion tables | 2.7 | 3 | 2 | 3 | 2 | 4 | **2.94** |
| E — Fire-and-forget + Parquet golden-file diff | 3.7 | 5 | 4 | 5 | 5 | 2 | **3.67** |
| F — Worker-emitted `validation_plan` + dbt unit tests | 2.3 | 2 | 1 | 2 | 3 | 4 | **2.61** |

### Calculation worksheet (audit trail)

```
A: 0.20·3.7 + 0.125·4 + 0.175·3 + 0.075·3 + 0.125·3 + 0.30·4
   = 0.740 + 0.500 + 0.525 + 0.225 + 0.375 + 1.200 = 3.565
B: 0.20·4.0 + 0.125·4 + 0.175·3 + 0.075·4 + 0.125·4 + 0.30·4
   = 0.800 + 0.500 + 0.525 + 0.300 + 0.500 + 1.200 = 3.825
C: 0.20·3.7 + 0.125·5 + 0.175·4 + 0.075·3 + 0.125·2 + 0.30·5
   = 0.740 + 0.625 + 0.700 + 0.225 + 0.250 + 1.500 = 4.040
D: 0.20·2.7 + 0.125·3 + 0.175·2 + 0.075·3 + 0.125·2 + 0.30·4
   = 0.540 + 0.375 + 0.350 + 0.225 + 0.250 + 1.200 = 2.940
E: 0.20·3.7 + 0.125·5 + 0.175·4 + 0.075·5 + 0.125·5 + 0.30·2
   = 0.740 + 0.625 + 0.700 + 0.375 + 0.625 + 0.600 = 3.665
F: 0.20·2.3 + 0.125·2 + 0.175·1 + 0.075·2 + 0.125·3 + 0.30·4
   = 0.460 + 0.250 + 0.175 + 0.150 + 0.375 + 1.200 = 2.610
```

### Per-cell justification

#### Option A — dbt data tests via in-app `dbt test`

- **DVF 3.7** → (4+3+4)/3.
- **T1 (Subtraction) 4**: One minor element could be removed — pandas inspection becomes redundant. Core is: chat → dbt test. Tight.
- **T2 (Concept Count) 3**: Two new concepts — (1) running `dbt test` from inside pytest, (2) the relationship between Ibis-materialized DuckDB tables and the dbt model graph.
- **T3 (Progressive Disclosure) 3**: First-time engineer must learn dbt + dbt-against-DuckDB + how the harness invokes dbt. Sequenced but multi-step.
- **T4 (Speed-as-Trust) 3**: `dbt test` adds 2–5s per run; manageable inside AC1.6 but noticeable.
- **T5 (Durability) 4**: dbt tests authored in `schema.yml` ship via the export pipeline almost as-is; only the `sources.yml` reference might need rewriting.

#### Option B — Pandera + dbt-test export translator

- **DVF 4.0** → (4+4+4)/3.
- **T1 4**: Pandera schema is a single declarative artifact; one minor element (the translator) could be deferred.
- **T2 3**: Two new concepts — Pandera schema, and the translator that emits dbt tests on export.
- **T3 4**: First interaction is "validate this DataFrame against this schema" — well-anchored in the existing pandas-based harness. Translator is one step removed.
- **T4 4**: Pandera validation is fast (sub-100ms for typical schemas); minor latency, well-masked.
- **T5 4**: Pandera schema → dbt-test translation is an automatable pipeline; ≤20% requires per-test custom logic on edge cases (regex semantics, custom checks).

#### Option C — Eject-then-test

- **DVF 3.7** → (5+2+4)/3.
- **T1 5**: Nothing can be removed without breaking it. The mechanism is *running the customer's workflow as the test*. Maximally subtractive.
- **T2 4**: One new concept — "the test IS `dbt build && dbt test` on a temp dir" — well-anchored in the eject-to-dbt feature engineers already know.
- **T3 3**: First interaction exposes the entire `dbt-project-export` mechanism. Sequencing logical but front-loaded.
- **T4 2**: `dbt build && dbt test` adds 10–30s per run on top of chat. Multiple wait points; AC1.6 has headroom but not generous.
- **T5 5**: 100% reuse. The validation logic IS the customer's first run. By construction.

#### Option D — Materialized assertion tables

- **DVF 2.7** → (3+2+3)/3.
- **T1 3**: Multiple removable elements — does each assertion really need to be a model? Value is unclear if the in-app DuckDB is ephemeral.
- **T2 2**: Three or more concepts — assertion models, dbt build vs dbt test, run_results.json parsing, ephemeral DuckDB target. Interdependent.
- **T3 3**: Engineers learn dbt build, model graph for assertions, materialized-test pattern. Sequentially exposed.
- **T4 2**: `dbt build` + assertion-model materialization is slower than `dbt test`. Multiple wait points.
- **T5 4**: Assertion models survive export, but most teams don't keep assertion models in mart layer — partial fit.

#### Option E — Fire-and-forget + Parquet golden-file diff

- **DVF 3.7** → (3+5+3)/3.
- **T1 5**: Maximally subtractive. SSE parsing gone, ChatEvent assertions gone, retry-with-rephrase gone (mostly), pandas inspection gone. One assertion: parquet equality.
- **T2 4**: One new concept — the golden-Parquet workflow. Well-anchored to snapshot-testing concepts engineers know from Jest/testthat.
- **T3 5**: First interaction is "run the flow, commit the parquet, you're done."
- **T4 5**: Parquet diff is fast — single file equality check is < 50ms.
- **T5 2**: Parquet snapshots don't ship to dbt. Customer ejects and starts from scratch. Unless we *also* convert snapshots into dbt unit-test fixtures (a real bridge — see recommendation), but that's a second mechanism.

#### Option F — Worker-emitted `validation_plan` + dbt unit tests

- **DVF 2.3** → (4+1+2)/3.
- **T1 2**: Clearly bloated — adds a new ChatEvent type + a worker-side validation-plan generator + a dbt unit-test fixture emitter + the runner that executes them. Several non-essential parts when judged against simpler options.
- **T2 1**: Five new concepts: validation_plan event, plan-emission discipline at the worker, plan-to-dbt-unit-test translation, fixture-driven dbt unit tests, plan/fixture sync invariant. Interdependent.
- **T3 2**: First interaction requires choosing between asserting on plan vs asserting on data. Two paths from the start.
- **T4 3**: Worker emits the plan during the turn; dbt unit tests run after. Latency is okay but justified only if the payoff lands.
- **T5 4**: dbt unit tests survive ejection (dbt 1.8+ feature ships the YAML); the plan-emission mechanism does not.

---

## 4. Ranking and Recommendation

| Rank | Option | Weighted Total |
|---|---|---|
| 1 | **C — Eject-then-test** | **4.04** |
| 2 | **B — Pandera + dbt-test export translator** | **3.83** |
| 3 | **E — Fire-and-forget + Parquet golden-file diff** | 3.67 |
| 4 | A — dbt data tests via in-app `dbt test` | 3.57 |
| 5 | D — Materialized assertion tables | 2.94 |
| 6 | F — Worker-emitted `validation_plan` + dbt unit tests | 2.61 |

The top three are within 0.37 of each other, but the structural bets differ sharply:

- **C** wins on durability (T5=5/5 — the only 5/5 in this column) and on subtraction (T1=5). The mechanism is irreducible: the validation logic IS the customer's first run.
- **B** is the most balanced — every score 4 — no failures, no exceptional strengths. Pandera anchors to the existing pandas harness; the translator emits dbt tests on export.
- **E** is the simplicity king (T1=5, T3=5, T4=5) but loses decisively on T5 (2/5) — Parquet snapshots don't ship to the customer's dbt project.

### Recommendation: **Option C — Eject-then-test**

**Why C wins under the locked weights**: T5=5/5 is the only score in this column reflecting the strategic-level job. Combined with T1=5/5 (irreducible mechanism) and T2=4/5 (one well-anchored new concept — the customer's own workflow), C captures JOB-001 cleanly. The T5 weight (30%) is deliberate: it tracks O4's opportunity score (16), the highest in the JTBD analysis. C is the only option that satisfies the strategic-level job by construction rather than by translation.

### Critical weakness flagged (carries forward to DESIGN)

T4 (Speed-as-Trust) at 2/5 is the lowest score in the top three. `dbt build && dbt test` on a freshly-extracted project, every test, will eat 10–30s of wall-clock per scenario. AC1.6 has headroom (~30% in the worst case per evolution doc §6) but that headroom is now spent. **If chat-driven flows grow past ~12 ops per scenario, AC1.6 risks breach.** DESIGN must address this with one of: (a) parallelize `dbt build` invocations, (b) cache dbt parse output across tests, (c) shrink the per-test wall-clock budget elsewhere.

A second weakness: **dependency on `dbt-project-export` correctness**. Today that feature has Gherkin specs (`features/dbt-project-export.feature`) but no green test gate. C bootstraps a load-bearing dependency on a feature that is itself not yet test-gated. A bug in export silently invalidates every test C runs. DESIGN must ratify a sequencing decision: gate the export feature first (tests for the export pipeline before tests *via* the export pipeline), or accept the inversion as a forcing function.

### Dissenting case: Option B (Pandera + dbt-test export translator)

Score 3.83 — **0.21 below C**. Outside scoring noise but inside risk-shift range. The dissent is principled: **if the team chooses not to take the load-bearing dependency on `dbt-project-export` correctness, B is the right answer.**

**Why B might still be right**:

1. **If `dbt-project-export` is not yet trusted** — B does not depend on the export pipeline being correct. Pandera schemas validate in-app today; the translator runs only at export time, and bad translations surface only when a customer ejects (acceptable, recoverable).
2. **If wall-clock budget is tighter than expected** — B runs Pandera in <100ms per validation. C's `dbt build && dbt test` overhead is real and accumulating.
3. **If the engineering team has more pandas/Pandera familiarity than dbt-CLI familiarity** — B leverages existing skills (harness already uses pandas); C adds dbt-CLI mechanics inside the test loop.
4. **If the translator is partially rather than fully automatable** — B degrades gracefully (manual `schema.yml` patches at export time); C does not (export must be correct end-to-end).

**The key dissent question for the DESIGN wave**: *"How much do we trust `dbt-project-export` today?"* If the answer is "not enough to load-bear our test suite on it," **B is the right call**. If the answer is "we'd rather find export bugs as test failures than as customer reports," **C is the right call**.

### Composition opportunity (for the DESIGN wave)

Options C and B are not mutually exclusive. A two-layer strategy is feasible:
- **Layer 1 (per-turn fast feedback)**: Pandera at the staging boundary (B's mechanism) — sub-100ms validation during the chat workflow; surfaces LLM errors immediately.
- **Layer 2 (per-flow durable gate)**: Eject-then-test (C's mechanism) — slower outer-loop gate validating the export pipeline AND the staged data together.

This is a *DESIGN-wave decision*, not a DIVERGE call — DIVERGE picks the primary direction; DESIGN ratifies the composition. The recommended primary direction is **C**, with **B** available as a fast-feedback layer if AC1.6 budget pressure surfaces during DESIGN.

---

## 5. Anti-Pattern Audit

| Anti-pattern | Detected? | Evidence |
|---|---|---|
| Cherry-picking criteria | No | All 6 options scored on all 6 criteria (DVF + T1–T5). |
| Weight manipulation | No | Weights locked in §2 before any scoring in §3. T5 weight (30%) derived from O4's opportunity score (16, highest in JTBD) — set BEFORE seeing any taste scores. |
| "It feels right" override | No | The recommendation IS the #1-by-score under the locked weights. |
| Feasibility as tie-breaker only | No | Feasibility filtered (DVF) AND scored within taste (implicit in T2/T3). |

---

## 6. Phase 4 Gate Check

- ✓ DVF filter applied (six options scored; no eliminations).
- ✓ **Weights locked before scoring** — derived from JTBD opportunity scores in §2, scoring happens only in §3.
- ✓ All six options scored on all six criteria.
- ✓ Weighted ranking complete.
- ✓ Recommendation traceable to scoring matrix (top score wins; weakness flagged).
- ✓ Dissenting case documented with explicit "if circumstances change" criteria.
