# Multi-Dataset Transaction Atomicity

## Context

The `create_dataset_from_upload` use case (`backend/app/use_cases/dataset/create_dataset_from_upload.py`) creates multiple datasets in a loop when a plugin returns `MultiProcessingResult`. If the Nth dataset write fails (e.g., S3 error during parquet write), datasets 1 through N-1 have already been committed to the metadata database.

## Root Cause

The decorator stack is ordered:

```python
@with_repositories    # outer — commits on successful return
@handle_returns       # inner — catches exceptions, returns Failure(e)
```

When an exception occurs inside the use case:

1. `handle_returns` catches it and returns `Failure(e)` — a normal return value
2. `with_repositories` sees a successful return (not an exception) and commits
3. Any dataset records created before the failure are persisted

The `handle_returns` decorator swallows the exception before `with_repositories` can detect it and roll back.

## Severity

CRITICAL — partial multi-dataset commits leave orphaned dataset records with no corresponding parquet data. Users see datasets that cannot be queried.

## Recommendation

Reverse the decorator order so `with_repositories` is the inner decorator:

```python
@handle_returns       # outer — catches exceptions from with_repositories, wraps as Failure
@with_repositories    # inner — rolls back on exception, then re-raises
```

This requires `with_repositories` to re-raise exceptions after rollback (current behavior commits on success, rolls back on exception). The `handle_returns` wrapper then converts the re-raised exception into a `Failure` monad.

Verify that all existing use cases using `@with_repositories` + `@handle_returns` are updated and that their tests still pass. The decorator order is used consistently across the codebase, so this is a horizontal change.

## Files to Modify

- `backend/app/use_cases/__init__.py` — verify `with_repositories` re-raises after rollback
- `backend/app/use_cases/dataset/create_dataset_from_upload.py` — reverse decorator order
- All other use cases with the same decorator stack — reverse order
- `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py` — existing rollback test validates the fix

## Evidence

Test `test_multi_dataset_partial_failure_returns_failure` in `test_create_dataset_from_upload.py` documents this behavior. The test was added during the `fhir-hl7v2-plugin-cleanup` change.
