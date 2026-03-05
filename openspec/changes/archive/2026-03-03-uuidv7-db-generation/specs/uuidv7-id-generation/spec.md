## MODIFIED Requirements

### Requirement: ORM models use UUIDv7 for ID generation
All ORM entity models SHALL generate UUIDv7 IDs via `server_default=text("uuidv7()")` on their `id` column. The database SHALL be the authority for ID generation — not Python-side `default=` callables. The `id` column type SHALL remain `String(36)`.

#### Scenario: ProjectRecord generates UUIDv7 ID via server_default
- **WHEN** a `ProjectRecord` is inserted without an explicit `id` value
- **THEN** the database SHALL generate a valid UUIDv7 string via the `uuidv7()` function
- **AND** the `id` column definition SHALL use `server_default=text("uuidv7()")` with no `default=` parameter

#### Scenario: DatasetRecord generates UUIDv7 ID via server_default
- **WHEN** a `DatasetRecord` is inserted without an explicit `id` value
- **THEN** the database SHALL generate a valid UUIDv7 string via the `uuidv7()` function
- **AND** explicit `id` values passed by callers SHALL continue to override the server_default

#### Scenario: TransformRecord generates UUIDv7 ID via server_default
- **WHEN** a `TransformRecord` is inserted without an explicit `id` value
- **THEN** the database SHALL generate a valid UUIDv7 string via the `uuidv7()` function

#### Scenario: OrganizationRecord generates UUIDv7 ID via server_default
- **WHEN** an `OrganizationRecord` is inserted without an explicit `id` value
- **THEN** the database SHALL generate a valid UUIDv7 string via the `uuidv7()` function

#### Scenario: ExternalAccessRecord generates UUIDv7 ID via server_default
- **WHEN** an `ExternalAccessRecord` is inserted without an explicit `id` value
- **THEN** the database SHALL generate a valid UUIDv7 string via the `uuidv7()` function

#### Scenario: OutboxRecord generates UUIDv7 ID via server_default
- **WHEN** an `OutboxRecord` is inserted without an explicit `id` value
- **THEN** the database SHALL generate a valid UUIDv7 string via the `uuidv7()` function

### MODIFIED Requirements

### Requirement: No database schema changes
**This requirement is REMOVED by the current change.** The migration to database-level `server_default` requires squashing existing Alembic migrations and generating a new initial schema that includes the `DEFAULT uuidv7()` clause.

## REMOVED Requirements

### Requirement: No database schema changes
**Reason**: Moving ID generation to `server_default` inherently changes the DDL (adds `DEFAULT uuidv7()` to all ID columns) and requires a migration squash.
**Migration**: Replaced by the `db-uuid-generation` capability's "Migration squash to single initial schema" requirement.
