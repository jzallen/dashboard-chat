## Why

The chat-first UI redesign established streaming chat, session/channel routing, and context-aware UI infrastructure. The next step is the View Layer — enabling users to create and manage structured SQL intermediate models (dbt intermediate layers) through natural language, using deterministic tool calls rather than raw AI-generated SQL. This formalizes behavioral contracts across all three services before implementation begins.

## What Changes

- **Backend domain model** — View gains structured `columns`, `joins`, `filters`, and `grain` fields replacing raw `sql_definition` as the source of truth; a new Alembic migration adds JSON columns to the ORM
- **SQL generator** — A new `ViewSQLGenerator` synthesizes both `executable_sql` and `display_sql` deterministically from structured definitions; SQL is regenerated and cached on every structural PATCH
- **Unified context model** — Channel custom data replaces `datasetId` with `contextType` ("dataset" | "view" | null) + `contextId`; backward-compatible read fallback preserves existing channels
- **Agent routing** — Agent reads `contextType` from the POST /chat request body and forks the tool set before any LLM invocation; view context gets 12 new view mutation tools, dataset context gets existing dataset tools, null context gets conversational-only tools
- **View detail UI** — New `/view/:viewId` route and `ViewDetailView` component with schema table, SQL preview panel, and source dependency list, mirroring the `/table/:datasetId` → `TableView` pattern
- **View tool execution** — Frontend executes view tool calls via read-modify-write against TanStack Query cache; `createView` triggers automatic context switch to the new view
- **dbt export extension** — Export generates `models/intermediate/int_{name}.sql` for each view with `{{ ref() }}` macro resolution through the dataset→view dependency chain

## Capabilities

### New Capabilities

- `view-schema-model`: Structured column definitions (`ViewColumn`, `ViewJoin`, `ViewFilter`, `ViewGrain`) as the authoritative view representation; ORM migration and grain-role auto-assignment logic
- `view-sql-generation`: Deterministic SQL synthesis from structured view definitions, producing executable SQL (backend types) and display SQL (display types); ref-resolution mode for dbt export
- `unified-context-model`: Replace channel `datasetId` with `contextType`+`contextId`; unified context picker showing datasets and views; `setContext()` API in ChatContext; backward-compatible legacy channel read
- `view-tool-set`: 12 agent tool definitions for view mutations (`createView`, `addColumn`, `removeColumn`, `addJoin`, `removeJoin`, `addFilter`, `removeFilter`, `renameView`, `deleteView`, `setMaterialization`, `castColumn`, `setGrain`); contextType-based routing at request ingestion
- `view-schema-display`: `ViewDetailView` React component with schema table (name, display type, source, grain role), collapsible SQL preview labeled "for reference only", source dependency list, inline chat, and `/view/:viewId` route
- `view-tool-execution`: Frontend handler for 12 view tool calls; read-modify-write pattern against TanStack Query cache; `createView` context switch flow; `deleteView` dependency-check warning in chat
- `dbt-export-views`: Export views as `models/intermediate/int_{snake_name}.sql` with materialization config and ref() macro resolution; no intermediate directory when no views exist

### Modified Capabilities

- `dbt-export-api`: Extended to include view intermediate model files alongside existing staging model files; ref resolution delegates to `ViewSQLGenerator` ref-resolution mode
- `chat-agent-client`: `fetchChatStream()` request body gains `contextType` and `contextId` fields; `tableSchema` becomes optional (only required when `contextType === "dataset"`)

## Impact

**Backend**: `backend/app/models/view.py` (domain model), `backend/app/repositories/metadata/view_record.py` (ORM + JSON columns), `backend/app/routers/schemas/view.py` (request/response schemas), new Alembic migration, new `backend/app/use_cases/view/sql_generator.py`, extended `create_view.py`/`update_view.py`, existing dbt export use case

**Agent**: `agent/lib/chat/handleChat.ts` (contextType routing), new shared view tool definitions module, `agent/lib/chat/prompts.ts` (view-context guardrail prompts)

**Frontend**: `frontend/src/lib/stream/useSessionContext.ts`, `frontend/src/ui/context/ChatContext/hooks/useChatEngine.tsx`, `frontend/src/core/chat/client.ts`, `frontend/src/ui/components/chat/` (DatasetPicker → UnifiedContextPicker), `frontend/src/ui/types.ts`, new `frontend/src/ui/components/ViewDetailView/`, new `frontend/src/lib/toolCalls/viewTools.ts`, `frontend/App.tsx`

**APIs**: POST /chat body schema change (additive); no breaking changes to existing view CRUD endpoints; Alembic migration required before first deploy

**Dependencies**: Existing `DependencyService` for circular-dependency validation; TanStack Query view key invalidation after tool call execution; Stream Chat channel schema extension
