<!-- DES-ENFORCEMENT : exempt -->
# Refactor Upload Pipeline Modularity — DESIGN

**Feature slug:** `refactor-upload-pipeline-modularity`
**Wave:** DESIGN (brownfield refactor — proactive, no production cause)
**Trigger:** User-initiated forward-looking modularity refactor. The hotspot review (`docs/research/tech-debt-hotspot-review.md` Finding 6) classified this file as healthy; the user disagrees on forward-looking modularity grounds and supplied two specific intents (plugin dispatch as its own class; single-upload as a degenerate `MultiProcessingResult`).
**Author:** Morgan (`nw-solution-architect`)
**Status:** Proposed — awaiting peer review (Atlas) → DISTILL
**Mode:** Propose (autonomous)
**Related ADR:** ADR-022 (Proposed)

> **Bar.** Behaviour preservation is **non-negotiable** per the task brief. Every existing test in `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py` (15 tests across 3 classes) stays green byte-for-byte. The asymmetric outbox-payload behaviour and the latent HTTP-controller union handling are explicitly **preserved as-is**, even where the refactor surfaces them as smells. Aligning them is **out of scope** for this feature; ADR-022 captures them as follow-ups.

---

## §0 Confirmation checklist

- [x] `create_dataset_from_upload.py` read end-to-end (174 LOC).
- [x] Plugin contract reviewed (`plugins/protocol.py`, `plugins/registry.py`, four real plugins).
- [x] Pipeline helpers reviewed (`_pipeline/ingestion.py`).
- [x] All 15 existing tests inventoried (`test_create_dataset_from_upload.py`: 6 base + 4 plugin + 5 characterization). Iron-Rule binding.
- [x] Call site mapped: only `HTTPController.post_dataset` (`dataset_controller.py:107`) consumes the use case directly.
- [x] Phase 2 surface untouched (no proposed change in `app/use_cases/project/_dbt/`, `tests/integration/dataset_layer/eject/`).
- [x] Sibling DESIGN dispatches untouched. `refactor-metadata-repository-split` owns `repositories/metadata/repository.py`; `extract-dataset-query-port` owns `models/dataset.py` + new `app/query_engine/`. **Zero file overlap** with this design.
- [x] ADR-022 selected — next sequential after ADR-021.

---

## §1 Problem statement

`create_dataset_from_upload.py` braids three responsibilities the user has identified as separable:

1. **Plugin dispatch (lines 79–104).** Five concerns inlined in the use-case body: registry presence guard, lookup precedence (`get_by_name` then `get_for_filename`), `asyncio.to_thread(plugin.process, ...)` under a 120s timeout, the `_converted_content` ducktype side-channel (HL7v2→FHIR), and the no-registry CSV fallback. None of these is independently mockable; tests must build a real `PluginRegistry` plus an S3 stubber to exercise any of it.

2. **Two divergent terminal blocks (lines 106–139 multi vs 141–158 single).** Both blocks call `_create_single_dataset` per dataset, both call `mark_processed`, both call `_emit_sync_events`. They diverge in a single observable: multi calls `outbox_repo.update_payload(upload_id, {"dataset_ids": [...], "dataset_id": first_id})`; single does **not** update the outbox payload at all. This is a **silent behaviour asymmetry** pinned by characterization test `test_multi_dataset_persists_dataset_ids_and_first_id_in_outbox_payload`. The asymmetry is a smell, but per the task brief it is not in scope to "fix"; behaviour preservation is the bar.

3. **Pipeline orchestration (`_pipeline/ingestion.py`).** Already healthy — the hotspot review correctly noted this. **Untouched** by this refactor.

Forward-looking weight: any future evolution of the plugin protocol (async `process()`, structured `ConversionArtifact`, choices-re-prompt) re-touches the use-case body rather than an adapter. The user wants a structural barrier between the use case and these concerns now, before more accretion.

---

## §2 Architectural options

### Option α — User's intent: `UploadPluginDispatcher` class + `MultiProcessingResult` as canonical pipeline output (preserves single-result-as-degenerate-case **internally**, while preserving today's **external** asymmetric behaviour)

Two structural moves, both additive:

1. **`UploadPluginDispatcher`** — new module `backend/app/use_cases/dataset/_pipeline/plugin_dispatch.py`. One class, one public method:

   ```
   class UploadPluginDispatcher:
       def __init__(self, registry: PluginRegistry | None,
                    lake_repo, outbox_repo,
                    timeout: float = 120.0) -> None: ...
       async def dispatch(self, event, raw_content: bytes,
                          choices: dict[str, str] | None
                          ) -> MultiProcessingResult: ...
   ```

   The class encapsulates: plugin lookup precedence, `asyncio.to_thread` + timeout, the `_converted_content` side-channel persistence, and the no-registry CSV fallback. The use case calls the dispatcher and gets back a single uniform shape.

2. **`MultiProcessingResult` as canonical internal pipeline output.** The dispatcher always returns `MultiProcessingResult`. Plugins that return `ProcessingResult` are wrapped at the dispatcher boundary as `MultiProcessingResult(results=[result])`. The CSV fallback wraps similarly. The use-case body becomes a single linear loop over `result.results`. **The `Result[Dataset | list[Dataset], str]` external return shape is preserved**: the use case unwraps a one-element list back to a `Dataset` (and a multi-element list stays a list) **before returning**, exactly as today. The unification is internal pipeline shape, not external API shape.

3. **Behavioural asymmetry preserved.** The terminal block guards the outbox payload-update with `if len(results) > 1` — preserving today's silent asymmetry exactly. Characterization test `test_multi_dataset_persists_dataset_ids_and_first_id_in_outbox_payload` and the implicit "single path does not update payload" check stay green byte-for-byte.

4. **Validator relaxation.** `MultiProcessingResult.__post_init__` currently requires every item to have a non-`None` `name`. The CSV fallback constructs `ProcessingResult(df=df)` (no name). Two viable shapes:

   - **α.a** — Relax the validator: allow `name=None` when `len(results) == 1`. Constraint-weakening; cannot break any current valid input.
   - **α.b** — Have the CSV fallback pass `name=None` and let the dispatcher leave the wrapper-name unset, but supply `"New Dataset"` at the wrap site. Stricter but adds magic-string knowledge to the dispatcher.

   **Selected: α.a.** Smaller surface change; honest about the contract (single-result mode does not require a name because the downstream default path handles it).

**Pros.**
- Plugin-dispatch knowledge isolated; future protocol changes touch the dispatcher only.
- Use-case body shrinks from ~110 LOC to ~45 LOC. Linear flow.
- `_converted_content` ducktype encapsulated; the use case never sees it.
- Test mock surface for the use case shrinks: tests can inject a dispatcher stub instead of a full `PluginRegistry` + S3 stubber. (Existing characterization tests retain real-`PluginRegistry` paths via the dispatcher's normal constructor — no change.)
- Single-path test cases stay `case Success(dataset)`; multi-path stays `case Success([d1, d2])`. **No test rewrites.**

**Cons.**
- Adds one class + one module (~80 LOC). Small surface increase.
- `MultiProcessingResult.__post_init__` weakens a constraint. Mitigated: grep confirms only `protocol.py` declares the constraint; all current callers construct it with names.
- The `_converted_content` ducktype lives **inside** the dispatcher rather than the use case. Slightly improves encapsulation, but the ducktype itself remains an out-of-Protocol attribute. Promoting it to a first-class `ConversionArtifact` field on `ProcessingResult` is **out of scope** (captured as ADR-022 follow-up).

### Option β — Callable-based dispatch + tagged-union result shape

A free function `dispatch_plugin(event, raw_content, choices, registry, lake_repo, outbox_repo) -> ProcessingOutput` where `ProcessingOutput = SingleResult | MultiResult` (PEP 604 union, exhaustively `match`-ed downstream). No class. The use-case loop becomes a `match` statement.

**Pros.**
- Functional shape; no class for stateless coordination.
- Tagged union is more honest that the two shapes are categorically different.
- Slightly less boilerplate than a class.

**Cons.**
- Use case still has two terminal `match`-arm branches — exactly what the user wants to eliminate via the "single is degenerate multi" reframing. β re-asserts the divergence the user asked to collapse.
- Stateful dispatcher concerns (120s timeout, side-channel persistence) re-emerge as 7-parameter function signature; that *is* a class with its state hidden.
- Test mock surface unchanged — tests still build a `PluginRegistry` because the function takes one as a parameter.

**Rejected** on user-intent-alignment grounds. β is *viable*, just measurably less aligned with the user's structural insight and not better on any other axis.

### Option γ — Minimum-touch helper extraction (status quo plus one helper)

Pull lines 79–104 into `_resolve_and_invoke_plugin(...)`. Keep both terminal branches. Keep the union return type.

**Pros.** Smallest possible diff. Trivially safe.

**Cons.** Addresses concern (1) only; ignores concern (2) entirely. The user's reframing is the higher-leverage half of the intent — ignoring it means re-doing this work later. Misses the structural insight.

**Rejected** on grounds that it solves only half the user's intent.

---

## §3 Reuse analysis

| Existing artefact | Disposition | Rationale |
|---|---|---|
| `_create_single_dataset` (helper at top of use-case file) | **REUSE AS-IS** | Already takes a single `ProcessingResult`; the canonical loop calls it once per result. |
| `_emit_sync_events` (helper at bottom) | **REUSE AS-IS** | Already takes `list[Dataset]`; works for length 1 or N. |
| `_pipeline/ingestion.py` (5 functions) | **REUSE AS-IS** | Pipeline helpers untouched. |
| `app.plugins.PluginRegistry` | **REUSE AS-IS** | Dispatcher accepts the registry as a constructor dependency. |
| `app.plugins.protocol.MultiProcessingResult` | **EXTEND** — relax `__post_init__` to allow `name=None` when `len(results) == 1` | Required by the unify-on-`MultiProcessingResult` pattern + CSV fallback. Constraint-weakening. |
| `app.plugins.protocol.ProcessingResult` | **REUSE AS-IS** | Unchanged. |
| `FileFormatPlugin` Protocol | **REUSE AS-IS** | The `_converted_content` ducktype stays out-of-Protocol (intentional — promoting it is a future feature). |
| `app.utils.csv_parser.parse_and_clean_csv` | **REUSE AS-IS** | Still the no-registry fallback path; relocates inside the dispatcher. |
| `OutboxRepository.update_payload` / `mark_processed` | **REUSE AS-IS** | Same calls; behind a guarded terminal block that preserves today's asymmetry. |
| `HTTPController.post_dataset` (`dataset_controller.py:107`) | **NO CHANGE** | The latent multi-dataset HTTP-envelope mishandling is preserved as-is per the brief's behaviour-preservation constraint. ADR-022 captures it as a follow-up. |
| `test_create_dataset_from_upload.py` (15 tests) | **PIN VERBATIM** — Iron-Rule binding | All 15 stay green byte-for-byte. New dispatcher unit tests added in DISTILL exercise the dispatcher in isolation. |

**No new external dependency. No new runtime substrate.**

---

## §4 Recommendation

**Adopt Option α (sub-shape α.a) — `UploadPluginDispatcher` + internal `MultiProcessingResult` canonicalization with validator relaxation.**

This **is** the user's stated intent. It is also the strongest option on three independent axes:

1. **Structural honesty.** "Single is a degenerate multi" is a true claim about uploads; β lies about it via tagged union, γ ignores it. Internalizing the canonicalization keeps the external API stable while making the internal flow linear.
2. **Test mock surface.** Use-case tests can inject a dispatcher stub; existing characterization tests keep working through the real-`PluginRegistry` path. No test rewrites.
3. **Forward-looking.** Future plugin-protocol changes land inside the dispatcher class; the use case stays a thin orchestrator.

**Engagement with α's cons:**

- **One new class.** Honestly evaluated: yes, but the alternative (β's free function) carries equivalent state in a 7-parameter signature. The class is the honest shape.
- **Validator relaxation.** Honestly evaluated: yes, but it weakens a constraint, and grep confirms zero callers depend on the strict form.
- **The `_converted_content` ducktype persists.** Yes — but it persists inside the dispatcher rather than the use case, which is a strict improvement. Promoting it to a first-class field is a separate, future feature.

**Effort: M.** New module ~80 LOC; use-case file shrinks from ~174 LOC to ~110 LOC; one-line validator change in `protocol.py`; ~5 new dispatcher unit tests in DISTILL.

**Layout:**

```
backend/app/use_cases/dataset/_pipeline/
├── __init__.py             # re-exports unchanged
├── ingestion.py            # unchanged
└── plugin_dispatch.py      # NEW — UploadPluginDispatcher
```

The dispatcher lives inside `_pipeline/` because it is part of the upload→dataset pipeline, not a free-standing plugin module. `app/plugins/` continues to own the *plugin contract*; `_pipeline/plugin_dispatch.py` owns *use-case-side dispatch coordination*.

---

## §5 Migration / call-site impact

**Single in-tree caller of the use case:** `HTTPController.post_dataset` (`dataset_controller.py:107`). Use-case external signature is unchanged: `Result[Dataset | list[Dataset], str]`. Controller is **not modified**.

**Internal dispatcher wiring:** the use case constructs the dispatcher inline:

```
dispatcher = UploadPluginDispatcher(
    registry=plugin_registry,
    lake_repo=lake_repo,
    outbox_repo=outbox_repo,
)
multi_result = await dispatcher.dispatch(file_received_event, raw_content, choices)
```

The dispatcher is a per-call coordinator, not a long-lived adapter — it is **not** registered with `RepositoryContainer`. (Earned-Trust note in §6 explains why no `probe()` is required.)

**Test impact (DELIVER scope; not executed here):**

- All 15 existing tests in `test_create_dataset_from_upload.py` stay green byte-for-byte. **No assertion changes; no fixture changes.**
- DISTILL adds ~5 dispatcher unit tests under a new `test_plugin_dispatch.py`: plugin lookup precedence in isolation; no-registry CSV fallback; `_converted_content` side-channel persistence; 120s timeout firing; single-result wrapping shape.

**Migration order (Mikado-style; DELIVER plan):**

1. Add `UploadPluginDispatcher` skeleton + unit tests RED.
2. Implement dispatcher GREEN.
3. Relax `MultiProcessingResult.__post_init__` (one-line; covered by a new negative test).
4. Refactor use case to delegate to dispatcher; verify all 15 existing tests stay green.
5. No deprecation shim needed — external signature unchanged.

---

## §6 Quality attributes (ISO 25010)

| Attribute | How addressed |
|---|---|
| **Maintainability / Modularity** | Plugin-dispatch logic isolated in one class with a narrow public surface. Future protocol changes touch the dispatcher only. |
| **Maintainability / Testability** | Dispatcher mockable in isolation (no S3 stubber needed for plugin-precedence tests). Use-case body becomes a single linear loop, simpler to read. |
| **Maintainability / Analyzability** | Use-case body shrinks ~30%. Linear flow with one terminal block (guarded for the asymmetry, but no `if isinstance(...)` branch). |
| **Reliability / Correctness** | Behaviour preservation is the bar. Iron-Rule-bound characterization tests are the proof. Outbox payload asymmetry preserved via `len(results) > 1` guard. Partial-failure semantics in multi-dataset writes (the leaky-tx behaviour pinned by `test_multi_dataset_partial_failure_returns_failure`) preserved verbatim. |
| **Functional Suitability / Correctness** | Validator relaxation widens accepted inputs without changing existing-valid-input semantics. Non-breaking. |
| **Performance Efficiency** | Zero hot-path impact. One method-call indirection; same number of loop iterations; no new I/O. |
| **Earned Trust (Principle 12)** | No new substrate dependency. The dispatcher does **not** require a `probe()` because it is a use-case-internal coordinator, not a driven adapter — its dependencies (`pandas`, `io.BytesIO`, `asyncio.to_thread`, `LakeRepository`, `OutboxRepository`, `PluginRegistry`) are already covered by their owners' contracts. The plugin-dispatch substrate (CPython `asyncio.to_thread` + a 120s timeout) was already trusted by the existing use case; this refactor relocates it without changing the trust boundary. |
| **Architectural enforcement (Principle 11)** | `pytest-archon` rule: `app.use_cases.dataset.create_dataset_from_upload` MUST NOT directly import `app.plugins.PluginRegistry` or `app.utils.csv_parser` after the refactor — the only allowed import path is via `_pipeline.plugin_dispatch`. Prevents regression of the plugin-dispatch encapsulation. (Single-layer suffices: the constraint is purely import-graph, like ADR-020's pattern; per ADR-019 §"three orthogonal layers", the multi-layer pattern applies only when behavioural fault-injection is in scope, which here it is not.) |

---

## §7 Risks + mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Outbox payload asymmetry inadvertently aligned** during unification (single path starts writing `dataset_ids`/`dataset_id`). Characterization test `test_multi_dataset_persists_dataset_ids_and_first_id_in_outbox_payload` would still pass; the **silent** asymmetry on the single path would change unobserved. | **Critical** | Terminal block guards payload-update with explicit `if len(results) > 1`. The DISTILL phase MUST add a new characterization test pinning "single-result path does NOT call `outbox_repo.update_payload`" (an absence assertion via a recording fake) — this closes the silent-behaviour gap and makes the asymmetry observable. ADR-022 captures alignment as a follow-up feature. |
| **`MultiProcessingResult.__post_init__` validator change** breaks an out-of-tree caller relying on strict-form. | Low | Repo-wide grep: only `protocol.py` declares the constraint. All in-tree callers (test mocks, real plugins) construct it with names. Constraint-weakening cannot break currently-passing inputs. Captured as a deliberate change in ADR-022. |
| **Plugin-protocol stability** — user concern. The `FileFormatPlugin` Protocol is **not** modified. The four real plugins (CSV/Excel/HL7v2/FHIR) work without any plugin-side change. | Low | Grep-confirmed. Dispatcher consumes the existing Protocol verbatim. |
| **`_converted_content` ducktype** (HL7v2→FHIR side channel) misfires if a future plugin reuses the attribute name for an unrelated purpose. | Medium | Dispatcher documents the ducktype in a module docstring as the explicit current contract. ADR-022 captures the follow-up: promote it to a first-class `ConversionArtifact` on `ProcessingResult`. |
| **120s timeout** moves into the dispatcher. No external override path exists today and none is added by this refactor. | Low | Dispatcher accepts a `timeout: float = 120.0` constructor parameter for future overridability. No caller currently overrides it. |
| **CSV fallback path** moves into the dispatcher and continues lazy-import of `app.utils.csv_parser`. | Low | Mirrors current behaviour. New dispatcher unit test pins it. |
| **Iron-Rule violation** during refactor. The 5 characterization tests in `TestCreateDatasetFromUploadCharacterization` were specifically added to bind current behaviour (bead `dc-89fx`). | High (if violated) / N/A (if respected) | DELIVER kickoff Step 0: confirm all 15 existing tests pass against unrefactored code (baseline). Then dispatcher tests RED → GREEN → refactor → all 15 stay green. Mikado-style. |
| **Latent HTTP-controller bug** for multi-dataset uploads (`serialize(list_of_datasets)['id']` raises). | N/A for this refactor | **Out of scope.** Brief says behaviour preservation is non-negotiable. The bug is preserved as-is; ADR-022 documents it as a follow-up. The refactor neither makes it worse nor better. |
| **Parallel work collision** with `refactor-metadata-repository-split` and `extract-dataset-query-port`. | Low | Zero file overlap. This refactor touches `app/use_cases/dataset/create_dataset_from_upload.py`, `app/use_cases/dataset/_pipeline/plugin_dispatch.py` (new), and `app/plugins/protocol.py` (one-line validator relaxation). The two parallel features touch `app/repositories/metadata/repository.py` and `app/models/dataset.py` + `app/query_engine/` (new). Merge order is unconstrained. |
| **Phase-2 dbt-test-validation collision.** | None | Phase 2's surface (`app/use_cases/project/_dbt/`, `tests/integration/dataset_layer/eject/`) is not analyzed or modified by this design. |

---

## Word count

~1,190 words (within 1,200 cap).
