# Capability: cleaning-transforms

Data model, API schemas, validation rules, and CRUD lifecycle for cleaning/alias/map transform types.

This capability extends the existing filter transform system to support four transform categories (`filter`, `clean`, `alias`, `map`) that share a common lifecycle but express different SQL semantics: row-level predicates (filter) vs column-level expressions (clean, alias, map).

---

## ADDED Requirements

### Requirement: Transform Type Distinction

The system SHALL distinguish transforms by type using a `transform_type` field on the Transform model. The supported values SHALL be `filter`, `clean`, `alias`, and `map`.

- The `transform_type` field SHALL be stored as VARCHAR(20), NOT NULL, with a DEFAULT of `'filter'`.
- Application-level validation SHALL enforce allowed values via a `TransformType = Literal['filter', 'clean', 'alias', 'map']` type annotation.
- The database SHALL NOT use a CHECK constraint for `transform_type` (SQLite does not enforce CHECK constraints reliably).
- All four types SHALL share the same CRUD endpoints and lifecycle states (`enabled`, `disabled`, `deleted`).

#### Scenario: Create a cleaning transform with explicit type

- **WHEN** a client sends a POST to `/api/datasets/{id}/transforms` with `transform_type` set to `"clean"`, `target_column` set to `"name"`, and a valid `expression_config` for a trim operation
- **THEN** the system SHALL create a transform record with `transform_type = 'clean'`
- **THEN** the persisted record SHALL include the `transform_type` field in its stored and returned representation

#### Scenario: Each transform type is distinguishable in responses

- **WHEN** a dataset has transforms of types `filter`, `clean`, `alias`, and `map`
- **THEN** the GET `/api/datasets/{id}` response (with `includeTransforms=true`) SHALL return each transform with its `transform_type` field populated
- **THEN** consumers SHALL be able to filter or group transforms by type using the `transform_type` field

#### Scenario: Invalid transform type is rejected

- **WHEN** a client sends a POST to `/api/datasets/{id}/transforms` with `transform_type` set to `"aggregate"` (an unsupported value)
- **THEN** the system SHALL return a 422 validation error
- **THEN** no transform record SHALL be created

---

### Requirement: Backward Compatibility

The system SHALL maintain full backward compatibility with existing filter transform clients. Omitting the `transform_type` field in a create request SHALL default to `'filter'`, and all existing filter transforms SHALL continue to work without modification.

- When `transform_type` is omitted from a `TransformCreate` payload, the system SHALL default it to `'filter'`.
- Existing transforms (created before this change) SHALL be treated as `transform_type = 'filter'` with `target_column`, `expression_config`, and `expression_sql` all NULL.
- The existing `condition_json` and `condition_sql` fields SHALL remain the authoritative fields for filter transforms.
- No data migration of existing transform records SHALL be required. The database migration SHALL use DEFAULT `'filter'` so all existing rows receive the correct type.

#### Scenario: Legacy filter create request without transform_type

- **WHEN** a client sends a POST to `/api/datasets/{id}/transforms` with `condition_json` and `condition_sql` populated but no `transform_type` field
- **THEN** the system SHALL create the transform with `transform_type = 'filter'`
- **THEN** the response SHALL include `transform_type: "filter"`
- **THEN** the transform SHALL function identically to transforms created before this change

#### Scenario: Existing filter transforms remain functional after migration

- **WHEN** the Alembic migration has been applied to a database containing existing filter transforms
- **THEN** all existing transforms SHALL have `transform_type = 'filter'` (populated by the column default)
- **THEN** all existing transforms SHALL have `target_column`, `expression_config`, and `expression_sql` as NULL
- **THEN** all existing transforms SHALL continue to be applied as WHERE clauses in `_build_table()` without modification

#### Scenario: TransformResponse includes new fields for existing filters

- **WHEN** the system returns a TransformResponse for a pre-existing filter transform
- **THEN** the response SHALL include `transform_type: "filter"`, `target_column: null`, `expression_config: null`, and `expression_sql: null`
- **THEN** the existing fields (`condition_json`, `condition_sql`, `name`, `status`, etc.) SHALL be unchanged

---

### Requirement: Column Targeting

Cleaning, alias, and map transforms SHALL target a specific column via a `target_column` field. Filter transforms SHALL NOT use this field.

- The `target_column` field SHALL be stored as VARCHAR(255), NULL.
- `target_column` SHALL be required (non-null) when `transform_type` is `clean`, `alias`, or `map`.
- `target_column` SHALL be NULL when `transform_type` is `filter`.
- The value of `target_column` SHALL correspond to an actual column name in the dataset's schema (the raw column name, not an alias).

#### Scenario: Cleaning transform specifies target column

- **WHEN** a client creates a cleaning transform with `transform_type = "clean"`, `target_column = "name"`, and a valid trim `expression_config`
- **THEN** the system SHALL persist the transform with `target_column = "name"`
- **THEN** the transform SHALL operate exclusively on the `name` column when applied

#### Scenario: Cleaning transform without target column is rejected

- **WHEN** a client sends a POST to `/api/datasets/{id}/transforms` with `transform_type = "clean"` and `target_column` omitted or set to NULL
- **THEN** the system SHALL return a 422 validation error indicating that `target_column` is required for cleaning transforms
- **THEN** no transform record SHALL be created

#### Scenario: Filter transform with target column is rejected

- **WHEN** a client sends a POST to `/api/datasets/{id}/transforms` with `transform_type = "filter"` and `target_column = "name"`
- **THEN** the system SHALL return a 422 validation error indicating that `target_column` must be NULL for filter transforms
- **THEN** no transform record SHALL be created

---

### Requirement: Expression Storage

Cleaning, alias, and map transforms SHALL store their operation configuration in an `expression_config` (structured JSON) field and a server-generated `expression_sql` (SQL text) field. These fields SHALL be distinct from the existing `condition_json` and `condition_sql` fields used by filter transforms.

- `expression_config` SHALL be stored as a JSON column, NULL.
- `expression_sql` SHALL be stored as a TEXT column, NULL.
- The client SHALL send `expression_config` only. The server SHALL generate `expression_sql` from the `expression_config`. Any client-provided `expression_sql` in create requests SHALL be ignored and overwritten by the server-generated value.
- `expression_config` SHALL always contain an `operation` field as a discriminator.
- The supported `expression_config` structures SHALL be:
  - Trim: `{"operation": "trim", "column": "<col>"}`
  - Case: `{"operation": "case", "column": "<col>", "mode": "title" | "upper" | "lower"}`
  - Fill null: `{"operation": "fill_null", "column": "<col>", "fill_value": "<value>", "fill_type": "text" | "numeric"}`
  - Map values: `{"operation": "map_values", "column": "<col>", "mappings": [{"from": "<src>", "to": "<dst>"}, ...]}`
  - Alias: `{"operation": "alias", "column": "<col>", "alias": "<display_name>"}`

#### Scenario: Server generates expression_sql for a trim transform

- **WHEN** a client creates a cleaning transform with `expression_config = {"operation": "trim", "column": "name"}`
- **THEN** the system SHALL generate `expression_sql` (e.g., `TRIM(name)`) on the server side
- **THEN** the persisted and returned transform SHALL include both `expression_config` and the server-generated `expression_sql`

#### Scenario: Client-provided expression_sql is overwritten

- **WHEN** a client creates a cleaning transform with `expression_config = {"operation": "trim", "column": "name"}` and also provides `expression_sql = "DROP TABLE users"`
- **THEN** the system SHALL ignore the client-provided `expression_sql`
- **THEN** the system SHALL generate and persist its own `expression_sql` from the `expression_config`
- **THEN** the persisted `expression_sql` SHALL be the server-generated value (e.g., `TRIM(name)`)

#### Scenario: Expression config for case standardization

- **WHEN** a client creates a cleaning transform with `expression_config = {"operation": "case", "column": "city", "mode": "title"}`
- **THEN** the system SHALL generate `expression_sql` corresponding to a title-case operation (e.g., `INITCAP(city)`)
- **THEN** the transform SHALL be persisted with both the config and the generated SQL

#### Scenario: Expression config for fill null

- **WHEN** a client creates a cleaning transform with `expression_config = {"operation": "fill_null", "column": "department", "fill_value": "Unknown", "fill_type": "text"}`
- **THEN** the system SHALL generate `expression_sql` corresponding to a null-coalesce operation (e.g., `COALESCE(department, 'Unknown')`)
- **THEN** the transform SHALL be persisted with both the config and the generated SQL

#### Scenario: Expression config for value mapping

- **WHEN** a client creates a map transform with `expression_config = {"operation": "map_values", "column": "state", "mappings": [{"from": "NY", "to": "New York"}, {"from": "CA", "to": "California"}]}`
- **THEN** the system SHALL generate `expression_sql` corresponding to a CASE WHEN expression
- **THEN** the generated SQL SHALL use exact match semantics (not substring or pattern matching)
- **THEN** unmapped values SHALL be preserved via an ELSE clause that returns the original column value

#### Scenario: Expression config for alias

- **WHEN** a client creates an alias transform with `expression_config = {"operation": "alias", "column": "emp_id", "alias": "Employee ID"}`
- **THEN** the system SHALL generate `expression_sql` corresponding to a column rename (e.g., `emp_id AS "Employee ID"`)
- **THEN** the transform SHALL be persisted with both the config and the generated SQL

#### Scenario: Expression config missing operation field is rejected

- **WHEN** a client sends an `expression_config` without an `operation` field (e.g., `{"column": "name"}`)
- **THEN** the system SHALL return a 422 validation error
- **THEN** no transform record SHALL be created

---

### Requirement: Cross-Field Validation

The `TransformCreate` schema SHALL enforce cross-field validation rules based on `transform_type`. A Pydantic `@model_validator(mode='after')` SHALL ensure that each transform type provides the correct set of fields and rejects incompatible fields.

The validation matrix SHALL be:

| Field | `filter` | `clean` | `alias` | `map` |
|-------|----------|---------|---------|-------|
| `condition_json` | Required | Must be NULL | Must be NULL | Must be NULL |
| `condition_sql` | Required | Must be NULL | Must be NULL | Must be NULL |
| `expression_config` | Must be NULL | Required | Required | Required |
| `expression_sql` | Must be NULL | Server-generated | Server-generated | Server-generated |
| `target_column` | Must be NULL | Required | Required | Required |

#### Scenario: Filter transform with all required fields passes validation

- **WHEN** a client sends `transform_type = "filter"` with `condition_json` and `condition_sql` populated, and `expression_config`, `expression_sql`, and `target_column` all NULL or absent
- **THEN** the system SHALL accept the request and create the filter transform

#### Scenario: Filter transform missing condition_json is rejected

- **WHEN** a client sends `transform_type = "filter"` with `condition_json` set to NULL
- **THEN** the system SHALL return a 422 validation error indicating `condition_json` is required for filter transforms

#### Scenario: Filter transform with expression fields is rejected

- **WHEN** a client sends `transform_type = "filter"` with `condition_json` populated AND `expression_config` also populated
- **THEN** the system SHALL return a 422 validation error indicating that expression fields are not allowed for filter transforms

#### Scenario: Cleaning transform with all required fields passes validation

- **WHEN** a client sends `transform_type = "clean"` with `target_column` and `expression_config` populated, and `condition_json` and `condition_sql` both NULL or absent
- **THEN** the system SHALL accept the request and create the cleaning transform

#### Scenario: Cleaning transform with condition fields is rejected

- **WHEN** a client sends `transform_type = "clean"` with `expression_config` populated AND `condition_json` also populated
- **THEN** the system SHALL return a 422 validation error indicating that condition fields are not allowed for cleaning transforms

#### Scenario: Map transform with all required fields passes validation

- **WHEN** a client sends `transform_type = "map"` with `target_column` and `expression_config` (containing `operation = "map_values"` and a `mappings` array) populated, and `condition_json` and `condition_sql` both NULL or absent
- **THEN** the system SHALL accept the request and create the map transform

#### Scenario: Alias transform with all required fields passes validation

- **WHEN** a client sends `transform_type = "alias"` with `target_column` and `expression_config` (containing `operation = "alias"` and an `alias` string) populated, and `condition_json` and `condition_sql` both NULL or absent
- **THEN** the system SHALL accept the request and create the alias transform

#### Scenario: Validation error messages identify the offending fields

- **WHEN** a cross-field validation error occurs
- **THEN** the error response SHALL identify which fields are invalid and why (e.g., "condition_json must be null for transform_type 'clean'")
- **THEN** the error response SHALL use a 422 status code

---

### Requirement: Database Migration

An Alembic migration SHALL add the four new columns to the `transforms` table. The migration SHALL be backward-compatible, reversible, and work on both SQLite and PostgreSQL.

- The migration SHALL add the following columns:
  - `transform_type` -- VARCHAR(20), NOT NULL, DEFAULT `'filter'`
  - `target_column` -- VARCHAR(255), NULL
  - `expression_sql` -- TEXT, NULL
  - `expression_config` -- JSON, NULL
- The migration SHALL NOT require any data migration. All existing rows SHALL receive `transform_type = 'filter'` via the column default.
- The migration's downgrade function SHALL drop the four added columns.
- The migration SHALL be compatible with both SQLite (via aiosqlite) and PostgreSQL (via asyncpg).
- The migration SHALL NOT add database-level CHECK constraints for `transform_type`.

#### Scenario: Upgrade migration adds columns to existing table

- **WHEN** the Alembic upgrade migration is executed against a database with an existing `transforms` table containing filter transform rows
- **THEN** the `transforms` table SHALL have four new columns: `transform_type`, `target_column`, `expression_sql`, `expression_config`
- **THEN** all pre-existing rows SHALL have `transform_type = 'filter'` and the three new nullable columns as NULL
- **THEN** the migration SHALL complete without errors on both SQLite and PostgreSQL

#### Scenario: Downgrade migration removes columns

- **WHEN** the Alembic downgrade migration is executed
- **THEN** the four columns (`transform_type`, `target_column`, `expression_sql`, `expression_config`) SHALL be dropped from the `transforms` table
- **THEN** any cleaning transforms created after the upgrade SHALL lose their expression data
- **THEN** pre-existing filter transforms SHALL remain intact (their `condition_json` and `condition_sql` are unaffected)

#### Scenario: Migration is idempotent with empty table

- **WHEN** the Alembic upgrade migration is executed against a database with an empty `transforms` table
- **THEN** the migration SHALL complete without errors
- **THEN** new transforms of any type SHALL be insertable into the table

---

### Requirement: Type Safety for Column Operations

The system SHALL validate that cleaning operations are compatible with the target column's data type. Text-only operations MUST be rejected for non-text columns, and fill values MUST match the column's data type.

- Trimming (`operation: "trim"`) SHALL be rejected for non-text columns (numeric, date, boolean).
- Case standardization (`operation: "case"`) SHALL be rejected for non-text columns.
- Fill null (`operation: "fill_null"`) SHALL validate that the `fill_value` is compatible with the column's data type. A text fill value for a numeric column SHALL be rejected.
- Value mapping (`operation: "map_values"`) SHALL be accepted for text columns. Behavior for non-text columns is undefined in v1.
- Alias (`operation: "alias"`) SHALL be accepted for any column type.
- Column type information SHALL be derived from the dataset's Parquet schema (the source of truth for column types).

#### Scenario: Trim on a numeric column is rejected

- **WHEN** a client creates a cleaning transform with `operation = "trim"` targeting a column whose Parquet schema type is numeric (e.g., INTEGER, DOUBLE)
- **THEN** the system SHALL return a 422 error indicating that trimming applies only to text columns
- **THEN** no transform record SHALL be created

#### Scenario: Case standardization on a numeric column is rejected

- **WHEN** a client creates a cleaning transform with `operation = "case"` targeting a column whose Parquet schema type is numeric
- **THEN** the system SHALL return a 422 error indicating that case operations apply only to text columns
- **THEN** no transform record SHALL be created

#### Scenario: Text fill value for a numeric column is rejected

- **WHEN** a client creates a cleaning transform with `operation = "fill_null"`, `fill_value = "N/A"`, and `fill_type = "text"` targeting a numeric column
- **THEN** the system SHALL return a 422 error indicating a type mismatch between the fill value and the column type
- **THEN** no transform record SHALL be created

#### Scenario: Numeric fill value for a numeric column is accepted

- **WHEN** a client creates a cleaning transform with `operation = "fill_null"`, `fill_value = "0"`, and `fill_type = "numeric"` targeting a numeric column
- **THEN** the system SHALL accept the request and create the transform

#### Scenario: Alias on a numeric column is accepted

- **WHEN** a client creates an alias transform targeting a numeric column
- **THEN** the system SHALL accept the request and create the alias transform
- **THEN** the column's display name SHALL change without affecting its data type or values

#### Scenario: Trim on a text column is accepted

- **WHEN** a client creates a cleaning transform with `operation = "trim"` targeting a column whose Parquet schema type is VARCHAR or STRING
- **THEN** the system SHALL accept the request and create the transform

---

### Requirement: CRUD Lifecycle for Cleaning Transforms

All transform types (`filter`, `clean`, `alias`, `map`) SHALL share the same CRUD lifecycle: creation (POST), status management via PATCH (enabled/disabled/deleted), and retrieval via the dataset GET endpoint. The lifecycle states SHALL be `enabled`, `disabled`, and `deleted` (soft-delete).

- A newly created transform SHALL have `status = 'enabled'` by default.
- A transform's status MAY be changed to `disabled` via the PATCH `/api/datasets/{id}/transforms` endpoint. A disabled transform SHALL NOT be applied during query execution but SHALL remain retrievable.
- A transform's status MAY be changed to `deleted` via the same PATCH endpoint. A deleted transform SHALL be soft-deleted (not removed from the database) and SHALL NOT be applied during query execution.
- A deleted transform SHALL NOT be re-enabled. Only `disabled` transforms MAY be re-enabled.
- The same PATCH endpoint and payload format SHALL work for all transform types. No separate endpoints SHALL be required for managing cleaning vs filter transforms.
- The create endpoint (POST `/api/datasets/{id}/transforms`) SHALL accept cleaning transform payloads alongside existing filter payloads, determined by `transform_type`.

#### Scenario: Create a cleaning transform

- **WHEN** a client sends a POST to `/api/datasets/{id}/transforms` with a valid cleaning transform payload (type `clean`, target column, expression config)
- **THEN** the system SHALL create the transform with `status = 'enabled'`
- **THEN** the response SHALL include the full TransformResponse with all fields populated (including server-generated `expression_sql`)

#### Scenario: Disable a cleaning transform

- **WHEN** a client sends a PATCH to `/api/datasets/{id}/transforms` with `{"updates": [{"id": "<transform_id>", "status": "disabled"}]}` for a cleaning transform
- **THEN** the transform's status SHALL change to `disabled`
- **THEN** the transform SHALL NOT be applied when the dataset is queried
- **THEN** the transform SHALL still be returned in the dataset's transform list

#### Scenario: Re-enable a disabled cleaning transform

- **WHEN** a client sends a PATCH to `/api/datasets/{id}/transforms` with `{"updates": [{"id": "<transform_id>", "status": "enabled"}]}` for a disabled cleaning transform
- **THEN** the transform's status SHALL change to `enabled`
- **THEN** the transform SHALL be applied again when the dataset is queried

#### Scenario: Soft-delete a cleaning transform

- **WHEN** a client sends a PATCH to `/api/datasets/{id}/transforms` with `{"updates": [{"id": "<transform_id>", "status": "deleted"}]}` for a cleaning transform
- **THEN** the transform's status SHALL change to `deleted`
- **THEN** the transform SHALL NOT be applied when the dataset is queried
- **THEN** the transform SHALL NOT be re-enabled

#### Scenario: Re-enable a deleted transform is rejected

- **WHEN** a client sends a PATCH to `/api/datasets/{id}/transforms` with `{"updates": [{"id": "<transform_id>", "status": "enabled"}]}` for a soft-deleted cleaning transform
- **THEN** the system SHALL reject the request
- **THEN** the transform SHALL remain in `deleted` status

#### Scenario: Disable and re-enable a filter transform (unchanged behavior)

- **WHEN** a client sends a PATCH to disable and then re-enable a filter transform
- **THEN** the lifecycle SHALL work identically to how it worked before this change
- **THEN** no regression in filter transform lifecycle behavior SHALL occur

#### Scenario: Create an alias transform (immediate application, no preview)

- **WHEN** a client sends a POST to `/api/datasets/{id}/transforms` with `transform_type = "alias"`, `target_column = "emp_id"`, and `expression_config = {"operation": "alias", "column": "emp_id", "alias": "Employee ID"}`
- **THEN** the system SHALL create the alias transform with `status = 'enabled'`
- **THEN** the column header SHALL display "Employee ID" in subsequent dataset queries

#### Scenario: Create a map transform

- **WHEN** a client sends a POST to `/api/datasets/{id}/transforms` with `transform_type = "map"`, `target_column = "state"`, and `expression_config = {"operation": "map_values", "column": "state", "mappings": [{"from": "NY", "to": "New York"}]}`
- **THEN** the system SHALL create the map transform with `status = 'enabled'`
- **THEN** cells containing exactly `"NY"` in the `state` column SHALL display `"New York"` in subsequent queries
- **THEN** cells containing `"NYC"` or `"NY State"` SHALL remain unchanged (exact match only)

---

### Requirement: API Schema Extensions

The `TransformCreate`, `TransformResponse`, and `TransformUpdate` Pydantic schemas SHALL be extended with the new fields. All new fields SHALL be optional with appropriate defaults to preserve backward compatibility.

- `TransformCreate` SHALL add: `transform_type: str = "filter"`, `target_column: str | None = None`, `expression_config: dict | None = None`, `expression_sql: str | None = None`.
- `TransformResponse` SHALL add: `transform_type: str`, `target_column: str | None`, `expression_config: dict | None`, `expression_sql: str | None`.
- `TransformUpdate` SHALL add: `expression_config: dict | None`, `expression_sql: str | None`.
- `TransformUpdate` SHALL NOT allow changing `transform_type` or `target_column` after creation.

#### Scenario: TransformCreate schema accepts cleaning payload

- **WHEN** a client sends a TransformCreate payload with `name = "Trim Name"`, `transform_type = "clean"`, `target_column = "name"`, `expression_config = {"operation": "trim", "column": "name"}`
- **THEN** the Pydantic schema SHALL validate successfully
- **THEN** the cross-field validator SHALL confirm that condition fields are NULL and expression fields are present

#### Scenario: TransformResponse includes all new fields

- **WHEN** the system returns a TransformResponse for a cleaning transform
- **THEN** the response SHALL include `transform_type`, `target_column`, `expression_config`, and `expression_sql` alongside all existing fields (`id`, `dataset_id`, `name`, `description`, `condition_json`, `condition_sql`, `version`, `status`, `nl_prompt`, `created_at`, `updated_at`)

#### Scenario: TransformUpdate cannot change transform_type

- **WHEN** a client sends a PATCH with `transform_type` set to a different value than the existing transform's type
- **THEN** the system SHALL either ignore the field or return a validation error
- **THEN** the transform's `transform_type` SHALL remain unchanged

#### Scenario: TransformUpdate cannot change target_column

- **WHEN** a client sends a PATCH with `target_column` set to a different column than the existing transform's target
- **THEN** the system SHALL either ignore the field or return a validation error
- **THEN** the transform's `target_column` SHALL remain unchanged
