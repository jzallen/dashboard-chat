# Upload

## Bounded Context

Upload Pipeline

## Purpose

An Upload represents a file upload state machine that tracks the progression from file receipt through format detection, optional user input (multi-sheet selection), processing, and final completion or failure. Successful uploads produce one or more Datasets.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `status` | varchar(20) | yes | `pending` | `pending`, `awaiting_input`, `processing`, `completed`, `failed` |

> Note: Full attribute list is derived from the Upload model. The status field is the primary domain concern documented here.

## Invariants

Upload invariants are encoded in the state machine transitions below. A completed or failed upload cannot be reprocessed.

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| produces | Dataset | one-to-many | Successful upload creates one or more datasets |

## Lifecycle

| Current State | Event | Next State | Guard |
|:--------------|:------|:-----------|:------|
| `pending` | Format detected, single-sheet | `processing` | — |
| `pending` | Multi-sheet file detected | `awaiting_input` | choices list populated |
| `awaiting_input` | User selects sheet(s) | `processing` | `POST /uploads/{id}/process` |
| `processing` | Conversion succeeds | `completed` | dataset_id(s) populated |
| `processing` | Conversion fails | `failed` | error_message populated |
| `completed` | — | terminal | — |
| `failed` | — | terminal | — |

**Enforced in:** `backend/app/models/upload.py` (status field) + `backend/app/use_cases/upload/upload_file.py`
**Specified in:** `docs/diagrams/state/upload-status.mermaid`

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `UploadNotFound` | 404 | Upload ID doesn't exist |
| `UploadAlreadyProcessed` | 409 | Attempting to process a completed/failed upload |
| `InvalidFileType` | 400 | File extension not recognized |
| `UnsupportedFormat` | 400 | No plugin can handle the file |
| `EmptyFile` | 400 | File has zero rows or no content |
| `PluginValidationError` | 400 | Plugin-specific validation failure |

**Enforced in:** `backend/app/use_cases/upload/exceptions.py`

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [Dataset](dataset.md) — created as output of successful uploads
