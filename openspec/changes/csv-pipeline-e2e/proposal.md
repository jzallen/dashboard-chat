# CSV Pipeline End-to-End Test

## Why

Individual E2E specs exist for each stage of the pipeline: `dataset-upload/` (upload), `data-cleaning/` (transforms), `table-operations/` (table interactions), and `smoke/` (basic connectivity). But no single test validates the complete CSV-first journey from upload to dbt export as a connected flow.

The CSV-first focus makes this the core product path. A regression anywhere in the chain — upload parsing, parquet conversion, transform application, view SQL generation, report creation, or dbt export — could silently break the end-to-end experience while individual stage tests still pass.

This test serves dual purpose: regression protection and living documentation of the core workflow.

## What Changes

### New Playwright Spec
- `e2e/specs/csv-pipeline/csv-pipeline.spec.ts` — single spec file walking the full CSV journey:
  1. **Upload:** Upload a CSV file, verify dataset creation and preview
  2. **Transform:** Apply cleaning transforms (trim, case standardization), verify preview updates
  3. **Filter:** Add a filter transform, verify row count changes
  4. **View:** Create a view joining two datasets (requires uploading a second CSV), verify SQL generation
  5. **Report:** Create a report with dimensions and measures from the view (once report-chat-tools lands)
  6. **Export:** Trigger dbt export, verify zip download contains expected file structure (once dbt-export-chat-tool lands)

### Test Data
- Two small CSV fixture files in `e2e/fixtures/` (e.g., `customers.csv` and `orders.csv`) designed for a simple join scenario
- Files should be small (10-20 rows) for fast test execution

### Phased Implementation
- **Phase 1 (now):** Steps 1-4 (upload → transform → filter → view) — all capabilities exist today
- **Phase 2 (after report-chat-tools):** Step 5 (report creation via chat)
- **Phase 3 (after dbt-export-chat-tool):** Step 6 (dbt export trigger and validation)

## Capabilities

### Modified Capabilities
- `e2e-test-infrastructure`: New spec added to the E2E suite

## Impact

- `e2e/specs/csv-pipeline/csv-pipeline.spec.ts` — new spec file
- `e2e/fixtures/customers.csv` — test data fixture
- `e2e/fixtures/orders.csv` — test data fixture
- No application code changes
- No database migrations
