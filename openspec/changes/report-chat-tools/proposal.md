# Report Chat Tools: Complete the Chat-First Report Modeling Layer

## Why

The core product vision is Upload → Model with NL → dbt export → SQL access. Reports are the mart layer — the final modeling step before export. Backend Report CRUD is complete: domain model, use cases, endpoints, dbt export with `fct_`/`dim_` prefixes. The `report-layer-chat-first.feature` defines 64 Gherkin scenarios specifying 15 structured tools.

But the agent has zero report support. `handleChat.ts` routes on `contextType: "dataset" | "view" | null` — there is no `"report"` branch. No report tool definitions exist. The frontend context system does not recognize report as a context type. Users cannot build reports through chat, which is the only interaction model the platform offers.

This is the single highest-priority gap. Without it, the dbt export produces only sources and intermediate models — no mart layer, no MetricFlow-ready output, and no useful semantic manifest for the planner.

## What Changes

### Agent Layer
- Add `contextType: "report"` branch in `handleChat.ts` alongside the existing `"dataset"` and `"view"` branches
- Create `reportToolDefinitions.ts` following the pattern of `viewToolDefinitions.ts`, defining 15 tools:
  - **CRUD**: `createReport`, `renameReport`, `deleteReport`
  - **Structure**: `addDimension`, `removeDimension`, `addMeasure`, `removeMeasure`
  - **Filters**: `addFilter`, `removeFilter`
  - **Joins**: `addJoin`, `removeJoin`
  - **Configuration**: `setMaterialization`, `setDomain`, `setReportType`
  - **Intelligence**: `suggestStructure` — proposes dimensions/measures from source view's grain and column metadata
- Create `getReportSystemPrompt()` in `prompts.ts` using the existing report-layer prompt foundations

### Frontend Layer
- Extend the `contextType` union in `core/chat/client.ts` and `ui/context/ChatContext/hooks/useChatEngine.tsx` to include `"report"`
- Add report context badge in the context picker (alongside dataset and view badges)
- Add report schema panel showing dimensions, measures, domain, materialization, and SQL preview
- Wire report tool call execution (similar to how view tool calls map to backend mutations)

### Backend Layer
- Add `suggestStructure` endpoint or extend report creation to accept a `suggest=true` parameter that returns proposed dimensions/measures from source view column metadata
- Ensure report tool call results (dimension/measure additions) generate deterministic SQL via the existing `sql_generator.py` pattern

## Capabilities

### New Capabilities
- `report-chat-tools`: Agent tool definitions for structured report modeling via chat
- `report-context-routing`: Agent and frontend support for `contextType: "report"` with appropriate system prompt and tool set

### Modified Capabilities
- `chat-context-management`: Extended to include report as a routable context type
- `agent-chat-streaming`: Report tools added to the tool-calling pipeline
- `report-mart-layer`: Agent-side integration for the existing backend CRUD operations
- `report-column-metadata`: Dimension/measure operations driven by chat tool calls instead of manual API calls

## Impact

- `agent/lib/chat/handleChat.ts` — add `"report"` to `ContextType` union (line 9), add routing branch (lines 40-51)
- `agent/lib/chat/reportToolDefinitions.ts` — new file, ~200 lines following `viewToolDefinitions.ts` pattern
- `agent/lib/chat/prompts.ts` — new `getReportSystemPrompt()` function
- `agent/lib/chat/types.ts` — extend types if needed
- `agent/test/chat/` — new test files for report tools, prompts, and context routing
- `frontend/src/core/chat/client.ts` — extend context type
- `frontend/src/ui/context/ChatContext/` — extend hooks for report context
- `frontend/src/ui/components/` — report schema panel component
- `backend/app/use_cases/report/` — `suggest_structure.py` use case (optional)
- `backend/app/routers/reports.py` — optional suggest endpoint
- No database migrations required — report table already exists
