# deterministic-test-ids Specification

## Purpose
TBD - created by archiving change uuidv7-deterministic-test-ids. Update Purpose after archive.
## Requirements
### Requirement: Shared UUIDv7 test constant pool
A module at `backend/tests/uuidv7_fixtures.py` SHALL provide named constants for all entity types used in test fixtures. Each constant SHALL be a valid UUIDv7 string (36-character hyphenated format, version nibble = 7, variant bits = 10).

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

### Requirement: Test conftest files use shared constants
All 7 test conftest files SHALL import IDs from `backend/tests/uuidv7_fixtures.py` instead of using hardcoded string IDs.

#### Scenario: Project test conftest migration
- **WHEN** `backend/tests/use_cases/project/conftest.py` creates seeded records
- **THEN** it SHALL use constants from `uuidv7_fixtures` (e.g., `PROJECT_1` instead of `"project-001"`)
- **AND** storage paths SHALL incorporate the new constants (e.g., `f"datasets/{PROJECT_1}/{DATASET_1}/"`)

#### Scenario: Dataset test conftest migration
- **WHEN** `backend/tests/use_cases/dataset/conftest.py` creates seeded records
- **THEN** it SHALL use constants from `uuidv7_fixtures` (e.g., `DATASET_1` instead of `"dataset-001"`)

#### Scenario: Transform test conftest migration
- **WHEN** `backend/tests/use_cases/transform/conftest.py` creates seeded records
- **THEN** it SHALL use constants from `uuidv7_fixtures`

#### Scenario: Upload test conftest migration
- **WHEN** `backend/tests/use_cases/upload/conftest.py` creates seeded records
- **THEN** it SHALL use constants from `uuidv7_fixtures`

#### Scenario: SQL access test conftest migration
- **WHEN** `backend/tests/use_cases/sql_access/conftest.py` creates seeded records
- **THEN** it SHALL use constants from `uuidv7_fixtures`

#### Scenario: Organization test conftest migration
- **WHEN** `backend/tests/use_cases/organization/conftest.py` creates seeded records
- **THEN** it SHALL use constants from `uuidv7_fixtures`

#### Scenario: Root test conftest migration
- **WHEN** `backend/tests/conftest.py` defines auth fixtures or shared test data
- **THEN** it SHALL use constants from `uuidv7_fixtures` (e.g., `USER_1` instead of `"test-user-001"`, `ORG_1` instead of `"test-org-001"`)

### Requirement: Test assertions use named constants
Test files that assert against entity IDs SHALL use the named constants from `uuidv7_fixtures` instead of hardcoded string literals.

#### Scenario: Assertions reference constants not magic strings
- **WHEN** a test asserts that a returned ID matches an expected value
- **THEN** the assertion SHALL use a named constant (e.g., `assert result["id"] == PROJECT_1`)
- **AND** SHALL NOT use a hardcoded string (e.g., `assert result["id"] == "project-001"`)

#### Scenario: Inline test data uses constants
- **WHEN** test files outside conftest create records with explicit IDs (e.g., `test_list_datasets.py`, `test_export_dbt_project.py`, `test_projects_export.py`)
- **THEN** those IDs SHALL also come from the shared constant pool or be generated with `uuid7()`

### Requirement: No behavioral changes to production code
The test fixture migration SHALL NOT alter any production code behavior. Only ORM model defaults and test files change.

#### Scenario: API responses unchanged
- **WHEN** the migration is complete
- **THEN** all API endpoints SHALL return the same response shapes as before
- **AND** the only difference SHALL be that new entity IDs are UUIDv7 format instead of UUIDv4

### Requirement: E2e-relevant components have data-testid attributes
Frontend components that e2e tests interact with SHALL have `data-testid` attributes for reliable selection.

#### Scenario: Upload widget states have test IDs
- **WHEN** the upload widget renders in browse, selected, uploading, uploaded, or error state
- **THEN** each state container SHALL have a `data-testid` attribute (e.g., `upload-widget-browse`, `upload-widget-uploaded`, `upload-widget-error`)

#### Scenario: Activity check modal has test IDs
- **WHEN** the activity check modal renders
- **THEN** the modal container SHALL have `data-testid="activity-check-modal"`
- **AND** the confirm button SHALL have `data-testid="activity-check-confirm"`
- **AND** the countdown display SHALL have `data-testid="activity-check-countdown"`

#### Scenario: Breadcrumb editor has test IDs
- **WHEN** the dataset breadcrumb is in edit mode
- **THEN** the input SHALL have `data-testid="breadcrumb-edit-input"`

#### Scenario: Chat action menu has test IDs
- **WHEN** the chat action menu is open
- **THEN** the menu container SHALL have `data-testid="chat-action-menu"`
- **AND** the "Create Dataset" option SHALL have `data-testid="action-create-dataset"`

#### Scenario: Sidebar navigation items have test IDs
- **WHEN** the sidebar renders project and dataset nav items
- **THEN** each project item SHALL have `data-testid="project-nav-{id}"`
- **AND** each dataset item SHALL have `data-testid="dataset-nav-{id}"`

