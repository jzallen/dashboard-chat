# Capability: Environment Status Literal Fix

**Status**: MODIFIED
**Domain**: sql_access

## Overview

Replace a raw string literal `"running"` with the `Status.RUNNING` enum value in `enable_sql_access.py`, eliminating a Connascence of Meaning where two representations encode the same value.

## Behaviors

### Status Enum Usage

- `enable_sql_access.py:_store_access_record` passes `environment_status` as `Status.RUNNING` instead of the string `"running"` when creating a new access record
- All other call sites already use `Status.RUNNING` — this makes the usage uniform

## Constraints

- No behavior change — `Status.RUNNING` resolves to the same string value
- The `ExternalAccessRepository.create()` method accepts `str | None` for `environment_status`, so enum `.value` or direct string is fine as long as the enum is used at the call site
