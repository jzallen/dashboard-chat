## Context

The chat-first UI redesign (completed) established: Stream Chat channels with custom data fields, SSE streaming from worker, `useChatEngine` context hook, and the `TableView` / `DatasetPicker` component pattern. The backend has a `View` domain model with `id`, `name`, `sql_definition` (raw string), `source_refs`, and `materialization` — but no structured column representation.

This design formalizes the full-stack contracts for the View Layer across five phases:
1. Backend domain model + SQL generator (no frontend changes)
2. Frontend unified context model (contextType+contextId replaces datasetId)
3. Worker tool routing (forks tool set by contextType at request ingestion)
4. Frontend ViewDetailView + view tool execution (parallelizable)
5. dbt export extension (depends only on sql_generator)

**Constraints**: SQLite in dev (no ALTER COLUMN; JSON stored as TEXT). Worker reads tool definitions before any LLM call. Frontend mutations follow read-modify-write against TanStack Query cache (no sub-column endpoints).

---

## Goals / Non-Goals

**Goals:**
- Replace raw `sql_definition` as source of truth with structured `columns`/`joins`/`filters`/`grain`
- Deterministic SQL synthesis from structure — the AI never writes raw SQL
- Unified context picker surfacing both datasets and views with type badges
- Worker tool forking by contextType at the HTTP handler level (before first LLM call)
- `ViewDetailView` mirroring `TableView` pattern: schema table + SQL preview + inline chat
- dbt intermediate model export with correct `{{ ref() }}` macro resolution
- Grain role auto-assignment server-side (not computed in the frontend)

**Non-Goals:**
- Aggregations / GROUP BY with SUM/COUNT/AVG (deferred)
- Window functions, UNION, CASE WHEN (deferred — stated in feature file)
- View data query execution (showing materialized rows) — deferred
- Column profiling for view context — requires query execution, deferred
- Unified `/context-items` API endpoint — two parallel frontend calls for now
- Inline view name editing via UI — rename only through chat
- Channel migration script for old `datasetId` fields — fallback read handles it

---

## Decisions

### D1: Structured columns stored as JSON in the ORM, not a separate table

**Decision**: Add `columns`, `joins`, `filters`, `grain` as JSON columns on `ViewRecord` (SQLAlchemy `JSON` type) via a single Alembic migration.

**Rationale**: Views are always fetched whole; there is no use case for querying individual columns independently across views. A separate `view_columns` table adds JOIN overhead, migration complexity, and ordering challenges with no query benefit. JSON columns are supported by both SQLite (dev) and PostgreSQL (prod) and are the pattern already used for `schema_config` on datasets.

**Alternative considered**: Normalized `view_columns` table with FK to `view_records`. Rejected: premature normalization for a document-oriented entity.

---

### D2: SQL regenerated on every structural PATCH, cached in `sql_definition`

**Decision**: `update_view` and `create_view` use cases call `ViewSQLGenerator` and write the result back to `sql_definition`. The `sql_definition` column becomes a derived cache, not the source of truth.

**Rationale**: The frontend displays `display_sql` from the view response. The dbt exporter reads `sql_definition` (executable SQL). Regenerating eagerly keeps the cache always valid and removes any "stale SQL" class of bugs. SQL generation is fast (O(columns) string concat with no external calls).

**Alternative considered**: Lazy generation on GET. Rejected: complicates the GET handler and introduces inconsistency if a migration runs between PATCH and GET.

---

### D3: contextType in POST /chat body, not a URL parameter or header

**Decision**: The worker reads `contextType` and `contextId` from the JSON request body of POST /chat.

**Rationale**: The worker already deserializes the full request body to extract `messages` and `tableSchema`. Adding fields there is additive and requires no routing or middleware changes. URL parameters would expose context in logs; headers are non-standard for body-coupled semantics.

**Breaking consideration**: `tableSchema` becomes optional in the body (required only when `contextType === "dataset"`). Existing clients that always send `tableSchema` continue to work unchanged.

---

### D4: Worker forks tool set before any LLM call

**Decision**: The first thing the worker does after body parsing is select the tool set: view tools, dataset tools, or conversational-only. No LLM turn is used for routing.

**Rationale**: Using an LLM turn to decide "is this a view operation?" wastes latency and tokens. The client already knows the context type and sends it explicitly. Early forking also ensures the system prompt can be tailored per context type (view guardrail prompts vs. dataset prompts).

---

### D5: Frontend view mutations use read-modify-write, no sub-column endpoints

**Decision**: All 12 view tool executions read the current `View` from TanStack Query cache, compute the new `columns`/`joins`/`filters` array, then PATCH the full arrays to `PATCH /api/projects/{project_id}/views/{view_id}`.

**Rationale**: Avoids adding 12 new sub-endpoints to the backend. The backend already accepts full-array PATCHes. Optimistic updates are straightforward since the new state is computed client-side before the PATCH. The TanStack Query cache ensures consistency after invalidation.

**Risk**: Concurrent edits (two browser tabs) can cause last-write-wins. Acceptable for the current single-user-per-view usage pattern.

---

### D6: createView context switch is frontend-initiated, not embedded in tool call result

**Decision**: The `createView` tool call result from the LLM does not include the new view ID (it isn't known yet). The frontend executes `POST /api/projects/{project_id}/views`, receives `{ id }` from the backend, then calls `setContext("view", id)` and navigates to `/view/{id}`.

**Rationale**: Tool call results are defined by the worker tool schema; the backend view ID is only known after the POST completes. Embedding ID generation in the tool schema would require the worker to call the backend during LLM streaming, creating coupling and retry complexity. The frontend-initiated flow is consistent with how `createDataset` already works.

---

### D7: Grain role is auto-assigned server-side in update_view

**Decision**: When `columns` or `grain` is mutated via PATCH, `update_view` re-derives `grain_role` for all columns before persisting.

**Rules**:
- If grain is null: all `grain_role` values are `None`
- If grain is defined: time column → `Time`; explicit grain dimensions (text/category/id/serial) → `Dimension` or `Entity` (by display type); decimal/integer columns → `Metric`; plain text/boolean columns → `None`

**Rationale**: Grain role is a derived property, not user-editable. Computing it server-side ensures the frontend always gets consistent grain roles without needing to replicate the assignment logic. The frontend reads grain roles from the API response and displays them; it never writes them.

---

### D8: ViewDetailView mirrors TableView component structure

**Decision**: `ViewDetailView` is a new top-level component at `/view/:viewId`, parallel to `TableView` at `/table/:datasetId`. Both register their respective tool handler on mount and unregister on unmount.

**Rationale**: Consistency with the existing pattern makes the component boundary clear: `TableView` owns dataset tool handler registration; `ViewDetailView` owns view tool handler registration. Reusing the same inline `ChatContext` channel means no new session plumbing.

---

## Risks / Trade-offs

**[Risk] JSON column ordering is not enforced by the DB** → Mitigation: The ORM preserves list order (Python lists serialize to JSON arrays); the backend always returns columns in the order they were stored. The frontend renders them in response order.

**[Risk] Alembic migration adds nullable JSON columns** → Mitigation: All new columns (`columns`, `joins`, `filters`, `grain`) default to `[]` or `null`. Existing view records get empty arrays, which produce valid (empty) `SELECT` SQL. No data loss; rollback is a `DROP COLUMN` migration.

**[Risk] contextType backward compatibility with existing channels** → Mitigation: Read fallback in `useSessionContext`: if `contextType` is null but `datasetId` is present, treat as `contextType="dataset"`, `contextId=datasetId`. This is a one-way compatibility shim; new channels always write `contextType`+`contextId`.

**[Risk] display_sql is shown to users as SQL but uses display types** → Mitigation: Label the panel "SQL Preview — for reference only" and use a muted color scheme. The label text is defined in the spec and must not be omitted.

**[Risk] Circular dependency validation is pre-existing** → `DependencyService` already validates DAG integrity. `ViewSQLGenerator` can assume a valid DAG — it does not need to re-validate.

**[Risk] Worker tool set grows to 12 view tools + existing dataset tools** → The fork ensures each context type only sees its own tool set. Prompt token budgets remain bounded: view context never sees dataset tools and vice versa.

---

## Migration Plan

1. **Write and review Alembic migration** adding `columns`, `joins`, `filters`, `grain` JSON columns to `view_records` with default `[]`/`null`
2. **Deploy backend** (migration runs on startup via Alembic auto-apply in dev; explicit `alembic upgrade head` in prod)
3. **Deploy worker** (contextType routing is backward-compatible: missing contextType → null → conversational only)
4. **Deploy frontend** (unified context model is backward-compatible: legacy channels continue to work via fallback read)
5. **Rollback**: If needed, revert frontend deploy (no schema change); revert worker deploy (tool sets unchanged); run `alembic downgrade -1` to drop new JSON columns (no data loss — columns are additive)

---

## Open Questions

- Should `display_sql` and `executable_sql` both be stored in the DB, or only `executable_sql`? (Current decision: store only `executable_sql` as `sql_definition`; generate `display_sql` on the fly in the GET response. This avoids storing two SQL strings and keeps the generator as the single source.)
- What is the maximum number of columns per view before the read-modify-write PATCH becomes a performance concern? (Not a concern at current scale; revisit if views exceed ~500 columns.)
