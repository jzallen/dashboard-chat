# Organization

## Bounded Context

Multi-Tenancy

## Purpose

An Organization is the root tenant container that provides org-scoped isolation for all domain entities. All data queries are scoped by `org_id` via `RestrictedSession`, ensuring strict multi-tenant separation.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `name` | varchar(255) | yes | — | — |
| `created_at` | datetime | yes | generated | — |
| `updated_at` | datetime | yes | generated | — |

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| children | Project | one-to-many | Org scopes projects (logical, not DB FK) |

## Lifecycle

No explicit state machine. Entity is created by any authenticated user (even without an existing org).

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `ExternalServiceError` | 502 | External service call failure during org operations |

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [Cross-Cutting Rules](cross-cutting.md) — multi-tenancy enforcement via RestrictedSession
