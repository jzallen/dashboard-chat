<!-- DES-ENFORCEMENT : exempt -->
# Wave Decisions — Refactor Upload Pipeline Modularity (DESIGN)

DWDs are durable design-wave decisions, ratified at design time and binding on downstream waves (DISTILL → DELIVER) unless explicitly superseded.

---

## DWD-1 — Option α (user's intent): `UploadPluginDispatcher` class + internal `MultiProcessingResult` canonicalization

**Decision.** Plugin dispatch becomes a class (`UploadPluginDispatcher`) under `backend/app/use_cases/dataset/_pipeline/plugin_dispatch.py`. The dispatcher always returns `MultiProcessingResult`; single-result plugins and the CSV fallback are wrapped at the dispatcher boundary. The use-case body becomes a single linear loop over `result.results`, eliminating the `isinstance(result, MultiProcessingResult)` branch.

**Binding effect on DISTILL.** Acceptance tests target two seams:
1. The use case end-to-end (existing 15 tests stay green byte-for-byte; ~5 dispatcher unit tests added).
2. The dispatcher in isolation: plugin lookup precedence; no-registry CSV fallback; `_converted_content` side-channel persistence; 120s timeout firing; single-result wrapping shape.

**Binding effect on DELIVER.** New module `_pipeline/plugin_dispatch.py` (~80 LOC). Use-case file shrinks from ~174 LOC to ~110 LOC. Refactor is Mikado-ordered (see DWD-6).

---

## DWD-2 — Outbox payload asymmetry is preserved verbatim, NOT aligned

**Decision.** The current behaviour — multi-dataset path calls `outbox_repo.update_payload(upload_id, {"dataset_ids": [...], "dataset_id": first_id})`, single-dataset path does NOT — is **explicitly preserved** by guarding the payload-update with `if len(results) > 1` in the unified terminal block.

**Rationale.** The task brief says behaviour preservation is non-negotiable. The asymmetry IS a smell, but "fix" via this refactor would change observable system behaviour (single-dataset uploads would gain a payload field they don't have today). That is out of scope. Aligning the two paths is a separate, future feature.

**Binding effect on DISTILL.** A NEW characterization test MUST be added pinning "single-result path does NOT call `outbox_repo.update_payload`" — an absence assertion via a recording fake on `OutboxRepository.update_payload`. This closes the silent-behaviour gap and makes the asymmetry observable at the test layer for the first time.

**Binding effect on DELIVER.** The `if len(results) > 1` guard MUST appear explicitly in code, not as a comment, not as a "natural" outcome. The intent must be readable.

**Forward note (non-binding, NOT this feature).** A future feature may align the two paths (write `dataset_ids` for single uploads too). That feature would supersede this DWD and update the characterization test correspondingly. Captured in ADR-022.

---

## DWD-3 — `MultiProcessingResult.__post_init__` validator relaxation

**Decision.** Relax `MultiProcessingResult.__post_init__` (`app/plugins/protocol.py`) so that the `r.name is None` check applies only when `len(self.results) > 1`. The non-empty-list check stays. This permits the single-result-as-degenerate-multi reframing while preserving the safety property for genuine multi-result plugins.

**Rationale.** The CSV fallback today constructs `ProcessingResult(df=df)` with `name=None`. Wrapping it in `MultiProcessingResult([fallback])` under the strict validator would raise. The relaxation is constraint-weakening and cannot break any currently-passing input.

**Rejected alternative.** Have the dispatcher supply `name="New Dataset"` at the wrap site for the CSV fallback. Rejected because it leaks magic-string knowledge from `_pipeline/ingestion.py:create_dataset_record` (which already defaults `name or "New Dataset"`) into the dispatcher. Single source of default truth.

**Binding effect on DELIVER.** The `protocol.py` change is a one-line conditional. A new negative test MUST be added pinning "MultiProcessingResult with two unnamed results raises ValueError" — preserves the safety property for the case it actually applies to.

---

## DWD-4 — `FileFormatPlugin` Protocol stability

**Decision.** The `FileFormatPlugin` Protocol is **NOT** modified by this refactor. The `_converted_content` ducktype (HL7v2→FHIR side channel) remains an out-of-Protocol attribute, accessed via `getattr(plugin, "_converted_content", None)` inside the dispatcher.

**Rationale.** Promoting `_converted_content` to a first-class field on `ProcessingResult` (or a new `ConversionArtifact` type) is a separate, structural plugin-protocol change. It would touch all four real plugins (CsvPlugin, ExcelPlugin, FhirPlugin, Hl7v2Plugin) and the integration tests, expanding blast radius. This refactor is a use-case-side modularity refactor; protocol changes are out of scope.

**Binding effect on DELIVER.** The dispatcher accesses `_converted_content` exactly the way the current use-case body does. Documented in a module-level docstring.

**Forward note (non-binding).** ADR-022 captures the `_converted_content`-promotion follow-up.

---

## DWD-5 — External use-case return shape preserved (`Result[Dataset | list[Dataset], str]`)

**Decision.** Despite internal canonicalization on `MultiProcessingResult`, the use-case external return type stays `Result[Dataset | list[Dataset], str]`. The use case unwraps a one-element list back to a single `Dataset` before returning; multi-element list stays a list.

**Rationale.** Behaviour preservation is non-negotiable. Changing the external return type to `Result[list[Dataset], str]` would force a controller change (`HTTPController.post_dataset` expects to call `serialize(data)['id']`), which is out of scope. The latent HTTP-envelope mishandling for multi-dataset uploads is a separate bug that pre-dates this refactor and is not addressed here.

**Binding effect on DISTILL.** No AC changes for the use-case external contract. All 15 existing tests stay byte-for-byte (`case Success(dataset)` for single; `case Success([d1, d2])` for multi).

**Binding effect on DELIVER.** Use-case signature unchanged. Controller untouched. The unification is purely internal pipeline shape.

**Forward note (non-binding).** ADR-022 captures the controller-side multi-dataset envelope as a follow-up. Aligning the use-case return type to `list[Dataset]` always would be a coordinated change touching the use case + controller + frontend (single-dataset POST response shape). Not this feature.

---

## DWD-6 — Mikado-style migration order

**Decision.** DELIVER follows this order, strictly:

1. **Step 0 — Baseline.** Confirm all 15 existing tests in `test_create_dataset_from_upload.py` pass against unrefactored code. If any is red, stop; the refactor cannot start from a yellow baseline.
2. **Step 1 — Dispatcher RED.** Add `UploadPluginDispatcher` skeleton + ~5 dispatcher unit tests (failing, against an unimplemented dispatcher).
3. **Step 2 — Dispatcher GREEN.** Implement the dispatcher; the new tests turn green. The use case is **untouched** at this point; dispatcher is dead code from the use case's perspective.
4. **Step 3 — Validator relaxation.** Apply the one-line change to `MultiProcessingResult.__post_init__`. Add the negative test (DWD-3). Run full test suite — all 15 use-case tests + new dispatcher tests + new validator test pass.
5. **Step 4 — Use-case refactor.** Replace the inline plugin-dispatch block with a delegation to the dispatcher. Replace the `isinstance(result, MultiProcessingResult)` branch with a single linear loop. Add the `if len(results) > 1` guard for the outbox payload (preserving DWD-2). Run all 15 + new tests — all green.
6. **Step 5 — Add absence-assertion characterization test.** Per DWD-2: pin "single-result path does NOT call `outbox_repo.update_payload`". This step **could** also live before Step 4 (as a pre-existing pin), but placing it after lets it serve as a confirmation that the refactor preserved the asymmetry intentionally.
7. **Step 6 — Architectural-enforcement rule.** Add the `pytest-archon` rule (per DWD-7) and confirm it passes.

**Rationale.** Each step ships green. Each step is independently revertable. Iron Rule respected: no test is modified to make the refactor pass; the refactor must preserve all 15 existing tests verbatim.

**Binding effect on DELIVER.** Software-crafter follows the seven steps in order. Deviation requires returning to DESIGN with a superseding DWD.

---

## DWD-7 — Architectural enforcement: `pytest-archon` import-graph rule

**Decision.** A `pytest-archon` rule is added under `backend/tests/architecture/` declaring:

> `app.use_cases.dataset.create_dataset_from_upload` MUST NOT directly import:
> - `app.plugins.PluginRegistry`
> - `app.plugins.protocol.FileFormatPlugin`
> - `app.utils.csv_parser`
>
> The only allowed import path for plugin-dispatch concerns is via `app.use_cases.dataset._pipeline.plugin_dispatch`.

**Rationale.** Without this rule, a future change could re-inline plugin lookup or the CSV fallback into the use-case body, regressing the encapsulation. The rule prevents regression at CI time. Single-layer enforcement (subtype/structural/behavioural per ADR-019) is **sufficient** because the constraint is purely import-graph — the same shape ADR-020 uses for its facade-removal rule.

**Rejected alternative.** Three-layer enforcement (subtype + structural + behavioural). Rejected because:
- Subtype layer (`mypy` + `Protocol`) does not apply — there is no Protocol on the dispatcher; it is a concrete class with a single, internal-to-this-feature API.
- Behavioural layer (CI gold-test under fault injection) does not apply — the dispatcher has no substrate dependency that lies. `asyncio.to_thread` is CPython-stable; the 120s timeout is a Python-level invariant.

**Binding effect on DELIVER.** Step 6 adds this rule and confirms it passes against the refactored code.

**Binding effect on DISTILL.** AC for "architectural rule prevents re-inlining of plugin dispatch" is in scope.

---

## DWD-8 — Earned Trust: no new probe required

**Decision.** `UploadPluginDispatcher` does NOT require a `probe()` method, and the composition root (`HTTPController.post_dataset` → use case) does NOT need a "wire-then-probe-then-use" invariant added.

**Rationale.** Per Principle 12, probing is required for components with substrate dependencies that can lie (filesystem `fsync` no-op, vendor SDKs in flux, etc.). The dispatcher's dependencies are:
- `PluginRegistry` — pure in-process Python; cannot lie. Already covered by its own constructor invariants (duplicate-name/duplicate-extension errors at construction time).
- `LakeRepository` — already a port with its own contracts. Owned by another team-of-one's `probe()` discipline (per ADR-016 and ADR-019 conventions).
- `OutboxRepository` — same.
- `pandas` + `io.BytesIO` + `asyncio.to_thread` — standard library + a long-stable third party. No fault-injection scenarios documented.
- `app.utils.csv_parser.parse_and_clean_csv` — pure Python; cannot lie.

The dispatcher is a **use-case-internal coordinator**, not a driven adapter. No probe.

**Binding effect on DELIVER.** No `probe()` method on `UploadPluginDispatcher`. No lifespan-startup invariant change. No `health.startup.refused` event integration.

**Self-application check.** This DWD records the rejection rationale rather than silently omitting it. The architectural-enforcement rule (DWD-7) handles the long-tail risk of someone *adding* a substrate dependency to the dispatcher later — at that point a probe would become required, and a future DWD would amend this decision.

---

## DWD-9 — Surface fence: parallel work coordination

**Decision.** This DESIGN does NOT modify, propose changes to, or take dependencies on:
- `backend/app/repositories/metadata/repository.py` (owned by `refactor-metadata-repository-split`)
- `backend/app/models/dataset.py` (owned by `extract-dataset-query-port`)
- `backend/app/query_engine/` (new package created by `extract-dataset-query-port`)
- `backend/app/use_cases/project/_dbt/` (owned by Phase-2 `dbt-test-validation`)
- `backend/tests/integration/dataset_layer/eject/` (owned by Phase-2)
- `backend/tests/integration/dataset_layer/harness.py` (owned by Phase-2)

**Files this DESIGN owns (zero overlap with the above):**
- `backend/app/use_cases/dataset/create_dataset_from_upload.py` — refactor
- `backend/app/use_cases/dataset/_pipeline/plugin_dispatch.py` — new
- `backend/app/plugins/protocol.py` — one-line validator relaxation
- `backend/tests/use_cases/dataset/test_plugin_dispatch.py` — new
- `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py` — new absence-assertion test added; existing 15 tests untouched
- `backend/tests/architecture/test_dependency_rules.py` (or equivalent) — add the `pytest-archon` rule

**Binding effect on DELIVER.** Roadmap MUST NOT schedule any task that touches the fenced files. Merge order with the two parallel refactors is unconstrained — none of the three features touch the same files.

---

## DWD-10 — ADR numbering

**Decision.** This feature mints **ADR-022**, the next sequential after the highest-numbered ADR in the repo (ADR-021 — `extract-dataset-query-port`). ADR-020 is `metadata-repository-split` (parallel dispatch). The two sibling DESIGN-wave dispatches have already taken 020 and 021; 022 is the unambiguous next number.

**Binding effect on DELIVER.** ADR file is `docs/decisions/adr-022-upload-pipeline-modularity.md`. Status starts **Proposed**, transitions to **Accepted** when DELIVER ships and Atlas approves.
