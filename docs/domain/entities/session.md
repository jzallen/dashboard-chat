# Session

## Bounded Context

Session Management

## Purpose

A Session represents a chat conversation thread owned by a specific user. Sessions belong to a Project Memory and provide the context for AI-powered natural language interactions with data tables.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |
| `stream_thread_id` | `varchar(100)` | External thread identifier |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `memory_id` | varchar(36) | yes | — | FK → project_memories |
| `stream_thread_id` | varchar(100) | yes | — | — |
| `owner_id` | varchar(36) | yes | — | Indexed; immutable after creation |
| `title` | varchar(500) | no | — | Set from first user message, max 100 chars |
| `org_id` | varchar(36) | yes | — | Indexed; org-scoped |
| `created_at` | datetime | yes | generated | — |
| `last_active_at` | datetime | no | — | — |

## Invariants

1. **Immutable ownership**
   > Session `owner_id` SHALL be set at creation and SHALL NOT be changed afterward.

   **Enforced in:** `backend/app/use_cases/session/update_session.py` — raises `SessionAccessDenied` if `user.id != session.owner_id`
   **Specified in:** `openspec/specs/session-ownership/spec.md`

2. **Owner-only write access**
   > Only the session owner SHALL update or delete the session. Any org member SHALL read (list) sessions.

   **Enforced in:** `backend/app/use_cases/session/update_session.py` — raises `SessionAccessDenied` if `user.id != session.owner_id`
   **Specified in:** `openspec/specs/session-ownership/spec.md`

3. **Title set from first message**
   > Session title SHALL be set to the first user message, truncated to 100 characters.

   **Enforced in:** Frontend (chat client sets title on first message)
   **Specified in:** `openspec/specs/session-title-management/spec.md`

4. **Title immutable after first message**
   > Subsequent messages SHALL NOT overwrite the title.

   **Enforced in:** Frontend (chat client sets title on first message)
   **Specified in:** `openspec/specs/session-title-management/spec.md`

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| parent | Project Memory | many-to-one | Session belongs to a project memory |

## Lifecycle

No explicit state machine. Entity is created and can be updated or deleted. Sessions are cascade-deleted when their parent Project Memory is deleted.

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `SessionNotFound` | 404 | Session ID doesn't exist |
| `SessionAccessDenied` | 403 | Non-owner attempts write operation |

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [Project](project.md) — sessions belong to projects via project memories
