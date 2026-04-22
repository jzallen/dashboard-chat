## 1. Agent Layer — Tool Definitions and Routing

- [x] 1.1 Create `agent/lib/chat/reportToolDefinitions.ts` with `getReportTools()` exporting 15 Zod-based tool definitions: `createReport`, `renameReport`, `deleteReport`, `addDimension`, `removeDimension`, `addMeasure`, `removeMeasure`, `addFilter`, `removeFilter`, `addJoin`, `removeJoin`, `setMaterialization`, `setDomain`, `setReportType`, `suggestStructure`
- [x] 1.2 Add `getReportSystemPrompt(tableSchema)` to `agent/lib/chat/prompts.ts` — list all 15 tools, inject current report state from `tableSchema.layerContext`, include guardrails (no mart-to-mart refs, semantic type validation)
- [x] 1.3 Extend `ContextType` in `agent/lib/chat/handleChat.ts` from `"dataset" | "view" | null` to `"dataset" | "view" | "report" | null` and add the `"report"` routing branch that selects `getReportTools()` + `getReportSystemPrompt(tableSchema)`
- [x] 1.4 Add agent tests in `agent/test/chat/` for report context routing, report tool definitions schema validation, and report system prompt content

## 2. Frontend — Report Tool Execution

- [x] 2.1 Create `frontend/src/core/toolCalls/reportTools.ts` with `executeReportToolCall(toolName, args, context)` dispatcher and individual `handle*` functions for all 15 tools
- [x] 2.2 Define `ReportToolContext` type carrying `reportId`, `projectId`, `queryClient`, `navigate`, `setContext` — following `ViewToolContext` pattern
- [x] 2.3 Implement CRUD handlers: `handleCreateReport` (POST + navigate + setContext), `handleRenameReport` (PATCH name), `handleDeleteReport` (DELETE + navigate away + clearContext)
- [x] 2.4 Implement structure handlers: `handleAddDimension`, `handleRemoveDimension`, `handleAddMeasure`, `handleRemoveMeasure` — each reads current `columns_metadata`, mutates the array, PATCHes the report
- [x] 2.5 Implement config handlers: `handleSetMaterialization`, `handleSetDomain`, `handleSetReportType` — each PATCHes the single field
- [x] 2.6 Implement filter/join handlers: `handleAddFilter`, `handleRemoveFilter`, `handleAddJoin`, `handleRemoveJoin` — filter handlers modify `sql_definition`, join handlers modify `source_refs` + `sql_definition`
- [x] 2.7 Implement `handleSuggestStructure` — returns a formatted string of suggestions (no mutation, agent presents to user)
- [x] 2.8 Add frontend tests for `reportTools.ts` — test each handler with mocked API client and queryClient invalidation

## 3. Frontend — Context Wiring

- [x] 3.1 Extend `entityType` in `useEntityContext.ts` to accept `"report"` alongside `"dataset" | "view" | null`
- [x] 3.2 Extend `contextType` in `frontend/src/core/chat/client.ts` `fetchChatStream` to accept `"report"`
- [x] 3.3 Add report detail page context registration: `setContext("report", reportId)` on mount, `setContext(null, null)` on unmount, and build `tableSchema` with `layerContext` from report state
- [x] 3.4 Register `ToolHandler` on the report detail page that delegates to `executeReportToolCall`
- [x] 3.5 Update `useChatEngine.tsx` to pass `tableSchema` for report context (currently only passed for dataset context)

## 4. Integration Testing

- [x] 4.1 Add agent integration test: send a chat request with `contextType: "report"` and verify the response includes report tool calls (not dataset or view tools)
- [x] 4.2 Add frontend integration test: mount report detail page, simulate tool call SSE events, verify API mutations and cache invalidation
- [ ] 4.3 Manual smoke test: create a report via chat, add dimensions/measures, change materialization, verify state persists across page refreshes

## 5. Documentation Updates

- [x] 5.1 Update context routing table in `docs/architecture/frontend-layers.md` (lines 81-93) to include `"report"` context type and update the `setContext()` type signature
- [x] 5.2 Update context routing table in `docs/domain/tool-calls/README.md` (lines 6-12) to add a "Report Tools" section listing all 15 report tools
- [x] 5.3 Create per-tool `.md` files in `docs/domain/tool-calls/` for each of the 15 report tools, following the format of existing tool docs (e.g., `add-filter.md`, `set-materialization.md`)
