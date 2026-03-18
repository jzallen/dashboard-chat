## MODIFIED Requirements

### Requirement: Shared UUIDv7 test constant pool
A module at `backend/tests/uuidv7_fixtures.py` SHALL provide named constants for all entity types used in test fixtures. Each constant SHALL be a valid UUIDv7 string (36-character hyphenated format, version nibble = 7, variant bits = 10).

Additionally, the module SHALL expose a factory function for creating a deterministic auto-incrementing `uuidv7()` callable, used as the backing implementation for the SQLite custom function in tests.

#### Scenario: Constants cover all entity domains
- **WHEN** the fixture module is imported
- **THEN** it SHALL provide named constants for at minimum:
  - Projects: `PROJECT_1`, `PROJECT_2`, `PROJECT_EMPTY`, `PROJECT_OTHER`
  - Datasets: `DATASET_1`, `DATASET_2`, `DATASET_3`, `DATASET_OTHER`
  - Transforms: `TRANSFORM_1`, `TRANSFORM_2`
  - Users: `USER_1`, `USER_2`
  - Organizations: `ORG_1`, `ORG_OTHER`
  - External access: `EA_1`, `EA_DISABLED`

#### Scenario: Constants are valid UUIDv7
- **WHEN** any constant from the pool is parsed as a UUID
- **THEN** it SHALL have version = 7 and variant = RFC 4122

#### Scenario: Constants are visually distinguishable by domain
- **WHEN** an engineer reads a test failure message containing a constant value
- **THEN** the domain (project, dataset, transform, etc.) SHALL be identifiable from the ID's second segment (e.g., `0001` for projects, `1001` for datasets)

#### Scenario: Auto-generated IDs use a distinct segment
- **WHEN** the deterministic `uuidv7()` function generates an ID (via SQLite server_default)
- **THEN** the ID SHALL use a segment prefix distinct from the explicit fixture domains (e.g., `f0xx`)
- **AND** the ID SHALL be a valid UUIDv7 string

### Requirement: Test conftest registers deterministic uuidv7 SQLite function
The root test `conftest.py` SHALL register a custom `uuidv7()` function on the SQLite test engine that returns deterministic, auto-incrementing UUIDv7 strings.

#### Scenario: Test engine registers uuidv7 on connect
- **WHEN** the `db_session` fixture creates a SQLite test engine
- **THEN** a `"connect"` event listener SHALL register a `uuidv7` function (0 arguments) on the raw DBAPI connection
- **AND** the function SHALL return values from a deterministic counter-based generator

#### Scenario: Auto-generated test IDs are sequential
- **WHEN** multiple records are inserted without explicit IDs in the same test session
- **THEN** the generated IDs SHALL increment sequentially (e.g., `019515a0-f001-...`, `019515a0-f002-...`)

#### Scenario: Counter resets per test
- **WHEN** a new `db_session` fixture is created for a different test
- **THEN** the deterministic counter SHALL reset to its initial state
- **AND** the first auto-generated ID SHALL be the same across tests

### Requirement: Test conftest files use shared constants
All test conftest files SHALL import IDs from `backend/tests/uuidv7_fixtures.py` instead of using hardcoded string IDs. This requirement is unchanged from the predecessor change.

#### Scenario: Project test conftest migration
- **WHEN** `backend/tests/use_cases/project/conftest.py` creates seeded records
- **THEN** it SHALL use constants from `uuidv7_fixtures` (e.g., `PROJECT_1` instead of `"project-001"`)
- **AND** storage paths SHALL incorporate the new constants (e.g., `f"datasets/{PROJECT_1}/{DATASET_1}/"`)

#### Scenario: Dataset test conftest migration
- **WHEN** `backend/tests/use_cases/dataset/conftest.py` creates seeded records
- **THEN** it SHALL use constants from `uuidv7_fixtures` (e.g., `DATASET_1` instead of `"dataset-001"`)

#### Scenario: All other conftest files migrated
- **WHEN** any test conftest file creates seeded records
- **THEN** it SHALL use constants from `uuidv7_fixtures`

### Requirement: Test assertions use named constants
Test files that assert against entity IDs SHALL use the named constants from `uuidv7_fixtures` instead of hardcoded string literals. This requirement is unchanged from the predecessor change.

#### Scenario: Assertions reference constants not magic strings
- **WHEN** a test asserts that a returned ID matches an expected value
- **THEN** the assertion SHALL use a named constant (e.g., `assert result["id"] == PROJECT_1`)
- **AND** SHALL NOT use a hardcoded string (e.g., `assert result["id"] == "project-001"`)
