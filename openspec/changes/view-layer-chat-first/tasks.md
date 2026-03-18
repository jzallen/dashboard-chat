## 1. Backend — View Domain Model (view-schema-model)

- [ ] 1.1 Define `ViewColumn`, `ViewJoin`, `ViewFilter`, `ViewGrain` dataclasses/Pydantic models in `backend/app/models/view.py`
- [ ] 1.2 Update `View` domain model to include `columns: list[ViewColumn]`, `joins: list[ViewJoin]`, `filters: list[ViewFilter]`, `grain: ViewGrain | None`
- [ ] 1.3 Update `ViewRecord` ORM model in `backend/app/repositories/metadata/view_record.py` to add `columns`, `joins`, `filters`, `grain` as `JSON` columns with `default=[]`/`default=None`
- [ ] 1.4 Write Alembic migration: add `columns`, `joins`, `filters`, `grain` JSON columns to `view_records` table
- [ ] 1.5 Update `ViewMetadataRepository` to serialize/deserialize `ViewColumn`/`ViewJoin`/`ViewFilter`/`ViewGrain` to/from the JSON columns
- [ ] 1.6 Update `backend/app/routers/schemas/view.py` Pydantic request/response schemas to include structured column fields
- [ ] 1.7 Implement grain role auto-assignment in `update_view` use case: re-derive `grain_role` for all columns when `columns` or `grain` changes
- [ ] 1.8 Write unit tests for grain role auto-assignment (all scenarios: null grain, time column, dimensions, metrics, text/boolean no-role)

## 2. Backend — SQL Generator (view-sql-generation)

- [ ] 2.1 Create `backend/app/use_cases/view/sql_generator.py` with `ViewSQLGenerator` class
- [ ] 2.2 Implement `generate_executable(view, ref_mode=False)`: builds SELECT with backend SQL type CASTs, WHERE clause from filters, JOIN clauses from joins
- [ ] 2.3 Implement `generate_display(view)`: same structure but uses display type names in CASTs; adds `-- SQL Preview — for reference only` header comment
- [ ] 2.4 Implement `ref_mode=True` source resolution: dataset sources → `{{ ref('stg_{name}') }}`, view sources → `{{ ref('int_{name}') }}`
- [ ] 2.5 Wire `ViewSQLGenerator.generate_executable()` into `create_view` use case — store result in `sql_definition`
- [ ] 2.6 Wire `ViewSQLGenerator.generate_executable()` into `update_view` use case — regenerate `sql_definition` on any structural PATCH (columns, joins, filters, grain)
- [ ] 2.7 Expose `display_sql` in the GET view response (generate on-the-fly in the router/controller, not stored)
- [ ] 2.8 Write unit tests for `ViewSQLGenerator`: executable SQL output, display SQL output, ref_mode substitutions, filter/join/alias permutations

## 3. Backend — dbt Export Extension (dbt-export-views)

- [ ] 3.1 Locate the existing dbt export use case (search for `stg_` generation logic in `backend/app/use_cases/`)
- [ ] 3.2 Add intermediate model generation: for each view, call `ViewSQLGenerator.generate_executable(view, ref_mode=True)` and write to `models/intermediate/int_{snake_name}.sql` with materialization config header
- [ ] 3.3 Skip `models/intermediate/` directory entirely when the project has no views
- [ ] 3.4 Write unit tests for dbt export with views: file paths, ref() macro resolution, materialization header, staging-only export when no views

## 4. Frontend — Unified Context Model (unified-context-model)

- [ ] 4.1 Update channel custom data type in `frontend/src/ui/types.ts`: add `contextType: "dataset" | "view" | null`, `contextId: string | null`; deprecate `datasetId`
- [ ] 4.2 Update `frontend/src/lib/stream/useSessionContext.ts`: implement `setContext(type, id)` replacing `registerDatasetId`; add legacy fallback read (null contextType + datasetId present → treat as dataset context)
- [ ] 4.3 Update `ChatContext` to expose `setContext` and remove `registerDatasetId` from public API
- [ ] 4.4 Update `frontend/src/ui/context/ChatContext/hooks/useChatEngine.tsx`: pass `contextType` and `contextId` in POST /chat body; omit `tableSchema` when `contextType` is not "dataset"
- [ ] 4.5 Update `frontend/src/core/chat/client.ts` (`fetchChatStream`): make `tableSchema` optional; add `contextType` and `contextId` parameters to request body
- [ ] 4.6 Refactor `DatasetPicker` → `UnifiedContextPicker`: fetch datasets + views in parallel; render unified list with type badges; call `setContext` on selection
- [ ] 4.7 Update context indicator in `ChatInput` gutter: resolve `contextType`+`contextId` to "View / {name}" or "Dataset / {name}" display label
- [ ] 4.8 Add view context tooltip: on hover over context indicator, show source list and grain definition when `contextType === "view"`
- [ ] 4.9 Update all call sites of `registerDatasetId` to use `setContext("dataset", id)`
- [ ] 4.10 Write tests for `useSessionContext` legacy fallback, `setContext` behavior, and `useChatEngine` contextType routing

## 5. Worker — View Tool Set and Routing (view-tool-set)

- [ ] 5.1 Create shared view tool definitions module (e.g., `worker/lib/chat/viewToolDefinitions.ts`) with all 12 tool schemas: `createView`, `addColumn`, `removeColumn`, `addJoin`, `removeJoin`, `addFilter`, `removeFilter`, `renameView`, `deleteView`, `setMaterialization`, `castColumn`, `setGrain`
- [ ] 5.2 Update `worker/lib/chat/handleChat.ts`: read `contextType` and `contextId` from request body; fork tool set before LLM invocation (view tools / dataset tools / conversational-only)
- [ ] 5.3 Relax the hard-fail on missing `tableSchema`: null context is valid and should not error
- [ ] 5.4 Update `worker/lib/chat/prompts.ts`: add view-context system prompt section with guardrail instructions (dataset-only redirect, grain requirements, metric/dimension guardrails, circular dependency warning)
- [ ] 5.5 Write worker tests: contextType "view" → view tools in prompt; contextType "dataset" → dataset tools in prompt; contextType null → no mutation tools; null tableSchema with null context does not error

## 6. Frontend — ViewDetailView Component (view-schema-display)

- [ ] 6.1 Create `frontend/src/ui/components/ViewDetailView/` directory with `index.tsx` entry point
- [ ] 6.2 Add TanStack Query view hooks: `useView(viewId)` for GET /api/projects/{projectId}/views/{viewId}; `useViews(projectId)` for list
- [ ] 6.3 Implement schema table: columns for Name, Type (display type), Source (entity name), Grain Role (conditional column — only when grain is defined)
- [ ] 6.4 Implement collapsible SQL preview panel: shows `display_sql` from API response; labeled "SQL Preview — for reference only" with muted visual style
- [ ] 6.5 Implement source dependency list: resolve each `source_ref` to name+type; render as clickable links (datasets → `/table/{id}`, views → `/view/{id}`)
- [ ] 6.6 Add inline chat input at bottom of `ViewDetailView` (same `ChatContext` channel)
- [ ] 6.7 Add `/view/:viewId` route in `frontend/App.tsx`
- [ ] 6.8 Update `UnifiedNav` session list: render view type indicator for channels with `contextType = "view"`
- [ ] 6.9 Write component tests for `ViewDetailView`: schema table rendering, grain role column visibility, SQL preview collapse/expand, source dependency links

## 7. Frontend — View Tool Execution (view-tool-execution)

- [ ] 7.1 Create `frontend/src/lib/toolCalls/viewTools.ts` with handler functions for all 12 view tool calls
- [ ] 7.2 Implement read-modify-write helpers: read current view from TanStack Query cache, compute new arrays, PATCH full arrays to backend
- [ ] 7.3 Implement `handleCreateView`: POST /views, receive `{ id }`, call `setContext("view", id)`, navigate to `/view/{id}`
- [ ] 7.4 Implement `handleAddColumn`, `handleRemoveColumn`, `handleCastColumn`: update `columns` array and PATCH
- [ ] 7.5 Implement `handleAddJoin`, `handleRemoveJoin`: update `joins` array and PATCH
- [ ] 7.6 Implement `handleAddFilter`, `handleRemoveFilter`: update `filters` array and PATCH
- [ ] 7.7 Implement `handleSetGrain`: PATCH `grain` field; invalidate view key so grain roles refresh from server
- [ ] 7.8 Implement `handleRenameView`: PATCH `name`; update context indicator label
- [ ] 7.9 Implement `handleSetMaterialization`: PATCH `materialization`
- [ ] 7.10 Implement `handleDeleteView`: GET dependents; if any, inject warning in chat and wait for confirmation; on confirm, DELETE + `setContext(null, null)`
- [ ] 7.11 Wire view tool handler registration/unregistration in `ViewDetailView` mount/unmount lifecycle
- [ ] 7.12 Ensure `filterTable` and `sortTable` in view context update TanStack Table display state only (no backend PATCH)
- [ ] 7.13 Write unit tests for `handleCreateView` context switch, `handleDeleteView` dependent warning, read-modify-write invalidation behavior

## 8. Integration Verification

- [ ] 8.1 Run `bazel test //backend:tests` — confirm SQL generator, migration, view CRUD, grain role tests all pass
- [ ] 8.2 Run `bazel test //worker:test` — confirm contextType routing tests pass
- [ ] 8.3 Run `bazel test //frontend:test` — confirm ViewDetailView, unified context picker, useChatEngine tests pass
- [ ] 8.4 Manual smoke test: POST /chat with `contextType="view"` → verify view tool set appears in Groq prompt (check worker logs)
- [ ] 8.5 Manual smoke test: create view from "orders" dataset via chat → context switches to view → add column → cast type → set grain → verify schema table shows grain roles
- [ ] 8.6 Manual smoke test: export dbt project with views → unzip → confirm `models/intermediate/int_*.sql` present with correct ref() macros and materialization config
