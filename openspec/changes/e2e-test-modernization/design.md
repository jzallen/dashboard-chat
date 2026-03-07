## Context

The e2e test suite was built for v1 — a single-page app where navigating to `/` rendered a pre-loaded product table with a chat panel. In v2, the application has:

- **Authentication** — dev mode uses a static token (`dev-token-static`) set in localStorage
- **Multi-level navigation** — org → project → dataset, with routes like `/projects/:id/datasets/:id`
- **Multi-service architecture** — frontend (5173), backend (8000), and worker (8787) must all be running
- **Backend-dependent data** — datasets are created via API and stored in S3/MinIO, not hardcoded in the frontend

The existing Playwright config only starts frontend + worker, and all tests assume `page.goto("/")` lands on a table view.

## Goals / Non-Goals

**Goals:**
- Make all existing e2e tests runnable against the v2 architecture
- Provide reusable fixtures for auth, data seeding, and navigation so new specs are easy to write
- Add e2e coverage for dataset upload, data cleaning, and auth lifecycle features
- Keep tests deterministic and independent (each test seeds its own data or uses shared read-only seed data)

**Non-Goals:**
- Full coverage of every scenario in every feature file (prioritize core user journeys)
- E2e tests for external SQL access or dbt export (these are better suited to API-level integration tests)
- E2e tests for file format plugins (backend-focused, requires specialized test fixtures like HL7v2 files)
- Cross-browser testing (Chrome-only is sufficient for now)
- Visual regression testing

## Decisions

### 1. Auth via localStorage injection (not UI login flow)

**Decision**: Set `auth_token` and `auth_user` in localStorage before navigation, bypassing the login page.

**Rationale**: The login flow is a redirect to WorkOS in production. In dev mode, there's a hardcoded token. Testing the actual login flow adds fragility without testing our code (it tests WorkOS). Auth injection is fast, reliable, and standard practice for Playwright.

**Alternative considered**: Intercept the auth API and mock responses. Rejected — adds complexity, and dev mode already provides a valid token path.

### 2. Data seeding via backend API in globalSetup

**Decision**: Use a Playwright `globalSetup` script that calls the backend API to create a shared project and dataset with known CSV data. Store the project/dataset IDs in a file that fixtures read.

**Rationale**: Tests need real data in the backend to navigate to. API seeding is faster than UI-based setup. A shared seed dataset for read-only table-operations tests avoids per-test setup overhead. Tests that mutate data (upload, add/delete rows) create their own isolated datasets.

**Alternative considered**: Seed via direct database insertion. Rejected — couples tests to schema internals and bypasses the storage layer (S3/Parquet).

### 3. Backend added to Playwright webServer config

**Decision**: Add the backend as a third entry in `local.config.ts` webServer array, started via `cd backend && uv run uvicorn app.main:app`.

**Rationale**: The backend is required for auth validation, dataset CRUD, and project loading. Without it, the frontend shows an error state.

**Alternative considered**: Mock the backend API at the Playwright level. Rejected — we want true e2e tests, not integration tests with mocks.

### 4. Fixture-based navigation helper

**Decision**: Create a `navigateToDataset(page, projectId, datasetId)` helper used in a Playwright fixture. All table-operation tests use this instead of `page.goto("/")`.

**Rationale**: Centralizes the v2 navigation pattern. If routes change, only the helper updates. The fixture also waits for the table to be visible before yielding control to the test.

### 5. Delete pipeline-flow.spec.ts, rewrite smoke.spec.ts

**Decision**: Delete `pipeline-flow.spec.ts` entirely. Rewrite `smoke.spec.ts` to verify the v2 app shell loads (auth → org view → navigate to project → see datasets).

**Rationale**: `pipeline-flow.spec.ts` tests a concept ("pipelines") that no longer exists — every assertion is either a no-op or checks for DOM elements that don't exist. It cannot be salvaged. The smoke test needs to verify the actual v2 user journey.

### 6. Test ID additions on components

**Decision**: Add `data-testid` attributes to components that e2e tests need to interact with but currently lack them. Specifically: upload widget states, activity check modal, breadcrumb editor input, chat action menu.

**Rationale**: CSS class selectors (e.g., `[class*="messageRow"]`) are fragile — they break on CSS module hash changes. The existing `ChatHelper` already uses some of these. New specs need reliable selectors for new UI elements.

### 7. E2e spec organization mirrors feature files

**Decision**: Organize new e2e specs to mirror feature file names:
- `e2e/dataset-upload/upload-flow.spec.ts`
- `e2e/data-cleaning/trim-and-case.spec.ts`
- `e2e/data-cleaning/column-alias.spec.ts`
- `e2e/auth/token-refresh.spec.ts`
- `e2e/auth/activity-check.spec.ts`

**Rationale**: Makes it easy to trace which feature scenarios have e2e coverage. Keeps specs focused and fast (smaller files run faster in parallel later).

**Alternative considered**: Group by service layer. Rejected — e2e tests are user-journey oriented, not service-oriented.

## Risks / Trade-offs

**[LLM non-determinism in chat-driven tests]** → Chat tests depend on the LLM (Groq) interpreting prompts correctly. The existing `complex-prompts.spec.ts` already handles this with retries. New chat-driven tests (data cleaning) face the same risk. Mitigation: Use explicit, unambiguous prompts. Use Playwright retries (already configured: 1 local, 2 CI).

**[Backend startup time]** → Adding the backend to webServer increases Playwright startup time. Mitigation: `reuseExistingServer: !process.env.CI` already handles this — in local dev, devs start services via Docker Compose, and Playwright reuses them.

**[Shared seed data coupling]** → If the shared seed dataset schema changes, multiple tests may break. Mitigation: Define the seed CSV and expected schema in a single fixture file. All tests reference the same fixture constants.

**[MinIO/Redis dependency]** → The backend needs MinIO and Redis. In CI, Docker Compose must be running. Mitigation: The CI pipeline already uses Docker Compose for integration tests. E2e tests piggyback on the same infrastructure.

## Open Questions

- Should the `globalSetup` seed data be torn down in `globalTeardown`, or should we rely on ephemeral CI environments? Leaning toward no teardown — dev databases are disposable and CI environments are ephemeral.
- For data-cleaning e2e tests, should we test the preview/confirm flow (2-step) or just the final result? Leaning toward testing the full flow since it's a core UX pattern.
