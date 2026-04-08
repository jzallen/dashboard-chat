# External Access

## Bounded Context

Access Control

## Purpose

External Access represents per-project SQL access credentials for pg_duckdb, enabling external tools to query project data via standard PostgreSQL connections. It manages credential lifecycle including creation, regeneration with cooldown, and sync with the query engine.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |
| `project_id` | `varchar(36)` | Unique constraint — one record per project |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `project_id` | varchar(36) | yes | — | FK → projects; unique |
| `org_id` | varchar(36) | yes | — | FK (indexed); org-scoped |
| `engine_node_id` | varchar(36) | no | — | FK → query_engine_nodes; nullable |
| `pg_schema` | varchar(255) | yes | — | — |
| `pg_role` | varchar(255) | yes | — | — |
| `pg_proxy_role` | varchar(255) | yes | — | — |
| `pg_password_hash` | text | yes | — | Hashed password |
| `enabled` | boolean | yes | — | — |
| `last_synced_at` | datetime | no | — | — |
| `created_at` | datetime | yes | generated | — |
| `updated_at` | datetime | yes | generated | — |

## Invariants

1. **One credential per project**
   > SQL access is a per-project toggle. Only one `external_access` record SHALL exist per project (unique constraint on `project_id`).

   **Enforced in:** `backend/app/use_cases/sql_access/enable_sql_access.py`
   **Specified in:** `features/external-data-access.feature`

2. **Regeneration cooldown**
   > Credential regeneration SHALL enforce a 60-second cooldown. Requests within the cooldown raise `CredentialCooldown` (HTTP 429).

   **Enforced in:** `backend/app/use_cases/sql_access/regenerate_sql_credentials.py`
   **Specified in:** `features/external-data-access.feature`, `../../requirements/nfr.md` (NFR-SEC7)

3. **Requires datasets**
   > SQL access SHALL NOT be enabled for projects with zero datasets. Raises `ProjectHasNoDatasets` (HTTP 400).

   **Enforced in:** `backend/app/use_cases/sql_access/enable_sql_access.py`
   **Specified in:** `features/external-data-access.feature`

### Sync Rules

> Dataset uploads and transform changes SHALL automatically propagate to the query engine via outbox events (`DatasetSyncRequested`, `TransformSyncRequested`, `DatasetRemoved`).

**Enforced in:** `backend/app/use_cases/dataset/create_dataset_from_upload.py:162-172`, `backend/app/use_cases/dataset/update_transforms.py:46-50`
**Specified in:** `../../requirements/nfr.md` (NFR-MT2)

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| parent | Project | one-to-one | Credentials belong to a project |
| references | Query Engine Node | many-to-one | Optional engine node assignment |

## Lifecycle

No explicit state machine. Credentials are created (enable), can be regenerated (with cooldown), and deleted (disable). The `enabled` boolean tracks active state.

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `SqlAccessAlreadyEnabled` | 409 | Attempting to enable SQL access that is already enabled |
| `SqlAccessNotEnabled` | 404 | Operating on SQL access that hasn't been enabled |
| `CredentialCooldown` | 429 | Regeneration requested within 60-second cooldown |
| `ProjectHasNoDatasets` | 400 | Enabling SQL access on project with no datasets |
| `QueryEngineUnreachable` | 502 | Query engine node is not responding |

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [Project](project.md) — parent entity
- [Query Engine](query-engine.md) — engine node serving the credentials
- [Outbox Message](outbox-message.md) — sync events for data propagation
