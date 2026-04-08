# Domain Entities

Documentation for each domain entity following Domain-Driven Design aggregate patterns. Each entity includes its attributes, invariants (business rules), relationships, lifecycle, and domain exceptions.

Source: [Entity-Relationship Diagram](../erd.mermaid) | [Dataset Lifecycle](../dataset-lifecycle.md)

## Entities

| Entity | Bounded Context | Description |
|--------|----------------|-------------|
| [Dataset](dataset.md) | Data Modeling | Parquet-backed data table with schema and transforms |
| [Transform](transform.md) | Data Modeling | Non-destructive data transformation (filter, clean, alias, map) |
| [View](view.md) | Data Modeling | Composed SQL view over datasets with joins and grain |
| [Report](report.md) | Data Modeling | Semantic layer with dimensions and measures |
| [Upload](upload.md) | Upload Pipeline | File upload state machine (pending → processing → completed) |
| [Session](session.md) | Session Management | Chat conversation thread with ownership |
| [Project](project.md) | Project Management | Workspace container for datasets, views, and reports |
| [Organization](organization.md) | Multi-Tenancy | Root tenant container for org-scoped isolation |
| [External Access](external-access.md) | Access Control | pg_duckdb SQL access credentials per project |
| [Query Engine](query-engine.md) | Access Control | pg_duckdb endpoint node for external SQL |
| [Outbox Message](outbox-message.md) | Event Infrastructure | At-least-once event delivery for sync operations |

## Cross-Cutting

- [Cross-Cutting Rules](cross-cutting.md) — Authorization model, multi-tenancy, and full domain exception catalog
