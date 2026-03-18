# uuidv7-id-generation Specification

## Purpose
TBD - created by archiving change uuidv7-deterministic-test-ids. Update Purpose after archive.
## Requirements
### Requirement: ORM models use UUIDv7 for ID generation
All ORM entity models SHALL use `uuid7()` from `uuid-utils` as their Python-side default for the `id` column. The `uuid4()` import and usage SHALL be removed from all ORM model files.

#### Scenario: ProjectRecord generates UUIDv7 ID
- **WHEN** a `ProjectRecord` is created without an explicit `id` value
- **THEN** the `id` field SHALL be populated with a valid UUIDv7 string (36-character hyphenated format, version nibble = 7)

#### Scenario: DatasetRecord generates UUIDv7 ID
- **WHEN** a `DatasetRecord` is created without an explicit `id` value
- **THEN** the `id` field SHALL be populated with a valid UUIDv7 string
- **AND** the existing behavior where callers pass an explicit `id` SHALL continue to work (explicit values override the default)

#### Scenario: TransformRecord generates UUIDv7 ID
- **WHEN** a `TransformRecord` is created without an explicit `id` value
- **THEN** the `id` field SHALL be populated with a valid UUIDv7 string

#### Scenario: OrganizationRecord generates UUIDv7 ID
- **WHEN** an `OrganizationRecord` is created without an explicit `id` value
- **THEN** the `id` field SHALL be populated with a valid UUIDv7 string

#### Scenario: ExternalAccessRecord generates UUIDv7 ID
- **WHEN** an `ExternalAccessRecord` is created without an explicit `id` value
- **THEN** the `id` field SHALL be populated with a valid UUIDv7 string

#### Scenario: OutboxRecord retains existing UUIDv7 default
- **WHEN** an `OutboxRecord` is created without an explicit `id` value
- **THEN** the `id` field SHALL continue to use its existing `uuid7()` default (no change required)

### Requirement: No database schema changes
The migration to UUIDv7 SHALL NOT require any Alembic migration. Column types SHALL remain `String(36)`. No `server_default` SHALL be added.

#### Scenario: Column type unchanged
- **WHEN** the ORM model defaults are updated to `uuid7()`
- **THEN** no new Alembic migration file SHALL be created
- **AND** the `String(36)` column type on all `id` columns SHALL remain unchanged

