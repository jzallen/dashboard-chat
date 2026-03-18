## Why

The `sql_access` domain was recently refactored to follow a clean package structure: use cases at the top level, infrastructure code in a `_infra/` subpackage, shared helpers in a service module, and `__init__.py` as a strict public API. The result is highly readable — the package structure "screams" what operations are available.

The other use case domains (`dataset`, `project`, `upload`, `organization`, `transform`) have grown organically and do not follow this pattern consistently. A team review identified concrete issues:

1. **Authorization logic is copy-pasted** across 4 project use cases instead of delegating to the existing `ProjectService`
2. **`ProjectService` exists but is completely unused** — a dead abstraction
3. **`create_dataset_from_upload`** mixes 5 private helpers at different abstraction levels (I/O, data analysis, persistence) in a single file
4. **`transform.py` is a flat module**, not a package — the only domain that breaks the package convention
5. **`transform` is deeply coupled to `dataset`** (uses dataset repos, raises dataset exceptions) but lives as a sibling, obscuring the dependency
6. **All 14 domain exceptions live in one flat file** instead of being co-located with their domains
7. **`upload_file.py` has no org_id authorization check** — potential authorization bypass
8. **`list_datasets` skips org access verification** — inconsistent with `get_dataset`
9. **`dbt/` subpackage** lacks `__all__` and the `_` prefix convention used by `_infra/`

These issues hurt readability, increase the blast radius of changes, and create maintenance traps where duplicated logic can diverge silently.

## What Changes

- **dataset domain**: Extract the ingestion pipeline helpers from `create_dataset_from_upload.py` into a `_pipeline/` subpackage. Unify `Dataset` construction paths. Add missing org access check to `list_datasets`. Consolidate `update_dataset` to use `DatasetService`.

- **project domain**: Adopt `ProjectService.fetch_and_authorize_project()` in all 4 use cases that currently duplicate the fetch+auth pattern. Add tests for `ProjectService`. Rename `dbt/` to `_dbt/` and add `__all__`.

- **transform domain**: Promote from flat module to package, or merge into `dataset/` domain as a sub-package (preferred — it's semantically a dataset sub-concern).

- **upload domain**: Add org_id authorization check to `upload_file.py`.

- **organization domain**: Add error handling for WorkOS HTTP calls. Move WorkOS API URL to settings.

- **shared exceptions**: Split `exceptions.py` into domain-specific exception modules co-located with each domain. Keep `DomainException` base class in the shared location.

- **Documentation**: Fix incorrect `handle_returns` error format in CLAUDE.md.

## Capabilities

### Modified Capabilities
- `dataset-crud`: Unified authorization checks, extracted ingestion pipeline, consistent Dataset construction
- `project-crud`: Adopted ProjectService, eliminated authorization duplication
- `transform-operations`: Relocated into dataset domain package
- `upload-file`: Added org_id authorization guard
- `organization-management`: Added external API error boundaries

### Removed Capabilities
- None (pure refactor — no behavior changes)

## Impact

**Backend**
- Modified: `app/use_cases/dataset/` — new `_pipeline/` subpackage, updated service usage
- Modified: `app/use_cases/project/` — adopted ProjectService, renamed `dbt/` to `_dbt/`
- Modified: `app/use_cases/upload/upload_file.py` — added auth check
- Modified: `app/use_cases/organization/create_organization.py` — added error handling
- Moved: `app/use_cases/transform.py` → `app/use_cases/dataset/` (as transform use cases)
- Split: `app/use_cases/exceptions.py` → domain-specific exception modules
- Modified: `app/use_cases/__init__.py` — updated imports
- Modified: All controllers/routers that import from reorganized modules
- Modified: All corresponding test files for new import paths

**Frontend**
- No changes

**Worker**
- No changes

**Security**
- Fixed: upload authorization gap (org_id check)
- Fixed: list_datasets authorization gap (org_id check)

## Architectural Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Transform location | Merge into dataset domain | Transform is semantically a dataset sub-concern; shares repos, exceptions, and auth patterns with dataset |
| 2 | Exception organization | Domain-specific modules | Co-locating exceptions with their domain reduces cross-domain coupling and makes it clear which exceptions belong where |
| 3 | Subpackage naming | Underscore prefix (`_pipeline/`, `_dbt/`) | Consistent with `_infra/` convention; signals "internal implementation detail" |
| 4 | ProjectService adoption | Adopt (not delete) | The service already has the right abstraction; 4 use cases need it. Adding tests closes the coverage gap |
| 5 | Migration approach | Incremental, domain-by-domain | Each domain can be refactored and tested independently. No big-bang rewrite |
