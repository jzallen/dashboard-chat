# NFR-H5: S3 Cleanup on Delete

## Tag

H5 — Handoff: Data Integrity

## Invariant

> When a dataset or project is deleted, corresponding Parquet files in S3 SHALL be removed.

## Status

**Not implemented** — tracked in `s3-lifecycle-cleanup` proposal

## Verification Method

Delete a dataset or project and verify that corresponding Parquet files are removed from S3 within the expected timeframe.

## Related

- `s3-lifecycle-cleanup` proposal
