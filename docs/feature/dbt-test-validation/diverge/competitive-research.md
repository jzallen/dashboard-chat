# Competitive Research — `dbt-test-validation`

**Feature**: dbt-test-validation
**Phase**: DIVERGE Phase 2 — Competitive Research
**Depth**: Comprehensive (5+ approaches; non-obvious alternatives included)
**Date**: 2026-05-08

> Research is grounded in JOB-001: detect when a chat-driven workflow has produced incorrect staged data, with assertions durable across the eject-to-dbt boundary. Each approach is evaluated for its fit to that job — not in absolute terms.

---

## 1. The Validated Job in One Sentence (for grounding)

> Validate chat-driven workflows by asserting on staged data, in a way that survives ejection to a customer's dbt project (`features/dbt-project-export.feature`).

---

## 2. Prior Art — Real Tools and Approaches

### 2.1 dbt-native data tests (singular + generic)

**Source**: [dbt Developer Hub — Data tests](https://docs.getdbt.com/docs/build/data-tests), [dbt Tests Explained](https://medium.com/@likkilaxminarayana/dbt-tests-explained-generic-vs-singular-with-real-examples-6c08d8dd78a7)

**What it is**:
- **Generic tests** — built-in (`unique`, `not_null`, `accepted_values`, `relationships`); declared in `schema.yml`; reusable across columns and models. dbt-utils adds 16 more (e.g. `equal_rowcount`, `fewer_rows_than`, `not_accepted_values`); dbt-expectations adds 62 more (Great Expectations port maintained by Metaplane).
- **Singular tests** — a `.sql` file in `tests/` that returns failing rows. Maximum flexibility. `dbt test` runs both.

**Fit to job**:
- ✓ **O4 (reuse across ejection boundary)** — the assertions are dbt-native. If we author them in a way that survives `dbt-project-export`, the customer's ejected project ships *with the tests already in it*.
- ✓ **O1 (discover incorrect staged data)** — assertions run against the staged model output, not the API response.
- ✗ **O3 (insulate from chat-protocol churn)** — only true if the chat path *settles* the staged data before the test fires. If chat is fire-and-forget, the tests need a synchronization point.
- ✗ **Limitation**: dbt tests run against persisted data — they assume the SUT has materialized the staging model. Today our staging model is an Ibis-compiled query against Parquet (ADR-007), not a `dbt run`-produced table. We'd need to either materialize on demand or run dbt against the same DuckDB instance.

**Cost**: Author tests in `schema.yml` and `tests/`. Run via `dbt test`. dbt 1.8+ also adds **unit tests** (see 2.2).

**Closest analog**: how analytics-engineering teams already validate dbt models in their day jobs.

### 2.2 dbt unit tests (dbt 1.8+)

**Source**: [dbt unit tests](https://docs.getdbt.com/docs/build/unit-tests), [Adrienne Vermorel — Unit Testing in dbt 1.8+](https://adriennevermorel.com/articles/unit-testing-dbt-complete-implementation-guide/)

**What it is**: as of dbt 1.8 (May 2024), dbt ships **unit tests** that mock model inputs (csv / dict / sql fixtures) and assert on expected output, row-by-row. The runner generates CTEs from the mocked inputs and executes the model SQL against them. `dbt test --select test_type:unit` runs only unit tests.

**Fit to job**:
- ✓ **O4** — unit-test fixtures travel with the dbt project on ejection.
- ✓ **O1** — by construction, the assertion is on the staged data shape.
- ✓ **O3** — unit tests are decoupled from the chat protocol entirely; they test the *transform SQL* in isolation.
- ✗ **Limitation**: unit tests don't exercise the chat→worker→backend path at all. They miss "did the chat correctly translate the user's intent into a transform?" That's the whole reason we have integration tests in the first place.

**Cost**: per-model fixtures + expected outputs in YAML. Once authored, they're cheap to run.

**Closest analog**: traditional unit tests, but for SQL.

### 2.3 Great Expectations (GX)

**Source**: [Soda Core vs Great Expectations](https://www.thedataletter.com/p/tool-review-soda-core-vs-great-expectations), [Branch Boston — GE vs Deequ vs Soda](https://branchboston.com/great-expectations-vs-deequ-vs-soda-data-quality-testing-tools-compared/)

**What it is**: Python-first declarative data validation framework. ~300 built-in "Expectations" (`expect_column_values_to_be_unique`, `expect_column_values_to_match_regex`, etc.). Generates "Data Docs" — an HTML site documenting expectations as a versioned data contract. Higher learning curve (Data Contexts, Batch Requests), full Python flexibility.

**Fit to job**:
- ✓ **O1** — strong native expression of staging-layer expectations.
- ✗ **O4** — GE expectations don't survive ejection to dbt unless the customer also adopts GE. dbt-expectations is the bridge (62 of GE's expectations as dbt generic tests), so the natural mapping is "use dbt-expectations, not GE itself."
- ✗ **O3** — adds a third runtime (alongside pytest + dbt CLI on export). High setup cost — the user explicitly flagged "the setup still feels messy" as the trigger for this whole feature.

**Cost**: high. Data Context configuration + per-suite YAML/JSON + Data Docs hosting decisions.

### 2.4 Soda Core + SodaCL

**Source**: [Soda Core vs Great Expectations — Hodman Murad](https://python.plainenglish.io/soda-core-vs-great-expectations-choosing-your-data-quality-tool-a98ce5096393), [DataKitchen — 2026 Open-Source DQ Landscape](https://datakitchen.io/blog/the-2026-open-source-data-quality-and-data-observability-landscape/)

**What it is**: CLI tool with YAML-based check language (SodaCL) compiled to SQL. "If you can write a SQL WHERE clause, you can write a Soda check." Aimed at continuous monitoring (Slack/PagerDuty alerting) more than CI gating, but supports both. Can call Python UDFs for custom checks.

**Fit to job**:
- ✓ **O1** — checks compile to SQL run against the staging table.
- ✗ **O4** — same problem as GE: doesn't survive ejection unless customer adopts Soda. Soda checks don't compile to dbt tests.
- ✓ **O3** — one YAML per dataset; insulated from chat-protocol.

**Cost**: medium. New runtime + YAML schema. Production observability sweet spot is wasted in our CI-gating use case.

### 2.5 Pandera schema contracts

**Source**: [Pandera (Union.ai)](https://github.com/unionai-oss/pandera), [Pandera Validation Guide 2026](https://pythondatabench.com/article/data-validation-python-pandera-practical-guide), [DZone — Pandera open-source framework](https://dzone.com/articles/pandera-open-source-data-validation-framework)

**What it is**: lightweight schema validation for pandas/Polars/PySpark DataFrames. `DataFrameSchema` or `DataFrameModel` declares dtypes + constraints; `schema.validate(df)` asserts. Pandera 0.29 (Jan 2026) supports Python 3.10–3.14, pandas 2.x/3.x. Recommended pattern: `import pandera.pandas as pa`. With `strict=True`, unexpected columns raise — catching upstream schema drift.

**Fit to job**:
- ✓ **O1** — assertions live exactly at the staging-data boundary; treats schemas as code artifacts (PR-reviewable).
- ✓ **Already in our stack adjacency** — the harness already uses pandas (`harness.py:49 import pandas as pd`); Pandera is a small dependency add.
- ✗ **O4** — Pandera schemas don't translate to dbt tests; same ejection-boundary problem.
- ✓ **O3** — schemas live in Python; insulated from chat-protocol.

**Cost**: low. One new dependency. Schemas are short.

### 2.6 Contract testing (Pact-style; consumer-driven)

**Source**: [Pact Docs — Consumer Tests](https://docs.pact.io/consumer), [Total Shift Left — Contract Testing 2026](https://totalshiftleft.ai/blog/contract-testing-for-microservices), [DataOps Redefined — Contract Testing](https://www.thedataops.org/contract-testing/)

**What it is**: consumer-driven contract testing. The consumer defines what messages it expects from the producer; a "pact" file records those expectations; the producer verifies it can satisfy them in CI. Pact Broker stores the pacts and tracks compatibility.

**Fit to job**:
- ✓ **O3** — the test surface is the *wire-format contract*, not the implementation. Chat-protocol churn would only break tests if the contract itself changed.
- ✗ **O1** — Pact validates *messages between services*, not *staged data after SQL transform*. Wrong abstraction layer.
- ✗ **O4** — pacts don't translate to dbt tests.

**Cost**: medium. Adds Pact infrastructure. Doesn't address the load-bearing functional outcome (staged-data correctness).

**Why it's worth listing anyway**: it's the structural opposite of the user's hypothesis. Where dbt-test-validation says "decouple from chat protocol; assert on data," contract testing says "stop asserting on data; assert on the protocol contract instead." Useful as a reference shape for "what a tighter-coupling option looks like."

### 2.7 Property-based / metamorphic testing for SQL transforms

**Source**: [MarkTechPost — Property-Based Testing with Hypothesis](https://www.marktechpost.com/2026/04/18/a-coding-guide-for-property-based-testing-using-hypothesis-with-stateful-differential-and-metamorphic-test-design/), [Bytes Yingw — Property-Based Testing with Hypothesis](https://bytes.yingw787.com/posts/2021/02/02/property_based_testing)

**What it is**: instead of asserting on specific outputs, assert on *invariants that must hold across many inputs*. Hypothesis (Python) or fast-check (JS) generates inputs and shrinks failures. Metamorphic tests assert relationships ("if input X is permuted, output Y is permuted in this way"). Stateful PBT (`RuleBasedStateMachine`) replays sequences of operations.

**Fit to job**:
- ✓ **O3** — invariants are protocol-agnostic.
- ✓ **O1** — properties on staged data ("trim is idempotent", "title-case preserves cardinality unless duplicates collapse") catch entire classes of bugs at once.
- ✗ **O4** — Hypothesis tests are Python; don't ship to customer's dbt project.
- ✓ **Disruption potential** — could replace several scenario-based tests with one property.

**Cost**: medium-high. Property authoring is a skill; catches subtle bugs but the upfront cost is real.

### 2.8 Snapshot / golden-file testing on tabular data

**Source**: [Casper — Golden Tests](https://medium.com/casperblockchain/golden-tests-e521077ae235), [Indrajeet Patil — Snapshot Testing in R](https://indrajeetpatil.github.io/intro-to-snapshot-testing/), [Martin Ahindura — Snapshot Testing in Data Science](https://martinahindura.medium.com/snapshot-testing-in-data-science-f2a9bac5b48a), [RegreSQL via "SQL Regression Tests" — Tapoueh](https://tapoueh.org/blog/2017/08/sql-regression-tests/)

**What it is**: capture the output of a workflow once (the "golden" snapshot); subsequent runs diff against the snapshot. Tabular variant: persist the staging table as Parquet/CSV/JSON; rerun the workflow; assert exact equality. RegreSQL is the SQL-specific shape (capture query result; rerun; diff). Common in characterization-test usage (Feathers).

**Fit to job**:
- ✓ **O1** — diff IS the assertion; binary pass/fail.
- ✓ **O5** — adding the next flow is "run, capture, commit." Cheapest marginal cost.
- ✗ **O4** — snapshot files don't ship through `dbt-project-export` today; would need to be authored as dbt unit-test fixtures (see 2.2) to survive ejection.
- ✗ **Brittleness** — every intentional change requires re-blessing every affected snapshot. Diff-noise risk on LLM-driven workflows.
- ✓ **Synergy** — snapshots can *bootstrap* dbt unit-test fixtures (the captured output IS the expected output). This is a non-obvious bridge.

**Cost**: low marginal; high blessing-discipline cost.

### 2.9 Materialized assertion tables (dbt-build-as-test)

**Non-obvious alternative**. Not a named tool — an architectural pattern.

**What it is**: instead of running tests *separately*, materialize models that SELECT only failing rows. `dbt build` runs models *and* tests in DAG order. If any test fails, downstream models do not build. The test artifacts become first-class build artifacts. Pattern documented in [Datafold — 7 dbt testing best practices](https://www.datafold.com/blog/7-dbt-testing-best-practices/) and [Elementary Data — dbt tests](https://www.elementary-data.com/post/dbt-tests).

**Fit to job**:
- ✓ **O4** — the test IS a dbt artifact. Survives ejection by construction.
- ✓ **O1** — failing rows are inspectable in the warehouse; debuggability is a feature.
- ✓ **O3** — fully decoupled from chat protocol.
- ✗ Requires the staged data to be persisted in a way `dbt build` can reach. Today our pipeline runs Ibis against Parquet on demand; we'd need to either materialize the dataset's staging SQL into DuckDB and run dbt against it, or treat the in-app DuckDB as a dbt target.

**Cost**: medium. Worth the cost only if `dbt build` integrates cleanly into the test loop.

### 2.10 Capture-replay of SSE traces with snapshot diffs

**Non-obvious alternative**. Adapted from LangWatch Scenario's [SSE Pattern testing guide](https://langwatch.ai/scenario/examples/testing-remote-agents/sse/) and the broader [SSE testing literature](https://procedure.tech/blogs/sse-for-llms/).

**What it is**: capture the worker's full SSE trace (every `ChatEvent` frame) from a real run. On subsequent runs, replay the *same prompt* and assert the trace matches (modulo allowed jitter — assistant-text deltas, timestamps). The trace IS the contract. Pairs with the existing presentation-state log (ADR-015) — we already have a `UIDirective[]` log per channel.

**Fit to job**:
- ✓ **O3** *(inverted)* — actually *increases* coupling to chat protocol. This is intentionally a tighter-coupling option to test the "is fire-and-forget actually better?" hypothesis.
- ✗ **O1** — the SSE trace is protocol; not staged data. Wrong abstraction layer for the load-bearing outcome.
- ✓ **O6** — failures are diff-able; root-causing "what changed" is fast.
- ✗ **LLM jitter** — assistant-text deltas and tool-call ordering may legitimately change. Brittle without good masking.

**Cost**: medium. Capture once; replay forever; bless when intent changes.

### 2.11 Eject-then-test (use dbt-project-export as the validation gate)

**Non-obvious alternative**. *This is the disruption candidate from JTBD §5.*

**What it is**: drive the chat workflow → call `POST /api/projects/{id}/export-dbt` to eject → unzip the dbt project into a sandbox → run `dbt build && dbt test` against a DuckDB target seeded with the same Parquet sources → green = pass. The validation harness IS the customer's first run.

**Fit to job**:
- ✓ **O4** — *maximally* satisfies. The validation logic IS the customer's. Reuse is 100% by definition.
- ✓ **O1** — `dbt build` materializes staging models; tests run against them.
- ✓ **O3** — chat-protocol changes are invisible to the test as long as the export shape stays stable.
- ✗ **Wall clock** — `dbt build && dbt test` adds 10–30s per test on top of the existing 30–90s chat workload. AC1.6 (5min) has headroom but not infinite.
- ✗ **Coupling to export feature** — if `dbt-project-export` is buggy, this validation strategy is undermined. Today the export feature has Gherkin specs (`features/dbt-project-export.feature`) but no green test gate.

**Cost**: high one-time (build the eject-then-test loop); low marginal (each new flow is the same loop).

### 2.12 Characterization tests via DuckDB introspection (the API-response baseline)

**The current baseline** — what the harness does today.

**What it is**: chat-driven workflow runs against a real compose stack; harness consumes typed `ChatEvent` SSE frames; after `turn_done`, asserts on table state via `GET /api/datasets/{id}` + pandas in-memory DataFrame inspection. ChatEvent shape is *also* asserted (e.g. `assert any(e.type == "transform_applied" ...)`). Retry-with-rephrase budget of 2 absorbs LLM jitter.

**Fit to job**:
- ✓ Currently working; ~1080 LOC for G.1 (`harness.py` 1104 + tests).
- ✗ **O4 (reuse)** — zero. Tests are pytest-only.
- ✗ **O3 (chat-protocol churn)** — high cost. Harness LOC went from 695 → 1104 across `dc-wcy` to keep up with stratification (no new scenarios added).
- ✓ **O5 (marginal cost of next flow)** — moderate; well-amortized for the 10-op demo.

**Cost**: known. The user is signaling it's *too high* relative to the value — hence this DIVERGE.

---

## 3. Synthesis Table — Approach × ODI Outcome Fit

| # | Approach | O1 (find bad data) | O3 (chat-churn) | O4 (eject-reuse) | O5 (next-flow) | Notes |
|---|---|---|---|---|---|---|
| 2.1 | dbt data tests (singular + generic) | ✓ | ◐ | ✓✓ | ✓ | Needs sync point if chat is async |
| 2.2 | dbt unit tests (1.8+) | ✓ | ✓ | ✓✓ | ✓ | Skips the chat path entirely |
| 2.3 | Great Expectations | ✓ | ◐ | ✗ | ✗ | Adds a third runtime |
| 2.4 | Soda Core | ✓ | ✓ | ✗ | ✓ | Sweet-spot is monitoring, not CI |
| 2.5 | Pandera | ✓ | ✓ | ✗ | ✓ | Already adjacent to harness |
| 2.6 | Contract testing (Pact-style) | ✗ | ✓✓ | ✗ | ✓ | Wrong abstraction layer |
| 2.7 | Property/metamorphic tests | ✓ | ✓ | ✗ | ◐ | High authoring skill |
| 2.8 | Snapshot / golden tests | ✓ | ✓ | ◐ | ✓✓ | Bridges to dbt unit-test fixtures |
| 2.9 | Materialized assertion tables | ✓ | ✓ | ✓✓ | ✓ | Requires dbt in the inner loop |
| 2.10 | SSE-trace capture-replay | ✗ | ✗✗ | ✗ | ✓ | Tighter-coupling structural option |
| 2.11 | Eject-then-test (dbt build) | ✓ | ✓ | ✓✓✓ | ✓ | Disruption candidate |
| 2.12 | API-response baseline (current) | ✓ | ✗✗ | ✗ | ◐ | The status quo |

Legend: ✓✓✓ = excellent, ✓✓ = strong, ✓ = good, ◐ = neutral, ✗ = weak, ✗✗ = poor.

---

## 4. Non-obvious Alternatives Highlighted

Per the brief, ≥1 non-obvious alternative is required. **Three** are surfaced:

1. **Materialized assertion tables (2.9)** — dbt's `build` (not `test`) becomes the gate. Tests are first-class artifacts.
2. **Capture-replay SSE traces (2.10)** — *intentionally tighter coupling* than the baseline. Listed to anchor the diversity range; not a recommended direction.
3. **Eject-then-test (2.11)** — disruption candidate. If `dbt-project-export` is the durable contract, run it for real.

---

## 5. Architectural Constraints — Where Options Must Bend

These constraints come from the existing codebase and ratified ADRs. Any chosen option must respect them.

| Constraint | Source | Implication |
|---|---|---|
| Production-topology fidelity | ADR-016 | Test stack keeps all 5 services (auth-proxy + backend + worker + query-engine + MinIO). Cannot drop services to simplify. |
| Ibis is the SQL generator | ADR-007 | Staging SQL is Ibis-compiled. Any dbt-test option needs to either run dbt against the same DuckDB target Ibis writes to, OR run dbt against the *exported* dbt project. |
| Headless presentation-state already exists | ADR-015 | Capture-replay options can read directives via `GET /api/channels/{id}/presentation-state` — no new endpoint needed. |
| `ChatEventSchema` is the wire SSOT | ADR-014 | Any protocol-coupled option binds to this schema. Schema churn is real (stratification went through `dc-wcy` to settle). |
| LLM jitter is intrinsic | retry-with-rephrase budget = 2 | Pure assertion-on-trace approaches need allowed-jitter masking. |
| `dbt-project-export` exists as a feature | `features/dbt-project-export.feature` | Eject-then-test (2.11) has a real, specified, target. |

---

## 6. Phase 2 Gate Check

- ✓ **5+ real tools/approaches named**: 12 catalogued (2.1–2.12), each with citations.
- ✓ **Non-obvious alternatives included**: 3 (materialized assertion tables, SSE capture-replay, eject-then-test).
- ✓ **Evidence quality confirmed**: every approach cited with at least one canonical or 2026-current source.
- ✓ **Architectural constraints documented**: 6 listed in §5.
- ✓ **No generic market claims**: every claim is grounded in a specific tool, source, or codebase artifact.

---

## Sources

- [dbt Developer Hub — Add data tests to your DAG](https://docs.getdbt.com/docs/build/data-tests)
- [dbt Developer Hub — Unit tests](https://docs.getdbt.com/docs/build/unit-tests)
- [dbt Tests Explained: Generic vs Singular](https://medium.com/@likkilaxminarayana/dbt-tests-explained-generic-vs-singular-with-real-examples-6c08d8dd78a7)
- [Adrienne Vermorel — Unit Testing in dbt 1.8+](https://adriennevermorel.com/articles/unit-testing-dbt-complete-implementation-guide/)
- [Datafold — 7 dbt testing best practices](https://www.datafold.com/blog/7-dbt-testing-best-practices/)
- [Elementary Data — dbt tests](https://www.elementary-data.com/post/dbt-tests)
- [Pandera (Union.ai)](https://github.com/unionai-oss/pandera)
- [Pandera Validation Guide 2026](https://pythondatabench.com/article/data-validation-python-pandera-practical-guide)
- [Soda Core vs Great Expectations — DataLetter](https://www.thedataletter.com/p/tool-review-soda-core-vs-great-expectations)
- [Branch Boston — Great Expectations vs Deequ vs Soda](https://branchboston.com/great-expectations-vs-deequ-vs-soda-data-quality-testing-tools-compared/)
- [Pact Docs — Consumer Tests](https://docs.pact.io/consumer)
- [Total Shift Left — Contract Testing 2026](https://totalshiftleft.ai/blog/contract-testing-for-microservices)
- [MarkTechPost — Property-Based Testing with Hypothesis (2026)](https://www.marktechpost.com/2026/04/18/a-coding-guide-for-property-based-testing-using-hypothesis-with-stateful-differential-and-metamorphic-test-design/)
- [LangWatch Scenario — SSE Pattern Testing](https://langwatch.ai/scenario/examples/testing-remote-agents/sse/)
- [Tapoueh — SQL Regression Tests / RegreSQL](https://tapoueh.org/blog/2017/08/sql-regression-tests/)
- [Casper — Golden Tests](https://medium.com/casperblockchain/golden-tests-e521077ae235)
- [DataKitchen — 2026 Open-Source DQ Landscape](https://datakitchen.io/blog/the-2026-open-source-data-quality-and-data-observability-landscape/)
