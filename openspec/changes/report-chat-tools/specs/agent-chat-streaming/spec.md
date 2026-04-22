## MODIFIED Requirements

### Requirement: Tool definitions use Zod schemas via AI SDK tool() helper

The agent service SHALL define all chat tools using the AI SDK `tool()` helper with Zod parameter schemas. Plain JSON Schema tool definitions SHALL be removed. Tool definitions SHALL be exported from context-specific modules:

- `agent/lib/chat/tools.ts` via `getTools(tableSchema)` for dataset context
- `agent/lib/chat/viewToolDefinitions.ts` via `getViewTools()` for view context
- `agent/lib/chat/reportToolDefinitions.ts` via `getReportTools()` for report context

#### Scenario: Type-safe tool parameters

- **WHEN** a tool definition is created for a column-specific operation (e.g. `filterTable`)
- **THEN** the column parameter SHALL use `z.enum(columnIds as [string, ...string[]])` built from the live table schema
- **AND** the tool SHALL be defined with `tool({ description, parameters })` from the `ai` package
- **AND** TypeScript SHALL infer the parameter types from the Zod schema at compile time

#### Scenario: Tool definitions passed to streamText

- **WHEN** `streamText` is called to handle a chat request
- **THEN** the `tools` option SHALL receive the result of the appropriate `getTools` / `getViewTools` / `getReportTools` factory
- **AND** `toolChoice` SHALL be `"auto"`

#### Scenario: Report tool definitions loaded for report context

- **WHEN** `streamText` is called with `contextType: "report"`
- **THEN** the `tools` option SHALL receive the result of `getReportTools()`
- **AND** the tool set SHALL contain 15 report-specific tools
