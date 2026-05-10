<!-- DES-ENFORCEMENT : exempt -->
# Upstream Changes — Refactor Upload Pipeline Modularity

Formal record of changes this design proposes to artefacts owned upstream of DESIGN (architecture brief, ADR index, cross-cutting modules consumed by ≥2 features). Per project convention, an "upstream change" is any modification to:

- `docs/product/architecture/brief.md`
- `docs/decisions/adr-*.md` (additions or supersessions)
- Cross-cutting helper modules consumed by ≥2 features

---

## 1. New ADR — ADR-022

**File:** `docs/decisions/adr-022-upload-pipeline-modularity.md`
**Status:** Proposed
**Title:** Extract `UploadPluginDispatcher` and unify pipeline output on `MultiProcessingResult`
**Numbering rationale.** Highest existing ADR is **021** (`adr-021-extract-dataset-query-port.md`). ADR-020 is `metadata-repository-split`. Both 020 and 021 are also Proposed (parallel DISTILL dispatches in flight). ADR-022 is the unambiguous next sequential number; no collision.

---

## 2. Architecture brief — `## Application Architecture` append (deferred to finalize)

A new sub-section will be appended to `docs/product/architecture/brief.md` under `## Application Architecture` → `### Application-architecture features`, adjacent to the existing `dbt-test-validation` entry. Proposed content (to be written by the DELIVER-phase finalizer when this feature ships, NOT by this DESIGN — the brief is append-only across waves and reflects ratified state):

```markdown
#### `refactor-upload-pipeline-modularity` (DESIGN — 2026-05-10)

**Author:** Morgan (nw-solution-architect)
**ADR:** ADR-022 (Proposed)
**Trigger:** User-initiated proactive modularity refactor. Hotspot review (Finding 6) classified file as healthy; user disagreed on forward-looking grounds.
**Status:** Awaiting peer review (Atlas) → DISTILL

**Decision summary.** Extract plugin-dispatch logic from
`create_dataset_from_upload` into a new `UploadPluginDispatcher` class
under `_pipeline/plugin_dispatch.py`. Unify internal pipeline output on
`MultiProcessingResult` (single-result plugins wrapped at dispatcher
boundary), collapsing the use-case body's single-vs-multi branch into a
linear loop. External use-case return shape (`Result[Dataset |
list[Dataset], str]`) preserved verbatim. Outbox-payload asymmetry
(multi writes `dataset_ids`/`dataset_id`; single does not) preserved
verbatim, with a new absence-assertion characterization test pinning the
single-path absence. `MultiProcessingResult.__post_init__` validator
relaxed to allow `name=None` when `len(results) == 1`.

**Constraint inheritance amendment.** ADR-022 adds:
| ADR-022 | Application | UploadPluginDispatcher isolates plugin-dispatch from use-case body; pipeline canonicalized on MultiProcessingResult internally |
```

**This DESIGN does NOT itself modify the brief.** The brief append happens at finalize time per the brief's stated convention ("each feature's DESIGN wave appends a sub-heading"). Pre-emptive editing would put unratified content in the SSOT.

---

## 3. Cross-cutting helper modules

| Module | Change type | Reason |
|---|---|---|
| `backend/app/plugins/protocol.py` | **EXTEND** — relax `MultiProcessingResult.__post_init__` (one-line conditional: name-required check applies only when `len(results) > 1`) | Required by the unify-on-`MultiProcessingResult` pattern. Constraint-weakening; cannot break currently-passing inputs. (DWD-3) |
| `backend/app/use_cases/dataset/create_dataset_from_upload.py` | **REWRITE** body, preserve external signature | Refactor target. (DWD-1, DWD-5) |
| `backend/app/use_cases/dataset/_pipeline/plugin_dispatch.py` | **CREATE NEW** | New `UploadPluginDispatcher` class. (DWD-1) |
| `backend/app/use_cases/dataset/_pipeline/__init__.py` | **POSSIBLY EXTEND** — re-export `UploadPluginDispatcher` if/when dispatcher needs to be importable from outside the use case | Currently `_pipeline/` re-exports only the ingestion helpers consumed by the use case file. If the dispatcher is consumed only by the same use case (likely), no re-export is needed. DELIVER decides at the import site. |
| `backend/tests/architecture/test_dependency_rules.py` (or equivalent — file-name fixed by repo convention) | **EXTEND** — add `pytest-archon` rule per DWD-7 | Architectural-enforcement rule preventing re-inlining of plugin dispatch into the use-case body |
| `backend/app/plugins/__init__.py` | **NO CHANGE** | Re-export list (`MultiProcessingResult`, `PluginRegistry`, etc.) unchanged. The validator-relaxation lives inside the dataclass body, not the module surface. |
| `backend/app/plugins/registry.py` | **NO CHANGE** | Lookup precedence (`get_by_name` then `get_for_filename`) preserved verbatim. Already pinned by `test_plugin_lookup_prefers_get_by_name_over_filename_match`. |
| `backend/app/plugins/csv_plugin.py` / `excel_plugin.py` / `fhir_plugin.py` / `hl7v2_plugin.py` | **NO CHANGE** | Plugin contract not modified. The four real plugins continue working without any plugin-side change. |
| `backend/app/utils/csv_parser.py` | **NO CHANGE** | Continues to be the no-registry CSV fallback (now reached lazily through the dispatcher). |
| `backend/app/use_cases/dataset/_pipeline/ingestion.py` | **NO CHANGE** | All five pipeline helpers (`fetch_upload_event`, `read_raw_file`, `analyze_dataframe`, `create_dataset_record`, `write_parquet`) consumed as-is. |
| `backend/app/controllers/dataset_controller.py` | **NO CHANGE** | The latent multi-dataset HTTP-envelope mishandling is preserved as-is per the brief's behaviour-preservation constraint. ADR-022 captures it as a follow-up. (DWD-5) |
| `backend/app/repositories/__init__.py` (`RepositoryContainer`) | **NO CHANGE** | Dispatcher is a per-call use-case-internal coordinator; not registered in the container. (DWD-8) |
| `backend/app/main.py` (lifespan) | **NO CHANGE** | No new probe; no startup-invariant change. (DWD-8) |
| `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py` (15 existing tests) | **EXTEND** — add ONE new test (DWD-2 absence assertion); existing 15 untouched | Iron-Rule binding on the existing 15. (DWD-6) |
| `backend/tests/use_cases/dataset/test_plugin_dispatch.py` | **CREATE NEW** | ~5 dispatcher unit tests covering plugin lookup precedence, CSV fallback, `_converted_content` side channel, timeout firing, single-result wrapping shape. (DWD-1) |

---

## 4. ADR cross-section index addition

When ADR-022 is accepted (post-DELIVER), the `## Cross-section index` table at the bottom of `docs/product/architecture/brief.md` gains a row:

```markdown
| ADR-022 | Application | UploadPluginDispatcher + pipeline canonicalization on MultiProcessingResult |
```

---

## 5. Conflicts with parallel work

| Parallel work | Surface owned by parallel work | Conflict status |
|---|---|---|
| Phase 2 dbt-test-validation | `app/use_cases/project/_dbt/`, `tests/integration/dataset_layer/eject/`, `tests/acceptance/dbt-test-validation/`, `tests/integration/dataset_layer/harness.py` | **No conflict.** Fully fenced per task brief. |
| `refactor-metadata-repository-split` (ADR-020) | `app/repositories/metadata/repository.py` (split into 8 per-aggregate classes); `app/repositories/__init__.py` (`RepositoryContainer`) extension | **No conflict.** This design touches **none** of those files. The use case under refactor here uses `repositories.metadata` indirectly through the existing facade — Phase A of ADR-020 is additive and preserves the `metadata` accessor; this refactor's compatibility with Phase A is automatic. |
| `extract-dataset-query-port` (ADR-021) | `app/models/dataset.py`; new `app/query_engine/` package; `app/repositories/__init__.py` (`RepositoryContainer`) extension | **No conflict.** This design touches **none** of those files. `_create_single_dataset` (helper preserved as-is) calls `Dataset(...)` constructor only — no `query_preview_rows()` or `_needs_custom_case_macros()` interaction. |
| ADR numbering | Both parallel features mint new ADRs concurrently | **No collision.** ADR-020 + ADR-021 already taken; ADR-022 is the unambiguous next number. |

---

## 6. Out-of-scope (deliberately not changed)

- **Promoting `_converted_content` to a first-class field on `ProcessingResult` (or a new `ConversionArtifact` type).** Captured as ADR-022 follow-up. Would touch all four real plugins + integration tests; expanding blast radius without payback in this scope. (DWD-4)

- **Aligning the outbox-payload asymmetry (writing `dataset_ids` for single uploads).** Captured as ADR-022 follow-up. Would change observable system behaviour; out of scope per behaviour-preservation constraint. (DWD-2)

- **Fixing the latent `HTTPController.post_dataset` multi-dataset envelope.** Today's `serialize(list_of_datasets)['id']` raises `TypeError` for multi-dataset uploads; the bug pre-dates this refactor and is not made worse or better. Captured as ADR-022 follow-up. (DWD-5)

- **Aligning the use-case external return type to `Result[list[Dataset], str]` (always-list).** Coordinated change with the controller fix above. Out of scope for this feature. (DWD-5)

- **Adding configurability to the 120s plugin-timeout.** Dispatcher accepts a `timeout` constructor parameter for future overridability, but no caller currently overrides it. (Risk-table item in design.md §7.)

- **Adding a `probe()` to the dispatcher.** Rejected per DWD-8 — dispatcher is a use-case-internal coordinator, not a driven adapter; its dependencies are already covered by their own contracts.

- **Adding behavioural-layer (CI gold-test) architectural enforcement.** Rejected per DWD-7 — the architectural rule is purely import-graph; single-layer (`pytest-archon`) is sufficient.

---

## 7. Summary

**Upstream changes are minimal and additive:** one new ADR, one one-line change to a cross-cutting Protocol module (validator relaxation), and one new architectural-enforcement rule. The architecture brief gains a sub-section at finalize time (post-DELIVER, post-peer-review). No other cross-cutting modules are touched. No external integrations changed. No deployment-topology change.

**Zero file overlap with the two parallel DESIGN-wave dispatches.** Merge order with `refactor-metadata-repository-split` and `extract-dataset-query-port` is unconstrained.
