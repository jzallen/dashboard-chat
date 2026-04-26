# User Stories — api-driven-user-flow-tests

> **Wave**: DISCUSS (Phase 3 only — see `wave-decisions.md`)
> **Persona**: backend / platform developer validating dataset (staging) layer behavior pre-merge
> **JTBD reference**: skipped (D4=No); single obvious job

The dataset (staging) layer is the part of the application that ingests a raw CSV and exposes chat-driven cleanup operations (whitespace, casing, type coercion, null fill, regex replacements, date normalization) on the resulting table. The chat-driven cleanup script in `/workspaces/dashboard-chat/docs/strategy/demo-staging-2026-04-26.md` is the canonical workload for exercising that layer end-to-end. Stories below encode the full workload — project creation through aggregated reads — as an executable, headless, API-driven test.

**Guiding principle.** These tests are a **headless representation of the production application**. The only substitution permitted is WorkOS auth → local dev JWT (per `backend/app/auth/dev_provider.py`). Every other dependency — Groq LLM, MinIO, DuckDB, the real worker, the real backend — is exercised as in production. Tests that mock or bypass production dependencies (LLM stubs, in-memory fakes) defeat the purpose: they validate plumbing rather than the dataset-layer behavior we ship.

---

## Story 1 — Headless dataset (staging) layer acceptance test

**Narrative**: As a developer validating the dataset (staging) layer before merge, I want to run a single command that drives the layer's full chat-mediated cleanup workload headlessly via the API — project creation, CSV ingest, the chat cleanup operations enumerated in the demo doc, and the aggregated reads that prove correctness — asserting the table state after each step, so that I can confirm the layer works without recording a 15-minute browser demo or trusting a manual run.

### Elevator Pitch
Before: Validating the dataset (staging) layer requires a human at a browser running the recorded demo workflow (~15 min, plus setup, plus friction-CSV bookkeeping). There is no way to know mid-PR whether the chat→agent→backend→DuckDB chain still completes the layer's cleanup workload end-to-end.
After: run `<test-runner> path/to/test_dataset_staging_layer` → sees `PASSED test_dataset_staging_layer[10 cleanup ops + 2 reads, 250 rows accounted for, ran in 1m38s]`
Decision enabled: developer decides whether the dataset (staging) layer is regression-free and can merge, vs. needs a fix before merge.

### Acceptance Criteria

**AC1.1 — Single command runs the whole workload**
> **Given** the dev stack's prerequisites are met (whatever DESIGN decides — see Q2/Q3)
> **When** the developer invokes the chosen test command (e.g., `RUN_INTEGRATION_TESTS=1 pytest tests/integration/test_dataset_staging_layer.py`)
> **Then** the test executes the full dataset (staging) layer workload end-to-end — project create → CSV upload → the chat-driven cleanup operations enumerated in `/workspaces/dashboard-chat/docs/strategy/demo-staging-2026-04-26.md` → the two aggregated reads — with no further human input
> **And** finishes with a single PASS/FAIL outcome.

**AC1.2 — Auth is local-JWT only; WorkOS is not contacted; all other production dependencies are real**
> **Given** the test process
> **When** any authenticated API call is made (to backend OR worker)
> **Then** the bearer token is produced by `backend/app/auth/dev_provider._mint_jwt()` (RS256, signed by `dev_keys`) — never by a WorkOS token exchange
> **And** the test process makes zero outbound network requests to `*.workos.com` (verifiable via a request-recorder fixture)
> **And** all other production dependencies are exercised against their real implementations (Groq for LLM, MinIO for object storage, DuckDB via the real query engine, the real worker process, the real FastAPI backend) — no in-memory fakes, no LLM stubs, no port-level mocks.

**AC1.3 — Project + dataset are created from scratch by the test**
> **Given** a clean starting state (per Q4 decision — per-test project or fixture-with-reset)
> **When** the test runs
> **Then** it creates a project (e.g., named "dataset-staging-{run-id}"), uploads `/usr/local/share/dc-demo-data/ecommerce-orders.csv` (or its in-tree equivalent), and lands at the dataset detail state
> **And** the dataset reports 250 rows × 11 columns before any cleanup turn runs.

**AC1.4 — Each cleanup operation mutates the table as specified by the demo doc**
> **Given** the dataset in its post-upload state
> **When** the test sends each chat-driven cleanup operation (verbatim from the demo doc) in order, waiting for completion before sending the next
> **Then** after each operation, the test asserts the table state matches the demo doc's "What you should see" column for that step. Specifically:
>
> | # | Turn (verbatim) | Asserted post-state |
> |---|---|---|
> | 1 | `Trim whitespace on every text column` | No leading/trailing spaces in {region, customer_email, product_category, payment_method, shipping_status} |
> | 2 | `Standardize the region column to title case` | `SELECT DISTINCT region` returns exactly `{North, South, East, West}` |
> | 3 | `The product category has typos — fix "Electornics" to "Electronics" and standardize everything to title case` | `SELECT DISTINCT product_category` returns exactly `{Electronics, Apparel, Home Goods, Books, Toys}` |
> | 4 | `Standardize payment_method to a single canonical form per method (e.g. "Credit Card" not "credit_card")` | `SELECT DISTINCT payment_method` returns exactly 4 values incl. `Credit Card`, `PayPal`, `Apple Pay`, `Bank Transfer` |
> | 5 | `Standardize shipping_status to title case` | `SELECT DISTINCT shipping_status` returns `{Delivered, Pending, Shipped, Cancelled}` |
> | 6 | `Strip the dollar sign from unit_price and convert it to a number` | `unit_price` column type is numeric; `SELECT COUNT(*) WHERE unit_price LIKE '$%'` is 0 |
> | 7 | `The order_date column has two different formats. Convert everything to ISO format (YYYY-MM-DD)` | All `order_date` values match `^\d{4}-\d{2}-\d{2}$`; min ≤ max parseable as ISO dates |
> | 8 | `Fill missing values in discount_pct with 0` | `SELECT COUNT(*) WHERE discount_pct IS NULL` is 0 |
> | 9 | `Show me the count of orders by region` | Agent returns 4 rows summing to 250 |
> | 10 | `And by product category` | Agent returns 5 rows summing to 250 |

**AC1.5 — Reprompt budget mirrors demo doc tolerance**
> **Given** the demo's success criterion ("≤2 reprompts is acceptable; >2 means staging chat tools have a real coverage gap")
> **When** the test runs
> **Then** for each cleanup operation, the test allows up to 2 retries before declaring that operation failed
> **And** any operation requiring a retry is reported in the test output (so a passing-but-flaky run is not silently passing).
> *(This AC is the primary lever for absorbing Groq non-determinism — the test path uses real Groq, so the same prompt may produce slightly different tool sequences across runs. The reprompt budget aligns the test's tolerance with the layer's user-facing tolerance.)*

**AC1.6 — Wall-clock budget**
> **Given** a green run on a developer laptop with the dev stack pre-warmed and Groq reachable
> **When** the test executes
> **Then** total wall-clock time is < 5 minutes (Groq round-trips dominate).
> *(The exact target depends on Q1/Q2/Q3 decisions. < 2 min is a stretch goal on local with warm caches; CI baseline is ≤ 5 min.)*

**AC1.7 — Test cleans up its data**
> **Given** the test ran (passed or failed)
> **When** the test process exits
> **Then** the test's project and any uploaded objects are deleted (project soft-delete + MinIO object removal), so a re-run starts clean
> **And** no orphaned `dataset-staging-*` projects accumulate across runs.

**AC1.8 — WorkOS is the only forbidden network destination**
> **Given** the test is run in any mode (local or CI)
> **When** the test executes
> **Then** zero outbound HTTP requests reach `*.workos.com`
> **And** outbound requests to `api.groq.com` (LLM), MinIO, and any other production dependency are EXPECTED and not flagged. Production-fidelity is the goal; the test path mirrors production with the single exception of WorkOS.

**AC1.9 — Failure messages identify the offending step and table state**
> **Given** any AC1.4 row fails
> **When** the assertion fails
> **Then** the error message includes (a) the turn number and verbatim prompt, (b) the agent's response, (c) the table state diff between expected and actual (or a small sample of mismatched rows)
> **So that** the developer can triage without re-running.

---

## Out of Scope

- The dataset rename in the demo's wrap step (`ecommerce_orders_clean`) and the friction-CSV bookkeeping — these are operator-recording artifacts, not dataset (staging) layer behavior.
- The "eyeball the mess" step — human-only inspection, not exercised by an API-driven test.
- Browser/UI tests. This story is API-only; UI Playwright coverage of the same workload is a follow-up explicitly enabled by this work but not delivered by it.
- The view layer, report layer, dbt-export, multi-user, and performance benchmarking — see the demo doc's "Out of Scope" section. Carried verbatim.
- Auth flow tests (login, refresh, logout). The dev provider is the test's auth path; verifying its correctness lives in `backend/app/auth/dev_provider.py`'s own tests, not here.
- Healthcare-domain adaptations of the dataset — the dataset (staging) layer must work generic-BI-shaped first.
- Mocking, stubbing, or otherwise replacing production dependencies other than WorkOS auth. If a future test surface requires a fake (e.g., flake-mitigation around Groq), it MUST be proposed and decided at DESIGN, not adopted ad hoc.

## Requirements Completeness

- One story; nine acceptance criteria covering: command surface, auth path, data setup, the 10 turns + 2 counts, retry budget, wall-clock, cleanup, no-external-network, failure-message ergonomics.
- Every AC is verifiable by a single test runner without internal-state inspection (worst case: a SQL query against the dataset's DuckDB view).
- Self-assessed completeness: > 0.95.

## DoR (inline — full validation deferred for this lean DISCUSS)

| # | Item | Status | Note |
|---|------|--------|------|
| 1 | User value clear | ✓ | Stated in elevator pitch |
| 2 | Acceptance criteria testable | ✓ | All AC reduce to test-runner output or a SQL query |
| 3 | Dependencies identified | ✓ | dev_provider, FastAPI, Hono worker, DuckDB, MinIO; LLM seam = DESIGN-wave Q1 |
| 4 | Sized | ✓ | One slice end-to-end; harness primitives emerge as needed |
| 5 | Discoverable to all touchpoints | ✓ | Auth + backend + worker + DuckDB + MinIO are all in-repo |
| 6 | Out-of-scope explicit | ✓ | See "Out of Scope" |
| 7 | KPIs measurable | ✓ | See `outcome-kpis.md` |
| 8 | No hidden coupling | ✓ | Dev provider already exists; LLM coupling explicitly surfaced as Q1 |
| 9 | Reviewable | ✓ | Single PR likely; harness primitives + dataset-layer test together |
