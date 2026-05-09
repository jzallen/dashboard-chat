# Wave Decisions — `dbt-test-validation` — DESIGN

**Feature:** dbt-test-validation
**Wave:** DESIGN
**Date:** 2026-05-08
**Author:** Morgan (nw-solution-architect)
**Mode:** Propose
**Prior wave:** DIVERGE (2026-05-08; recommended Option C with Option B as principled dissent)

---

## Decisions

* **[D1] Architectural realization: Option β (Layered C+B).** Per-flow
  `EjectAndTestOrchestrator` (C's mechanism) for the customer-fidelity gate;
  per-turn `PanderaValidator` (B's per-turn layer only — NOT B's translator)
  for sub-100ms feedback. Two binding points; one concept (validation). The
  eject step doubles as the drift detector between Pandera and `schema.yml`
  SSOTs. (See: `design.md` §2 Option β, §7 Recommendation.)

* **[D2] Earned Trust — `probe()` is mandatory and not deferrable.**
  `EjectAndTestOrchestrator.probe()` exercises 5 specific probes covering
  `dbt.cli.main.dbtRunner` importability + version, dbt-duckdb adapter
  loadability, export-endpoint reachability, MinIO httpfs readability via
  the seeded DuckDB profile, and `dbtRunnerResult.result` shape (which dbt
  documents as "not fully contracted"). Composition-root invariant: **wire
  then probe then use**. Probe failure → `pytest.skip(reason)` with the
  failing probe named. (See: `design.md` §4, ADR-019 Decision outcome
  §"Earned-Trust contract".)

* **[D3] No topology change to the compose stack.** ADR-016 inherited as a
  hard constraint. The orchestrator runs in-process to pytest, OUTSIDE the
  compose network, invoking `dbtRunner` in-process (Python API) and reading
  MinIO via httpfs from a tmpdir DuckDB. Production-topology fidelity
  preserved. (See: `design.md` §3 Reuse Analysis, ADR-019 Decision drivers.)

* **[D4] Test extras isolation for new dependencies.** `dbt-core`,
  `dbt-duckdb`, and `pandera` are added as `pyproject.toml` test extras —
  NOT runtime dependencies. An `import-linter` rule forbids
  `backend/app/**` from importing them. (See: `design.md` §3 Reuse
  Analysis bottom rows, §11 Architectural Enforcement.)

* **[D5] `EjectOrchestratorProtocol` defines the boundary.** A Python
  `typing.Protocol` (marked `runtime_checkable`) requires `probe()` and
  `eject_and_test()`. Software-crafter implements; the orchestrator-construction
  test asserts subtype conformance via mypy + an additional structural
  pytest-archon rule. (See: `design.md` §11.)

* **[D6] The eject orchestrator is a test-infrastructure module, not a
  backend module.** Lives in `backend/tests/integration/dataset_layer/eject/`
  alongside the harness. Owned by the same team that owns the harness.
  (See: `design.md` §3 Reuse Analysis, §12 Paradigm Note.)

* **[D7] OOP for stateful orchestration; functions for parsers/seeders.**
  Consistent with the existing `harness.py` paradigm choice (composition
  over inheritance; class wrappers around stateful resources; module-level
  pure functions for parsers). (See: `design.md` §12.)

* **[D8] AC1.6 (5-min wall-clock) HOLDS at M=1 regression flow.** Estimated
  ~85–105s end-to-end per flow with ~65% headroom. Profile in DELIVER on
  the actual CI runner; γ (sampled-eject) is the documented contingency at
  M ≥ 3 flows. AC1.6 is NOT revised in this wave. (See: `design.md` §6 OQ4
  resolution, c4-diagrams.md sequence note.)

* **[D9] Use `dbtRunner` Python API instead of subprocess (post-Atlas
  refinement, 2026-05-09).** dbt is a Python tool and exposes a stable
  `from dbt.cli.main import dbtRunner, dbtRunnerResult` entry point since
  dbt 1.5. `DbtRunner` wraps that API rather than `subprocess.run`. Wins:
  no PATH dependence; no exit-code/output-text re-parse; `.result` read
  directly (with run_results.json as defensive fallback only); ~50–200ms
  saved per `invoke()` over fork/exec. Documented constraint: `dbtRunner`
  is NOT safe for concurrent calls within one Python process — pytest
  serial execution and pytest-xdist's per-worker process isolation are
  both fine; intra-test parallelism would require subprocess isolation
  per concurrent call. Triggered by user feedback on Atlas's approval;
  changes are scoped to component spec + probes + behavioral enforcement
  (no recommendation flip). (See: `design.md` §3 `DbtRunner` row, §4
  probes, §10 contract test, §13 risks #2/#3/#6, ADR-019 Decision
  outcome + Consequences.)

---

## Open Question Resolutions

| OQ | Resolution | One-line rationale |
|---|---|---|
| **OQ1** | Fresh DuckDB seeded with same MinIO Parquet sources | Production-fidelity (the customer's `unzip && dbt build` does exactly this); cleaner isolation from Ibis-materialized state |
| **OQ2** | Per-flow eject for regression flows; per-turn Pandera for fast feedback | Two binding points, one concept (validation) |
| **OQ3** | Accept the testing inversion, with `probe()` as the floor | The 3 use-case unit tests for export do not reach the runtime substrate; `probe()` does, and activates immediately rather than after a 1-week gate-first refactor |
| **OQ4** | AC1.6 holds at M=1; γ (sampled-eject) is the contingency at M ≥ 3 | Estimated ~85–105s/flow gives ~65% headroom against 300s |
| **OQ5** | AC1.4 raw-tool-call leak guard stays at protocol level; data assertions split across per-turn Pandera (β) and per-flow dbt-test | The protocol invariant is wire-vocabulary (ADR-014), not data; data goes to dbt because that's JOB-001's strategic destination |

---

## Quality Gates (DESIGN-wave)

- [x] Confirmation checklist (✓/⊘) completed in `design.md` §0.
- [x] 2–3 architectural options proposed (α, β, γ); structural diff
      explicit; trade-offs surfaced.
- [x] Reuse Analysis table — every existing component classified
      (EXTEND/CREATE NEW/REUSE AS-IS) with justification.
- [x] C4 diagrams (L1 + L2 + L3 + sequence) in Mermaid.
- [x] OQ1–OQ5 resolved with one-line rationale.
- [x] Recommendation explicit, with weakness flags.
- [x] ADR draft (ADR-019) — Status / Context / Considered options /
      Decision outcome / Consequences / Cross-decision composition / Open
      questions / References.
- [x] Architecture brief bootstrapped at
      `docs/product/architecture/brief.md` with `## Application
      Architecture` section.
- [x] External integration annotated for DEVOPS handoff (`dbt-core` ↔
      `RunResultsParser` contract test recommendation).
- [x] Architectural enforcement tooling specified (mypy +
      `pytest-archon` + behavioral CI test; `import-linter` for the
      runtime-import boundary).
- [x] Earned Trust principle applied — every adapter contract has a
      `probe()` specification.
- [x] OSS-only stack (dbt-core Apache-2.0; dbt-duckdb Apache-2.0; pandera
      MIT).
- [x] No source-code modifications (DESIGN is artifact-only).

- [ ] Peer review (Atlas, `solution-architect-reviewer`) — pending; max 2
      iterations protocol; results recorded here on completion.

---

## Wave Outputs (file paths)

* `docs/feature/dbt-test-validation/design/design.md` — proposal with α/β/γ + recommendation.
* `docs/feature/dbt-test-validation/design/c4-diagrams.md` — L1, L2, L3, sequence (Mermaid).
* `docs/feature/dbt-test-validation/design/wave-decisions.md` — this file.
* `docs/feature/dbt-test-validation/design/upstream-changes.md` — formal "no upstream changes" record.
* `docs/decisions/adr-019-eject-then-test-validation.md` — Proposed ADR.
* `docs/product/architecture/brief.md` — bootstrapped with `## Application Architecture` and a `dbt-test-validation` sub-section.

## Hand-off

**Next wave:** `/nw-distill` (acceptance-designer) — write BDD acceptance
tests for the new `eject_and_test()` and `validate_after()` harness
methods, plus the `probe()` skip-with-reason behavior. Then `/nw-deliver`
(software-crafter) implements via Outside-In TDD.

**Recipient package for DISTILL/DEVOPS:**
* ADR-019 (architectural decision; constraints).
* β recommendation in `design.md` §7 (mechanism + components).
* `c4-diagrams.md` (visual contract).
* This `wave-decisions.md` (decision summary).
* External-integration annotation: contract test for `dbt-core` ↔
  `RunResultsParser` (DEVOPS).
* Quality attribute scenarios: AC1.6 wall-clock; AC1.4 raw-tool-call leak
  guard; ProbeReport skip-with-reason; EjectTestReport
  status/failures/models-built.
* Development paradigm: Python OOP (orchestrator) + module-level pure
  functions (parsers, seeders) — consistent with existing harness.
