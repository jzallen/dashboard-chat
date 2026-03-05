# Capability: cleaning-chat-tools

Eight new tool definitions, system prompt updates, and frontend tool execution handlers for driving cleaning operations through the chat interface.

---

## ADDED Requirements

### Requirement: trimWhitespace tool definition

The system SHALL provide a `trimWhitespace` tool that previews trimming leading and trailing whitespace from text column(s). The tool MUST accept a `column` parameter whose `enum` values are restricted to columns where `type === "string"`, plus the literal value `"all"`. The tool MUST NOT be offered for numeric, boolean, or date columns. When `column` is `"all"`, the tool SHALL target all text columns in the dataset.

#### Scenario: Trim whitespace from a specific text column

- **WHEN** the AI calls `trimWhitespace` with `column` set to a specific text column name
- **THEN** the frontend SHALL call `POST /api/datasets/{id}/transforms/preview` with the trim operation config for that column
- **THEN** the tool SHALL return a formatted string containing `affected_count` and up to 5 before/after sample values
- **THEN** the AI SHALL present the preview to the user and ask for confirmation before proceeding

#### Scenario: Trim whitespace from all text columns

- **WHEN** the AI calls `trimWhitespace` with `column` set to `"all"`
- **THEN** the frontend SHALL call the preview endpoint for each text column in the schema
- **THEN** the tool SHALL return a combined preview listing each affected column and its cell count
- **THEN** numeric, boolean, and date columns SHALL be excluded from the operation

#### Scenario: Trim whitespace rejected for non-text column

- **WHEN** the AI attempts to call `trimWhitespace` with a column whose type is not `"string"`
- **THEN** the tool definition's `enum` constraint SHALL prevent the call from being made
- **THEN** if the user requests trimming on a non-text column, the AI SHALL explain that trimming applies only to text columns and SHALL NOT create a transform

---

### Requirement: standardizeCase tool definition

The system SHALL provide a `standardizeCase` tool that previews case standardization on a text column. The tool MUST accept a `column` parameter restricted to text columns (same `enum` restriction as `trimWhitespace`) and a `mode` parameter with `enum` values `["title", "upper", "lower"]`. Both parameters MUST be required.

#### Scenario: Standardize text to title case

- **WHEN** the AI calls `standardizeCase` with `column` set to a text column and `mode` set to `"title"`
- **THEN** the frontend SHALL call `POST /api/datasets/{id}/transforms/preview` with the case operation config
- **THEN** the tool SHALL return a preview with affected count and before/after samples showing title-cased values

#### Scenario: Standardize text to upper case

- **WHEN** the AI calls `standardizeCase` with `mode` set to `"upper"`
- **THEN** the preview SHALL show values converted to UPPER CASE

#### Scenario: Standardize text to lower case

- **WHEN** the AI calls `standardizeCase` with `mode` set to `"lower"`
- **THEN** the preview SHALL show values converted to lower case

#### Scenario: Case standardization rejected for non-text column

- **WHEN** the user asks to standardize casing on a numeric or date column
- **THEN** the AI SHALL explain that case operations apply only to text columns
- **THEN** no transform SHALL be created

#### Scenario: Ambiguous casing request triggers clarification

- **WHEN** the user asks to "fix the casing" without specifying a mode
- **THEN** the AI SHALL ask which case format the user wants (title, upper, or lower)
- **THEN** the AI SHALL NOT call `standardizeCase` until the user specifies a mode

---

### Requirement: renameColumn tool definition

The system SHALL provide a `renameColumn` tool that creates column alias transforms immediately without a preview step. The tool MUST accept a `renames` parameter that is an array of objects, each containing a `column` (current column name, from `enum` of all column names regardless of type) and an `alias` (new display name, free-form string). The `renames` array MUST be required.

#### Scenario: Rename a single column

- **WHEN** the AI calls `renameColumn` with `renames` containing one entry `{column: "emp_id", alias: "Employee ID"}`
- **THEN** the frontend SHALL create an alias transform directly via `POST /api/datasets/{id}/transforms` without calling the preview endpoint
- **THEN** the column header in the table view SHALL display "Employee ID"
- **THEN** the AI SHALL confirm the rename in its response

#### Scenario: Rename multiple columns in one request

- **WHEN** the AI calls `renameColumn` with `renames` containing multiple entries
- **THEN** the frontend SHALL create one alias transform per entry
- **THEN** all specified column headers SHALL update to their new display names

#### Scenario: Subsequent AI messages use the alias

- **WHEN** a column has been renamed via `renameColumn`
- **THEN** the system prompt SHALL reflect the alias in the column schema
- **THEN** the AI SHALL refer to the column by its alias in subsequent responses

---

### Requirement: fillNulls tool definition

The system SHALL provide a `fillNulls` tool that previews filling null and empty values in a column with a specified value. The tool MUST accept a `column` parameter whose `enum` includes all columns regardless of type, and a `fillValue` parameter. Both parameters MUST be required. The `fillValue` MUST match the target column's data type: string values for text columns, numeric values for numeric columns.

#### Scenario: Fill null values in a text column

- **WHEN** the AI calls `fillNulls` with `column` set to a text column and `fillValue` set to a string (e.g., `"Unknown"`)
- **THEN** the frontend SHALL call the preview endpoint with the fill_null operation config
- **THEN** the tool SHALL return a preview with the count of null/empty cells and sample affected rows

#### Scenario: Fill null values in a numeric column

- **WHEN** the AI calls `fillNulls` with `column` set to a numeric column and `fillValue` set to a number (e.g., `0`)
- **THEN** the preview SHALL show null cells that would be filled with the numeric value

#### Scenario: Type-mismatched fill value is rejected

- **WHEN** the user asks to fill blanks in a numeric column with a string value like `"N/A"`
- **THEN** the AI SHALL explain the type mismatch
- **THEN** the AI SHALL suggest providing a numeric value instead
- **THEN** no transform SHALL be created

#### Scenario: AI does not guess fill values

- **WHEN** the user asks to "fill in the missing data" without specifying a fill value
- **THEN** the AI SHALL ask the user what value to use for filling blanks
- **THEN** the AI MUST NOT infer, guess, or default a fill value on its own
- **THEN** no tool call SHALL be made until the user provides an explicit value

---

### Requirement: mapValues tool definition

The system SHALL provide a `mapValues` tool that previews replacing specific values in a text column with new values using exact match only. The tool MUST accept a `column` parameter restricted to text columns and a `mappings` array of objects, each containing `from` (string, exact match) and `to` (string, replacement). Both parameters MUST be required.

#### Scenario: Replace a single value

- **WHEN** the AI calls `mapValues` with `column` set to a text column and `mappings` containing one `{from: "NY", to: "New York"}` entry
- **THEN** the frontend SHALL call the preview endpoint with the map_values operation config
- **THEN** the preview SHALL show the count of cells matching exactly `"NY"` and sample before/after values

#### Scenario: Replace multiple values at once

- **WHEN** the AI calls `mapValues` with `mappings` containing multiple entries
- **THEN** the preview SHALL show per-mapping match counts
- **THEN** a single value-mapping transform SHALL be created when the user confirms (not one per mapping)

#### Scenario: Only exact matches are replaced

- **WHEN** the AI calls `mapValues` with a mapping `{from: "NY", to: "New York"}`
- **THEN** only cells containing exactly `"NY"` SHALL be affected
- **THEN** cells containing `"NYC"`, `"NY State"`, or any other partial match SHALL NOT be changed

#### Scenario: Value mapping restricted to text columns

- **WHEN** the user asks to map values in a numeric or date column
- **THEN** the `enum` constraint on `column` SHALL prevent the AI from targeting non-text columns

---

### Requirement: applyCleaningTransform tool definition

The system SHALL provide an `applyCleaningTransform` tool that creates a cleaning transform after the user has confirmed a preview. The tool MUST accept `transformType` (enum: `["clean", "alias", "map"]`), `column` (target column name), `expressionConfig` (object containing the cleaning operation configuration), and `name` (human-readable label). All four parameters MUST be required. This tool MUST only be called after the user explicitly confirms a previously shown preview.

#### Scenario: Apply transform after user confirmation

- **WHEN** the user says "yes", "go ahead", "apply", or similar after seeing a preview
- **THEN** the AI SHALL call `applyCleaningTransform` with the parameters matching the previewed operation
- **THEN** the frontend SHALL call `POST /api/datasets/{id}/transforms` with the cleaning transform payload
- **THEN** the frontend SHALL invalidate the dataset query in the TanStack Query cache to refresh the table view
- **THEN** the AI SHALL confirm the operation and state how many cells were affected

#### Scenario: Apply transform not called without confirmation

- **WHEN** the user says "no", "cancel", or "never mind" after seeing a preview
- **THEN** the AI SHALL NOT call `applyCleaningTransform`
- **THEN** no transform SHALL be created
- **THEN** the AI SHALL acknowledge the cancellation

#### Scenario: Apply transform not called before preview

- **WHEN** the user requests a cleaning operation
- **THEN** the AI MUST first call the appropriate preview tool (trimWhitespace, standardizeCase, fillNulls, or mapValues)
- **THEN** the AI MUST NOT call `applyCleaningTransform` until the user has seen the preview and explicitly confirmed

---

### Requirement: undoCleaningTransform tool definition

The system SHALL provide an `undoCleaningTransform` tool that disables or deletes a cleaning transform. The tool MUST accept an `action` parameter with `enum` values `["disable", "delete"]` (required) and an optional `transformId` parameter. When `transformId` is omitted, the tool SHALL target the most recently created cleaning transform (by `created_at`).

#### Scenario: Disable the most recent cleaning transform

- **WHEN** the AI calls `undoCleaningTransform` with `action: "disable"` and no `transformId`
- **THEN** the frontend SHALL identify the most recently created active cleaning transform from the `transforms` array in the tool call context
- **THEN** the frontend SHALL call `PATCH /api/datasets/{id}/transforms` with `{ updates: [{ id, status: "disabled" }] }`
- **THEN** the frontend SHALL invalidate the dataset query to refresh the table view
- **THEN** the AI SHALL confirm what was disabled (column and operation)

#### Scenario: Delete a specific cleaning transform

- **WHEN** the AI calls `undoCleaningTransform` with `action: "delete"` and a specific `transformId`
- **THEN** the frontend SHALL call `PATCH /api/datasets/{id}/transforms` with `{ updates: [{ id, status: "deleted" }] }`
- **THEN** the transform SHALL be soft-deleted and MUST NOT be re-enabled afterward

#### Scenario: Permanently deleted transform cannot be re-enabled

- **WHEN** a transform has been deleted via `undoCleaningTransform` with `action: "delete"`
- **THEN** the `reEnableCleaningTransform` tool SHALL NOT be able to re-enable it
- **THEN** the AI SHALL inform the user that deleted transforms cannot be restored

---

### Requirement: reEnableCleaningTransform tool definition

The system SHALL provide a `reEnableCleaningTransform` tool that re-enables a previously disabled cleaning transform. The tool MUST accept an optional `transformId` parameter. When `transformId` is omitted, the tool SHALL target the most recently disabled cleaning transform.

#### Scenario: Re-enable the most recently disabled transform

- **WHEN** the AI calls `reEnableCleaningTransform` with no `transformId`
- **THEN** the frontend SHALL identify the most recently disabled cleaning transform from the `transforms` array
- **THEN** the frontend SHALL call `PATCH /api/datasets/{id}/transforms` with `{ updates: [{ id, status: "enabled" }] }`
- **THEN** the frontend SHALL invalidate the dataset query to refresh the table view
- **THEN** the AI SHALL confirm what was re-enabled (column and operation)

#### Scenario: Re-enable a specific disabled transform

- **WHEN** the AI calls `reEnableCleaningTransform` with a specific `transformId`
- **THEN** the frontend SHALL re-enable exactly that transform via the PATCH endpoint

---

### Requirement: Preview then confirm then apply interaction pattern

All cleaning preview tools (`trimWhitespace`, `standardizeCase`, `fillNulls`, `mapValues`) SHALL follow a three-step interaction pattern: (1) preview, (2) user confirmation, (3) apply. The preview step MUST call `POST /api/datasets/{id}/transforms/preview` and return data for the AI to format. The preview MUST NOT create a transform. The apply step MUST only occur via `applyCleaningTransform` after explicit user confirmation.

#### Scenario: Complete preview-confirm-apply flow

- **WHEN** the user requests a cleaning operation (e.g., "trim the Name column")
- **THEN** the AI SHALL call the appropriate preview tool (e.g., `trimWhitespace`)
- **THEN** the frontend SHALL call the preview endpoint and return the preview data (affected_count, up to 5 before/after samples) as a formatted string to the AI
- **THEN** the AI SHALL present the preview to the user, including affected cell count, sample before/after values, and a prompt asking to confirm or cancel
- **THEN** when the user confirms, the AI SHALL call `applyCleaningTransform` with the matching parameters
- **THEN** the frontend SHALL create the transform, invalidate the dataset query cache, and the AI SHALL confirm the result

#### Scenario: User cancels after preview

- **WHEN** the user says "no" or "cancel" after seeing a preview
- **THEN** the AI SHALL NOT call `applyCleaningTransform`
- **THEN** no transform SHALL be created
- **THEN** the AI SHALL acknowledge the cancellation

---

### Requirement: Immediate application pattern for column aliases

The `renameColumn` tool SHALL apply immediately without a preview step. When called, the frontend SHALL create alias transform(s) directly via `POST /api/datasets/{id}/transforms`. This is distinct from the preview-confirm-apply pattern used by other cleaning tools.

#### Scenario: Column alias applies without preview

- **WHEN** the AI calls `renameColumn`
- **THEN** the frontend SHALL create the alias transform immediately without calling the preview endpoint
- **THEN** the AI SHALL confirm the rename without asking for user confirmation first

#### Scenario: Column alias reflected in subsequent interactions

- **WHEN** a column alias has been created
- **THEN** the system prompt SHALL show the alias as the column's display name with the actual column name in parentheses
- **THEN** the AI SHALL use the alias name (not the raw column name) when referring to the column in subsequent messages

---

### Requirement: Undo and re-enable pattern

The system SHALL support disabling, deleting, and re-enabling cleaning transforms through the `undoCleaningTransform` and `reEnableCleaningTransform` tools. When no `transformId` is provided, both tools SHALL default to the most recent applicable cleaning transform. Disabled transforms SHALL be re-enableable. Deleted transforms SHALL NOT be re-enableable.

#### Scenario: Undo targets most recent cleaning transform by default

- **WHEN** the user says "undo" or "revert that" without specifying a transform
- **THEN** the AI SHALL call `undoCleaningTransform` with `action: "disable"` and no `transformId`
- **THEN** the frontend SHALL identify and disable the most recently created active cleaning transform

#### Scenario: Re-enable targets most recently disabled transform by default

- **WHEN** the user says "turn that back on" without specifying a transform
- **THEN** the AI SHALL call `reEnableCleaningTransform` with no `transformId`
- **THEN** the frontend SHALL identify and re-enable the most recently disabled cleaning transform

#### Scenario: Disable is reversible but delete is permanent

- **WHEN** a transform is disabled via `undoCleaningTransform` with `action: "disable"`
- **THEN** the transform SHALL be re-enableable via `reEnableCleaningTransform`
- **WHEN** a transform is deleted via `undoCleaningTransform` with `action: "delete"`
- **THEN** the transform SHALL be permanently removed and MUST NOT be re-enableable

---

### Requirement: System prompt active cleaning transforms section

The `getSystemPrompt` function SHALL include an `ACTIVE CLEANING TRANSFORMS` section after the existing `ACTIVE FILTERS` section. This section SHALL list all active cleaning transforms with their target column and operation. When column aliases exist, the column descriptions in the schema SHALL display both the alias and the actual column name.

#### Scenario: Active cleaning transforms displayed in system prompt

- **WHEN** the dataset has active cleaning transforms
- **THEN** the system prompt SHALL include an `ACTIVE CLEANING TRANSFORMS` section listing each transform's column and operation (e.g., "Name column: trimmed whitespace", "City column: title case")
- **THEN** for alias transforms, the listing SHALL show the alias mapping (e.g., "emp_id aliased as 'Employee ID'")
- **THEN** for fill_null transforms, the listing SHALL include the fill value (e.g., "Department column: nulls filled with 'Unknown'")
- **THEN** for map_values transforms, the listing SHALL summarize the mappings (e.g., "State column: value mapping (NY->New York, CA->California)")

#### Scenario: No active cleaning transforms

- **WHEN** the dataset has no active cleaning transforms
- **THEN** the system prompt SHALL display "No active cleaning transforms."

#### Scenario: Column aliases reflected in schema section

- **WHEN** one or more columns have active alias transforms
- **THEN** the `CURRENT TABLE SCHEMA` section SHALL display the alias as the primary name with the actual column name noted (e.g., `"Employee ID" (string, actual column: emp_id)`)

---

### Requirement: System prompt cleaning instructions

The system prompt `INSTRUCTIONS` section SHALL include instructions 7 through 10 covering cleaning tool usage, column renaming, undo/re-enable, and important rules. These instructions SHALL guide the AI to use the correct tool for each operation and follow the preview-confirm pattern.

#### Scenario: Cleaning operation instructions present

- **WHEN** the system prompt is generated
- **THEN** instruction 7 SHALL describe the four preview-based cleaning tools (trimWhitespace, standardizeCase, fillNulls, mapValues), state that a preview MUST be shown first (except for renameColumn), and instruct the AI to wait for user confirmation before calling applyCleaningTransform
- **THEN** instruction 8 SHALL describe the renameColumn tool, state that it applies immediately without preview, and instruct the AI to use the new name after renaming
- **THEN** instruction 9 SHALL describe undoCleaningTransform and reEnableCleaningTransform
- **THEN** instruction 10 SHALL state the important rules: text-only restriction for trim/case/mapValues, type matching for fill values, never guess fill values, clarify ambiguous column references, and use column aliases in responses

---

### Requirement: AI behavior rules for cleaning operations

The AI MUST follow specific behavioral rules when handling cleaning operations. These rules SHALL be enforced through the system prompt instructions and tool definitions.

#### Scenario: AI must not guess fill values

- **WHEN** the user asks to fill missing data without specifying a value
- **THEN** the AI MUST ask the user what value to use
- **THEN** the AI MUST NOT infer, assume, or default a fill value (such as 0, "Unknown", or the column mean)

#### Scenario: AI must use column aliases in responses

- **WHEN** a column has an active alias
- **THEN** the AI SHALL refer to the column by its alias name in all subsequent messages
- **THEN** the AI SHALL NOT use the raw column name unless disambiguating for the user

#### Scenario: AI must clarify ambiguous column references

- **WHEN** the user references a column ambiguously (e.g., "the names") and multiple candidate columns exist (e.g., "first_name", "last_name", "company_name")
- **THEN** the AI SHALL ask the user which column they mean
- **THEN** the AI SHALL list the candidate columns
- **THEN** the AI SHALL NOT proceed with a cleaning tool call until the user specifies a column

#### Scenario: AI enforces text-only restriction

- **WHEN** the user asks to trim whitespace, standardize case, or map values on a non-text column
- **THEN** the AI SHALL explain that the operation applies only to text columns
- **THEN** the AI SHALL NOT call the tool

#### Scenario: AI enforces fill value type matching

- **WHEN** the user provides a fill value that does not match the target column's type
- **THEN** the AI SHALL explain the type mismatch and suggest a compatible value
- **THEN** the AI SHALL NOT call `fillNulls` with a mismatched type

---

### Requirement: TableSchema type extension

The `TableSchema` interface in `shared/chat/types.ts` SHALL be extended with two new fields: an optional `alias` field on each column entry and an optional `activeCleaningTransforms` array on the schema root.

#### Scenario: Column alias field in TableSchema

- **WHEN** the `TableSchema` is constructed for a dataset with column aliases
- **THEN** each column entry MAY include an `alias?: string` field containing the display name
- **THEN** columns without aliases SHALL omit the `alias` field or set it to `undefined`

#### Scenario: Active cleaning transforms array in TableSchema

- **WHEN** the `TableSchema` is constructed for a dataset with active cleaning transforms
- **THEN** the schema SHALL include an `activeCleaningTransforms` array where each entry contains `id` (string), `column` (string), `operation` (string), and optionally `details` (string)
- **THEN** when no active cleaning transforms exist, the field SHALL be omitted or set to an empty array

#### Scenario: TableSchema backward compatibility

- **WHEN** the extended `TableSchema` is used with code that does not reference the new fields
- **THEN** the existing fields (`columns`, `rowCount`, `activeFilters`) SHALL remain unchanged
- **THEN** the new fields SHALL be optional and SHALL NOT break existing consumers

---

### Requirement: Frontend ToolCallContext interface

The `executeToolCall` function SHALL accept a `ToolCallContext` interface that wraps the existing handler parameters alongside new fields required for cleaning tool execution. The context MUST include `datasetId` (string), `transforms` (array of transform responses), and `queryClient` (TanStack Query QueryClient instance) in addition to the existing `setColumnFilters`, `setSorting`, and `setData` handlers.

#### Scenario: ToolCallContext provides dataset ID

- **WHEN** a cleaning tool handler executes
- **THEN** it SHALL use `context.datasetId` to construct API endpoint URLs for preview and transform creation

#### Scenario: ToolCallContext provides transforms for undo resolution

- **WHEN** the `undoCleaningTransform` or `reEnableCleaningTransform` handler executes without a `transformId`
- **THEN** it SHALL use `context.transforms` to identify the most recent applicable cleaning transform

#### Scenario: ToolCallContext provides queryClient for cache invalidation

- **WHEN** the `applyCleaningTransform`, `undoCleaningTransform`, or `reEnableCleaningTransform` handler executes
- **THEN** it SHALL use `context.queryClient` to invalidate the dataset query cache, triggering a table view refresh

#### Scenario: Existing tool handlers continue to work

- **WHEN** an existing tool (sortTable, filterTable, etc.) is executed via the updated `executeToolCall`
- **THEN** the existing handlers SHALL continue to function using the same `setColumnFilters`, `setSorting`, and `setData` methods from the context
- **THEN** no behavioral change SHALL occur for existing tools

---

### Requirement: Frontend preview tool execution handlers

The frontend SHALL implement execution handlers for the four preview tools (`trimWhitespace`, `standardizeCase`, `fillNulls`, `mapValues`) that call the preview API and return formatted results for the AI to present.

#### Scenario: Preview handler calls backend preview endpoint

- **WHEN** a preview tool is executed (trimWhitespace, standardizeCase, fillNulls, or mapValues)
- **THEN** the handler SHALL call `POST /api/datasets/{datasetId}/transforms/preview` with the appropriate operation config
- **THEN** the handler SHALL return a formatted string containing the `affected_count` and up to 5 before/after sample values

#### Scenario: Preview handler does not create a transform

- **WHEN** a preview tool handler executes
- **THEN** it SHALL NOT call the transform creation endpoint
- **THEN** it SHALL NOT modify the dataset query cache
- **THEN** the returned string SHALL be used as the tool call result for the AI to format its response

---

### Requirement: Frontend apply and undo tool execution handlers

The frontend SHALL implement execution handlers for `applyCleaningTransform`, `undoCleaningTransform`, and `reEnableCleaningTransform` that create or update transforms via backend API calls and invalidate the dataset query cache.

#### Scenario: Apply handler creates transform and invalidates cache

- **WHEN** the `applyCleaningTransform` handler executes
- **THEN** it SHALL call `POST /api/datasets/{datasetId}/transforms` with the cleaning transform payload (transformType, column, expressionConfig, name)
- **THEN** it SHALL invalidate the dataset query in the TanStack Query cache using `context.queryClient`
- **THEN** it SHALL return a confirmation string for the AI

#### Scenario: Undo handler updates transform status via PATCH

- **WHEN** the `undoCleaningTransform` handler executes
- **THEN** it SHALL call `PATCH /api/datasets/{datasetId}/transforms` with `{ updates: [{ id, status }] }` where status is `"disabled"` or `"deleted"` based on the `action` parameter
- **THEN** it SHALL invalidate the dataset query cache

#### Scenario: Re-enable handler updates transform status via PATCH

- **WHEN** the `reEnableCleaningTransform` handler executes
- **THEN** it SHALL call `PATCH /api/datasets/{datasetId}/transforms` with `{ updates: [{ id, status: "enabled" }] }`
- **THEN** it SHALL invalidate the dataset query cache

---

### Requirement: Column type restrictions on tool definitions

The `getToolDefinitions` function SHALL enforce column type restrictions by constructing separate `enum` arrays for text-only tools versus all-column tools. Tools restricted to text columns (`trimWhitespace`, `standardizeCase`, `mapValues`) SHALL use an `enum` derived from columns where `type === "string"`. Tools available to all columns (`fillNulls`, `renameColumn`) SHALL use an `enum` derived from all columns.

#### Scenario: Text-only tools exclude non-string columns

- **WHEN** `getToolDefinitions` is called with a `TableSchema` containing columns of mixed types
- **THEN** the `column` parameter `enum` for `trimWhitespace`, `standardizeCase`, and `mapValues` SHALL include only columns where `type === "string"`
- **THEN** numeric, boolean, and date columns SHALL be excluded from these enums

#### Scenario: All-column tools include every column

- **WHEN** `getToolDefinitions` is called with a `TableSchema`
- **THEN** the `column` parameter `enum` for `fillNulls` SHALL include all columns regardless of type
- **THEN** the `column` parameter `enum` for `renameColumn` SHALL include all columns regardless of type

#### Scenario: Tool descriptions reference available columns

- **WHEN** `getToolDefinitions` generates the tool definitions
- **THEN** the `description` field of text-only tools SHALL include `${textColumnDescriptions}` showing only text column names and types
- **THEN** the `description` field of all-column tools SHALL include `${columnDescriptions}` showing all column names and types
