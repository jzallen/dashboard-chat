## Why

The e2e test suite was written for v1 (single-page table app) and has not been updated for the v2 architecture (auth, org/project/dataset hierarchy, multi-service). All existing tests navigate to `/` and expect a pre-loaded table — this no longer works. Meanwhile, 6 of 8 feature files have zero e2e coverage. The tests cannot run, and the gap is widening with every new feature.

## What Changes

- **Delete** `pipeline-flow.spec.ts` — references obsolete "pipeline" concept with placeholder assertions
- **Rewrite** `smoke.spec.ts` — update for v2 auth + navigation flow (login → org → project → dataset)
- **Add auth fixture** — dev-mode authentication (set `dev-token-static` in localStorage before navigation)
- **Add navigation fixture** — seed a project/dataset via backend API, navigate to dataset view
- **Update Playwright config** — add backend to `webServer` array in `local.config.ts`
- **Update all table-operations specs** — replace `page.goto("/")` with fixture-based navigation to a seeded dataset
- **Add new e2e specs** for uncovered feature files, prioritized:
  1. `dataset-upload-chat` — upload widget flow, file selection, rename (core user journey)
  2. `data-cleaning-chat` — trim, case standardization, column alias (core user journey)
  3. `token-refresh` — 401 recovery, activity check modal (auth stability)
  4. `dbt-project-export` — export download verification (may be better as API-level integration test)

## Capabilities

### New Capabilities
- `e2e-test-infrastructure`: Auth fixtures, navigation helpers, data seeding, Playwright config for the v2 multi-service architecture
- `e2e-dataset-upload`: End-to-end coverage of the dataset upload chat flow (maps to `dataset-upload-chat.feature`)
- `e2e-data-cleaning`: End-to-end coverage of data cleaning chat operations (maps to `data-cleaning-chat.feature`)
- `e2e-auth-lifecycle`: End-to-end coverage of token refresh and session lifecycle (maps to `token-refresh.feature`)

### Modified Capabilities
- `deterministic-test-ids`: May need additional test IDs on new UI components (upload widget, activity check modal, breadcrumb editor) to support reliable e2e selectors

## Impact

- **e2e/** — All spec files rewritten or replaced; new fixtures and helpers added
- **e2e/config/local.config.ts** — Backend added to webServer array
- **e2e/fixtures/test-fixtures.ts** — Auth and navigation fixtures added
- **frontend/src/** — Possible additions of `data-testid` attributes on components lacking them
- **CI/CD** — E2e pipeline stage needs backend service available (Docker Compose or equivalent)
- **No backend code changes** — All backend APIs already exist; tests consume them
- **No breaking changes** — This is test infrastructure only
