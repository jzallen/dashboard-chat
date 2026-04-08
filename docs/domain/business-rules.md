# Business Rules by Entity

This document consolidates all business rules enforced across the domain. Each rule links to where it is enforced (code) and specified (spec/feature). Rules use four formats:

- **Decision tables** — type systems and valid value combinations
- **State transition tables** — lifecycle rules
- **Declarative invariants** — always-true properties (SHALL statements)
- **Schema tables** — data shape contracts

---

## Dataset

### Invariants

> A Dataset SHALL have a non-empty `schema_config` with a `fields` dict before any query can execute.

**Enforced in:** `backend/app/models/dataset.py:212` — `_build_table_from_schema()` raises `ValueError("No data or schema available")`
**Specified in:** Undocumented

> Dataset storage path SHALL follow the pattern `datasets/{project_id}/{dataset_id}/`.

**Enforced in:** `backend/app/models/dataset.py:89` — `storage_path` computed property
**Specified in:** Undocumented

> All transforms are non-destructive. Raw Parquet files SHALL never be modified by transform operations.

**Enforced in:** Architecture — transforms generate SQL via Ibis; Parquet files are read-only
**Specified in:** `docs/requirements/nfr.md` NFR-M3

### Transform Pipeline

Transforms are applied in a strict three-stage pipeline. Within each stage, transforms are sorted by `created_at`.

| Stage | Order | Transform Types | Ibis Operation | Field Requirements |
|:-----:|:-----:|:----------------|:---------------|:-------------------|
| 1 | MUTATE | `clean`, `map` | `.mutate()` | `target_column` + `expression_config` |
| 2 | FILTER | `filter` | `.filter()` | `condition_json` |
| 3 | RENAME | `alias` | `.rename()` | `expression_config.alias_name` |

**Enforced in:** `backend/app/models/dataset.py:155-206` — `_build_table()` method
**Specified in:** `docs/domain/dataset-lifecycle.md` (stages documented, ordering rule undocumented)

---

## Transform

### Type System

Four transform types with mutually exclusive field requirements:

| transform_type | condition_json | condition_sql | target_column | expression_config | expression_sql |
|:-:|:-:|:-:|:-:|:-:|:-:|
| `filter` | required | generated | forbidden | forbidden | forbidden |
| `clean` | forbidden | forbidden | required | required | generated |
| `alias` | forbidden | forbidden | required | required | generated |
| `map` | forbidden | forbidden | required | required | generated |

**Enforced in:** `backend/app/routers/schemas/dataset.py` — `TransformCreate` Pydantic `@model_validator(mode='after')`
**Specified in:** `openspec/specs/cleaning-transforms/spec.md` — Requirement: Cross-Field Validation

### Valid Cleaning Operations

| Operation | Requires target_column type | Config fields |
|:----------|:---------------------------|:--------------|
| `trim` | text only | — |
| `upper` | text only | — |
| `lower` | text only | — |
| `title` | text only | — |
| `snake` | text only | — |
| `kebab` | text only | — |
| `fill_null` | any | `fill_value` |
| `map_values` | text only | `mappings: [{from, to}]` |
| `alias` | any | `alias_name` |

**Enforced in:** `backend/app/routers/schemas/dataset.py` — `CleaningExpression._validate()`
**Specified in:** `openspec/specs/cleaning-transforms/spec.md` — Requirement: Expression Storage

### Status Lifecycle

| Current State | Event | Next State | Reversible |
|:--------------|:------|:-----------|:----------:|
| `enabled` | `undoCleaningTransform(action: disable)` | `disabled` | yes |
| `enabled` | `undoCleaningTransform(action: delete)` | `deleted` | no |
| `disabled` | `reEnableCleaningTransform` | `enabled` | yes |
| `disabled` | `undoCleaningTransform(action: delete)` | `deleted` | no |
| `deleted` | any | blocked | — |

**Enforced in:** `backend/app/use_cases/dataset/update_transforms.py` — batch update accepts status changes
**Specified in:** `docs/diagrams/state/transform-status.mermaid`, `openspec/specs/cleaning-transforms/spec.md`

---

## View

### DisplayType Enum

| Value | Description | Example Use |
|:------|:------------|:------------|
| `text` | Free-form string | Patient name, notes |
| `category` | Low-cardinality string | Status, department |
| `id` | Unique identifier | Primary key, UUID |
| `serial` | Auto-incrementing integer | Row number |
| `integer` | Whole number | Count, quantity |
| `decimal` | Floating-point number | Revenue, percentage |
| `boolean` | True/false | Active flag |
| `date` | Calendar date | Birth date |
| `time` | Time of day | Appointment time |
| `datetime` | Date + time | Created timestamp |

**Enforced in:** `backend/app/models/view.py:13-24` — `DisplayType(StrEnum)`
**Specified in:** Undocumented

### GrainRole Enum

| Value | Description | When to Use |
|:------|:------------|:------------|
| `Time` | Time dimension column | The column used for time-series grouping |
| `Dimension` | Grouping dimension | Categorical columns for GROUP BY |
| `Entity` | Entity identifier | Primary/foreign keys linking entities |
| `Metric` | Numeric measure | Columns that will be aggregated |

**Enforced in:** `backend/app/models/view.py:26-31` — `GrainRole(StrEnum)`
**Specified in:** Undocumented

### Composition Rules

> A ViewColumn SHALL have `name`, `source_ref`, `source_column`, and `display_type`. `grain_role` and `alias` are optional.

> A ViewJoin SHALL have `left_ref`, `left_column`, `right_ref`, `right_column`. `join_type` defaults to `"INNER"`. Valid join types: `INNER`, `LEFT`, `RIGHT`, `FULL`.

> A ViewFilter SHALL have `source_ref`, `column`, `operator`. `value` is optional (omitted for `IS NULL`/`IS NOT NULL`).

> A ViewGrain SHALL have `time_column` (required). `dimensions` is an optional list of column names.

**Enforced in:** `backend/app/models/view.py:33-63` — frozen dataclass constructors
**Specified in:** Undocumented

### Materialization

> View materialization SHALL default to `"ephemeral"` and accept: `ephemeral`, `view`, `table`, `incremental`.

**Enforced in:** `backend/app/models/view.py:102` — field default
**Specified in:** `features/view-layer-chat-first.feature`

### Dependency Rules

> Views SHALL NOT create circular dependencies. A view cannot reference itself or create a reference cycle.

**Enforced in:** `backend/app/use_cases/view/dependency_service.py` — raises `CircularDependency`
**Specified in:** Undocumented

---

## Report

### Column Metadata Schema

Each entry in `columns_metadata` SHALL conform to:

| Field | Type | Required | Description |
|:------|:-----|:--------:|:------------|
| `name` | string | yes | Column name from source |
| `semantic_role` | enum | yes | `entity`, `dimension`, or `measure` |
| `semantic_type` | enum | yes | Depends on role (see table below) |
| `time_granularity` | enum | when type=`time` | `day`, `week`, `month`, `quarter`, `year` |

### Valid semantic_type by Role

| semantic_role | Valid semantic_type values |
|:-------------|:--------------------------|
| `entity` | `primary`, `foreign`, `unique` |
| `dimension` | `categorical`, `time` |
| `measure` | `sum`, `count`, `count_distinct`, `avg`, `min`, `max` |

**Enforced in:** `backend/app/use_cases/report/column_validation.py:9-50` — `validate_columns_metadata()`
**Specified in:** `openspec/specs/report-column-metadata/spec.md`

### Invariants

> A Report SHALL have `report_type` of `"fact"` or `"dimension"`.

**Enforced in:** `backend/app/models/report.py` — string field (no enum constraint in model; validated at schema layer)
**Specified in:** `features/report-layer-chat-first.feature`

> Reports SHALL NOT reference other reports (no mart-to-mart dependencies).

**Enforced in:** `backend/app/use_cases/report/create_report.py` — raises `InvalidReportReference`
**Specified in:** `openspec/specs/report-column-metadata/spec.md` (implicit)

### Defaults

| Field | Default | Enforced in |
|:------|:--------|:------------|
| `domain` | `"Organization"` | `backend/app/models/report.py:44` |
| `materialization` | `"view"` | `backend/app/models/report.py:46` |

---

## Upload

### Status Lifecycle

| Current | Event | Next | Guard |
|:--------|:------|:-----|:------|
| `pending` | Format detected, single-sheet | `processing` | — |
| `pending` | Multi-sheet file detected | `awaiting_input` | choices list populated |
| `awaiting_input` | User selects sheet(s) | `processing` | `POST /uploads/{id}/process` |
| `processing` | Conversion succeeds | `completed` | dataset_id(s) populated |
| `processing` | Conversion fails | `failed` | error_message populated |
| `completed` | — | terminal | — |
| `failed` | — | terminal | — |

**Enforced in:** `backend/app/models/upload.py` (status field) + `backend/app/use_cases/upload/upload_file.py`
**Specified in:** `docs/diagrams/state/upload-status.mermaid`

### Domain Exceptions

| Exception | Code | Trigger |
|:----------|:----:|:--------|
| `UploadNotFound` | 404 | Upload ID doesn't exist |
| `UploadAlreadyProcessed` | 409 | Attempting to process a completed/failed upload |
| `InvalidFileType` | 400 | File extension not recognized |
| `UnsupportedFormat` | 400 | No plugin can handle the file |
| `EmptyFile` | 400 | File has zero rows or no content |

**Enforced in:** `backend/app/use_cases/upload/exceptions.py`

---

## Session

### Ownership Rules

> Session `owner_id` SHALL be set at creation and SHALL NOT be changed afterward.

> Only the session owner SHALL update or delete the session. Any org member SHALL read (list) sessions.

**Enforced in:** `backend/app/use_cases/session/update_session.py` — raises `SessionAccessDenied` if `user.id != session.owner_id`
**Specified in:** `openspec/specs/session-ownership/spec.md`

### Title Management

> Session title SHALL be set to the first user message, truncated to 100 characters.

> Subsequent messages SHALL NOT overwrite the title.

**Enforced in:** Frontend (chat client sets title on first message)
**Specified in:** `openspec/specs/session-title-management/spec.md`

---

## Project

### Cascade Delete Behavior

When a project is deleted, the following records are cascade-deleted via SQLAlchemy:

| Parent | Cascaded Entity | Cascade Type |
|:-------|:----------------|:-------------|
| Project | Datasets | `all, delete-orphan` |
| Project | Views | `all, delete-orphan` |
| Project | Reports | `all, delete-orphan` |
| Project | Project Memories | `all, delete-orphan` (→ cascades to Sessions) |
| Project | External Access | FK `CASCADE DELETE` |
| Dataset | Transforms | `all, delete-orphan` |
| Project Memory | Sessions | FK `CASCADE DELETE` |

> S3 Parquet files are NOT cleaned up on cascade delete. This is a known gap tracked in `s3-lifecycle-cleanup`.

**Enforced in:** `backend/app/repositories/metadata/project_record.py:37-45` — SQLAlchemy `relationship(cascade=...)`
**Specified in:** Undocumented

---

## SQL Access

### Credential Lifecycle

> SQL access is a per-project toggle. Only one `external_access` record SHALL exist per project (unique constraint on `project_id`).

> Credential regeneration SHALL enforce a 60-second cooldown. Requests within the cooldown raise `CredentialCooldown` (HTTP 429).

> SQL access SHALL NOT be enabled for projects with zero datasets. Raises `ProjectHasNoDatasets` (HTTP 400).

**Enforced in:** `backend/app/use_cases/sql_access/` — `enable_sql_access.py`, `regenerate_sql_credentials.py`
**Specified in:** `features/external-data-access.feature`, `docs/requirements/nfr.md` NFR-A5

### Sync Rules

> Dataset uploads and transform changes SHALL automatically propagate to the query engine via outbox events (`DatasetSyncRequested`, `TransformSyncRequested`, `DatasetRemoved`).

**Enforced in:** `backend/app/use_cases/dataset/create_dataset_from_upload.py:162-172`, `backend/app/use_cases/dataset/update_transforms.py:46-50`
**Specified in:** `docs/requirements/nfr.md` NFR-A4

---

## Cross-Cutting Rules

### Authorization Model

| Resource | Operation | Who Can Access | Enforcement |
|:---------|:----------|:---------------|:------------|
| Project | read/write | Users where `user.org_id == project.org_id` | `deps.py:authorize_project_access()` |
| Dataset | read/write | Users where `user.org_id == dataset.project.org_id` | `deps.py:authorize_dataset_access()` |
| View | read/write | Users where `user.org_id == view.org_id` | Router-level via project authorization |
| Report | read/write | Users where `user.org_id == report.org_id` | Router-level via project authorization |
| Session | read | Any user in the org | No owner check on `list_sessions` |
| Session | write | Session owner only (`user.id == session.owner_id`) | `update_session.py` raises `SessionAccessDenied` |
| Organization | create | Any authenticated user (even without org) | `ORG_LESS_PATHS` in auth middleware |

**Enforced in:** `backend/app/routers/deps.py`, `backend/app/auth/middleware.py`
**Specified in:** `openspec/specs/session-ownership/spec.md` (session only), `openspec/specs/router-layer-authorization/spec.md`

### Multi-Tenancy

> All data queries SHALL be scoped by `org_id` via `RestrictedSession`.

**Enforced in:** `backend/app/repositories/metadata/repository.py` — RestrictedSession appends `WHERE org_id = ?` to all queries
**Specified in:** `docs/architecture/backend-layers.md`, `docs/requirements/nfr.md` NFR-MT1

### Domain Exception Catalog

All domain exceptions inherit from `DomainException` and carry `_type`, `_title`, and `_status_code`:

| Exception | Status | Domain |
|:----------|:------:|:-------|
| `ProjectNotFound` | 404 | Project |
| `ProjectIdRequired` | 400 | Project |
| `ProjectHasNoDatasets` | 400 | Project |
| `ExportValidationError` | 400 | Project |
| `DatasetNotFound` | 404 | Dataset |
| `InvalidExpressionConfig` | 400 | Dataset |
| `ColumnTypeMismatch` | 422 | Dataset |
| `PreviewNotSupported` | 400 | Dataset |
| `ViewNotFound` | 404 | View |
| `InvalidSourceReference` | 400 | View |
| `CircularDependency` | 400 | View |
| `ReportNotFound` | 404 | Report |
| `InvalidReportReference` | 400 | Report |
| `InvalidColumnMetadata` | 400 | Report |
| `UploadNotFound` | 404 | Upload |
| `UploadAlreadyProcessed` | 409 | Upload |
| `InvalidFileType` | 400 | Upload |
| `UnsupportedFormat` | 400 | Upload |
| `EmptyFile` | 400 | Upload |
| `SessionNotFound` | 404 | Session |
| `SessionAccessDenied` | 403 | Session |
| `SqlAccessAlreadyEnabled` | 409 | SQL Access |
| `SqlAccessNotEnabled` | 404 | SQL Access |
| `CredentialCooldown` | 429 | SQL Access |
| `QueryEngineUnreachable` | 502 | SQL Access |
| `PluginValidationError` | 400 | Upload |
| `ExternalServiceError` | 502 | Organization |

**Enforced in:** `backend/app/use_cases/*/exceptions.py`
**Specified in:** Undocumented (code-only)
