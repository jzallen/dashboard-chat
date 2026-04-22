## ADDED Requirements

### Requirement: Report context type in agent routing

The agent's `ContextType` union in `handleChat.ts` SHALL include `"report"` as a valid value: `"dataset" | "view" | "report" | null`.

- When `contextType === "report"`, the agent SHALL select `getReportSystemPrompt(tableSchema)` as the system prompt and `getReportTools()` as the tool set
- The report branch SHALL NOT use the `resolve_dataset` interception transform — reports have explicit context
- The report branch SHALL pass `tableSchema` to `getReportSystemPrompt()` for state injection

#### Scenario: Agent routes report context to report tools

- **WHEN** a chat request arrives with `contextType: "report"` and a `tableSchema` containing `layerContext.layer: "report"`
- **THEN** the agent SHALL use `getReportTools()` and `getReportSystemPrompt(tableSchema)`
- **THEN** the agent SHALL NOT activate the `resolve_dataset` interception

#### Scenario: Report context without tableSchema

- **WHEN** a chat request arrives with `contextType: "report"` but `tableSchema` is null
- **THEN** the agent SHALL fall back to the conversational prompt and tools (same as null context)

---

### Requirement: Frontend report context registration

The report detail page SHALL register `"report"` as the entity context type when mounted.

- The report detail page SHALL call `setContext("report", reportId)` on mount and `setContext(null, null)` on unmount
- The report detail page SHALL build a `tableSchema` with `layerContext` containing `layer: "report"`, `modelName`, `sqlDefinition`, and `sourceSchemas` derived from the report's current state
- The `tableSchema` SHALL be updated when the report state changes (e.g., after a tool call mutates the report)

#### Scenario: Report page sets context on mount

- **WHEN** the user navigates to a report detail page for report "Orders"
- **THEN** the frontend SHALL call `setContext("report", reportId)`
- **THEN** the `tableSchema.layerContext` SHALL contain `layer: "report"`, `modelName: "Orders"`, and the current `sqlDefinition`

#### Scenario: Report page clears context on unmount

- **WHEN** the user navigates away from the report detail page
- **THEN** the frontend SHALL call `setContext(null, null)`

---

### Requirement: Frontend report tool handler

The report detail page SHALL register a `ToolHandler` that dispatches report tool calls to the backend API.

- `executeReportToolCall(toolName, args, context)` SHALL route each tool name to a handler function
- Each handler SHALL call the appropriate report API endpoint (POST for create, PATCH for updates, DELETE for delete)
- After each mutation, the handler SHALL invalidate the relevant TanStack Query keys to refresh the UI
- The handler SHALL return a string result describing what changed (for the agent to include in its response)

#### Scenario: addDimension tool execution

- **WHEN** the frontend receives an `addDimension` tool call with `name: "region"`, `semantic_type: "categorical"`
- **THEN** the handler SHALL read the current report's `columns_metadata`
- **THEN** the handler SHALL append `{name: "region", semantic_role: "dimension", semantic_type: "categorical"}` to the array
- **THEN** the handler SHALL PATCH the report with the updated `columns_metadata`
- **THEN** the handler SHALL invalidate the report query cache

#### Scenario: createReport tool execution

- **WHEN** the frontend receives a `createReport` tool call with `name: "Orders"`, `report_type: "fact"`
- **THEN** the handler SHALL POST to `/api/projects/{projectId}/reports` with the provided parameters
- **THEN** the handler SHALL navigate to the new report's detail page
- **THEN** the handler SHALL call `setContext("report", newReportId)`

#### Scenario: deleteReport tool execution

- **WHEN** the frontend receives a `deleteReport` tool call
- **THEN** the handler SHALL DELETE the report via the API
- **THEN** the handler SHALL navigate away from the report detail page
- **THEN** the handler SHALL call `setContext(null, null)`
