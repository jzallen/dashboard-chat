# Design: Use Case Package Refactor

## Architecture Overview

### Reference Pattern (from sql_access)

Every use case domain follows this canonical structure:

```
domain/
├── __init__.py              # __all__ = [use case functions only]
├── {domain}_service.py      # Shared logic used by 2+ use cases (NOT exported)
├── _{name}.py               # Domain-private constants/types (underscore prefix)
├── use_case_1.py            # @with_repositories + @handle_returns
├── use_case_2.py            # One decorated function per file
├── _subpackage/             # Infrastructure/supporting code (underscore prefix)
│   ├── __init__.py          # Re-exports with __all__
│   └── module.py            # Low-level implementation details
└── exceptions.py            # Domain-specific exceptions (imports DomainException base)
```

**Placement rules:**
1. A function belongs **at the top level** when it represents a discrete business operation with the `@with_repositories` + `@handle_returns` decorator stack
2. A function goes in **`{domain}_service.py`** when it's shared by 2+ use cases and operates at domain level
3. A function goes in a **`_subpackage/`** when it's infrastructure, I/O, or low-level detail not directly expressing business intent
4. **`__init__.py`** exports only public use case functions via `__all__`
5. **Private helpers** within a single use case stay in that file (prefix `_`)

---

## Decision 1: Transform Merges into Dataset Domain

### Current State

```
use_cases/
├── dataset/
│   ├── __init__.py
│   ├── dataset_service.py
│   ├── get_dataset.py
│   ├── list_datasets.py
│   ├── update_dataset.py
│   └── create_dataset_from_upload.py
└── transform.py                    # ← flat module, not a package
```

`transform.py` imports from dataset repos, raises dataset exceptions, and uses the same authorization pattern. It has no independent data or state.

### Target State

```
use_cases/
└── dataset/
    ├── __init__.py                 # Adds: create_transforms, update_transforms, preview_cleaning_transform
    ├── dataset_service.py          # Gains: fetch_and_authorize (was in transform.py inline)
    ├── get_dataset.py
    ├── list_datasets.py
    ├── update_dataset.py
    ├── create_dataset_from_upload.py
    ├── create_transforms.py        # ← extracted from transform.py
    ├── update_transforms.py        # ← extracted from transform.py
    └── preview_cleaning.py         # ← extracted from transform.py (renamed for clarity)
```

### Why Not Keep as Sibling Package

- Transform has zero independent dependencies — everything it needs comes from dataset
- The coupling is data-level (same repos, same exceptions, same auth) not just behavioral
- Making it a separate package implies false independence and forces readers to look in two places for dataset operations

### Migration Path

1. Split `transform.py` into 3 files (one per use case function)
2. Move `_fetch_and_authorize_dataset` into `dataset_service.py` as a public method
3. Update `dataset/__init__.py` to export the 3 new use case functions
4. Update `controllers/transform.py` imports to point to `app.use_cases.dataset`
5. Delete `transform.py`

---

## Decision 2: Dataset Ingestion Pipeline Extraction

### Current State

`create_dataset_from_upload.py` contains 5 private helpers at mixed abstraction levels:

```python
_fetch_upload_event()      # Outbox I/O
_read_raw_file()           # S3 I/O
_analyze_dataframe()       # CPU-bound data analysis (schema inference + column profiling + preview)
_create_dataset_record()   # 7-param metadata persistence helper
_write_parquet()           # S3 I/O
```

These form a sequential pipeline: fetch event → read file → analyze → create record → write parquet.

### Target State

```
dataset/
├── _pipeline/
│   ├── __init__.py         # Re-exports with __all__
│   └── ingestion.py        # Pipeline steps: fetch, read, analyze, write
├── create_dataset_from_upload.py   # Thin orchestrator calling _pipeline
└── ...
```

### What Stays vs What Moves

| Function | Destination | Reason |
|----------|-------------|--------|
| `_fetch_upload_event` | `_pipeline/ingestion.py` | Outbox I/O — infrastructure |
| `_read_raw_file` | `_pipeline/ingestion.py` | S3 I/O — infrastructure |
| `_analyze_dataframe` | `_pipeline/ingestion.py` | Data analysis — below use case abstraction |
| `_create_dataset_record` | `_pipeline/ingestion.py` | Record construction — could become a `Dataset` factory method but functionally is a pipeline step |
| `_write_parquet` | `_pipeline/ingestion.py` | S3 I/O — infrastructure |
| `create_dataset_from_upload` | stays | Orchestrates pipeline, has decorator stack |

### Benefits

- `create_dataset_from_upload.py` becomes a readable ~20-line orchestrator
- Pipeline steps become independently testable
- Abstraction levels are cleanly separated (use case orchestrates, pipeline executes)
- Consistent with `sql_access/_infra` pattern

---

## Decision 3: Adopt ProjectService Across Use Cases

### Current State

`project_service.py` has `fetch_and_authorize_project()` but no use case calls it. Instead, 4 use cases copy-paste:

```python
project = await metadata_repo.get_project(project_id, include_datasets=False)
if project is None:
    raise ProjectNotFound(project_id)
user = get_auth_user()
if project.get("org_id") and project["org_id"] != user.org_id:
    raise AuthorizationError(f"Access denied to project {project_id}")
```

### Target State

All 4 use cases (`get_project`, `update_project`, `delete_project`, `export_dbt_project`) call:

```python
svc = ProjectService(repositories)
project = await svc.fetch_and_authorize_project(project_id, include_datasets=True/False)
```

### Service Method Alignment

Verify that `ProjectService.fetch_and_authorize_project()` matches the inline pattern exactly. If the method signature differs (e.g., missing `include_datasets` param), update the service to match.

### Test Strategy

1. Add `tests/use_cases/project/test_project_service.py` with direct unit tests
2. Existing use case tests continue to work (they test the use case, not the service internals)
3. The service tests cover: fetch success, project not found, org access denied

---

## Decision 4: Exception Co-location

### Current State

All 14 exceptions in `app/use_cases/exceptions.py`:

```
DomainException (base)
├── Upload: UploadNotFound, UploadAlreadyProcessed, InvalidFileType, EmptyFile
├── Project: ProjectIdRequired, ProjectNotFound, ProjectHasNoDatasets
├── Dataset: DatasetNotFound
├── Transform: InvalidExpressionConfig, ColumnTypeMismatch, PreviewNotSupported
└── SqlAccess: SqlAccessAlreadyEnabled, SqlAccessNotEnabled, CredentialCooldown, EnvironmentNotRunning, EnvironmentNotStopped
```

### Target State

```
use_cases/
├── exceptions.py                          # DomainException base + AuthorizationError only
├── dataset/
│   ├── exceptions.py                      # DatasetNotFound
│   └── ...
├── project/
│   ├── exceptions.py                      # ProjectIdRequired, ProjectNotFound, ProjectHasNoDatasets
│   └── ...
├── upload/
│   ├── exceptions.py                      # UploadNotFound, UploadAlreadyProcessed, InvalidFileType, EmptyFile
│   └── ...
├── organization/
│   ├── exceptions.py                      # (new: ExternalServiceError for WorkOS failures)
│   └── ...
└── sql_access/
    ├── exceptions.py                      # SqlAccessAlreadyEnabled, SqlAccessNotEnabled, CredentialCooldown, EnvironmentNotRunning, EnvironmentNotStopped
    └── ...
```

Transform exceptions (`InvalidExpressionConfig`, `ColumnTypeMismatch`, `PreviewNotSupported`) move to `dataset/exceptions.py` since transform merges into dataset.

### Migration Safety

- Keep `app/use_cases/exceptions.py` as a re-export barrel during migration
- Each domain exception module imports `DomainException` from the base
- Update imports domain-by-domain; remove barrel re-exports once all consumers are migrated

---

## Decision 5: Rename dbt/ to _dbt/

### Rationale

The `_` prefix convention (established by `sql_access/_infra`) signals that a subpackage is an internal implementation detail. The `dbt/` subpackage is consumed only by `export_dbt_project.py` — it's not part of the domain's public API.

### Changes

1. Rename `project/dbt/` → `project/_dbt/`
2. Add `__all__` to `project/_dbt/__init__.py`
3. Update imports in `export_dbt_project.py`
4. Update imports in tests

---

## Decision 6: Authorization Gap Fixes

### Upload Domain

`upload_file.py` validates project existence but does not check `project.org_id == user.org_id`. This allows cross-org uploads.

**Fix:** After fetching the project record, add:

```python
user = get_auth_user()
if project.get("org_id") and project["org_id"] != user.org_id:
    raise AuthorizationError(f"Access denied to project {project_id}")
```

### Dataset Domain

`list_datasets.py` does not verify org ownership of the parent project. While the router may enforce this, the use case layer should be self-sufficient.

**Fix:** Add org check after project existence validation, following the `DatasetService._verify_org_access` pattern.

---

## Decision 7: Preview Limit Constant

The value `10` (preview rows) appears independently in:
- `create_dataset_from_upload.py`: `df.head(10)`
- `dataset_service.py`: `preview_limit=10` default parameter

**Fix:** Define `DEFAULT_PREVIEW_LIMIT = 10` in `dataset_service.py` and reference it from both locations.

---

## Decision 8: Organization Error Handling

`create_organization.py` makes raw `httpx` calls to WorkOS with no error boundary. `httpx.HTTPStatusError` propagates as a raw exception through `handle_returns`, becoming a generic 500.

**Fix:**
1. Add `ExternalServiceError(DomainException)` to `organization/exceptions.py`
2. Wrap `httpx` calls in try/except and raise `ExternalServiceError` with context
3. Move WorkOS base URL to `config.py` settings

---

## Refactor Sequence

The domains are refactored in dependency order:

```
Phase 1: Shared foundation (exceptions split, CLAUDE.md fix)
    ↓
Phase 2: Upload auth fix (smallest, standalone)
    ↓
Phase 3: Project refactor (adopt ProjectService, rename _dbt)
    ↓
Phase 4: Dataset refactor (extract _pipeline, unify service usage)
    ↓
Phase 5: Transform merge (depends on Phase 4 being complete)
    ↓
Phase 6: Organization error handling
    ↓
Phase 7: Verification (cross-domain consistency check)
```

Each phase is independently testable and deployable. No phase changes runtime behavior — these are pure structural refactors (except the auth fixes, which add security enforcement).
