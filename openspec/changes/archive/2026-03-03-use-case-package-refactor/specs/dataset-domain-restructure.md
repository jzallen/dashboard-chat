# Capability: Dataset Domain Restructure

**Status**: MODIFIED
**Domain**: dataset

## Overview

Restructure the dataset domain to follow package conventions: extract the ingestion pipeline into a `_pipeline/` subpackage, merge transform use cases into the domain, unify Dataset construction and authorization patterns, and co-locate exceptions.

## Behaviors

### Ingestion Pipeline Extraction

- The five private helper functions in `create_dataset_from_upload.py` (`_fetch_upload_event`, `_read_raw_file`, `_analyze_dataframe`, `_create_dataset_record`, `_write_parquet`) are extracted to `dataset/_pipeline/ingestion.py`
- `create_dataset_from_upload.py` becomes a thin orchestrator that calls pipeline functions
- Pipeline functions are importable from `dataset._pipeline` for testing but are not part of the domain's public API

### Transform Use Case Merge

- The three use case functions from `transform.py` (`create_transforms`, `update_transforms`, `preview_cleaning_transform`) become top-level files in `dataset/`
- `transform.py:_fetch_and_authorize_dataset()` moves to `DatasetService` as a public method
- `dataset/__init__.py` exports all 7 use case functions (4 original + 3 from transform)
- Transform-domain exceptions (`InvalidExpressionConfig`, `ColumnTypeMismatch`, `PreviewNotSupported`) move to `dataset/exceptions.py`

### Authorization Unification

- `list_datasets` adds org_id verification for the parent project, matching the pattern in `get_dataset`
- `update_dataset` delegates existence checking to `DatasetService` instead of directly accessing the metadata repository
- All dataset use cases that access org-scoped resources go through `DatasetService` for authorization

### Dataset Construction Unification

- `create_dataset_from_upload` uses `Dataset.from_record()` or an equivalent factory instead of manual `Dataset(...)` construction
- A shared `DEFAULT_PREVIEW_LIMIT = 10` constant is defined in `dataset_service.py` and used by both the ingestion pipeline and the service's fetch method

### Exception Co-location

- `DatasetNotFound` moves from `app/use_cases/exceptions.py` to `dataset/exceptions.py`
- Transform exceptions (`InvalidExpressionConfig`, `ColumnTypeMismatch`, `PreviewNotSupported`) move to `dataset/exceptions.py`
- All exceptions inherit from `DomainException`

## Target Structure

```
dataset/
├── __init__.py                    # __all__ = 7 use case functions
├── exceptions.py                  # DatasetNotFound, InvalidExpressionConfig, ColumnTypeMismatch, PreviewNotSupported
├── dataset_service.py             # fetch_dataset, fetch_and_authorize_dataset, _verify_org_access, DEFAULT_PREVIEW_LIMIT
├── get_dataset.py
├── list_datasets.py               # + org access check
├── update_dataset.py              # delegates to service for existence check
├── create_dataset_from_upload.py  # thin orchestrator
├── create_transforms.py           # from transform.py
├── update_transforms.py           # from transform.py
├── preview_cleaning.py            # from transform.py (renamed)
└── _pipeline/
    ├── __init__.py                # __all__ re-exports
    └── ingestion.py               # fetch_upload_event, read_raw_file, analyze_dataframe, create_dataset_record, write_parquet
```

## Constraints

- The ingestion pipeline functions must not import from use case modules (dependency flows inward: use case → pipeline, never pipeline → use case)
- Transform use cases import shared auth logic from `DatasetService`, not from a removed `transform.py`
