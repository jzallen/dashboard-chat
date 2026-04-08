# Project

## Bounded Context

Project Management

## Purpose

A Project is the primary workspace container that holds datasets, views, reports, and sessions. It provides the organizational boundary for all data modeling work and enforces cascade deletion of child entities.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `name` | varchar(255) | yes | — | — |
| `description` | text | no | — | — |
| `org_id` | varchar(36) | yes | — | Indexed; convention — no DB FK |
| `created_by` | varchar(36) | yes | — | — |
| `created_at` | datetime | yes | generated | — |
| `updated_at` | datetime | yes | generated | — |

## Invariants

1. **Cascade delete behavior**
   When a project is deleted, the following records are cascade-deleted via SQLAlchemy:

   | Parent | Cascaded Entity | Cascade Type |
   |:-------|:----------------|:-------------|
   | Project | Datasets | `all, delete-orphan` |
   | Project | Views | `all, delete-orphan` |
   | Project | Reports | `all, delete-orphan` |
   | Project | Project Memories | `all, delete-orphan` (cascades to Sessions) |
   | Project | External Access | FK `CASCADE DELETE` |
   | Dataset | Transforms | `all, delete-orphan` |
   | Project Memory | Sessions | FK `CASCADE DELETE` |

   **Enforced in:** `backend/app/repositories/metadata/project_record.py:37-45` — SQLAlchemy `relationship(cascade=...)`
   **Specified in:** Undocumented

2. **S3 cleanup gap**
   > S3 Parquet files are NOT cleaned up on cascade delete. This is a known gap tracked in `s3-lifecycle-cleanup`.

   **Enforced in:** Not enforced (known gap)
   **Specified in:** Undocumented

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| parent | Organization | many-to-one | Project scoped to an org (logical, not DB FK) |
| children | Dataset | one-to-many | Project contains datasets |
| children | View | one-to-many | Project contains views |
| children | Report | one-to-many | Project contains reports |
| child | Project Memory | one-to-one | Project has one memory container |
| child | External Access | one-to-one | Project has optional SQL access |

## Lifecycle

No explicit state machine. Entity is created and can be updated or deleted. Deletion triggers cascade delete of all child entities.

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `ProjectNotFound` | 404 | Project ID doesn't exist |
| `ProjectIdRequired` | 400 | Operation requires a project ID but none provided |
| `ProjectHasNoDatasets` | 400 | SQL access enabled on project with zero datasets |
| `ExportValidationError` | 400 | Export request fails validation |

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [Dataset](dataset.md), [View](view.md), [Report](report.md) — child data modeling entities
- [Session](session.md) — chat sessions via project memories
- [External Access](external-access.md) — SQL access credentials
