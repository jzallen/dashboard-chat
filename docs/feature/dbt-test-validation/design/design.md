# Design — `dbt-test-validation`

**Feature:** dbt-test-validation
**Wave:** DESIGN (entered directly from DIVERGE; DISCUSS skipped per CLAUDE.md routing)
**Date:** 2026-05-08
**Author:** Morgan (nw-solution-architect)
**Mode:** Propose
**Companion artifacts:**
- ADR: `docs/decisions/adr-018-eject-then-test-validation.md`
- C4 + sequence: `docs/feature/dbt-test-validation/design/c4-diagrams.md`
- DIVERGE input: `docs/feature/dbt-test-validation/recommendation.md`

---

## 0. Confirmation Checklist

| Artifact | Status | Note |
|---|---|---|
| `docs/feature/dbt-test-validation/discuss/` | ⊘ | intentionally skipped (DIVERGE→DESIGN per brownfield routing) |
| `docs/feature/dbt-test-validation/spike/` | ⊘ | intentionally skipped (no spike run; not gated) |
| `docs/feature/dbt-test-validation/recommendation.md` | ✓ | read; primary input |
| `docs/feature/dbt-test-validation/wave-decisions.md` | ✓ | read |
| `docs/feature/dbt-test-validation/diverge/job-analysis.md` | ✓ | read; JOB-001 + ODI used to anchor decisions |
| `docs/feature/dbt-test-validation/diverge/competitive-research.md` | ✓ (selectively) | scanned for prior-art landmines |
| `docs/feature/dbt-test-validation/diverge/taste-evaluation.md` | ✓ | read; T5 weight rationale carried forward |
| `docs/feature/dbt-test-validation/diverge/options-raw.md` | ✓ | read; α/β/γ are realizations of C, B, and a hybrid |
| `docs/feature/dbt-test-validation/diverge/review.yaml` | ✓ | iteration-2 approved (Prism) |
| `docs/product/jobs.yaml` | ✓ | SSOT — JOB-001 |
| `docs/product/architecture/brief.md` | ✓ (bootstrapped this wave) | new file with `## Application Architecture` |
| ADRs 007, 013, 014, 015, 016, 017 | ✓ | constraints loaded |
| Codebase: `harness.py` (1104 LOC), `test_dataset_staging_layer.py`, `conftest.py` | ✓ | examined |
| Codebase: `features/dbt-project-export.feature` + use case + use-case tests | ✓ | examined |
| Codebase grep: `dbt-project-export` implementation | ✓ | endpoint exists at `GET /api/projects/{id}/export/dbt`; use case at `backend/app/use_cases/project/export_dbt_project.py`; **3 use-case tests** in `backend/tests/use_cases/project/test_export_dbt_project.py` |

**Skill load attempt:** `nw-design`, `nw-architecture-patterns`,
`nw-architectural-styles-tradeoffs`, and `nw-sa-critique-dimensions` were
unreachable in this environment. Proceeded under the system-prompt operating
contract (principles 1–12). The Earned Trust principle (#12) materially shaped
the orchestrator's `probe()` design (see §4 and §6 OQ4).

---

## 1. Problem Re-Statement (one paragraph)

DIVERGE picked **Option C — Eject-then-test**. C's core mechanism: drive the
chat workflow → call `GET /api/projects/{id}/export/dbt` → unzip into a
tmpdir → seed a DuckDB profile against the same MinIO Parquet sources → run
`dbt build` then `dbt test` (programmatically via `dbtRunner.invoke()`).
The customer's first run IS the last test run. C
scored highest (4.04) on T5 (durability across ejection) at 5/5. Two real
weaknesses carried forward: (a) wall-clock pressure under AC1.6 (5 min) and
(b) load-bearing dependency on `dbt-project-export` correctness, which has
unit tests but no end-to-end gate. DIVERGE also surfaced **Option B**
(Pandera at the staging boundary + dbt-test export translator) as a
principled dissent at 3.83 and as a layerable companion. DESIGN's job: pick
the realization, resolve OQ1–OQ5, and ratify as ADR-018.

---

## 2. Three Architectural Options for Realizing C

All three respect the hard constraints: ADR-016 (5-service compose;
production-topology fidelity), ADR-007 (Ibis is the SQL generator), AC1.6
(≤300s wall-clock), JOB-001 (durability across ejection).

The structural diff between α / β / γ is **scope** and **layering**, not
**mechanism**. All three call the same export endpoint, all three drive
dbt the same way — via the `dbtRunner` Python API (`dbt.cli.main`), against
a tmpdir DuckDB. They differ in how widely the orchestrator is invoked and
whether a per-turn fast-feedback layer (Pandera, B's mechanism) sits
beneath it.

### Option α — Pure C (eject-then-test only)

**Mechanism.** Every regression flow runs `eject_and_test()` after all chat
ops complete. The harness retains AC1.4's raw-tool-call leak guard at the
protocol level (a chat-protocol invariant, not data) and otherwise has no
per-turn data assertions. All data shape/value assertions move to dbt
generic + custom tests in the exported `schema.yml`.

**Component shape.**
* New: `EjectAndTestOrchestrator`, `DuckDBProfileSeeder`, `DbtRunner`,
  `RunResultsParser` (see L3 in `c4-diagrams.md`).
* `DatasetLayerHarness`: extended with one new method `eject_and_test()`
  that delegates to the orchestrator. No other changes.
* `PanderaValidator`: NOT created.

**OQ1 (DuckDB topology).** Fresh DuckDB seeded with same MinIO Parquet.
Production-fidelity (the customer does exactly this).

**OQ2 (scope).** Every flow that ends in a "settled" state is a regression
flow. AC1.4-only flows (which assert protocol invariants only) skip eject.

**OQ3 (gating sequence).** Accept the inversion. Use the existing 3 use-case
tests in `test_export_dbt_project.py` as the floor; let eject-then-test
bring out export bugs as test failures. Document this as a known load-bearing
dependency in ADR-018.

**OQ4 (wall-clock).** AC1.6 holds for the single existing flow (~85–105s
end-to-end per c4 sequence diagram). Profile in DELIVER. Revisit at second
regression flow.

**OQ5 (per-turn assertions).** Move all data assertions to dbt-test. Keep
AC1.4 raw-tool-call leak guard (protocol).

**Trade-offs.**
* + Subtraction: simplest mechanism. Validation logic IS the customer's first
  run. T5 = 5/5 by construction.
* + One concept to learn — "eject + run dbt." No translator, no schema
  duality.
* − When LLM jitter produces a wrong staging shape, the test fails late
  (after the full flow + eject + dbt build/test). Triage cost is higher than
  per-turn validation.
* − Load-bearing on `dbt-project-export` correctness. The existing 3 use-case
  tests cover happy-path zip generation, project-not-found, and empty-project
  skeleton — they do NOT cover MinIO-source-readability, S3-credential-env-var
  expansion, or `dbt deps`/`dbt build` end-to-end. **This is the gap that the
  `probe()` method explicitly catches.**

**Hire criteria** (when α is right): "we'd rather find export bugs as test
failures than as customer reports, AND per-turn LLM jitter is rare enough
that late-binding triage is acceptable."

---

### Option β — Layered C+B (eject-then-test + Pandera per-turn) **[RECOMMENDED]**

**Mechanism.** Same per-flow eject-and-test as α. Additionally, after each
`chat_turn`, a `PanderaValidator` runs a `pa.DataFrameSchema` against
`get_table_state(dataset_id).df` to give sub-100ms feedback on shape
violations. The Pandera schema is the SSOT for in-app per-turn validation;
the export path's `schema.yml` is authored separately (no automatic
translator in this iteration — that is B's full ambition; β only borrows
B's per-turn layer, not its export translator).

**Component shape.**
* New: same as α, plus `PanderaValidator`.
* `DatasetLayerHarness`: extended with `validate_after(dataset_id, schema)`
  in addition to `eject_and_test()`.

**OQ1.** Same as α.

**OQ2.** Per-turn Pandera runs on every chat_turn. Per-flow eject runs only
on regression flows. Two-layer cost profile per JOB-001 outcome:
* O1 (discover incorrect staged data fast) — Pandera catches in <100ms.
* O4 (reuse across ejection boundary) — eject-and-test ships the customer
  artifact.

**OQ3.** Same as α — accept inversion; rely on `probe()` to catch
substrate-level export breakage.

**OQ4.** Per-flow ~85–105s + per-turn ~50ms × 10 ops = ~106s. AC1.6 holds.

**OQ5.** Per-turn data assertions stay (Pandera). Per-flow data assertions
stay (dbt-test). AC1.4 raw-tool-call guard stays at protocol level.

**Trade-offs.**
* + Fast triage: when a chat_turn produces wrong shape, Pandera fails the
  flow before the eject phase runs — saving ~30s on the failing-fast path
  and giving a clear "workflow problem vs data problem" signal (O6).
* + Composable: B's translator can be added in a later wave without
  restructuring the architecture; the Pandera schemas are already in the
  codebase to translate.
* + Two layers ≠ two test surfaces: one concept (validation) with two
  binding points (per-turn fast / per-flow durable).
* − Pandera schemas + dbt schema.yml are two SSOTs for the same data
  contract. **Drift risk.** Mitigation: the per-flow eject-and-test runs the
  customer's tests, so any divergence between Pandera and `schema.yml`
  surfaces as an eject-and-test failure (one of the two MUST be wrong).
* − Per-turn LLM-jitter failures now retry-with-rephrase (AC1.5 budget). Per
  the existing harness retry budget of 2 rephrases per turn, this is
  already paid for.

**Hire criteria** (when β is right): "we want fast triage when chat ops
produce wrong shapes, AND we want the customer-fidelity gate, AND we accept
maintaining two validation surfaces with the eject step as the drift
detector." This is the recommended option.

---

### Option γ — Sampled-eject C

**Mechanism.** Same as α, but `eject_and_test()` runs only on a curated
subset of "representative" regression flows (registered in `conftest.py`
via a marker, e.g. `@pytest.mark.eject_regression`). All other flows rely
on protocol-level assertions (AC1.4) plus existing harness predicates
(`assert_distinct_values`, etc.) for data-shape coverage.

**Component shape.** Same as α.

**OQ1.** Same as α.

**OQ2.** Eject runs on a curated subset. Default subset: the `Act 3`
demo workflow (current single flow); future flows opt in via marker.

**OQ3.** Same as α.

**OQ4.** Wall-clock per CI run = M flows × (~85–105s) where M is the
sampled set size. AC1.6 holds at M ≤ 3 even at the high end.

**OQ5.** Mixed: per-turn assertions stay where they exist today (existing
predicates); Pandera NOT added; dbt-test runs only on sampled flows.

**Trade-offs.**
* + Best wall-clock economy at scale (M ≪ N as flow count grows).
* + One mechanism to learn (no Pandera).
* − Sampling decision becomes a maintenance question — what makes a flow
  "representative"? Drift between sampled and non-sampled coverage.
* − Per-turn signal stays at today's level (which the user already flagged
  as "messy"). O6 (workflow-vs-data triage) does not improve.
* − When the customer ejects a non-sampled flow's project state, our test
  suite has not exercised that path through dbt. Partial T5.

**Hire criteria** (when γ is right): "the regression flow count grows past
3 AND wall-clock budget tightens AND the team has high confidence in
per-turn LLM determinism." Effectively a **future-state** option for β if
flow count grows.

---

## 3. Reuse Analysis (HARD GATE)

Every existing component examined. New components justified.

| Component | Disposition | Justification |
|---|---|---|
| `DatasetLayerHarness` (`harness.py:746`) | **EXTEND** | Add 1–2 thin facade methods (`validate_after`, `eject_and_test`). The harness is the canonical entry point for chat-driven flow tests; piggybacking preserves the AAA shape acceptance tests already use. No new top-level test framework. |
| `ChatApi` (`harness.py:678`) | **REUSE AS-IS** | Single-turn SSE driver. Untouched. |
| `TransformsApi` (`harness.py:631`) | **REUSE AS-IS** | Direct mutation wrapper for C.3 idempotency tests; orthogonal to validation. |
| `DatasetsApi` | **REUSE AS-IS** | `get_table_state(...)` provides the DataFrame for per-turn Pandera validation (β only). |
| `SessionsApi` | **REUSE AS-IS** | Orthogonal — replay-and-idempotency surface stays. |
| `dataset_layer_env`/`dataset_layer_pat`/`dataset_layer_project` fixtures (`conftest.py`) | **REUSE AS-IS** | Compose-up + auth wiring already production-fidelity per ADR-016. |
| `GET /api/projects/{id}/export/dbt` (`backend/app/routers/projects.py:54`) | **REUSE AS-IS** | The load-bearing dependency. Already implemented + has 3 use-case tests. β/γ rely on `probe()` to detect runtime-config breakage that the use-case tests do not exercise. |
| `export_dbt_project` use case (`backend/app/use_cases/project/export_dbt_project.py`) | **REUSE AS-IS** | Same as above. |
| `_dbt/` subpackage (zip generator, naming, profiles template) | **REUSE AS-IS** | The artifact authoring is the SUT. |
| `EjectAndTestOrchestrator` | **CREATE NEW** | No existing orchestration for "fetch zip → unzip → seed → run dbt → parse." Not a backend concern (it runs in pytest, against the SUT from outside). Test infrastructure module. |
| `DuckDBProfileSeeder` | **CREATE NEW** | The exported `profiles.yml` uses `env_var(...)` placeholders for S3 creds (per `dbt-project-export.feature` line 47). Test runs need a concrete profile pointing at MinIO with the test bucket. Lives in the orchestrator package. |
| `DbtRunner` | **CREATE NEW** | Wraps `dbtRunner.invoke()` from `dbt.cli.main` (Python API; stable since dbt 1.5). Sequences `deps` → `build` → `test` as three `invoke()` calls; reads `dbtRunnerResult.result` directly (no `run_results.json` re-parse). Documented constraint: not safe for concurrent invocation within one process — fine for serial pytest, pytest-xdist workers each get their own `dbtRunner` instance. Exists nowhere today. |
| `RunResultsParser` | **CREATE NEW** | Translates `dbtRunnerResult.result` (list of `RunResult` objects from `dbt.cli.main`) into an `EjectTestReport` value. Pure utility. Falls back to reading `target/run_results.json` only if `dbtRunner` ever exposes the result as `None` (defensive — contract test pins this). |
| `PanderaValidator` (β only) | **CREATE NEW** | New per-turn validation layer. Wraps `pa.DataFrameSchema.validate(df, lazy=True)` against the harness's existing `TableState.df`. Lives next to harness in `backend/tests/integration/dataset_layer/validation/`. |
| Schemas (`OrdersStaging`, etc., β only) | **CREATE NEW (per regression flow)** | One Pandera schema per dataset shape under test. Authored alongside the test that uses them. |
| `dbt`, `dbt-duckdb` Python deps | **ADD to test extras** | Add to `backend/pyproject.toml` under a `[project.optional-dependencies] test` group (or equivalent uv test extra) — NOT to runtime deps. The backend itself does not import dbt; only the integration test loop does. |
| `pandera` Python dep | **ADD to test extras** (β only) | Same scope as dbt. Pandera 0.29+. |
| `moto` autouse override (`conftest.py:63`) | **REUSE AS-IS** | Preserves the "real MinIO is the SUT" invariant; the eject orchestrator's seeded DuckDB also reads real MinIO. |

**Conway's Law check.** Single-team brownfield codebase; one Python backend
module owner. The orchestrator + Pandera layer sit in `backend/tests/` and
are owned by the same team that owns the harness. No cross-team handoff;
no Inverse Conway pressure.

---

## 4. Earned Trust — `probe()` Specification (principle 12)

This section is load-bearing. The orchestrator's external dependencies are:
the export endpoint, the `dbt.cli.main.dbtRunner` Python API, the
`dbt-duckdb` adapter, MinIO over httpfs, and the filesystem (tmpdir). Every
one of them is a place the substrate can lie.

### `EjectAndTestOrchestrator.probe() -> ProbeReport`

Invoked once per pytest session by a session-scoped fixture before any
flow uses the orchestrator. Failures convert to `pytest.skip(...)` rather
than silent green.

**Probe contract — what each probe MUST exercise (fault-injection scenarios):**

| Probe | Verifies | Lie it catches |
|---|---|---|
| `probe_dbt_runner_importable` | `from dbt.cli.main import dbtRunner, dbtRunnerResult` succeeds AND `dbtRunner().invoke(['--version']).success` is `True` AND the reported version is `>= 1.8` | `dbt-core` missing from the test extra; pinned to incompatible version; entry point moved (the docs warn `.result` is "not fully contracted") |
| `probe_dbt_duckdb_loadable` | `import dbt.adapters.duckdb` succeeds | adapter not installed alongside `dbt-core` |
| `probe_export_endpoint_reachable` | `GET /api/projects/{id}/export/dbt` against a throwaway probe project returns 200 application/zip with at least `dbt_project.yml` and `profiles.yml` in the zip | export endpoint regressed (caught BEFORE per-flow tests build on it) |
| `probe_minio_readable_via_duckdb` | A throwaway DuckDB connection in a tmpdir can `INSTALL httpfs; LOAD httpfs;` and `SELECT count(*) FROM read_parquet('s3://<test-bucket>/<known-fixture>.parquet')` | profile.yml's `env_var(...)` substitution + S3 endpoint URL + creds + path style do NOT actually let DuckDB read the source — the canonical "compiles but cannot read" lie |
| `probe_run_results_shape` | `dbtRunner().invoke(['parse', '--project-dir', <probe-proj>])` returns a `dbtRunnerResult` whose `.result` and (where applicable) `.result[0].node` exposes the attributes `RunResultsParser` reads | dbt minor-version bump changed the `RunResult` shape — caught at probe, not at first failing flow. (`dbtRunnerResult.result` is documented as "not fully contracted"; this probe is the version-pin canary.) |

**Composition root invariant.** A session-scoped pytest fixture
(`eject_orchestrator`) invokes `probe()` exactly once. On failure it calls
`pytest.skip(reason)`; the skip message names which probe failed. The
fixture caches the orchestrator for the rest of the session.

**Self-application (principle 12 self-application).** A separate
ArchUnit-style structural test asserts that `EjectAndTestOrchestrator` HAS
a `probe()` method (subtype check via Python `Protocol`/`runtime_checkable`,
plus an AST walker that flags any test that constructs the orchestrator
without going through the probing fixture). This catches the failure mode
where the probe is silently skipped.

**Layered enforcement (principle 11 + 12 cross-application):**

| Layer | Tool | Question answered |
|---|---|---|
| Subtype | `mypy` + `typing.Protocol` (`EjectOrchestratorProtocol` requires `probe()` and `eject_and_test()`) | Does the type say it has a probe? |
| Structural | `pytest-archon` rule: any module under `backend/tests/integration/dataset_layer/` that imports `EjectAndTestOrchestrator` MUST also import the `eject_orchestrator` fixture from `conftest.py` | Does the test path go through the probing fixture? |
| Behavioral | A behavioral CI test that uninstalls `dbt-core` in the test environment (or monkeypatches `dbt.cli.main.dbtRunner` to raise `ImportError`) and asserts the suite skips with the expected `probe_dbt_runner_importable` failure reason | Does the probe actually fail loudly when the substrate lies? |

**Why this is mandatory and not "we'll add it later":** Option C's
load-bearing risk (DIVERGE recommendation §3 weakness 2) is "the export
pipeline could be broken in a way that lets the test pass anyway." The only
way to neutralize that risk before it consumes a flow is a probe that
exercises the specific lies. Without `probe()`, β and γ have **lower** real
trust than the existing harness, not higher.

---

## 5. C4 Diagrams

See `docs/feature/dbt-test-validation/design/c4-diagrams.md` for:
* L1 System Context
* L2 Container (harness internals + new components)
* L3 Component for `EjectAndTestOrchestrator`
* Sequence diagram for one regression flow end-to-end (β)

---

## 6. Open-Question Resolutions

| OQ | Resolution | One-line rationale |
|---|---|---|
| **OQ1** | **Fresh DuckDB seeded with same MinIO Parquet sources.** | Production-fidelity — exactly what the customer does on `unzip && dbt build`; isolation from Ibis-materialized state avoids cross-test contamination. |
| **OQ2** | **Per-flow eject for regression flows; per-turn Pandera for fast feedback (β).** | Two layers, one concept; per-turn catches LLM jitter <100ms, per-flow gives the customer-fidelity assertion. |
| **OQ3** | **Accept the testing inversion, with a `probe()` floor.** The existing 3 use-case tests stand; eject-and-test brings out export-runtime bugs as flow-level test failures. `probe()` catches the export-endpoint substrate lies (MinIO unreachable, profile broken, etc.) BEFORE the suite uses them. | Gate-first (1-week effort to harden export with end-to-end tests of its own) is plausible but the better lever is the probe — it covers exactly the runtime gaps the use-case tests do not, and it activates immediately. |
| **OQ4** | **AC1.6 holds at M=1 regression flow with ~65% headroom (~85–105s observed estimate).** Profile in DELIVER on first integration run; revisit at M ≥ 3 with γ as the contingency. | Single-flow today; observed-cost numbers come from the breakdown in `c4-diagrams.md`'s sequence note. |
| **OQ5** | **Keep AC1.4 raw-tool-call leak guard at protocol level. Move data assertions to two layers: per-turn Pandera (β) + per-flow dbt-test (β/α/γ).** Existing predicates (`assert_distinct_values`, etc.) STAY for the chat-protocol-volatility transition period and are deprecated when the equivalent Pandera/dbt assertion lands. | The protocol guard is not data-shaped; it is a wire-vocabulary invariant per ADR-014 and stays where it lives. Data goes to dbt because that's JOB-001's strategic-level destination. |

---

## 7. Recommendation — **Option β (Layered C+B)**

### Why β

1. **JOB-001 strategic level**: β still scores T5=5/5 — every regression flow
   ships the customer's artifact and runs `dbt build` + `dbt test` against
   it (via the same `dbtRunner` API a Python-savvy customer would invoke).
2. **JOB-001 ODI O3 (chat-protocol churn cost)**: β's per-turn Pandera layer
   gives a stable boundary that does NOT couple to the chat protocol —
   the schema is on the data, not on the wire. The user's "the setup still
   feels messy" signal lands here. Pure α inherits today's mess at the
   per-turn level.
3. **JOB-001 ODI O6 (workflow-vs-data triage)**: β separates the two by
   construction. Pandera failure ⇒ chat path produced wrong shape (workflow).
   dbt-test failure ⇒ shape was correct but value contract broken (data).
   α conflates them at the eject step.
4. **AC1.6 economy**: β's overhead (per-turn Pandera ~50ms) is invisible
   against per-flow eject. No real wall-clock cost over α.
5. **Composes forward to B's full ambition**: if a Pandera-to-dbt-test
   translator becomes warranted, β has the input artifacts (Pandera
   schemas) already in the codebase. α does not.

### Weakness flags (carrying forward)

* **Two SSOTs for data contract** (Pandera schema + dbt `schema.yml`). Drift
  detector: the eject step IS the diff. If they diverge, eject-and-test
  fails. Acceptable but worth noting.
* **`probe()` is mandatory**: ratify this in DELIVER. A β/γ deployment
  WITHOUT `probe()` has lower real trust than the existing harness because
  it is loaded with a silent-failure mode (export-runtime breakage that
  passes use-case unit tests but fails substrate-readability).
* **Single regression flow today.** Wall-clock margin (~65%) is adequate
  for now. **At M ≥ 3 regression flows, escalate to γ** (sampled-eject)
  with a documented sampling rule. β + γ are not mutually exclusive —
  γ is β's degraded mode under wall-clock pressure.
* **Pandera-to-dbt translator NOT in scope for this iteration.** β borrows
  B's per-turn layer only. The translator is B's full ambition; deferred.

### Why not α

α is correct if "two SSOTs is unacceptable" outweighs O3 and O6. Today's
harness already has multiple data assertion paths; β's Pandera layer
**replaces** the existing per-turn predicates in the long run, so the
"two SSOTs" framing is transitional. α also leaves the user's "feels messy"
signal unaddressed at the per-turn level.

### Why not γ

γ is correct as β's contingency, not as the primary today. With a single
regression flow, sampling is degenerate (M=1, sampled-set=1). γ lights up
when the regression-flow count grows.

### Why not flip to B (full dissent trigger from DIVERGE §4)

DIVERGE flagged three flip triggers. We re-evaluate them now:

1. *"`dbt-project-export` is found to have material correctness gaps not
   addressed in OQ3."* — The `probe()` design directly addresses this. The
   gap is real but the mitigation matches its surface area. **Trigger does
   not fire.**
2. *"Wall-clock profiling in OQ4 shows `dbt build` + `dbt test` consistently
   exceeds 30s per scenario."* — Estimated 10–30s per flow against a single
   ~250-row staging model. Profile in DELIVER; if exceeded, escalate to γ
   (β's contingency), not B. **Trigger does not fire pre-DELIVER; the
   contingency is documented.**
3. *"The team's pandas/Pandera familiarity dominates dbt-CLI familiarity."*
   — The user's framing says the opposite: the product ejects to dbt; the
   team IS choosing to speak dbt. **Trigger does not fire.**

---

## 8. Cross-Decision Composition

* **ADR-018 ↔ ADR-007** — Ibis materializes the in-app DuckDB tables; the
  exported dbt project's compiled SQL targets a separate DuckDB instance
  reading the same Parquet sources. Two DuckDBs, one source-of-truth (MinIO
  Parquet). The eject step exercises the SQL-generation path that ships;
  it does not reuse Ibis's runtime materialization.
* **ADR-018 ↔ ADR-014** — Independent. β does NOT add new ChatEvent types
  (Option F was declined precisely on these grounds). The wire schema is
  unchanged.
* **ADR-018 ↔ ADR-015** — Independent in this iteration. The
  presentation-state log is orthogonal to data-shape validation. Future
  composition possible: a "presentation-state-after-eject" assertion is
  conceivable but not in JOB-001.
* **ADR-018 ↔ ADR-016** — Hard constraint inherited. The 5-service compose
  stack is unchanged; the orchestrator runs OUTSIDE the compose network.
  Production-topology fidelity is preserved.
* **ADR-018 ↔ ADR-017** — Independent. SessionEventReader dispatch is
  orthogonal to dbt-test validation.
* **ADR-018 ↔ JOB-001** — JOB-001's strategic-level outcome (durability
  across ejection) is satisfied by the eject step; the per-turn layer
  satisfies O3/O6 derivative outcomes.

---

## 9. Quality Attribute Strategy

| Quality attribute | Strategy in β |
|---|---|
| Reliability | `probe()` upfront; production-fidelity DuckDB read path; `dbtRunnerResult.success` + `.result` inspection (Python API surface, no exit-code translation) |
| Maintainability | Two layers, one concept; orchestrator is a small (~3-5 module) Python package; Pandera schemas live next to the tests they serve |
| Performance | Per-turn Pandera <100ms; per-flow eject ~85–105s; AC1.6 holds; γ is the documented contingency |
| Testability | β IS the testability story for chat-driven flows; orchestrator itself has unit tests for `RunResultsParser` (input: `dbtRunnerResult` fixtures) and contract tests for `DbtRunner` (golden-fixture `dbtRunnerResult` per pinned dbt version) |
| Observability | `EjectTestReport` is a structured value (status, models built, tests run, failures by name). `probe()` produces a `ProbeReport` for skip diagnostics |
| Security | No secrets in artifacts; profile.yml uses `env_var(...)` placeholders per existing `dbt-project-export.feature`; the seeder injects test creds (already present in compose) at runtime, never persisted |

---

## 10. External Integration Detection (principle 10)

The eject-and-test loop has one new external integration: the
`dbt.cli.main.dbtRunner` Python API. It is invoked in-process and consumes
a Python-object contract (`dbtRunnerResult` with `.success`, `.exception`,
`.result`).

**Recommendation to platform-architect (DEVOPS wave handoff):**

> Contract test recommended for `dbt-core` ↔ `RunResultsParser`. The
> contract is `dbtRunnerResult.result` — a list of `RunResult` objects
> whose attributes (`.node.name`, `.status`, `.failures`, `.message`,
> `.execution_time`) the parser reads. dbt explicitly documents this
> surface as "not fully contracted"; minor-version bumps have historically
> renamed fields. A consumer-driven contract test that pins the parser
> against a recorded `dbtRunnerResult` (or its serialized
> `target/run_results.json` equivalent) per supported dbt version
> (1.8, 1.9) — runnable in CI without the full compose stack — catches
> upstream shape drift before a `dbt-core` bump in a feature branch
> green-passes a parser that silently misses failures. Pact is overkill;
> a simple golden-fixture test suffices.

---

## 11. Architectural Enforcement (principle 11)

| Rule | Tool | What it forbids |
|---|---|---|
| Orchestrator is constructed only via the probing fixture | `pytest-archon` | Tests that import `EjectAndTestOrchestrator` directly without the `eject_orchestrator` fixture |
| Pandera schemas live in `backend/tests/integration/dataset_layer/validation/schemas/` | `pytest-archon` | Schemas authored elsewhere drift away from co-location with tests |
| dbt + dbt-duckdb + pandera are NOT runtime backend dependencies | `pyproject.toml` test extras + `import-linter` config in `backend/` | Accidental import of dbt from `backend/app/` |
| `EjectAndTestOrchestrator` implements `EjectOrchestratorProtocol` (which requires `probe()`) | `mypy` + `typing.Protocol` `runtime_checkable` | A "lite" orchestrator without a probe |

`import-linter` was investigated for the broader cross-module discipline;
its contracts are import-graph only and cannot enforce method-presence on
classes. Hence the layered enforcement (subtype + structural + behavioral)
described in §4.

---

## 12. Paradigm Note (per design brief item 7)

The codebase is mixed (Python OOP-leaning in backend; TypeScript multi-paradigm
elsewhere). Test infrastructure here follows the existing harness's OOP
composition shape: classes for stateful wrappers (`ChatApi`, `TransformsApi`,
`DatasetLayerHarness`) + module-level pure functions for parsers and
seeders. The new orchestrator is OOP (it has session-scoped state — the
probe result cache, the `dbtRunner` instance) and composes with module-level pure
helpers (`RunResultsParser`, profile templating). **OOP for the orchestrator;
functions for the parsers/templaters.** This is consistent with the existing
harness paradigm choice.

---

## 13. Risks Carried Forward to DELIVER

1. **`probe_minio_readable_via_duckdb` may be brittle on first run.** If the
   exported `profiles.yml` uses an env-var name that doesn't exist in the
   pytest process environment, the seeder must inject one. Plan for a
   debugging-friendly probe error message.
2. **dbt 1.9 vs 1.8 `dbtRunnerResult.result` drift.** dbt explicitly
   documents this surface as "not fully contracted." Pin a minor version
   in `pyproject.toml` test extras; the contract test (DEVOPS handoff §10)
   is the canary on upgrade.
3. **Customer-fidelity caveat: customer uses CLI, we use Python API.**
   The eject orchestrator invokes `dbtRunner` programmatically; a customer
   typically runs `dbt build && dbt test` from a shell. Both paths route
   through the same `dbt.cli.main` machinery so behaviour is identical,
   but signal-handling and exit-code semantics differ at the edges.
   Document in DELIVER; flag any divergence as it surfaces.
4. **Per-flow wall-clock could exceed 30s on slower CI runners.** Profile
   on the actual CI runner before committing AC1.6 stability. (Python-API
   invocation removes ~50–200ms of subprocess fork/exec per `invoke()` vs
   the original subprocess design — small but real.)
5. **Two-SSOT drift between Pandera and `schema.yml`.** Tracked: the
   eject step IS the drift detector. Document this explicitly in the test
   docstring so future engineers don't accidentally remove the eject layer
   thinking Pandera is sufficient.
6. **`dbtRunner` is not concurrency-safe within a single Python process.**
   pytest's default serial execution is fine; pytest-xdist's per-worker
   isolation is also fine. Adding intra-test parallelism (e.g. running
   multiple flows concurrently in a single asyncio loop) would require
   subprocess isolation per concurrent invocation, OR a single-threaded
   pool. Documented as a constraint, not a today-problem.

---

## 14. What DELIVER Will Build (acceptance-designer + software-crafter view)

* `EjectAndTestOrchestrator` + `probe()` (with the 5 specified probes).
* `DuckDBProfileSeeder` + `DbtRunner` + `RunResultsParser`.
* `PanderaValidator` + at least one schema (`OrdersStaging`).
* `eject_orchestrator` session-scoped pytest fixture (composition root).
* New `eject_and_test()` and `validate_after()` methods on
  `DatasetLayerHarness`.
* Update to `test_dataset_staging_layer.py` to call both layers.
* Architectural enforcement tests (subtype + structural + behavioral).
* Test extras in `backend/pyproject.toml` for `dbt-core`, `dbt-duckdb`,
  `pandera`.

The acceptance criteria for DELIVER are observable behaviors (test passes,
test skips with named-probe-failure reason, AC1.6 holds), not internal
structure. Software-crafter chooses the internal decomposition during
GREEN/REFACTOR.

---

## 15. Upstream Impact

DIVERGE assumptions reviewed; no revisions required. The
`dbt-project-export` feature is implemented and unit-tested at exactly the
level DIVERGE assumed. AC1.6 stands. JOB-001 stands. ADR-016 stands.

See `upstream-changes.md` (empty by design) for the formal "no changes"
record.
