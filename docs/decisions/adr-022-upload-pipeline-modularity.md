<!-- DES-ENFORCEMENT : exempt -->
# ADR-022: Extract `UploadPluginDispatcher` and unify pipeline output on `MultiProcessingResult`

**Status:** Proposed
**Date:** 2026-05-10
**Originating wave:** DESIGN (entered directly per CLAUDE.md brownfield routing; user-initiated proactive modularity refactor)
**Bead:** TBD (assigned at DELIVER kickoff)
**Companion artifacts:**
- DESIGN proposal: `docs/feature/refactor-upload-pipeline-modularity/design/design.md`
- C4 diagrams: `docs/feature/refactor-upload-pipeline-modularity/design/c4-diagrams.md`
- Wave decisions: `docs/feature/refactor-upload-pipeline-modularity/design/wave-decisions.md`
- Upstream-changes record: `docs/feature/refactor-upload-pipeline-modularity/design/upstream-changes.md`
- Source signal: User-initiated; the hotspot review (`docs/research/tech-debt-hotspot-review.md` Finding 6) classified the file as healthy ("exemplifies good use-case structure"); the user disagrees on **forward-looking** modularity grounds.

## Context and problem statement

`backend/app/use_cases/dataset/create_dataset_from_upload.py` (174 LOC, 18 commits) braids three responsibilities the user has flagged as separable:

1. **Plugin dispatch (lines 79–104).** Five concerns inlined: registry presence guard; plugin lookup precedence (`get_by_name` then `get_for_filename`); `asyncio.to_thread` thread-offload + 120s timeout; `_converted_content` ducktype side-channel persistence (HL7v2→FHIR); no-registry CSV fallback. None mockable in isolation.

2. **Two divergent terminal blocks (lines 106–139 multi vs 141–158 single).** Both call `_create_single_dataset` per dataset, both call `mark_processed`, both call `_emit_sync_events`. They diverge in **one observable**: multi calls `outbox_repo.update_payload(upload_id, {"dataset_ids": [...], "dataset_id": first_id})`; single does not update the outbox payload at all. This is a silent behaviour asymmetry pinned by `test_multi_dataset_persists_dataset_ids_and_first_id_in_outbox_payload`.

3. **Pipeline orchestration (`_pipeline/ingestion.py`).** Already healthy; not in scope for this refactor.

The hotspot reviewer's classification — "no debt found" — is correct on a *static* lens (the file is well-tested, decorator stack honored, decomposition begun). The user's lens is *forward-looking*: any future plugin-protocol enhancement (async `process()`, structured `ConversionArtifact`, choices re-prompt) re-touches the use-case body rather than an adapter, accreting more inlined branches.

CLAUDE.md routes "refactors with cause known" to DESIGN entry. The cause here is **forward-looking modularity** rather than production debt; entry is justified, scope is small.

The constraint context:
- **Behaviour preservation is non-negotiable** (task brief). The asymmetric outbox-payload behaviour and the latent `HTTPController.post_dataset` multi-dataset envelope mishandling are preserved as-is, **even where the refactor surfaces them as smells**. Aligning them is out of scope; this ADR captures both as follow-ups.
- Two parallel DESIGN dispatches are running. Zero file overlap (DWD-9).
- Phase 2 dbt-test-validation surface is fenced.

## Decision drivers

- **Maintainability — modularity (ISO 25010 §7).** Use-case body collapses from ~110 LOC of orchestration + branching to ~45 LOC of linear pipeline. Plugin-dispatch knowledge isolated in one class.
- **Maintainability — testability.** Use-case tests can inject a dispatcher stub instead of building a `PluginRegistry` + S3 stubber for plugin-precedence concerns. Dispatcher unit tests cover plugin selection in isolation (no S3 stubber).
- **Maintainability — analyzability.** Single linear flow with one terminal block (guarded for the asymmetry) replaces an `if isinstance(result, MultiProcessingResult)` branch.
- **Behaviour preservation.** The 15 existing tests in `test_create_dataset_from_upload.py` (6 base + 4 plugin + 5 characterization) stay green byte-for-byte. The outbox payload asymmetry stays observable.
- **Protocol stability.** The `FileFormatPlugin` Protocol is not modified. The four real plugins (CSV, Excel, HL7v2, FHIR) work without any plugin-side change. The `_converted_content` ducktype remains an out-of-Protocol attribute; promoting it is a separate, future feature.
- **Earned Trust (Principle 12).** No new substrate dependency. The dispatcher is a use-case-internal coordinator, not a driven adapter, so it does not carry a `probe()` (DWD-8). The architectural-enforcement rule (DWD-7) catches the failure mode of "someone adds a substrate dependency to the dispatcher later" by forcing a future ADR to amend DWD-8.
- **Architectural enforcement (Principle 11).** Single-layer (`pytest-archon`) import-graph rule prevents regression of plugin-dispatch encapsulation. Mirrors ADR-020's pattern; multi-layer pattern (ADR-019) is overkill here because the constraint is purely import-graph.
- **CLAUDE.md constraints honored.** `@handle_returns` + `@with_repositories` + `RepositoryContainer` decorator stack preserved. Result-monad return-type union (`Result[Dataset | list[Dataset], str]`) preserved on the external use-case API.

## Considered options

### α — `UploadPluginDispatcher` class + internal `MultiProcessingResult` canonicalization. **Chosen.**

A new class `UploadPluginDispatcher` (under `_pipeline/plugin_dispatch.py`) owns plugin lookup, threading + timeout, `_converted_content` side-channel persistence, and the no-registry CSV fallback. The dispatcher always returns `MultiProcessingResult`; single-result plugins are wrapped at the dispatcher boundary. The use-case body becomes a single linear loop over `result.results`, eliminating the `isinstance(result, MultiProcessingResult)` branch.

External use-case return shape preserved: a one-element list is unwrapped back to a `Dataset` before returning; multi-element list stays a list. `MultiProcessingResult.__post_init__` validator relaxed: `r.name is None` check applies only when `len(self.results) > 1` (constraint-weakening; CSV fallback's nameless `ProcessingResult` becomes legal as a degenerate single).

Outbox payload asymmetry preserved verbatim via explicit `if len(results) > 1` guard. A new absence-assertion characterization test pins "single-result path does NOT call `outbox_repo.update_payload`" — closes the silent-behaviour gap and makes the asymmetry observable at the test layer.

**Pros:** matches user's stated intent; addresses both halves (plugin-dispatch isolation AND single/multi unification); test mock surface shrinks; future plugin-protocol changes touch the dispatcher only; no test rewrites required (existing 15 stay green byte-for-byte).

**Cons:** adds one class + one module (~80 LOC); validator relaxation is a touch on a Protocol-adjacent type (mitigated: constraint-weakening, no caller depends on strict form); `_converted_content` ducktype persists (mitigated: encapsulated inside dispatcher, captured as follow-up).

### β — Callable-based dispatch + tagged-union result shape

A free function `dispatch_plugin(...) -> SingleResult | MultiResult` (PEP 604 union, exhaustively `match`-ed downstream). No class.

**Rejected.** The use case still has two terminal `match`-arm branches — exactly what the user asked to eliminate via the "single is degenerate multi" reframing. β re-asserts the divergence the user wants collapsed. Stateful dispatcher concerns (120s timeout, side-channel persistence) re-emerge as a 7-parameter function signature; that *is* a class with state hidden. Test mock surface unchanged.

### γ — Minimum-touch helper extraction

Pull lines 79–104 into `_resolve_and_invoke_plugin(...)`. Keep both terminal branches. Keep the union return type.

**Rejected.** Smallest possible change but addresses concern (1) only; ignores concern (2) entirely. The user's reframing ("single is degenerate multi") is the higher-leverage half of the intent — ignoring it means re-doing this work later.

### δ — Promote `_converted_content` to first-class `ConversionArtifact` field on `ProcessingResult`

Modify the `FileFormatPlugin` Protocol so `process()` returns `(ProcessingResult | MultiProcessingResult, ConversionArtifact | None)` or a richer wrapper.

**Rejected** for this feature. Touches all four real plugins (CsvPlugin, ExcelPlugin, FhirPlugin, Hl7v2Plugin) and the integration tests; expands blast radius substantially. The protocol change is **valuable** but is a separate, structural plugin-protocol change. Captured as a follow-up note in this ADR.

## Decision outcome

**Option α — `UploadPluginDispatcher` class + internal `MultiProcessingResult` canonicalization with validator relaxation and explicit asymmetry guard.**

### Mechanism

**Single PR (Mikado-ordered, 7 steps):**

1. **Step 0** — Confirm all 15 existing tests in `test_create_dataset_from_upload.py` pass against unrefactored code.
2. **Step 1** — Add `UploadPluginDispatcher` skeleton + ~5 dispatcher unit tests RED.
3. **Step 2** — Implement dispatcher GREEN. Use case untouched.
4. **Step 3** — Relax `MultiProcessingResult.__post_init__` (one-line conditional). Add negative test.
5. **Step 4** — Refactor use case: replace inline plugin-dispatch with delegation; replace `isinstance` branch with linear loop; add `if len(results) > 1` guard for outbox payload. All 15 + new tests green.
6. **Step 5** — Add absence-assertion characterization test pinning "single-result path does NOT call `outbox_repo.update_payload`".
7. **Step 6** — Add `pytest-archon` rule (DWD-7); confirm passes.

Each step ships green; each is independently revertable. Iron Rule respected: no existing test is modified to make the refactor pass.

### Architectural enforcement (Principle 11)

A `pytest-archon` test under `backend/tests/architecture/` declares:

> `app.use_cases.dataset.create_dataset_from_upload` MUST NOT directly import `app.plugins.PluginRegistry`, `app.plugins.protocol.FileFormatPlugin`, or `app.utils.csv_parser`. The only allowed import path for plugin-dispatch concerns is via `app.use_cases.dataset._pipeline.plugin_dispatch`.

Single-layer enforcement is sufficient — the constraint is purely import-graph (mirrors ADR-020's pattern). The multi-layer pattern (ADR-019: subtype + structural + behavioural) does not apply here because: subtype layer requires a Protocol, which the dispatcher does not have (it is a concrete internal class); behavioural layer requires a substrate dependency that lies, which the dispatcher does not have.

### Earned-Trust contract (Principle 12)

No probe required. The dispatcher is a use-case-internal coordinator, not a driven adapter. Its dependencies (`pandas`, `io.BytesIO`, `asyncio.to_thread`, `LakeRepository`, `OutboxRepository`, `PluginRegistry`, `csv_parser.parse_and_clean_csv`) are pure in-process Python or already covered by other components' contracts. There is no substrate that can lie.

The architectural-enforcement rule (above) handles the long-tail risk of someone adding a substrate dependency to the dispatcher later — at that point a probe would become required, and a future ADR would amend this decision. Captured in DWD-8.

### Behaviour preservation guarantees

- All 15 existing tests stay green byte-for-byte. **No assertion changes; no fixture changes.**
- External use-case return shape `Result[Dataset | list[Dataset], str]` preserved; controller untouched.
- Outbox payload asymmetry preserved (multi writes `dataset_ids`/`dataset_id`; single does not), now made observable by a new absence-assertion test.
- Plugin lookup precedence (`get_by_name` then `get_for_filename`) preserved verbatim, pinned by `test_plugin_lookup_prefers_get_by_name_over_filename_match`.
- `_converted_content` ducktype access (HL7v2→FHIR side channel) preserved verbatim, pinned by `test_converted_storage_path_persisted_in_outbox`.
- Partial-failure semantics in multi-dataset writes preserved verbatim (the leaky-tx behaviour pinned by `test_multi_dataset_partial_failure_returns_failure`); fixing it is out of scope.
- 120s timeout preserved verbatim; dispatcher accepts a `timeout` constructor parameter for future overridability but no caller currently overrides it.

## Consequences

### Positive

- Plugin-dispatch knowledge isolated. Future plugin-protocol changes touch the dispatcher only.
- Use-case body shrinks from ~174 LOC to ~110 LOC; linear flow with one terminal block.
- Test mock surface for use-case tests reduces (dispatcher stubbable in isolation).
- Architectural-enforcement rule prevents regression at CI time.
- Outbox payload asymmetry — previously a silent runtime behaviour — becomes observable at the test layer for the first time.

### Negative / accepted trade-offs

- One new class + one new module (~80 LOC). Small surface increase justified by encapsulation gain.
- `MultiProcessingResult.__post_init__` validator weakens. Mitigated: constraint-weakening cannot break currently-passing inputs; new negative test pins the property for the case it does apply (multi-result mode requires names).
- The `_converted_content` ducktype persists (now inside the dispatcher rather than the use case). Captured as a follow-up; promoting it is a separate plugin-protocol change.

### Operational

- No new runtime dependency. No new external integration. No DEVOPS contract-test annotation needed.
- No deployment-topology change. ADR-016 5-service compose stack untouched.
- No database migration; `OutboxRecord` and `Dataset` ORM records unchanged.
- No new FastAPI lifespan invariant; no probe.

### Earned-Trust note

This refactor introduces no new substrate dependency. ADR-019's probe contract carries forward unchanged. The `pytest-archon` import-constraint rule is the layer-appropriate "wire-then-probe-then-use" — an attempted re-inlining of plugin dispatch into the use-case body fails at CI, not silently in production.

## Cross-decision composition (intentional)

- **ADR-022 ↔ ADR-019** — Independent. Phase 2 dbt-test-validation surface fully fenced (DWD-9). Reuses ADR-019's `pytest-archon` enforcement pattern.
- **ADR-022 ↔ ADR-020** — Independent. ADR-020 splits `MetadataRepository` (persistence layer); ADR-022 refactors a use case (orchestration layer). Zero file overlap. Use case continues to consume `repositories.metadata` via the facade Phase A of ADR-020 preserves; transition to per-aggregate `repositories.datasets` is a Phase B candidate, not part of this feature.
- **ADR-022 ↔ ADR-021** — Independent. ADR-021 extracts query execution from `Dataset` model; ADR-022 refactors a use case that calls `Dataset(...)` constructor only. Zero file overlap. Merge order unconstrained.
- **ADR-022 ↔ ADR-007 (Ibis as SQL generator)** — Orthogonal. The use case does not generate SQL; it persists DataFrames as parquet via `LakeRepository`.

## Follow-up notes (NOT this feature)

1. **Promote `_converted_content` to first-class `ConversionArtifact` field on `ProcessingResult`.** Touches all four real plugins + integration tests. Future feature.
2. **Align outbox-payload asymmetry** (write `dataset_ids` for single uploads too). Behaviour-changing; would update the absence-assertion characterization test correspondingly. Future feature.
3. **Fix `HTTPController.post_dataset` multi-dataset envelope.** `serialize(list_of_datasets)['id']` raises `TypeError` for multi-dataset uploads today. Coordinated change with the controller, the use-case external return type (`Result[list[Dataset], str]` always), and frontend consumption. Future feature.
4. **Dispatcher → adapter promotion.** If a future change adds a substrate dependency to the dispatcher (vendor SDK, network client, etc.), DWD-8 must be amended and a `probe()` added.

## Confirmation

After DELIVER:

- All 15 existing tests in `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py` pass byte-for-byte.
- One new absence-assertion test (DWD-2) pins "single-result path does NOT call `outbox_repo.update_payload`".
- ~5 dispatcher unit tests in `backend/tests/use_cases/dataset/test_plugin_dispatch.py` cover plugin lookup precedence, CSV fallback, `_converted_content` side channel, 120s timeout firing, and single-result wrapping shape.
- `pytest-archon` rule in `backend/tests/architecture/` (or equivalent) enforces the import-graph constraint and passes.
- `grep -n "isinstance(result, MultiProcessingResult)" backend/app/use_cases/dataset/create_dataset_from_upload.py` returns nothing.
- `grep -n "PluginRegistry\|FileFormatPlugin\|csv_parser" backend/app/use_cases/dataset/create_dataset_from_upload.py` returns nothing (the architectural rule's runtime check).
- `mypy backend/app` passes.
- The four real plugins (CsvPlugin, ExcelPlugin, FhirPlugin, Hl7v2Plugin) are unchanged.

## Related

- ADR-005 — Frozen dataclasses over Pydantic for domain models. Preserved.
- ADR-006 — Result monad over exceptions. Preserved (`Result[Dataset | list[Dataset], str]`).
- ADR-016 — 5-service compose stack. Untouched.
- ADR-019 — Eject-then-test validation. Surface-fenced; no overlap.
- ADR-020 — Metadata-repository split (Proposed, parallel). Independent layer.
- ADR-021 — Extract dataset query port (Proposed, parallel). Independent layer.
- `docs/research/tech-debt-hotspot-review.md` Finding 6 — Reviewer's "no debt found" classification; user's forward-looking dissent is the source signal.
- `backend/app/use_cases/dataset/create_dataset_from_upload.py` — file being refactored.
- `backend/app/plugins/protocol.py` — one-line validator relaxation target.
- `backend/app/use_cases/dataset/_pipeline/plugin_dispatch.py` — new module.
- `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py` — Iron-Rule-bound characterization tests.
