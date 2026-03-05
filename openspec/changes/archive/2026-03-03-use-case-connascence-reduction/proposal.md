## Why

The previous refactor (`use-case-package-refactor`) improved locality by co-locating exceptions with domains, consolidating auth into service classes, and merging transforms into the dataset package. That work reduced the *locality* axis of connascence — moving coupled things closer together.

A connascence assessment of the current codebase reveals four remaining issues, ordered by risk (strength x degree x inverse-locality):

1. **Environment status string literal** — `enable_sql_access.py:211` uses `"running"` while every other site uses `Status.RUNNING`. Connascence of Meaning: two representations of the same value. If the enum changes, this site breaks silently. (Trivial fix)

2. **Third authorization copy** — `upload_file.py:70-73` has an inline org-access check that duplicates `ProjectService.fetch_and_authorize_project()`. Three implementations of the same algorithm means a policy change must be applied in three places. Connascence of Algorithm at poor locality. (Small fix)

3. **Untyped `RepositoryContainer` access** — 35+ sites do `repositories["metadata_repository"]` with magic strings. `__getitem__` returns `object`, so callers get no type safety. A typo fails silently until runtime. Connascence of Name at high degree and poor locality. (Medium fix)

4. **Untyped `access_record` dicts** — The `sql_access` domain has 30+ occurrences of `access_record["some_key"]` across 10 files. Every consumer must agree on key names and value semantics by convention. Connascence of Meaning at high degree. (Medium-large fix)

## What Changes

- **Status literal → enum**: Replace the one string literal `"running"` with `Status.RUNNING` in `enable_sql_access.py`.

- **Upload auth consolidation**: Replace the inline org-access check in `upload_file.py` with `ProjectService(repositories).fetch_and_authorize_project(project_id)`. Remove the now-redundant manual `get_project` call. Update tests.

- **Typed `RepositoryContainer`**: Add typed property accessors (`.metadata`, `.lake`, `.outbox`, `.external_access`) that return properly typed repository instances. Migrate all 35+ access sites from string indexing to property access. Retain `__getitem__` for backward compatibility during migration, then remove.

- **Typed `ExternalAccessRecord`**: Introduce a dataclass (or TypedDict) for external access records returned by `ExternalAccessRepository`. Replace `dict` returns with the typed record. Update all `access_record["key"]` sites in `sql_access/` to attribute access.

## What Does NOT Change

- The `fetch_full_datasets` N+1 pattern — deferred to a separate backlog item (`docs/backlog/project-dataset-query-model.md`) that requires coordinated frontend/backend changes.
- Repository return types outside `sql_access` (e.g., `project_dict`) — those are addressed by the query model backlog item.
- No new endpoints, migrations, or service boundaries.

## Scope

- **Backend only** — all changes are in `backend/app/use_cases/`, `backend/app/repositories/`, and their tests.
- **No breaking API changes** — these are internal refactors; HTTP responses are unchanged.
- **Incremental** — each of the four items can be committed independently.
