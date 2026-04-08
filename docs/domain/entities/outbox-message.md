# Outbox Message

## Bounded Context

Event Infrastructure

## Purpose

An Outbox Message implements the transactional outbox pattern for at-least-once event delivery. Domain events (e.g., dataset sync requests, transform changes) are written to the outbox table within the same database transaction as the domain operation, then processed asynchronously.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `aggregate_type` | varchar(100) | yes | — | Indexed; e.g., `Dataset`, `Transform` |
| `aggregate_id` | varchar(36) | yes | — | Indexed; ID of the source aggregate |
| `event_type` | varchar(100) | yes | — | e.g., `DatasetSyncRequested`, `TransformSyncRequested`, `DatasetRemoved` |
| `payload` | json | yes | — | Event-specific data |
| `processed` | boolean | yes | `false` | Whether the event has been delivered |
| `created_at` | datetime | yes | generated | Indexed |
| `processed_at` | datetime | no | — | When the event was processed |

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| references | Dataset / Transform | many-to-one | Events reference a source aggregate by `aggregate_type` + `aggregate_id` |

## Lifecycle

No explicit state machine. Messages are created as `processed = false`, then marked `processed = true` with `processed_at` timestamp after delivery.

## Domain Exceptions

No domain-specific exceptions defined.

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [External Access](external-access.md) — sync rules that produce outbox events
