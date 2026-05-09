# Options Raw — `dbt-test-validation`

**Feature**: dbt-test-validation
**Phase**: DIVERGE Phase 3 — Brainstorming
**Date**: 2026-05-08

> **Generation-only.** No evaluation language permitted in this file. Pro/con/risk lives in `taste-evaluation.md`.

---

## 1. HMW Question

> **How might we validate chat-driven workflows in a way that is durable through ejection to dbt and lets the test suite stay insensitive to chat-protocol churn?**

The HMW deliberately omits "fire-and-forget" and "dbt SQL tests" from the question — these are *candidate solutions*, not framing.

---

## 2. SCAMPER — One Option per Lens

### Option A — **Substitute**: Replace API-response assertions with dbt-native data tests

**Core idea**: After each `chat_turn`, run `dbt test --select stg_<dataset>` against the same DuckDB instance Ibis writes to. Assertions are authored as dbt generic tests (`unique`, `not_null`, `accepted_values`, `dbt-utils.expression_is_true`, `dbt-expectations.expect_column_values_to_match_regex`) in a `schema.yml` colocated with the staging-model SQL.

**Key mechanism**: chat path writes staging table → harness invokes `dbt test` against the materialized table → green/red is the assertion result.

**Key assumption**: The same `dbt test` SQL we author for in-app validation can be lifted verbatim into the customer's ejected project (via `dbt-project-export`).

**SCAMPER origin**: Substitute (replace API-response + pandas with dbt SQL tests).

**Closest competitor**: standard analytics-engineering shop using dbt Core + dbt-utils + dbt-expectations.

---

### Option B — **Combine**: Pandera schema contracts at the staging boundary, run from inside the harness

**Core idea**: Define a `pa.DataFrameSchema` per dataset (e.g. `OrdersStagingSchema`). After each `chat_turn`, harness fetches the staging preview and calls `OrdersStagingSchema.validate(df, lazy=True)`. The schema lives in `backend/tests/integration/dataset_layer/schemas/` and is *also* published to the dbt-export pipeline as a translation step that emits equivalent dbt generic tests.

**Key mechanism**: Single Python schema source → pytest validates in-app via Pandera → dbt-export translator emits `not_null`/`accepted_values`/etc. in the customer's `schema.yml`.

**Key assumption**: A meaningful subset of Pandera constraints translates 1:1 to dbt generic tests (column types, not-null, accepted-values, regex). The translator is feasible.

**SCAMPER origin**: Combine (merges in-app validation with dbt-export contract authoring).

**Closest competitor**: Pandera-driven "data contract" patterns in modern Python ELT shops, paired with custom YAML emission.

---

### Option C — **Adapt**: Eject-then-test — run `dbt build && dbt test` against the exported project as the validation gate

**Core idea**: After driving the chat workflow, harness calls `POST /api/projects/{id}/export-dbt` to obtain the dbt project zip. Unzip into a tmpdir, set up a DuckDB profile pointing at the same Parquet sources, run `dbt build && dbt test`. The customer's first run IS our last run.

**Key mechanism**: chat → workflow state is persisted → export → dbt-as-validation. The test artifact is "dbt build green."

**Key assumption**: The dbt-project-export feature is correct enough to run end-to-end (or its bugs become first-class test failures we want to surface). DuckDB seed of Parquet sources matches in-app behavior closely enough that drift is a *finding*, not noise.

**SCAMPER origin**: Adapt (borrows the customer's intended workflow as the test harness).

**Closest competitor**: integration tests that run the artifact-under-shipment instead of mocking it (e.g., Bazel image-build tests; Helm chart `helm template && kubectl apply --dry-run=server`).

---

### Option D — **Modify (Magnify)**: Materialized assertion tables — `dbt build`-as-test inside the inner loop

**Core idea**: Author "assertion models" alongside staging models — e.g. `stg_orders__assert_region_in_canonical_set.sql` returns failing rows. `dbt build` runs models AND tests in DAG order; if any test model returns rows, downstream models do not build. Harness invokes `dbt build` inside the test, captures structured failures from `target/run_results.json`, and surfaces them to pytest.

**Key mechanism**: Tests are first-class dbt artifacts. `dbt build` is the only command the harness runs after chat.

**Key assumption**: dbt's `target/run_results.json` is stable enough to parse for pytest assertions. Materializing assertion models per-dataset is an acceptable footprint.

**SCAMPER origin**: Modify (magnify the role of dbt — from "tests run separately" to "tests are build artifacts").

**Closest competitor**: dbt-elementary monitoring patterns; the `dbt build` discipline favored by Datafold's "7 best practices" article.

---

### Option E — **Eliminate**: Decouple chat from validation — fire-and-forget chat, schema-snapshot diff as the only assertion

**Core idea**: Remove the per-turn `await chat_turn(...)` blocking semantics. Drive prompts asynchronously; do not consume SSE in the test (other than to detect `turn_done` for synchronization). After all prompts in a flow have been issued, capture the staging DataFrame as Parquet, diff it against a committed golden Parquet file. One assertion per flow: `staging.parquet == golden.parquet`.

**Key mechanism**: chat path is opaque; the only thing we assert is "does the staged data match the blessed golden?"

**Key assumption**: Golden Parquet files are stable enough across LLM jitter (with deterministic transforms downstream of the chat). Re-blessing on intentional changes is acceptable workflow.

**SCAMPER origin**: Eliminate (remove SSE parsing, ChatEvent assertions, retry-with-rephrase scaffolding from the assertion path; keep them only as an internal mechanism).

**Closest competitor**: snapshot/golden testing (Jest snapshot, R `testthat::expect_snapshot_value`); RegreSQL.

---

### Option F — **Reverse**: Worker emits a "test plan" event, dbt unit tests consume it; chat path is asserted *only* via the emitted plan

**Core idea**: Reverse the data flow. Today: chat → SSE → state → assertion. Reversed: chat → SSE includes a new `validation_plan` event describing the *intended* staging shape (column adds, type changes, expected distinct values) → dbt unit tests are generated on the fly from that plan, run against fixtures. The chat path is validated by *emitting a correct plan*; the SQL is validated against the plan via dbt unit tests.

**Key mechanism**: A new `validation_plan` event in `shared/chat/events.ts` carries the assertion contract from the worker. Two halves: (1) chat correctly translates intent into plan (asserted in the worker test surface), (2) dbt unit tests verify the generated staging SQL satisfies the plan.

**Key assumption**: The worker can produce a meaningful validation plan without hallucinating. Splitting the assertion into "intent→plan" and "plan→SQL" halves is a clarification, not a complication.

**SCAMPER origin**: Reverse (the worker becomes the test author; the test harness becomes the test runner).

**Closest competitor**: BDD step-definition emission; LangChain's "self-grading" patterns; LangWatch Scenario's expected-trace contracts.

---

### Option G — **Put to other use**: Bidirectional schema contract — same artifact powers in-app validation AND ships as dbt tests on export

**Core idea**: Author a single `schema.yml` (dbt-flavored) per dataset as the source of truth for both in-app testing and the exported dbt project. In-app: a Python adapter reads `schema.yml` and runs the listed generic tests via DuckDB SQL directly against the staging table. On export: the same `schema.yml` is bundled into the customer's project unchanged.

**Key mechanism**: One file, two consumers (in-app DuckDB SQL runner, export pipeline).

**Key assumption**: The set of dbt generic tests we use in-app is ≤ the set of tests dbt Core + dbt-utils + dbt-expectations provide on export. No "Python-only" tests live in the in-app suite.

**SCAMPER origin**: Put-to-other-use (the in-app validation file IS the export artifact).

**Closest competitor**: open-source data-contract repos that publish a single YAML/JSON Schema and generate runtime validators in multiple languages.

---

## 3. Crazy 8s Supplement — 2 Additional Structurally Distinct Options

### Option H — Hybrid layered: Pandera at boundary + dbt tests on export

**Core idea**: Pandera is the in-app validator (fast feedback, Python-native, catches LLM errors immediately). On export, a translator generates *equivalent* dbt generic tests in `schema.yml` from the Pandera schemas. Two separate test surfaces: pytest runs Pandera; ejected dbt project runs dbt tests.

**Key mechanism**: Pandera schema is the SSOT; export pipeline emits a dbt-flavored translation.

**Key assumption**: Translation fidelity is high enough that "Pandera passes in-app" implies "dbt tests will pass in customer's project."

**SCAMPER origin**: Crazy 8s (Combine + Adapt fold).

**Closest competitor**: AsyncAPI + JSON Schema duality; Avro IDL + JSON Schema duality.

---

### Option I — SSE trace capture-replay against committed golden traces

**Core idea**: Every `chat_turn` for a flow captures the full ordered list of `ChatEvent` frames. The first run blesses a `<flow>.golden.jsonl` snapshot; subsequent runs assert event-trace equality, with allowed-jitter masking (assistant-text deltas redacted; timestamps masked; tool-call `id`s masked). No data assertion. The trace IS the contract.

**Key mechanism**: SSE-stream snapshot diff with masked fields.

**Key assumption**: With deterministic worker (pinned model + temp=0) the trace is stable enough that masked-diff produces signal.

**SCAMPER origin**: Crazy 8s (intentionally tighter-coupling structural foil).

**Closest competitor**: VCR.py for HTTP cassettes; Polly.JS; Jest snapshot; LangWatch Scenario's `expected_trace`.

---

## 4. Generated Set — 9 Options

Options A–I generated. Now curate to 6 via diversity test.

| ID | Where assertion lives | Coupling to chat protocol | Test author | Cost profile |
|---|---|---|---|---|
| A | dbt-test SQL (in-app) | Loose (post-turn-only) | backend test code | Medium author / Low marginal |
| B | Pandera schema (in-app, translates to dbt) | Loose | backend test code | Low author / Low marginal |
| C | dbt build/test on exported project | Loose | shared with downstream consumers | High one-time / Low marginal |
| D | Materialized assertion tables (dbt build) | Loose | backend test code | Medium author / Low marginal |
| E | Snapshot diff on staged Parquet | Decoupled (fire-and-forget) | backend test code | Low author / Med blessing |
| F | Worker-emitted validation_plan + dbt unit tests | Tight (asserts on new event) | shared (worker + dbt) | High author / Low marginal |
| G | Single schema.yml (dual consumer) | Loose | shared with downstream consumers | Medium author / Low marginal |
| H | Pandera (in-app) + translated dbt tests (export) | Loose | backend test code | Low+Medium author / Low marginal |
| I | SSE trace snapshot diff | Tight (asserts on full ChatEvent stream) | backend test code | Low author / High blessing |

---

## 5. Curation — 6 Options

Per skill: 6 curated options, each passing the 3-point diversity test (different mechanism, different assumption, different cost profile).

### Diversity test

Asking "is X a variation of Y?":

- **A vs G** — both end up with dbt-flavored tests. A authors them as a Python-side step (running dbt-against-DuckDB during pytest); G authors them as a single `schema.yml` consumed by both in-app DuckDB runner and export. Different test author location, different coupling-to-dbt-CLI dependency, different cost profile (G reuses one file; A runs dbt twice). **Distinct enough — keep both.**
- **B vs H** — B is "Pandera + translator emits dbt tests on export." H is "Pandera + translator runs at export." H is a *near-duplicate of B*. **Merge: keep B (the simpler statement); drop H.**
- **A vs D** — A runs `dbt test`. D runs `dbt build`. D's distinctive property is "tests are first-class build artifacts." Different mechanism, different cost (D persists assertion tables). **Distinct — keep both.**
- **E vs I** — E asserts on staged-Parquet diff (data). I asserts on SSE-trace diff (protocol). Diametrically opposite assertion locations. **Distinct — keep both.**
- **F** — only option emitting a worker-side artifact for validation. Distinct.
- **C** — only option that exercises the eject-to-dbt feature itself. Distinct.

### Eliminations

- **H — Merged with B.** B already encodes "Pandera + translator." H's "two separate test surfaces" framing is implicit in B; explicit-vs-implicit is not a structural difference.

### Final 6 options

| ID | Title | Where assertion lives | Coupling | Author | Cost |
|---|---|---|---|---|---|
| **A** | dbt data tests via in-app `dbt test` | dbt-test SQL | Loose | backend code | Med / Low |
| **B** | Pandera at boundary + dbt-test export translator | Pandera schema → dbt tests | Loose | backend code | Low / Low |
| **C** | Eject-then-test (`dbt build && dbt test` on exported project) | exported dbt project | Loose | shared | High one-time / Low marginal |
| **D** | Materialized assertion tables — `dbt build`-as-test | dbt assertion models | Loose | backend code | Med / Low |
| **E** | Fire-and-forget chat + Parquet golden-file diff | committed golden Parquet | Decoupled | backend code | Low / Med-blessing |
| **F** | Worker-emitted `validation_plan` + dbt unit tests | new event + dbt unit-test fixtures | Tight | shared (worker+dbt) | High / Low |

Two options are tighter coupling than the user's hypothesis (F asserts on a new chat event; the implicit baseline asserts on the trace). Two are looser (C and E are fire-and-forget on the chat protocol). The 6 span the full coupling axis the brief required.

The "very tight coupling" trace-snapshot Option I and the "Status Quo / API-response baseline" are dropped from formal scoring — they are useful as **anchors** (I = "what tighter-coupling looks like"; baseline = "today") in the dissenting case.

---

## 6. Phase 3 Gate Check

- ✓ HMW question framed without embedded solution.
- ✓ All 7 SCAMPER lenses applied (A–G).
- ✓ 2 Crazy 8s supplements added (H, I).
- ✓ 6 options curated, each passing 3-point diversity test.
- ✓ One option merged (H → B); one anchor option (I) preserved as dissent material.
- ✓ Coverage of the brief's required diversity axes:
  - **Where assertion lives** — API response (baseline only) | staged-data table (E) | dbt-test SQL (A, D) | Pandera schema (B) | UI directive replay (I, anchor only) | exported dbt project (C) | new chat event + dbt unit-test fixtures (F).
  - **Coupling to chat protocol** — tight (F, I) | loose (A, B, C, D, G/dropped) | decoupled (E).
  - **Test author** — backend test code (A, B, D, E) | shared with downstream (C) | worker + dbt unit-test author (F).
- ✓ No evaluation language used in option descriptions.
