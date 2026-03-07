## 1. Playwright Config & Cleanup

- [x] 1.1 Update `e2e/config/local.config.ts` to add backend as third webServer entry (`cd backend && uv run uvicorn app.main:app`, health check at `http://localhost:8000/health`)
- [x] 1.2 Delete `e2e/pipeline-flow.spec.ts`
- [x] 1.3 Add `e2e/global-setup.ts` seed script: call backend API to create project + dataset with the 10-row product CSV, write IDs to `e2e/.seed-data.json`

## 2. Auth & Navigation Fixtures

- [x] 2.1 Create `e2e/fixtures/auth.fixture.ts`: inject `dev-token-static` and dev user JSON into localStorage via `page.addInitScript`
- [x] 2.2 Create `e2e/fixtures/navigation.fixture.ts`: `navigateToDataset(page, projectId, datasetId)` helper that navigates and waits for `data-testid="data-table"`
- [x] 2.3 Update `e2e/fixtures/test-fixtures.ts` to compose auth + navigation fixtures and expose `seededProjectId` / `seededDatasetId` from `.seed-data.json`

## 3. Frontend data-testid Additions

- [x] 3.1 Add `data-testid` attributes to `UploadWidget.tsx` for each state: `upload-widget-browse`, `upload-widget-selected`, `upload-widget-uploading`, `upload-widget-uploaded`, `upload-widget-error`
- [x] 3.2 Add `data-testid="activity-check-modal"`, `data-testid="activity-check-confirm"` to `ActivityCheckModal/index.tsx`
- [x] 3.3 Add `data-testid="breadcrumb-edit-input"` to `DatasetView/Breadcrumb.tsx` edit input
- [x] 3.4 Add `data-testid="chat-action-menu"` and `data-testid="action-create-dataset"` to the chat action menu component
- [x] 3.5 Add `data-testid="project-nav-{id}"` and `data-testid="dataset-nav-{id}"` to `SideNav/ProjectNavItem.tsx` and `SideNav/DatasetNavItem.tsx`

## 4. Rewrite Existing Tests

- [x] 4.1 Rewrite `e2e/smoke.spec.ts`: auth → org view loads → navigate to project → navigate to dataset → table visible with rows
- [x] 4.2 Update `e2e/table-operations/filter.spec.ts`: replace `page.goto("/")` with fixture-based navigation, use seeded dataset IDs
- [x] 4.3 Update `e2e/table-operations/sort.spec.ts`: same fixture migration
- [x] 4.4 Update `e2e/table-operations/add-row.spec.ts`: same fixture migration
- [x] 4.5 Update `e2e/table-operations/delete-row.spec.ts`: same fixture migration
- [x] 4.6 Update `e2e/table-operations/complex-prompts.spec.ts`: same fixture migration

## 5. Dataset Upload E2E Tests

- [x] 5.1 Create `e2e/dataset-upload/upload-flow.spec.ts`: test action menu → upload widget → file select → send → uploaded state → dataset appears in sidebar
- [x] 5.2 Add test for removing selected file before sending (click "x", widget returns to browse)
- [x] 5.3 Add test for renaming dataset via breadcrumb after upload
- [x] 5.4 Add test for upload error display (invalid file → error message + retry button)

## 6. Data Cleaning E2E Tests

- [x] 6.1 Create a dirty-data CSV fixture file with leading/trailing spaces, mixed case, null values
- [x] 6.2 Create `e2e/data-cleaning/trim-and-case.spec.ts`: upload dirty CSV, trim whitespace via chat, verify preview + confirm flow, verify table update
- [x] 6.3 Add case standardization test: convert column to title case via chat, verify preview + confirm, verify table values
- [x] 6.4 Create `e2e/data-cleaning/column-alias.spec.ts`: rename column via chat, verify header updates immediately (no preview step)
- [x] 6.5 Add null fill test: fill blanks with specified value via chat, verify preview + confirm, verify table update
- [x] 6.6 Add undo test: apply cleaning transform, say "undo", verify table reverts to raw values

## 7. Auth Lifecycle E2E Tests

- [x] 7.1 Create `e2e/auth/activity-check.spec.ts`: use `page.clock` to fast-forward inactivity timer, verify modal appears with countdown
- [x] 7.2 Add test: confirm activity via button click → modal closes, session continues
- [x] 7.3 Add test: countdown reaches zero → user logged out, redirected to login
- [x] 7.4 Create `e2e/auth/token-refresh.spec.ts`: clear localStorage auth_token, trigger API call, verify recovery (dev mode re-auth)

## 8. Validation

- [ ] 8.1 Run full e2e suite locally (`npm run test:e2e:local`) and verify all tests pass
- [ ] 8.2 Verify each new spec can run in isolation (`npx playwright test <file>`)
