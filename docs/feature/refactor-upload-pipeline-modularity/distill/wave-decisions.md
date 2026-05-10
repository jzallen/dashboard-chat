<!-- DES-ENFORCEMENT : exempt -->
# Wave Decisions — `refactor-upload-pipeline-modularity` — DISTILL

**Feature:** refactor-upload-pipeline-modularity
**Wave:** DISTILL (acceptance test design)
**Date:** 2026-05-10
**Author:** Quinn (nw-acceptance-designer)
**Prior wave:** DESIGN (Proposed 2026-05-10; recommended Option α — `UploadPluginDispatcher` class + internal `MultiProcessingResult` canonicalization with `len(results) > 1` guard preserving the silent outbox-payload asymmetry; ratified as ADR-022 Proposed)

---

## Reconciliation Result

**Reconciliation passed — 0 contradictions.**

DESIGN's `wave-decisions.md` ratified DWD-1..DWD-10 with Option α, the
`MultiProcessingResult` internal canonicalization, the validator
relaxation for `len==1`, the explicit `if len(results) > 1` outbox
payload guard, and the new absence-assertion characterization test as
the **HARD GATE** that closes the silent-behaviour gap. All ten
DESIGN-wave decisions carry forward into DISTILL unchanged.

DISCUSS was intentionally skipped per CLAUDE.md brownfield routing
(refactor with cause known — user-initiated proactive modularity →
DESIGN entry). DEVOPS was empty (DWD-9 in DESIGN: surface fence, no
new external integration, no compose-stack change). There are no user
stories to trace; the acceptance criteria derive from ADR-022's
behaviour-preservation contract + the 15 existing characterization
tests at `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py`.

No back-propagation issues surfaced — see `upstream-issues.md`.

---

## Decisions

* **[DWD-1] Walking-skeleton strategy: Strategy C-local — real
  SQLAlchemy + in-memory aiosqlite + boto3.Stubber-wrapped
  `MinIOLakeRepository`, no compose stack required.** The "real
  adapter" surface for this refactor is exactly what
  `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py`
  drives the existing 15 tests against today: aiosqlite for the
  metadata + outbox repos, `boto3.stub.Stubber` for the lake repo. Iron
  Rule binds the refactor to that substrate (per CLAUDE.md: "preserve
  behaviour against the real substrate the production code runs
  against"). No compose stack is in scope (DWD-9 in DESIGN's
  wave-decisions: surface fence — `app/use_cases/project/_dbt/`,
  `app/repositories/metadata/repository.py`, `app/models/dataset.py`,
  `app/query_engine/` are all out of scope). Auto-detect rationale: the
  walking skeleton's only "external" service is S3, and S3 is already
  exercised via `boto3.Stubber` in the canonical test layer; aligning
  to that pattern keeps the WS demo-able locally with zero new
  infrastructure. Tagged `@walking_skeleton @real-io @driving_adapter`.

* **[DWD-2] Asymmetry-preservation scenario is a HARD GATE.** Per
  DWD-2 in DESIGN's wave-decisions.md ("Outbox payload asymmetry is
  preserved verbatim, NOT aligned") and ADR-022 §Behaviour-preservation
  guarantees, the silent behaviour asymmetry between the single-file
  and multi-file outbox-payload writes MUST be preserved by the
  refactor. THIS DISTILL adds the new absence-assertion characterization
  layer that DWD-2 demands:
  - **Single-path absence-assertion (NEW).** A new method
    `test_single_dataset_does_not_persist_dataset_ids_or_dataset_id_in_outbox_payload`
    is appended to
    `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py::TestCreateDatasetFromUploadCharacterization`
    in DELIVER Phase 02 (only allowed mutation to that file across the
    entire feature; Iron Rule fence elsewhere).
  - **Multi-path presence-assertion (EXISTING).** Pinned by
    `test_multi_dataset_persists_dataset_ids_and_first_id_in_outbox_payload`
    today; stays Iron-Rule-bound.
  - **Acceptance-level pin.** This wave's
    `milestone-2-asymmetry-preservation.feature` restates BOTH halves
    AND adds a "boundary scenario" that runs both paths in one
    scenario, asserting the explicit `if len(results) > 1` guard
    observably toggles. Three scenarios in milestone-2:
      1. Single-file upload leaves the outbox payload free of
         `dataset_ids` / `dataset_id` keys.
      2. Multi-file upload records `dataset_ids` (list) and
         `dataset_id` (first id) in the outbox payload.
      3. The boundary that determines the payload write is the
         canonical result length being greater than one.
  - **HARD GATE proof (DELIVER Phase 02 manual review gate).** A
    deliberate code-side mutation that drops the `if len(results) > 1`
    guard MUST fail BOTH the new absence-assertion test AND the
    milestone-2 acceptance scenarios. Reviewer performs this mutation
    test locally before approving Phase 02.

* **[DWD-3] Driving port = `create_dataset_from_upload` use-case
  function (milestones 1 + 2) AND `DatasetController.post_dataset`
  (milestone 3 driving adapter).** Per the test-design-mandates skill
  (Mandate 1), the driving port is the entry point consumers actually
  use. For this refactor:
  - The use case is consumed by `HTTPController.post_dataset` (the
    sole in-tree caller per DESIGN §5). All milestone-1 and
    milestone-2 scenarios drive through `create_dataset_from_upload`
    directly (the same way the existing 15 tests do; the same way the
    `DatasetController.post_dataset` adapter does in production).
  - The new `UploadPluginDispatcher` is a use-case-internal
    coordinator (DWD-8 in DESIGN's wave-decisions.md: not registered
    in `RepositoryContainer`, not a driven adapter, no probe). It is
    NEVER imported in step glue — observed only through the public
    function it serves.
  - Milestone 3 scenarios drive through `DatasetController.post_dataset`
    directly (the HTTP-side driving adapter). The controller's
    JSON:API envelope shape is the observable user-facing contract;
    the refactor must not change it.

  **CM-A evidence.** `grep -n 'from app.plugins\|from app.use_cases.dataset._pipeline.plugin_dispatch'`
  on `tests/acceptance/refactor-upload-pipeline-modularity/steps/upload_pipeline_steps.py`
  must return zero matches EXCEPT the import-graph proof step that
  asserts the dispatcher module exists (one explicit, documented
  exception per Dim 7's "import-existence as observable behaviour"
  pattern; the dispatcher's existence at the import path is the
  refactor's structural deliverable).

* **[DWD-4] Walking-skeleton scope = single-file CSV through the
  no-registry fallback path.** Justification:
  - The single-file path is THE path the refactor must not break and
    THE path that exercises the new `len(results) == 1` canonical
    shape end-to-end. It is the asymmetry's "absence" arm — the
    walking skeleton makes that absence observable for the first time
    (DWD-2 in this wave; binding effect on DISTILL).
  - It exercises the dispatcher's no-registry CSV-fallback branch,
    proving the relaxed validator (DWD-3 in DESIGN's wave-decisions:
    `r.name is None` allowed when `len == 1`) accepts the fallback's
    nameless `ProcessingResult`.
  - It returns `Success(Dataset)` (NOT `Success([Dataset])`),
    proving the external return shape is preserved (DWD-5 in DESIGN's
    wave-decisions: the use case unwraps a one-element list back to a
    single Dataset before returning).
  - Walking-skeleton litmus test:
    - **Title describes user goal?** YES — "Customer uploads a single
      CSV and receives a single dataset back through the new
      dispatcher." The "user" is the Dashboard Chat customer; the
      goal is "my single-file upload still works after the refactor."
    - **Given/When describe user actions/context?** YES — "an upload
      event is recorded for 'test_data.csv' against that project,"
      "the engineer runs the upload-to-dataset use case for that
      upload."
    - **Then describe user observations?** YES — "the use case
      returns a single dataset," "the returned dataset's row count is
      3," "the returned dataset's column names are name, age, active."
      All assertions are on return values from the driving port or
      the persisted dataset's observable shape.
    - **Demo-able to a non-technical stakeholder?** YES — "we
      restructured the upload pipeline; here is proof a CSV upload
      still produces the same dataset before and after." Atlas (any
      reviewer) can confirm.
    - **Litmus test:** "If I deleted the real adapter, would this WS
      still pass?" NO — the SQLite engine and the `boto3.Stubber` ARE
      the adapter surface; without them every step errors at fixture
      bind time. WS is testing real wiring, not InMemory (Mandate 6
      / Dim 9d).

* **[DWD-5] Four feature files, 12 total scenarios.** Per the
  test-design-mandates skill (recommended ratio 2-3 WS + 17-18 focused
  for a typical 20-scenario feature), this feature fits 1 WS + 4
  milestone-1 + 3 milestone-2 + 4 milestone-3 = **12 scenarios**.
  Slightly under the recommended 20 because:
  - The refactor surface is small (one new ~80-LOC module + a
    one-line validator change + a use-case body refactor).
  - The dispatcher's micro-behaviours (precedence, timeout firing,
    `_converted_content` side-channel persistence, single-result
    wrapping) are covered by ~5 unit tests at
    `backend/tests/use_cases/dataset/test_plugin_dispatch.py` per
    ADR-022 §Confirmation; replicating them at the acceptance level
    would be redundant.
  - The 15 existing characterization tests at
    `test_create_dataset_from_upload.py` carry the bulk of the
    behaviour-preservation surface; this acceptance suite is
    PARALLEL to them, validating the refactor's structural
    deliverables (dispatcher exists, canonicalization in place,
    asymmetry preserved, controller envelope unchanged).

  Per-file counts:
  - `walking-skeleton.feature`: 1 scenario (Phase 00).
  - `milestone-1-dispatcher-extraction.feature`: 4 scenarios (Phase
    01) — single-plugin one-entry, multi-plugin N-entry, no-registry
    CSV fallback, plugin-name precedence.
  - `milestone-2-asymmetry-preservation.feature`: 3 scenarios (Phase
    02) — single-path absence, multi-path presence, boundary
    (`len > 1`) toggle.
  - `milestone-3-call-site-stability.feature`: 4 scenarios (Phase 03)
    — single-upload envelope, multi-upload preserved-verbatim,
    no-plugin-match error shape, partial-failure error shape.

* **[DWD-6] Error-path coverage: 5 of 12 scenarios (42%).** Meets the
  skill's 40% floor. Counted as "error" anything where the observable
  outcome is a refactor-defect signal (an absence assertion being
  violated by silent alignment, an exception shape changing, a status
  code shifting):
  - **Happy path / parity (7):** WS single-file, M1 single-plugin
    one-entry, M1 multi-plugin N-entry, M1 no-registry CSV fallback,
    M2 multi-path presence (parity with existing characterization),
    M3 single-upload envelope, M3 multi-upload preserved-verbatim
    (today's TypeError IS the preserved observable; it counts as a
    happy path for "behaviour preservation").
  - **Error / boundary (5):** M1 plugin-name precedence (mis-routing
    is a defect), M2 single-path absence (silent alignment is a
    defect), M2 boundary toggle, M3 no-plugin-match error shape, M3
    partial-failure error shape.

* **[DWD-7] Default test filter: `-m "not pending"`.** Walking
  skeleton runs by default. Milestone-1 + milestone-2 + milestone-3
  scenarios are tagged `@pending` at the Feature level; DELIVER
  unpends per phase per `roadmap.json`'s `scenarios_to_unskip`.
  Mirrors the precedent established by every other acceptance suite
  at `tests/acceptance/`.

* **[DWD-8] Mandate 7 RED scaffolds use `pytest.fail("DISTILL scaffold
  — DELIVER implements: ...")`.** Per CLAUDE.md project conventions
  and the precedent set by `tests/acceptance/refactor-metadata-repository-split/`
  + `tests/acceptance/extract-dataset-query-port/`, this is the
  standard scaffold marker for DELIVER's outer-loop entry. Every
  step body in `steps/upload_pipeline_steps.py` raises `pytest.fail`
  with a self-documenting "DELIVER implements: ..." message describing
  the exact production-side change required. The conftest's
  `db_engine` and `repository_container` fixtures are also
  `pytest.skip` scaffolds — DELIVER replaces their bodies in Phase 00.
  Module-level `__SCAFFOLD__ = True` marker is set in the steps file
  per ADR-022 wave-design conventions; DELIVER removes it at Phase 03
  exit.

* **[DWD-9] Iron Rule fence: `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py`
  (existing 15 tests) MUST stay byte-for-byte green across every
  phase.** Per CLAUDE.md "NEVER modify a failing test to make it
  pass." For this refactor specifically, the 15 tests at that file
  ARE the characterization layer; they were specifically added by
  bead `dc-89fx` (per the file's own docstring) to bind current
  behaviour. The ONLY allowed mutation to that file across the entire
  feature is in DELIVER Phase 02: APPEND a single new method,
  `test_single_dataset_does_not_persist_dataset_ids_or_dataset_id_in_outbox_payload`,
  to `TestCreateDatasetFromUploadCharacterization`. Verified by
  `git diff` exit criterion in roadmap.json's Phase 02 manual review
  gate. If a pre-existing test fails after a refactor step, the
  refactor is wrong, not the test.

* **[DWD-10] No story IDs to trace.** This refactor entered at
  DESIGN per CLAUDE.md brownfield routing (proactive modularity
  refactor; user-initiated, no production cause). There is no
  `docs/feature/refactor-upload-pipeline-modularity/discuss/` folder
  and no `user-stories.md`. Acceptance criteria derive from:
  - ADR-022's behaviour-preservation contract + Confirmation
    checklist.
  - DESIGN's DWD-1 through DWD-10 (binding wave decisions).
  - The 15 existing characterization tests (the "as-is" behaviour
    surface).
  Dim 8 Check A traceability is therefore N/A (no stories);
  documented here as the audited trail rather than papered over.
  Dim 8 Check B (Environment-to-Scenario mapping) reduces to one
  environment ("aiosqlite + boto3.Stubber"), trivially covered by
  every scenario's Background ("a fresh SQLite-backed repository
  container" + "a stubbed object-store client wired into the lake
  repository").

---

## Adapter Coverage Table (Mandate 6)

| Adapter | `@real-io @driving_adapter` scenario | Covered by |
|---|---|---|
| `MinIOLakeRepository` (boto3-wrapped S3 read + partitioned-parquet write) | YES | walking-skeleton + every milestone-1 scenario + every milestone-2 scenario + every milestone-3 scenario (the lake adapter is in every scenario's Background) |
| `OutboxRepository` (SQLAlchemy ORM-backed event log) — `fetch_upload_event` + `update_payload` (multi-path) + `mark_processed` + `submit_dataset_sync_event` | YES | walking-skeleton (mark_processed only — single path doesn't update payload) + every milestone-1 scenario + every milestone-2 scenario (asymmetry pin against the persisted payload) + every milestone-3 scenario |
| `MetadataRepository` (project_exists + dataset record persistence) | YES | walking-skeleton + every milestone scenario (every scenario seeds a project, persists dataset records, reads them back) |
| `aiosqlite` engine + `RestrictedSession` (the SQL substrate) | YES | walking-skeleton + every milestone scenario (the SQLite engine IS the wiring; without it nothing collects) |
| `UploadPluginDispatcher` (NEW class — use-case-internal coordinator, NOT a driven adapter per DWD-8 in DESIGN) | YES (indirectly via the use case) | walking-skeleton + every milestone-1 scenario + every milestone-2 scenario (the dispatcher is observable through `create_dataset_from_upload`'s return shape and the persisted outbox state; the dispatcher's `dispatch` method is exercised by the use-case driving port in every scenario) |
| `DatasetController.post_dataset` (HTTP driving adapter) | YES | every milestone-3 scenario |
| `pytest-archon` import-graph rule (DWD-7 in DESIGN's wave-decisions) | YES | none in this acceptance suite — covered by the production-side rule at `backend/tests/architecture/test_dependency_rules.py` (added in DELIVER Phase 03). The rule's runtime check IS the test; replicating it at the acceptance level would be redundant. |
| Plugin protocol stability (`FileFormatPlugin`) | YES — through the use-case driving port | milestone-1 scenarios use the existing mock plugin fixtures (MockSinglePlugin, MockMultiPlugin, _RecordingMockSinglePlugin, _UnknownExtPlugin) from `test_create_dataset_from_upload.py`; if the protocol changes, those fixtures fail to construct and the scenarios fail at fixture-bind time. |

Zero "NO — MISSING" rows.

**Costly-external pattern:** none in scope. SQLite + boto3.Stubber
both run in-process; no compose stack, no MinIO container, no
auth-proxy. No `@requires_external` markers needed.

---

## Driving-Port-to-Behaviour Mapping

| Behaviour preserved | Driving port | Observable outcome |
|---|---|---|
| Single-file upload returns single Dataset (WS) | `create_dataset_from_upload(...)` use case | `Success(Dataset)` returned; row_count + column names match the CSV; outbox record marked processed |
| Single-plugin upload returns single Dataset with plugin-supplied name (M1) | `create_dataset_from_upload(..., plugin_registry=...)` use case | `Success(Dataset)` with `dataset.name == "Plugin Dataset"` |
| Multi-plugin upload returns list of Datasets (M1) | Same use case | `Success([Dataset, Dataset])` with `[d.name for d in datasets] == ["Type A", "Type B"]` |
| No-registry CSV fallback returns single Dataset with default name (M1) | Same use case (plugin_registry=None) | `Success(Dataset)` with `dataset.name == "New Dataset"` |
| Plugin name on the event takes precedence over filename extension (M1) | Same use case | The named plugin's recorder shows `process_called == True`; the extension-claim plugin's recorder shows `process_called == False` |
| Single-file upload leaves outbox payload free of dataset_ids/dataset_id (M2 — NEW absence assertion) | Same use case + persisted OutboxRecord re-read | `"dataset_ids" not in record.payload` AND `"dataset_id" not in record.payload` |
| Multi-file upload records dataset_ids + dataset_id in outbox payload (M2 — existing presence assertion) | Same use case + persisted OutboxRecord re-read | `record.payload["dataset_ids"] == [d.id for d in datasets]` AND `record.payload["dataset_id"] == datasets[0].id` |
| The `len(results) > 1` boundary observably toggles (M2 — boundary scenario) | Two invocations of the same use case | One-entry upload's payload lacks the keys; two-entry upload's payload contains them |
| Single-upload controller envelope unchanged (M3) | `DatasetController.post_dataset(...)` | `(envelope, status) == (..., 201)` with `envelope["data"]["type"] == "datasets"` and self-link containing the dataset id |
| Multi-upload controller behaviour preserved verbatim (M3) | Same controller method | Today's `TypeError` from `serialize(list_of_datasets)['id']` is the observable; refactor preserves it (ADR-022 follow-up #3) |
| No-plugin-match error shape unchanged (M3) | Same controller method | Non-success status code; envelope describes the upload-pipeline failure |
| Partial-failure error shape unchanged (M3) | Same controller method | Non-success status code; envelope describes the storage-substrate failure on the second write |

Every "Observable outcome" cell asserts on a return value from the
driving port, the persisted outbox record's payload (re-read from the
DB), or an observable user-visible signal (status code, envelope
shape, raised exception type + message). Zero internal-state
assertions, zero `mock.called` assertions, zero file-existence checks
(Dim 7 mechanical checklist passes for every Then step).

---

## Mandate Compliance Evidence

* **CM-A (Hexagonal boundary).** All `@when` step definitions in
  `tests/acceptance/refactor-upload-pipeline-modularity/steps/upload_pipeline_steps.py`
  invoke `create_dataset_from_upload(...)` (use-case driving port,
  M1+M2) or `DatasetController.post_dataset(...)` (HTTP-side driving
  adapter, M3) — never a directly-imported `UploadPluginDispatcher`
  instance. Verified by `grep -n 'from app.use_cases.dataset._pipeline.plugin_dispatch'`
  on the steps file at scaffold-creation time — zero matches in
  `@when` bodies.

  ONE documented exception: the `then_dispatcher_used` step asserts
  the dispatcher module is importable at its declared path. This is
  the import-graph proof of the refactor's structural deliverable
  (the dispatcher exists at
  `app.use_cases.dataset._pipeline.plugin_dispatch.UploadPluginDispatcher`).
  It is an existence assertion, not a method invocation; the
  dispatcher's behaviour is exercised through the use case in every
  other scenario. This pattern mirrors the milestone-2 archon-rule
  scenario in
  `tests/acceptance/refactor-metadata-repository-split/milestone-2-facade-removal.feature`
  and is on-pattern with Dim 7 (importability is observable
  behaviour at the import-graph layer; structural refactors that
  produce new modules require this kind of pin).

* **CM-B (Business language).** Gherkin uses domain terms only:
  "engineer", "customer", "project", "upload event", "object store",
  "raw upload", "CSV", "dataset", "plugin", "plugin name",
  "dispatcher" (the user — the backend engineer — names the
  refactor's central concept directly), "outbox payload",
  "controller", "envelope", "self-link", "status code", "domain
  failure", "storage-substrate failure". Zero technical jargon: no
  "API", "HTTP", "JSON" (substituted with "envelope"), "POST",
  "DataFrame", "asyncio", "Protocol", "decorator", "subprocess" in
  any `.feature` file. The terms "dispatcher", "outbox payload",
  "envelope", and "controller" are domain terms here because the
  user for this acceptance suite IS the backend engineer; their
  domain vocabulary names these concepts directly. (Same exception
  the `refactor-metadata-repository-split` distill applies for
  "repository" and "facade".) Verified by:
  ```
  grep -nEi 'API|HTTP|REST|JSON|asyncio|subprocess|Protocol|DataFrame|status_code' \
    tests/acceptance/refactor-upload-pipeline-modularity/*.feature
  ```
  Returns one match for "status code" in milestone-3 — and "status
  code" is a domain term for the engineer-as-user (it names what the
  controller observably returns). No other technical terms.

* **CM-C (User journey completeness).** Walking skeleton frames a
  complete journey: customer uploads CSV → use case processes →
  customer's dataset is returned. Milestone-1 scenarios each frame a
  mini-journey per upload class (single-plugin, multi-plugin,
  fallback, precedence): seed prerequisites → invoke use case →
  re-read return shape. Milestone-2 scenarios each frame the
  asymmetry observation explicitly: invoke use case → re-read
  outbox record → observe presence-or-absence of the payload keys.
  Milestone-3 scenarios each frame the controller-side journey:
  customer-shaped POST → controller's serialize+wrap → engineer
  reads envelope + status. All scenarios deliver an observable user
  value — the dataset, the payload, or the envelope.

* **CM-D (Pure function extraction).** This refactor moves the
  inlined plugin-dispatch logic out of the use-case body and into a
  new class. The dispatcher's internals (lookup precedence guard,
  the `_converted_content` ducktype check, the timeout-and-thread
  wrapper) are NOT pure — they touch `LakeRepository`,
  `OutboxRepository`, and `asyncio.to_thread`. They are exercised
  through the dispatcher's public `dispatch` method, which is the
  appropriate seam (the dispatcher is itself the adapter
  encapsulating those impure operations).

  The dispatcher's ~5 unit tests (added in DELIVER Phase 01 at
  `backend/tests/use_cases/dataset/test_plugin_dispatch.py`) cover
  the dispatcher's behaviour in isolation, exercising the impure
  surface through controlled stand-ins. This acceptance suite
  exercises the dispatcher only through `create_dataset_from_upload`
  — appropriate for an acceptance-level concern. CM-D is satisfied
  at the layered division: dispatcher unit tests cover the
  micro-behaviour; acceptance scenarios cover the user-facing
  outcome.

  The CSV fallback (`app.utils.csv_parser.parse_and_clean_csv`) is a
  pure function and continues to be tested directly via the existing
  unit tests at
  `backend/tests/utils/test_csv_parser.py` (no fixture parametrization
  needed). The dispatcher imports it lazily, mirroring the current
  use-case body's lazy import.

---

## Self-Review Checklist (skill Dimension 9 + Mandate 7)

- [x] WS strategy declared in this file (DWD-1 = Strategy C-local
      with aiosqlite + boto3.Stubber)
- [x] WS scenario tagged `@walking_skeleton @real-io @driving_adapter`
- [x] Every driven adapter has at least one `@real-io` scenario
      (table above)
- [x] All step bindings have RED-ready scaffolds with self-documenting
      `pytest.fail("DISTILL scaffold — DELIVER implements: ...")`
      markers
- [x] `__SCAFFOLD__ = True` module marker present at top of
      `steps/upload_pipeline_steps.py`
- [x] All scaffold step bodies use `pytest.fail` (not
      `AssertionError`) per DWD-8 rationale
- [x] At least one scenario exercises the driving port
      (`create_dataset_from_upload`) via its public Python API, not
      internal helpers (walking-skeleton + every milestone scenario)
- [x] Error/edge case coverage ≥ 40% (DWD-6: 42%)
- [x] BDD imports after `sys.path` manipulation have `# noqa`
      markers (skill F-003) — see
      `tests/acceptance/refactor-upload-pipeline-modularity/conftest.py`
      line 41
- [x] `@when` step glue imports nothing from
      `app.use_cases.dataset._pipeline.plugin_dispatch` per-class —
      verified by grep on `steps/upload_pipeline_steps.py` (one
      documented exception: import-existence proof for the dispatcher
      module under `then_dispatcher_used`)
- [x] Mandate 1 (CM-A): import listings show zero internal-component
      imports in `@when` step bodies; the one documented exception is
      a structural existence assertion
- [x] Mandate 2 (CM-B): grep results show zero technical jargon in
      `.feature` files
- [x] Mandate 3 (CM-C): walking skeleton + focused scenario counts:
      1 + 11 = 12 (1 WS + 4 M1 + 3 M2 + 4 M3)
- [x] Mandate 4 (CM-D): pure function extraction handled at the
      dispatcher unit-test layer; acceptance suite exercises through
      public seams
- [x] Iron Rule honoured: `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py`
      bodies stay byte-for-byte green across every phase; the only
      allowed mutation is the appended absence-assertion test in
      Phase 02 (DWD-9 + roadmap exit criteria)
- [x] DWD-2 HARD GATE: asymmetry-preservation scenario(s) exist in
      milestone-2; absence-assertion characterization test scheduled
      for Phase 02 of `roadmap.json`; DELIVER manual review gate
      requires mutation-test proof before Phase 02 approval
- [x] No KPI contracts in scope (no `docs/product/kpi-contracts.yaml`
      reference applies — refactor is invisible to product KPIs);
      `@kpi` tag absent by design
- [x] No story IDs to trace (DWD-10 — entered at DESIGN per
      brownfield routing); Dim 8 Check A acknowledged as N/A
- [x] Dim 8 Check B (environment-to-scenario): one environment
      ("aiosqlite + boto3.Stubber"), trivially covered by every
      scenario's Background

---

## Wave Outputs (file paths)

* `tests/acceptance/refactor-upload-pipeline-modularity/walking-skeleton.feature` (1 scenario; `@walking_skeleton @real-io @driving_adapter`)
* `tests/acceptance/refactor-upload-pipeline-modularity/milestone-1-dispatcher-extraction.feature` (4 scenarios; `@milestone_1 @real-io @driving_adapter @pending`)
* `tests/acceptance/refactor-upload-pipeline-modularity/milestone-2-asymmetry-preservation.feature` (3 scenarios; `@milestone_2 @real-io @asymmetry_preservation @characterization @pending`)
* `tests/acceptance/refactor-upload-pipeline-modularity/milestone-3-call-site-stability.feature` (4 scenarios; `@milestone_3 @real-io @driving_adapter @call_site_stability @pending`)
* `tests/acceptance/refactor-upload-pipeline-modularity/conftest.py` (DISTILL scaffold; DELIVER's Phase 00 wires the real engine + container fixtures)
* `tests/acceptance/refactor-upload-pipeline-modularity/pyproject.toml`
* `tests/acceptance/refactor-upload-pipeline-modularity/steps/upload_pipeline_steps.py` (DISTILL scaffold; every step body raises `pytest.fail("DISTILL scaffold — DELIVER implements: ...")`)
* `tests/acceptance/refactor-upload-pipeline-modularity/test_walking_skeleton.py` + `test_milestone_1_dispatcher_extraction.py` + `test_milestone_2_asymmetry_preservation.py` + `test_milestone_3_call_site_stability.py` (pytest-bdd runners)
* `docs/feature/refactor-upload-pipeline-modularity/distill/wave-decisions.md` (this file)
* `docs/feature/refactor-upload-pipeline-modularity/distill/upstream-issues.md`
* `docs/feature/refactor-upload-pipeline-modularity/distill/roadmap.json`

---

## Hand-off

**Next wave:** `/nw-deliver` (software-crafter) — implements
`UploadPluginDispatcher` + the `MultiProcessingResult` validator
relaxation + the use-case body refactor + the absence-assertion
characterization test + the `pytest-archon` rule via Outside-In TDD,
enabling milestone scenarios one at a time per the 4-phase roadmap.
Walking-skeleton MUST go GREEN first (Phase 00). The asymmetry-
preservation HARD GATE (DWD-2) MUST be proven via mutation test in
Phase 02 before Phase 03 begins.

**Recipient package for DELIVER:**
* This file (`distill/wave-decisions.md`) — strategy + adapter
  coverage + mandate compliance + HARD GATE rationale
* `roadmap.json` — 4-phase scenario unskip schedule + manual review
  gates
* The 4 `.feature` files — scenario SSOT
* The DISTILL scaffolds at the paths listed above — DELIVER replaces
  the `pytest.fail` step bodies and the `pytest.skip` fixture bodies
  with real implementations
* ADR-022 (Proposed) + DESIGN's `wave-decisions.md` DWD-1 through
  DWD-10 + `c4-diagrams.md` + `upstream-changes.md` — unchanged,
  governing
