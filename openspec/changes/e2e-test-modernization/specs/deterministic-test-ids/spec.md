## MODIFIED Requirements

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

## ADDED Requirements

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
