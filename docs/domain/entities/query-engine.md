# Query Engine

## Bounded Context

Access Control

## Purpose

A Query Engine Node represents a pg_duckdb endpoint that serves external SQL access for projects. Each node has connection details and a status indicating its operational state.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `org_id` | varchar(36) | yes | — | Indexed; org-scoped |
| `name` | varchar(255) | yes | — | — |
| `host` | varchar(255) | yes | — | — |
| `port` | integer | yes | — | — |
| `database` | varchar(255) | yes | — | — |
| `admin_user` | varchar(255) | yes | — | — |
| `admin_password_encrypted` | text | yes | — | Encrypted at rest |
| `status` | varchar(50) | yes | — | `running`, `stopped`, `error` |
| `status_message` | text | no | — | Error or status details |
| `created_at` | datetime | yes | generated | — |
| `updated_at` | datetime | yes | generated | — |

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| children | External Access | one-to-many | Engine node serves multiple project credentials |

## Lifecycle

No explicit state machine. The `status` field tracks operational state (`running`, `stopped`, `error`) but transitions are managed externally by infrastructure, not by domain events.

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `QueryEngineUnreachable` | 502 | Engine node is not responding |

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [External Access](external-access.md) — credentials served by this engine
