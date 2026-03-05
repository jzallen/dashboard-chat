# Capability: Typed External Access Record

**Status**: MODIFIED
**Domain**: sql_access, repositories

## Overview

Replace the `dict[str, Any]` return type from `ExternalAccessRepository` methods with typed dataclasses, eliminating Connascence of Meaning across 30+ `access_record["key"]` sites in the `sql_access` domain. Consumers access `.pg_schema` instead of `["pg_schema"]`.

## Behaviors

### Two Record Types

Two dataclasses replace the `_to_dict` and `_to_dict_with_hash` methods:

**`AccessRecordView`** — the standard view (excludes password hash):
- `id: str`
- `project_id: str`
- `org_id: str`
- `pg_schema: str`
- `pg_role: str`
- `environment_id: str | None`
- `environment_host: str | None`
- `environment_port: int | None`
- `proxy_container_id: str | None`
- `environment_status: str | None`
- `status_message: str | None`
- `is_legacy: bool` (computed: `enabled and proxy_container_id is None`)
- `enabled: bool`
- `last_synced_at: str | None` (ISO format)
- `created_at: str | None` (ISO format)
- `updated_at: str | None` (ISO format)

**`AccessRecordWithHash`** — extends the view with credentials:
- All fields from `AccessRecordView`
- `pg_password_hash: str`

### Repository Changes

- `ExternalAccessRepository._to_dict` → returns `AccessRecordView` instead of `dict`
- `ExternalAccessRepository._to_dict_with_hash` → returns `AccessRecordWithHash` instead of `dict`
- All public methods that currently return `dict[str, Any] | None` return `AccessRecordView | None` or `AccessRecordWithHash | None`
- `ExternalAccessRepository.update()` continues to accept `dict[str, Any]` for the `update_data` parameter (it maps to `setattr` calls on the ORM record)

### Consumer Migration

All `access_record["key"]` sites in `sql_access/` use cases become `access_record.key`:
- `access_record["enabled"]` → `access_record.enabled`
- `access_record["pg_schema"]` → `access_record.pg_schema`
- `access_record.get("is_legacy", True)` → `access_record.is_legacy`
- `access_record.get("environment_status", "running")` → `access_record.environment_status or "running"` (or default in dataclass)
- etc.

### Dataclass Location

The dataclasses live in `app/repositories/external_access.py` alongside the repository class, since they are the repository's return type contract.

## Constraints

- The `update()` method's `update_data` parameter stays as `dict[str, Any]` — it's a partial update pattern where only changed fields are passed
- `is_legacy` is a computed field derived from `enabled` and `proxy_container_id`, preserved as a `@property` or set at construction time
- Tests that construct mock access records must use the dataclass constructor instead of dict literals
- `frozen=True` on the dataclasses to prevent accidental mutation of query results
