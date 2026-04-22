# report-chat-tools Specification

## Purpose
TBD - created by archiving change report-chat-tools. Update Purpose after archive.
## Requirements
### Requirement: Report tool definitions

The agent service SHALL define report chat tools in `agent/lib/chat/reportToolDefinitions.ts` using the AI SDK `tool()` helper with Zod parameter schemas. A `getReportTools()` factory function SHALL export the tool set.

The following 15 tools SHALL be defined:

**CRUD tools:**
- `createReport` — creates a new report with name, report_type, and optional source_refs
- `renameReport` — renames the current report
- `deleteReport` — deletes the current report

**Structure tools:**
- `addDimension` — adds a column to `columns_metadata` with `semantic_role: "dimension"`
- `removeDimension` — removes a dimension column by name from `columns_metadata`
- `addMeasure` — adds a column to `columns_metadata` with `semantic_role: "measure"`
- `removeMeasure` — removes a measure column by name from `columns_metadata`

**Filter tools:**
- `addFilter` — adds a SQL WHERE clause filter to the report's `sql_definition`
- `removeFilter` — removes a filter from the report's `sql_definition`

**Join tools:**
- `addJoin` — adds a source reference and JOIN clause to the report
- `removeJoin` — removes a source reference and its JOIN clause

**Configuration tools:**
- `setMaterialization` — sets materialization strategy (`"view"`, `"table"`, `"ephemeral"`, `"incremental"`)
- `setDomain` — sets the business domain classification
- `setReportType` — sets report type to `"fact"` or `"dimension"`

**Intelligence tools:**
- `suggestStructure` — analyzes source schemas and proposes dimensions/measures based on column name/type heuristics

#### Scenario: Report tools available in report context

- **WHEN** the agent receives a chat request with `contextType: "report"`
- **THEN** the agent SHALL call `streamText` with `tools` set to the result of `getReportTools()`
- **THEN** `toolChoice` SHALL be `"auto"`

#### Scenario: addDimension tool parameters

- **WHEN** the `addDimension` tool is called
- **THEN** it SHALL accept `name` (string), `semantic_type` (enum: `"categorical"`, `"time"`), and optional `time_granularity` (enum: `"day"`, `"week"`, `"month"`, `"quarter"`, `"year"`), `description` (string), and `expr` (string)

#### Scenario: addMeasure tool parameters

- **WHEN** the `addMeasure` tool is called
- **THEN** it SHALL accept `name` (string), `semantic_type` (enum: `"sum"`, `"count"`, `"count_distinct"`, `"avg"`, `"min"`, `"max"`), and optional `description` (string) and `expr` (string)

#### Scenario: createReport tool parameters

- **WHEN** the `createReport` tool is called
- **THEN** it SHALL accept `name` (string), `report_type` (enum: `"fact"`, `"dimension"`), and optional `source_refs` (array of `{name: string, type: "dataset" | "view"}`)
- **THEN** the `source_refs` type enum SHALL NOT include `"report"` — mart-to-mart references are blocked

#### Scenario: setMaterialization tool parameters

- **WHEN** the `setMaterialization` tool is called
- **THEN** it SHALL accept `strategy` (enum: `"view"`, `"table"`, `"ephemeral"`, `"incremental"`)

#### Scenario: suggestStructure tool output

- **WHEN** the `suggestStructure` tool is called
- **THEN** the agent SHALL analyze source view column names and types from `tableSchema.layerContext.sourceSchemas`
- **THEN** the agent SHALL propose dimension and measure assignments following the heuristics in the `report-column-metadata` spec (columns ending in `_id` → entity, `_at`/`_date` → time dimension, numeric → measure, string → categorical dimension)
- **THEN** the suggestions SHALL be presented conversationally for user confirmation

---

### Requirement: Report system prompt

The agent SHALL use a report-specific system prompt when `contextType` is `"report"`.

- `getReportSystemPrompt(tableSchema)` SHALL describe the report's current state: name, report type, domain, materialization, column metadata, source references, and SQL definition
- The prompt SHALL include all 15 tool names with brief descriptions
- The prompt SHALL include guardrails: no mart-to-mart source references, no raw data row editing, dimension/measure semantic types must match their role
- The prompt SHALL include the `getLayerSection(tableSchema)` output for the `"report"` layer

#### Scenario: Report prompt includes current state

- **WHEN** the agent builds the system prompt for a report with 3 dimensions and 2 measures
- **THEN** the prompt SHALL list all 5 column metadata entries with their roles and types

#### Scenario: Report prompt enforces source ref constraint

- **WHEN** the agent receives the report system prompt
- **THEN** the prompt SHALL instruct the agent to reject any attempt to reference another report as a source

