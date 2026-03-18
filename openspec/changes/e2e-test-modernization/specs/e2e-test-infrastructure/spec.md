## ADDED Requirements

### Requirement: Dev-mode auth fixture
The e2e test framework SHALL provide a Playwright fixture that authenticates in dev mode by injecting `auth_token` and `auth_user` into localStorage before any page navigation.

#### Scenario: Auth fixture sets localStorage before navigation
- **WHEN** a test uses the auth fixture
- **THEN** `localStorage.auth_token` SHALL be set to `"dev-token-static"`
- **AND** `localStorage.auth_user` SHALL be set to a JSON object with `id: "dev-user-001"` and `org_id: "dev-org-001"`
- **AND** subsequent `page.goto()` calls SHALL see an authenticated session

#### Scenario: Auth fixture is applied automatically to all tests
- **WHEN** a test imports from the shared fixtures file
- **THEN** the auth fixture SHALL be applied in `beforeEach` without explicit opt-in
- **AND** no test SHALL need to manually set auth tokens

### Requirement: Data seeding via globalSetup
The e2e test framework SHALL provide a `globalSetup` script that seeds a project and dataset with known CSV data via the backend API before any tests run.

#### Scenario: Global setup creates a project and dataset
- **WHEN** Playwright runs globalSetup
- **THEN** the script SHALL call `POST /api/projects` to create a test project
- **AND** SHALL call `POST /api/projects/:id/datasets` with a known CSV file to create a test dataset
- **AND** SHALL write the project ID and dataset ID to a shared file readable by fixtures

#### Scenario: Seed data matches expected schema
- **WHEN** the seed CSV is uploaded
- **THEN** the resulting dataset SHALL have columns: ID, Name, Category, Amount, Quantity, In Stock
- **AND** the dataset SHALL have exactly 10 rows matching the product data used by existing table-operations tests

#### Scenario: Seed data is reused across read-only tests
- **WHEN** multiple table-operations tests run
- **THEN** they SHALL all reference the same seeded project/dataset IDs
- **AND** no test SHALL re-seed data unless it performs mutations

### Requirement: Navigation fixture
The e2e test framework SHALL provide a `navigateToDataset` helper that navigates to a specific dataset view and waits for the table to be visible.

#### Scenario: Navigate to a seeded dataset
- **WHEN** a test calls `navigateToDataset(page, projectId, datasetId)`
- **THEN** the page SHALL navigate to `/projects/:projectId/datasets/:datasetId`
- **AND** the helper SHALL wait for `[data-testid="data-table"]` to be visible before returning

#### Scenario: Navigation fixture is available via test-fixtures.ts
- **WHEN** a test imports the navigation fixture
- **THEN** it SHALL be accessible as `datasetPage` or equivalent in the test function signature

### Requirement: Backend in Playwright webServer config
The `e2e/config/local.config.ts` SHALL include the backend as a third entry in the `webServer` array.

#### Scenario: Backend starts with frontend and worker
- **WHEN** Playwright starts via local config
- **THEN** it SHALL start the backend at `http://localhost:8000`
- **AND** SHALL health-check against `http://localhost:8000/health`
- **AND** SHALL reuse existing servers when `!process.env.CI`

### Requirement: Obsolete tests removed or rewritten
The e2e suite SHALL NOT contain tests that reference obsolete v1 concepts.

#### Scenario: pipeline-flow.spec.ts is deleted
- **WHEN** the e2e test directory is listed
- **THEN** `pipeline-flow.spec.ts` SHALL NOT exist

#### Scenario: smoke.spec.ts tests v2 app shell
- **WHEN** the smoke test runs
- **THEN** it SHALL verify: page loads, auth is active, org view is accessible, navigation to a project works, navigation to a dataset shows a table with data

### Requirement: Table-operations tests use fixtures
All tests in `e2e/table-operations/` SHALL use the auth and navigation fixtures instead of navigating to `/`.

#### Scenario: Filter test navigates via fixture
- **WHEN** `filter.spec.ts` runs its beforeEach
- **THEN** it SHALL navigate to the seeded dataset via the navigation fixture
- **AND** SHALL NOT call `page.goto("/")`

#### Scenario: All table-operations tests are independent
- **WHEN** any table-operations test runs in isolation
- **THEN** it SHALL pass without depending on other tests having run first
