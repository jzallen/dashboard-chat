## Context

The chat agent currently routes on `contextType: "dataset" | "view" | null` in `handleChat.ts` (line 9). Each context type selects a system prompt and a set of Zod-based tool definitions. Tool calls are emitted as `9:` SSE lines — the agent never executes tools itself. The frontend parses these lines and dispatches execution via a registered `ToolHandler` per page component.

Report backend CRUD is complete: domain model (`app/models/report.py`), repository methods (`repository.py` lines 895-999), five use cases (create, update, get, list, delete), router at `/api/projects/{project_id}/reports`, and HTTP controller methods. Column metadata validation enforces semantic role/type pairs (entity, dimension, measure).

The `layerContext.layer` type in `agent/lib/chat/types.ts` already includes `"report"`, and `getLayerSection()` in `prompts.ts` already has a `"report"` branch (lines 528-556). The gap is: no `"report"` value in `ContextType`, no report tool definitions, no frontend report tool executor, and no report page wiring.

## Goals / Non-Goals

**Goals:**
- Add `"report"` as a first-class `contextType` in the agent, with dedicated tool definitions and system prompt
- Enable users to create, configure, and refine reports (dimensions, measures, filters, joins, materialization, domain, report type) entirely through chat
- Follow existing patterns exactly: Zod-based `tool()` definitions, frontend-side execution via backend API mutations, `ToolHandler` registration on the report detail page
- Include `suggestStructure` tool that proposes dimensions/measures from source view column metadata

**Non-Goals:**
- SQL preview or live query execution from chat (existing report detail UI handles this)
- Dashboard preview integration (blocked by `local-first-analytics`)
- dbt export triggering from chat (separate `dbt-export-chat-tool` change)
- Changes to the report backend CRUD — it's complete and tested
- Report creation from non-report contexts (users navigate to reports section first)

## Decisions

### 1. Report tool definitions follow the view tool pattern exactly

Report tools go in a new `agent/lib/chat/reportToolDefinitions.ts` using `tool()` from the Vercel AI SDK with Zod parameter schemas. No `execute` functions — the frontend owns all mutations.

**Why not extend the existing tools.ts?** `tools.ts` is dataset-specific (column enums from `tableSchema`). View tools already have their own file. Report tools are a third distinct context with its own tool set.

**Alternatives considered:**
- Single tools file with context-conditional tool sets — rejected because it conflates three unrelated tool domains and makes each harder to test independently.

### 2. Frontend report tool executor mirrors `viewTools.ts`

A new `frontend/src/core/toolCalls/reportTools.ts` with `executeReportToolCall(toolName, args, context)` dispatching to individual `handle*` functions. Each handler calls the report API via a catalog/API client and invalidates TanStack Query cache.

**Why not reuse the view tool executor?** Report mutations hit different endpoints (`/api/projects/{pid}/reports/{rid}`) and operate on different domain concepts (dimensions/measures vs columns/joins). The dispatcher pattern is the same but the handlers are entirely different.

### 3. Report context uses PATCH-based mutations for structural changes

Adding a dimension, removing a measure, setting materialization — all use `PATCH /api/projects/{pid}/reports/{rid}` with partial update payloads. The frontend reads the current report state, computes the new `columns_metadata` / field value, and sends the delta.

**Why PATCH over dedicated endpoints?** The backend already supports `PATCH` with partial `update_data` dict. Adding dedicated endpoints (e.g., `POST .../dimensions`) would require new routes, controllers, and use cases for no behavioral gain. The view tools already use this pattern (`patchView()` helper).

**Trade-off:** Client must read-then-write for array mutations (add/remove dimension). This is acceptable because reports are single-user-edited and the chat is the only mutation source during a session.

### 4. `suggestStructure` is an agent-side heuristic, not a backend endpoint

The agent's system prompt includes heuristic rules for suggesting dimensions/measures from column metadata (columns ending in `_id` → entity, `_at`/`_date` → time dimension, numeric types → measure, string types → categorical dimension). These rules already exist in `report-column-metadata` spec.

**Why not a backend endpoint?** The suggestion logic is simple pattern matching on column names and types — data the agent already has via `tableSchema.layerContext.sourceSchemas`. A backend round-trip adds latency and complexity for a deterministic string-matching operation. The `suggestStructure` tool emits a structured suggestion that the user confirms or modifies via follow-up chat.

**Alternative considered:** Backend `suggest=true` parameter on report creation — rejected because it couples suggestion heuristics to the persistence layer and the agent needs to explain its reasoning conversationally.

### 5. `contextType: "report"` requires `tableSchema` with `layerContext`

When the report detail page sets context, it passes a `tableSchema` with `layerContext.layer = "report"`, `layerContext.modelName`, `layerContext.sqlDefinition`, and `layerContext.sourceSchemas`. This enables the agent to understand the report's current state and source structure.

The agent routes on `contextType === "report"` and calls `getReportTools()` + `getReportSystemPrompt(tableSchema)`. The `getLayerSection()` helper already handles the `"report"` layer case.

### 6. Tool count: 15 tools matching the proposal

| Category | Tools |
|----------|-------|
| CRUD | `createReport`, `renameReport`, `deleteReport` |
| Structure | `addDimension`, `removeDimension`, `addMeasure`, `removeMeasure` |
| Filters | `addFilter`, `removeFilter` |
| Joins | `addJoin`, `removeJoin` |
| Config | `setMaterialization`, `setDomain`, `setReportType` |
| Intelligence | `suggestStructure` |

This mirrors the view tool set (12 tools) with additions for the report-specific concepts (dimensions, measures, domain, report type, suggest).

## Risks / Trade-offs

**[Read-then-write race on array mutations]** → The frontend reads current `columns_metadata`, modifies it, and PATCHes. If two mutations overlap, the second could overwrite the first. **Mitigation:** Chat tool calls are sequential (agent emits one at a time, frontend executes serially via `executeToolCalls`). No concurrent mutation path exists.

**[Agent context size with large source schemas]** → Reports can reference multiple views/datasets. Passing all `sourceSchemas` in `tableSchema` could bloat the agent's context window. **Mitigation:** Limit `sourceSchemas` to column names and types only (not full row data). The `layerContext` fields are already designed for this — they carry schema metadata, not data.

**[suggestStructure accuracy]** → Heuristic-based suggestions may misclassify columns (e.g., a string `status` column as categorical dimension when it's actually a filter). **Mitigation:** Suggestions are always presented to the user for confirmation. The agent explains its reasoning and the user accepts, modifies, or rejects via follow-up messages.

**[No report-to-report source refs]** → The backend explicitly blocks `source_refs` with `type: "report"` (`InvalidReportReference`). The agent tools must enforce this — `addJoin` and `createReport` only accept dataset/view sources. **Mitigation:** Tool parameter descriptions and system prompt guardrails make this constraint explicit.
