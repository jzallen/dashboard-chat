# ADR-018: Eject-then-Test as the Dataset-Layer Validation Strategy

**Status:** Ratified
**Date:** 2026-05-08
**Ratified:** 2026-05-09 by Zach Allen (project owner) following Atlas (`nw-solution-architect-reviewer`) approval and the `dbtRunner` Python-API refinement (see `wave-decisions.md` D9).
**Originating wave:** DESIGN (entered directly from DIVERGE per CLAUDE.md brownfield routing; DISCUSS skipped)
**Bead:** TBD (assigned at DELIVER kickoff)
**Companion artifacts:**
- DIVERGE recommendation: `docs/feature/dbt-test-validation/recommendation.md`
- DESIGN proposal: `docs/feature/dbt-test-validation/design/design.md`
- C4 diagrams: `docs/feature/dbt-test-validation/design/c4-diagrams.md`

## Context

The `DatasetLayerHarness` integration suite
(`backend/tests/integration/dataset_layer/`) drives chat-driven workflows
end-to-end against a 5-service compose stack (ADR-016). Today its
data-shape assertions are authored as Python predicates against a pandas
DataFrame fetched from `GET /api/datasets/{id}` (e.g.
`assert_distinct_values`, `assert_no_leading_trailing_whitespace`). The
harness has grown from 695 LOC to 1104 LOC across two refactors without
adding test scenarios — the cost has been chat-protocol churn (ADR-014 wire
stratification, ADR-015 presentation-state log) leaking into per-turn
assertions. Meanwhile, the product ships a `dbt-project-export` feature
(`features/dbt-project-export.feature`,
`backend/app/use_cases/project/export_dbt_project.py`,
`GET /api/projects/{id}/export/dbt`) whose declared purpose is to let
customers run their own dbt tests downstream. **No part of the dashboard's
own test suite today exercises the ejected dbt project.**

DIVERGE (`recommendation.md`) validated a strategic-level job (JOB-001 in
`docs/product/jobs.yaml`):

> When a chat-driven user workflow modifies the staging layer of a dataset,
> validate that the resulting staged data matches the intended outcome
> contract using assertions that remain valid after the project is ejected
> to dbt.

The highest-importance under-served outcome is **O4 — reuse validation logic
across the in-app ↔ ejected-dbt boundary** (importance 9, satisfaction 2,
opportunity score 16). DIVERGE scored 6 architectural options under locked
weights; **Option C — Eject-then-test** scored 4.04 (#1) on the strength
of T5 (durability across ejection, 5/5) being the only 5/5 in that column.
**Option B** (Pandera at the staging boundary + dbt-test export translator)
scored 3.83 (#2), explicitly flagged as a layerable companion.

Five open questions were carried forward to DESIGN; this ADR ratifies an
answer for each.

## Decision drivers

* **JOB-001 strategic-level outcome (O4) drives the architecture.** Any
  option that does not run the customer's actual artifact violates the
  validated job's strategic level.
* **AC1.6 (≤300s wall-clock per CI run, inherited from
  `api-driven-user-flow-tests`).** The eject step has measured/estimated
  cost ~85–105s per regression flow; AC1.6 holds with ~65% headroom at
  M=1 flow and degrades to a contingency (γ — sampled-eject) at M ≥ 3.
* **ADR-016 production-topology fidelity (hard constraint).** The 5-service
  compose stack must remain unchanged. The orchestrator runs **outside** the
  compose network (in pytest), preserving the constraint.
* **ADR-007 (Ibis is the SQL generator).** The dashboard's runtime materializes
  via Ibis-on-DuckDB; the customer's dbt-on-DuckDB run is a parallel artifact.
  The eject-and-test path uses a **separate** DuckDB instance reading the
  **same** MinIO Parquet — production-fidelity at the data-source level,
  isolation at the query-engine level.
* **Earned Trust (principle 12).** The `dbt-project-export` endpoint has
  3 use-case unit tests covering happy-path zip generation, project-not-found,
  and empty-project skeleton. Those tests do NOT cover the runtime substrate
  (MinIO httpfs readability with the seeded profile, `dbt-core` Python-API version skew,
  `run_results.json` schema drift). Without an explicit `probe()` mechanism,
  the test suite would silently pass on a broken substrate. The orchestrator's
  `probe()` is therefore not optional.
* **Conway's Law check.** Single-team brownfield; orchestrator + Pandera
  layer sit in `backend/tests/` next to the existing harness. No team
  boundary to negotiate.

## Considered options

DIVERGE evaluated 6 architectural options (A–F + I as anchor). DESIGN
narrowed to three realizations of the chosen DIVERGE direction (C):

1. **Option α — Pure C (eject-then-test only).** Every regression flow
   ejects + runs `dbt build` then `dbt test` (programmatically via
   `dbtRunner.invoke()`). Per-turn assertions retire to the AC1.4
   raw-tool-call leak guard only.
2. **Option β — Layered C+B (eject-then-test + Pandera per-turn).
   Recommended.** Per-flow eject-and-test for the durable customer-fidelity
   gate; per-turn Pandera schema validation against the staging DataFrame
   for sub-100ms feedback. Two layers, one concept (validation), with the
   eject step doubling as a drift detector between the two SSOTs.
3. **Option γ — Sampled-eject C.** Eject runs only on a curated subset of
   regression flows (registered via pytest marker). Wall-clock economy at
   scale; documented contingency for β when regression flows grow past 3.

Three options from DIVERGE were considered and rejected as the primary
direction (covered exhaustively in `recommendation.md`):

* **Option B alone** (Pandera + dbt-test export translator). Loses on T5
  unless paired with eject. β layers B's per-turn mechanism beneath C
  rather than choosing B as the primary.
* **Option E** (Fire-and-forget + Parquet golden-file diff). T5 = 2/5;
  snapshots don't ship to the customer's project. Re-blessing fatigue.
* **Option F** (Worker-emitted `validation_plan` event + dbt unit tests).
  Highest concept count; would amend ADR-014. DIVERGE T2 = 1/5.

## Decision outcome

**Option β — Layered C+B (eject-then-test + Pandera per-turn).**

### Mechanism (chosen β)

After driving each chat workflow:

1. **Per-turn (B's mechanism)**: A `PanderaValidator` runs a
   `pa.DataFrameSchema` against the staging DataFrame from
   `GET /api/datasets/{id}?preview_limit=N`. <100ms per turn; failures
   cause the existing AC1.5 retry-with-rephrase path to engage.
2. **Per-flow (C's mechanism)**: An `EjectAndTestOrchestrator`:
   1. Calls `GET /api/projects/{id}/export/dbt` and captures the zip.
   2. Unzips to a `tmp_path` tmpdir; verifies the expected file tree.
   3. Seeds `profiles.yml` with concrete S3 endpoint + credentials pointing
      at MinIO (substituting for the `env_var(...)` placeholders that ship
      in the export per `dbt-project-export.feature` line 47).
   4. Invokes `dbtRunner` from `dbt.cli.main` (Python API; stable since
      dbt 1.5) for `deps`, then `build`, then `test` — three sequential
      `invoke([...])` calls against an ephemeral DuckDB file in the same
      tmpdir. No subprocess; the runner is in-process to pytest.
   5. Reads `dbtRunnerResult.result` directly into an `EjectTestReport`.
      (Falls back to `target/run_results.json` only as a defensive path
      if `.result` is ever `None` — pinned by the contract test.)
3. **Composition root**: a session-scoped pytest fixture
   (`eject_orchestrator`) constructs the orchestrator and invokes its
   `probe()` exactly once. Probe failure → `pytest.skip(reason)`.

### Open-question ratifications

* **OQ1 — DuckDB topology**: **Fresh DuckDB seeded with same MinIO Parquet
  sources.** Production-fidelity (the customer does this on `unzip && dbt
  build`); cleaner isolation from Ibis-materialized state.
* **OQ2 — Scope**: **Per-flow eject for regression flows; per-turn Pandera
  for fast feedback.** Two binding points, one concept.
* **OQ3 — `dbt-project-export` test-gating sequence**: **Accept the
  inversion, with `probe()` as the floor.** The export feature has 3
  use-case unit tests; the inversion risk is mitigated not by gate-first
  hardening (1-week effort) but by `probe()`, which exercises the runtime
  substrate the use-case tests cannot reach (MinIO httpfs readability via
  the seeded profile, etc.).
* **OQ4 — AC1.6 wall-clock**: **AC1.6 holds at M=1 regression flow with
  ~65% headroom (~85–105s estimated end-to-end).** Profile in DELIVER on
  the actual CI runner; γ (sampled-eject) is the documented contingency at
  M ≥ 3 flows.
* **OQ5 — Per-turn assertions**: **Keep AC1.4 raw-tool-call leak guard
  (protocol-level invariant per ADR-014). Move data assertions to two
  layers — per-turn Pandera (β) and per-flow dbt-test (β/α/γ).** Existing
  harness predicates remain during the transition and retire as the
  Pandera/dbt assertions land.

### Earned-Trust contract — `probe()` is mandatory

`EjectAndTestOrchestrator.probe()` MUST exercise the following 5 probes
before any flow uses the orchestrator. The composition-root invariant is
**wire then probe then use**. Probe failure converts to `pytest.skip(reason)`
with the failing probe named in the skip message.

| Probe | Verifies | Substrate lie it catches |
|---|---|---|
| `probe_dbt_runner_importable` | `from dbt.cli.main import dbtRunner, dbtRunnerResult` succeeds AND `dbtRunner().invoke(['--version']).success` is `True` AND the reported version is ≥ 1.8 | `dbt-core` missing from the test extra; pinned to incompatible version; entry point moved |
| `probe_dbt_duckdb_loadable` | `import dbt.adapters.duckdb` succeeds | adapter not installed alongside dbt-core |
| `probe_export_endpoint_reachable` | `GET /api/projects/{id}/export/dbt` against a throwaway probe project returns 200 application/zip with `dbt_project.yml` and `profiles.yml` in the archive | export endpoint regressed (caught BEFORE per-flow tests build on it) |
| `probe_minio_readable_via_duckdb` | A throwaway DuckDB connection in tmpdir can `INSTALL httpfs; LOAD httpfs;` and `SELECT count(*) FROM read_parquet('s3://<test-bucket>/<known-fixture>.parquet')` | profile.yml's `env_var(...)` substitution + S3 endpoint URL + creds + path style do NOT actually let DuckDB read the source — the canonical "compiles but cannot read" substrate lie |
| `probe_run_results_shape` | `dbtRunner().invoke(['parse', '--project-dir', <probe>])` returns a `dbtRunnerResult` whose `.result` exposes the attributes `RunResultsParser` reads (`.node.name`, `.status`, `.failures`, `.message`, `.execution_time`) | dbt minor-version bump changed the `RunResult` shape (dbt explicitly documents `.result` as "not fully contracted"); caught at probe, not at first failing flow |

The probe contract is enforced via three orthogonal layers
(principle 11 + 12 cross-application):

| Layer | Tool | Question answered |
|---|---|---|
| Subtype | `mypy` + `typing.Protocol` (`EjectOrchestratorProtocol`) marked `runtime_checkable` | Does the type say it has `probe()`? |
| Structural | `pytest-archon` rule: any test under `backend/tests/integration/dataset_layer/` that imports `EjectAndTestOrchestrator` MUST also import the `eject_orchestrator` fixture | Does the test path go through the probing fixture? |
| Behavioral | A CI gold-test that uninstalls `dbt-core` from the test environment (or monkeypatches `dbt.cli.main.dbtRunner` to raise `ImportError`) and asserts the suite skips with the `probe_dbt_runner_importable` failure reason | Does the probe actually fail loudly when the substrate lies? |

`import-linter` was investigated for the broader cross-module discipline;
its contracts are import-graph only and cannot enforce method-presence on
classes. Hence the layered enforcement above.

### Why β over α

* α leaves O3 (chat-protocol churn cost) and O6 (workflow-vs-data triage)
  unaddressed at the per-turn level — the user's "feels messy" signal lands
  squarely on the per-turn surface, and α inherits today's mess.
* β's Pandera layer is a stable boundary that does NOT couple to the chat
  protocol — the schema is on the data, not on the wire. ADR-014 wire-vocab
  changes do not propagate into Pandera schemas.
* Per-turn ~50ms overhead is invisible against per-flow eject's ~30s.
* β composes forward: a Pandera-to-dbt-test translator (B's full ambition)
  has its input artifacts in place if it becomes warranted.

### Why β over γ

γ's value lights up at M ≥ 3 regression flows. Today there is M=1. γ is
documented as β's contingency, not as the primary.

### Why not flip to B alone (per DIVERGE §4 dissent triggers)

Three flip triggers from DIVERGE were re-evaluated at DESIGN:

1. *"`dbt-project-export` is found to have material correctness gaps."* —
   The `probe()` design directly addresses this. **Trigger does not fire.**
2. *"Wall-clock profiling shows >30s per scenario."* — Estimated 10–30s
   per flow. Profile in DELIVER; if exceeded, escalate to γ (β's
   contingency), not B. **Trigger does not fire pre-DELIVER.**
3. *"The team's pandas/Pandera familiarity dominates dbt-CLI familiarity."*
   — The user's framing says the opposite: the product ejects to dbt.
   **Trigger does not fire.**

## Consequences

### Positive

* **JOB-001 strategic level satisfied by construction**: every regression
  flow ships and runs the customer's artifact.
* **O3 (chat-protocol churn) and O6 (workflow-vs-data triage) addressed**
  via the Pandera layer's protocol-independent boundary.
* **`probe()` neutralizes the load-bearing-on-export risk** that DIVERGE
  flagged as Option C's primary weakness.
* **No topology change to the compose stack** (ADR-016 preserved).
* **Forward-composable** with B's full translator if it becomes warranted.

### Negative / accepted trade-offs

* **Two SSOTs for data contract** (Pandera schema + dbt `schema.yml`) until
  a translator lands. Drift detector: the eject step IS the diff. If
  Pandera and `schema.yml` diverge, eject-and-test fails. Acceptable but
  tracked.
* **`dbt-core` Python API is a new external integration** for the test
  loop. Contract test recommended for `RunResultsParser` against pinned
  dbt versions (1.8, 1.9) — the contract is `dbtRunnerResult.result`,
  which dbt explicitly documents as "not fully contracted." See DEVOPS
  handoff in `design.md` §10.
* **`dbtRunner` is not safe for concurrent invocation within a single
  Python process.** Documented constraint: pytest serial execution is
  fine; pytest-xdist's per-worker process isolation is also fine. Adding
  intra-test parallelism (multiple flows in one asyncio loop) would
  require either subprocess isolation or a single-threaded pool. Not a
  today-problem; flagged so a future contributor doesn't introduce it
  silently.
* **Per-flow wall-clock estimates are not yet measured on the actual CI
  runner.** AC1.6 confidence is high but not yet evidence-backed. Profile
  in DELIVER.
* **`dbt-core` + `dbt-duckdb` + `pandera` are added as test extras** in
  `backend/pyproject.toml`. Not runtime dependencies; backend code MUST NOT
  import them (enforced via test-extras isolation + an `import-linter` rule
  in the backend package).

### Operational

* `EjectAndTestOrchestrator` is in-process to pytest; invokes dbt
  in-process via `dbtRunner.invoke()`. No new docker-compose service, no
  subprocess fork/exec per dbt command.
* The fresh DuckDB file lives under pytest's `tmp_path` and is cleaned at
  test teardown.
* MinIO credentials for the seeded profile come from the existing dev
  compose env (`MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`) — no new secret
  store.

## Cross-decision composition (intentional)

* **ADR-018 ↔ ADR-007** — Ibis materializes the in-app DuckDB; the eject
  step targets a separate DuckDB reading the same MinIO Parquet. Two
  query engines, one source of truth. The eject step exercises the
  SQL-generation path that ships, not Ibis's runtime materialization.
* **ADR-018 ↔ ADR-014** — Independent. β does NOT add new ChatEvent types
  (Option F was declined precisely on these grounds). The wire schema is
  unchanged.
* **ADR-018 ↔ ADR-015** — Independent in this iteration. The
  presentation-state log is orthogonal to data-shape validation. Future
  composition possible (a "presentation-state-after-eject" assertion) but
  not in JOB-001's scope.
* **ADR-018 ↔ ADR-016** — Hard constraint inherited. The 5-service compose
  stack is unchanged; the orchestrator is in-process to pytest, outside the
  compose network. Production-topology fidelity preserved.
* **ADR-018 ↔ ADR-017** — Independent. SessionEventReader dispatch is
  orthogonal to dbt-test validation.

## Open questions

1. **Pandera-to-dbt-test translator (B's full ambition).** Out of scope for
   this iteration; β borrows only B's per-turn layer. Revisit when (a)
   regression-flow count grows past 3 and (b) translator fidelity is
   ≥ 80% automatable. Decision owner: future feature wave.
2. **Wall-clock measurement on the actual CI runner.** Estimates in §6.OQ4
   come from per-component sums; needs a measured baseline once DELIVER's
   first integration run lands. Owner: DELIVER acceptance test author.
3. **dbt minor-version pin.** DELIVER picks `dbt-core ~= 1.8` or
   `~= 1.9` based on dbt-duckdb adapter compatibility. The contract test
   for `RunResultsParser` pins both versions. Owner: software-crafter at
   DELIVER kickoff.
4. **Sampling rule for γ contingency.** When regression-flow count reaches 3,
   define which flows are "representative" for sampled-eject. Open. Owner:
   future feature wave at the trigger point.
5. **Bead assignment.** This ADR is Proposed; a bead id will be assigned at
   DELIVER kickoff and back-filled here.

## References

* DIVERGE: `docs/feature/dbt-test-validation/recommendation.md`
* DIVERGE wave-decisions: `docs/feature/dbt-test-validation/wave-decisions.md`
* DESIGN proposal: `docs/feature/dbt-test-validation/design/design.md`
* C4 + sequence diagrams: `docs/feature/dbt-test-validation/design/c4-diagrams.md`
* SSOT: `docs/product/jobs.yaml` (JOB-001)
* Architecture brief: `docs/product/architecture/brief.md` (`## Application Architecture`)
* Existing harness: `backend/tests/integration/dataset_layer/harness.py`
* Existing acceptance test: `backend/tests/integration/dataset_layer/test_dataset_staging_layer.py`
* Conftest: `backend/tests/integration/dataset_layer/conftest.py`
* Export endpoint: `backend/app/routers/projects.py:54`
* Export use case: `backend/app/use_cases/project/export_dbt_project.py`
* Existing export tests: `backend/tests/use_cases/project/test_export_dbt_project.py`
* Export Gherkin: `features/dbt-project-export.feature`
* Constraint ADRs: ADR-007 (Ibis), ADR-014 (ChatEvent stratification),
  ADR-015 (presentation-state log), ADR-016 (5-service compose),
  ADR-017 (SessionEventReader dispatch).
* AC1.6 origin: `docs/evolution/2026-05-01-api-driven-user-flow-tests.md` §6.
