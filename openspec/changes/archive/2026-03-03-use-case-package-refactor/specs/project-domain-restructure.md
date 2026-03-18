# Capability: Project Domain Restructure

**Status**: MODIFIED
**Domain**: project

## Overview

Restructure the project domain to adopt `ProjectService` consistently, eliminate authorization duplication, rename the `dbt/` subpackage to `_dbt/`, and co-locate exceptions.

## Behaviors

### ProjectService Adoption

- `get_project`, `update_project`, `delete_project`, and `export_dbt_project` delegate to `ProjectService.fetch_and_authorize_project()` instead of implementing inline fetch+auth logic
- The 7-line fetch+None-check+org-verify pattern is removed from all 4 use cases
- `ProjectService.fetch_and_authorize_project()` accepts an `include_datasets` parameter to control eager loading
- `ProjectService.fetch_full_datasets()` is used by `export_dbt_project` for loading complete dataset objects

### dbt Subpackage Rename

- `project/dbt/` is renamed to `project/_dbt/` to follow the underscore-prefix convention for internal subpackages
- `_dbt/__init__.py` adds an explicit `__all__` list: `["generate_dbt_project_zip", "to_snake_case"]`
- All imports in `export_dbt_project.py` and tests update to use `_dbt`

### Exception Co-location

- `ProjectIdRequired`, `ProjectNotFound`, and `ProjectHasNoDatasets` move from `app/use_cases/exceptions.py` to `project/exceptions.py`
- All exceptions inherit from `DomainException`

### Magic String Extraction

- The `"__S3_BUCKET__"` sentinel in `export_dbt_project.py` is extracted to a named constant `_BUCKET_PLACEHOLDER`

### Type Alias

- The `list[tuple[str, Dataset]]` type used across 4 dbt generator files is aliased as `DatasetPair = tuple[str, Dataset]` in `_dbt/naming.py` or a `_dbt/_types.py` module

## Target Structure

```
project/
├── __init__.py                # __all__ = 7 use case functions
├── exceptions.py              # ProjectIdRequired, ProjectNotFound, ProjectHasNoDatasets
├── project_service.py         # fetch_and_authorize_project, fetch_full_datasets
├── create_project.py
├── get_project.py             # delegates to ProjectService
├── list_projects.py
├── update_project.py          # delegates to ProjectService
├── delete_project.py          # delegates to ProjectService
├── export_dbt_project.py      # delegates to ProjectService + _dbt
└── _dbt/
    ├── __init__.py            # __all__ defined
    ├── naming.py              # to_snake_case, DatasetPair type alias
    ├── project_yml.py
    ├── profiles_yml.py
    ├── sources_yml.py
    ├── schema_yml.py
    ├── model_sql.py
    ├── macros_sql.py
    ├── bootstrap_sql.py
    └── readme.py
```

## Constraints

- `ProjectService` must be tested directly in `test_project_service.py`
- `_dbt/` must not be imported from outside the project domain
