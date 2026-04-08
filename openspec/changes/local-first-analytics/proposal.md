## Status: Shelved

**Reason:** CSV-first focus (2026-04-08). This is Stage 3 (Preview) work with multiple unmet dependencies: report-chat-tools must land first, semantic manifest generation must exist, and DuckDB WASM runtime must be built.

**Unblock condition:** `report-chat-tools` complete + `planner-docker-integration` complete (which itself depends on report-chat-tools).

---

## Why

The dashboard pipeline currently has specs for a semantic manifest, a layout planner, and a report mart layer — but no defined read path for how dashboards actually query data at runtime. Every dashboard interaction (filter change, drill-down, time range adjustment) would require a backend round-trip through the query engine, making interactive analytics slow and putting load on shared infrastructure. The local-first analytics pattern moves interactive compute to the browser: the backend loads a pre-aggregated extract once via pg_duckdb, the client caches it in DuckDB WASM, and all subsequent queries execute locally with zero network latency. This is the same pattern MotherDuck's UI uses — load once, query many.

## What Changes

- **Backend extract endpoint** — a new API endpoint that executes a MetricFlow-generated SQL query against the query engine (pg_duckdb → `read_parquet('s3://...')`), serializes the result as Arrow IPC, and returns it as a binary response. This is the only backend hit per dashboard session. The extract SQL is scoped by `org_id` and shaped by the dashboard's data contract (which metrics, dimensions, and grain the layout requires).
- **DuckDB WASM client layer** — a Web Worker-hosted DuckDB WASM instance that ingests the Arrow IPC payload, stores it as in-memory tables, and executes SQL queries from dashboard components. All filtering, aggregation, and drill-down happens here with sub-10ms latency and zero network.
- **OPFS persistence** — the DuckDB WASM database is backed by the Origin Private File System for cross-session caching. On dashboard load, the client checks OPFS for a cached extract before hitting the backend. Cache invalidation uses a version token from the API (derived from dataset/transform timestamps).
- **Dashboard query interface** — dashboard components (charts, tables, KPI cards) submit SQL queries to the Web Worker instead of calling backend APIs. The SQL is generated from the semantic manifest (metric expressions, dimension columns) combined with user-applied filters from the dashboard UI.
- **MetricFlow integration in backend** — the semantic manifest (already spec'd in `semantic-manifest-schema`) drives SQL generation for both the extract query (what data to load) and the client-side queries (how to aggregate/filter). The backend generates the extract SQL; the client generates interaction SQL from the same manifest definition.
- **Wire format: Arrow IPC** — `pyarrow` on the backend serializes query results as Arrow IPC stream format. The frontend uses `apache-arrow` JS to ingest into DuckDB WASM via `insertArrowTable()` — zero parsing overhead.

## Capabilities

### New Capabilities
- `dashboard-extract-api`: Backend endpoint that executes extract SQL against the query engine and returns Arrow IPC bytes. Scoped by org_id, shaped by dashboard data contract. Includes cache headers (ETag/version token) for client-side invalidation.
- `duckdb-wasm-runtime`: Client-side DuckDB WASM runtime in a Web Worker. Loads Arrow IPC data, persists to OPFS, executes SQL queries from dashboard components. Manages lifecycle (init, load, query, evict).
- `dashboard-query-interface`: Protocol for dashboard components to submit SQL queries to the WASM runtime and receive typed results. Includes query generation from semantic manifest + user filters.

### Modified Capabilities
- `dashboard-plan-schema`: DashboardPlan gains a `data_contract` field specifying which metrics, dimensions, and grain the dashboard requires — this drives the extract SQL. Components reference metric/dimension IDs that map to columns in the extract.
- `semantic-manifest-schema`: The manifest is used client-side (not just as planner input) to generate interaction SQL. May need a serialized subset shipped to the frontend alongside the extract.
- `report-mart-layer`: Reports with `materialization: "table"` become candidates for extract pre-computation. The extract endpoint can read from materialized mart tables instead of raw views when available, reducing extract generation time.

## Impact

- **Backend** (`app/use_cases/dashboard/`): New use case for extract generation. Depends on the query engine asyncpg pool and the semantic manifest. New router/controller under `/api/dashboards/{id}/extract`.
- **Backend dependencies**: `pyarrow` added for Arrow IPC serialization. Evaluate `adbc_driver_postgresql` as an alternative to asyncpg for native Arrow returns from PostgreSQL.
- **Frontend** (`frontend/src/lib/`): New `wasm/` module with Web Worker, DuckDB WASM initialization, OPFS cache manager, and query interface. New dependency: `@duckdb/duckdb-wasm`, `apache-arrow`.
- **Frontend bundle size**: DuckDB WASM is ~4MB compressed. Must be loaded asynchronously, not in the main bundle. Web Worker isolation prevents main thread blocking.
- **Dashboard components**: Chart/table/KPI components switch from TanStack Query (fetching from backend) to the WASM query interface for dashboard-mode rendering. Non-dashboard views (data catalog, project settings) continue using existing API patterns.
- **Query engine**: No changes to the engine itself. The extract endpoint uses the existing asyncpg pool and CVAS views. If mart tables exist for a report, the extract SQL can reference those instead.
- **Outbox dispatcher** (dependency): `MartRefreshRequested` events could trigger pre-computation of mart tables that the extract endpoint reads from. This is optional — extracts work against CVAS views without materialization, just slower for large datasets.
- **Security**: Extract SQL is generated server-side from the semantic manifest — users never submit arbitrary SQL. The `org_id` scoping is enforced in the extract query. Client-side SQL operates only on the already-scoped extract data.
- **Offline capability**: With OPFS caching + Service Worker, dashboards can render from cached extracts without network access. This is a natural consequence of the architecture, not an explicit goal.
