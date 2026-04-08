# NFR-M3: Non-Destructive Exploration

## Tag

M3 — Model: Data Integrity

## Invariant

> All transforms SHALL be reversible. Raw Parquet files SHALL never be modified by any transform operation. Users SHALL be able to disable and re-enable any transform without data loss.

## Status

**Implemented** — transforms generate SQL via Ibis; Parquet is read-only

## Verification Method

Verify that applying, disabling, and re-enabling transforms does not alter the underlying Parquet files. Confirm that raw data checksums remain identical before and after transform operations.

## Related

- [ADR-005: Frozen Dataclasses](../decisions/adrs.md)
- Dataset entity (`docs/domain/dataset-lifecycle.md`)
