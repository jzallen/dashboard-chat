# Capability: Typed Repository Container

**Status**: MODIFIED
**Domain**: backend (repositories)

## Overview

Add typed property accessors to `RepositoryContainer` so that callers access repositories via `.metadata`, `.lake`, `.outbox`, and `.external_access` instead of string-indexed `["metadata_repository"]`. This converts Connascence of Name (35+ magic string occurrences) into Connascence of Type (statically verifiable property access).

## Behaviors

### Typed Properties

`RepositoryContainer` gains four read-only properties:

| Property | Returns | Replaces |
|----------|---------|----------|
| `.metadata` | `MetadataRepository` | `["metadata_repository"]` |
| `.lake` | `LakeRepository` | `["lake_repository"]` |
| `.outbox` | `OutboxRepository` | `["outbox_repository"]` |
| `.external_access` | `ExternalAccessRepository` | `["external_access_repository"]` |

Each property uses the existing lazy-instantiation and caching mechanism internally (delegates to `__getitem__`).

### Migration

- All 35+ call sites migrate from `repositories["key"]` to `repositories.property`
- Local type annotations like `metadata_repo: MetadataRepository = repositories["metadata_repository"]` simplify to `metadata_repo = repositories.metadata` (the property return type provides the annotation)
- Service class constructors (`DatasetService.__init__`, `ProjectService.__init__`) migrate similarly

### `__getitem__` Retention

- `__getitem__` is retained for backward compatibility with the test override mechanism: `repositories={'metadata_repository': MockRepo}`
- The `with_repositories` decorator's `match` on `dict` overrides continues to work unchanged
- `__getitem__` may be deprecated in a future change once override patterns are updated

## Constraints

- Property names are shorter than registry keys: `metadata` not `metadata_repository`. This is intentional — the `_repository` suffix is redundant when accessed as a property of a container that is already named `repositories`
- The registry keys (`"metadata_repository"`, etc.) remain unchanged internally — only the external access pattern changes
- Type annotations on properties must use the abstract types where applicable (e.g., `LakeRepository` protocol, not `MinIOLakeRepository` concrete class)
