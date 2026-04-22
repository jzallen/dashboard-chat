## Purpose

Describes how the worker selects the right chat tool set based on `contextType` (`view`, `dataset`, or null) before making the LLM call. It formalises the tool-set fork so the LLM never sees tools that don't apply to the active context, and avoids an extra routing turn.

## Requirements

### Requirement: Worker forks tool set based on contextType before LLM invocation

The worker POST /chat handler SHALL read `contextType` from the request body and select the appropriate tool set before making any LLM API call.

#### Scenario: View context receives view-only tool set

- **WHEN** POST /chat is received with `contextType: "view"`
- **THEN** the worker SHALL provide only the 12 view mutation tools to the LLM
- **AND** dataset mutation tools (row add/delete, cell edit, column transforms) SHALL NOT be included in the LLM prompt
- **AND** no additional LLM turn SHALL be used for routing

#### Scenario: Dataset context receives dataset-only tool set

- **WHEN** POST /chat is received with `contextType: "dataset"`
- **THEN** the worker SHALL provide only the existing dataset mutation tools to the LLM
- **AND** view mutation tools SHALL NOT be included in the LLM prompt

#### Scenario: Null context receives conversational tools only

- **WHEN** POST /chat is received with `contextType: null` or `contextType` absent
- **THEN** the worker SHALL provide conversational-response tools only (no table or view mutation tools)
- **AND** the current hard-fail on missing `tableSchema` SHALL be relaxed — null context is valid

---

### Requirement: 12 view mutation tool definitions

The worker SHALL define exactly 12 view mutation tools available when `contextType === "view"`.

#### Scenario: createView tool accepted by LLM

- **WHEN** the user asks to create a view
- **THEN** the LLM SHALL invoke `createView` with parameters: `name` (string), `sourceRefs` (array of dataset/view IDs or names), `description?` (optional string)
- **AND** the tool call SHALL NOT include the new view ID (it is assigned by the backend)

#### Scenario: addColumn tool accepted by LLM

- **WHEN** the user asks to add a column
- **THEN** the LLM SHALL invoke `addColumn` with: `sourceRef` (dataset/view name), `sourceColumn` (column name in source), `displayType` (one of 10 types), `alias?` (optional output name)

#### Scenario: removeColumn tool accepted by LLM

- **WHEN** the user asks to remove a column
- **THEN** the LLM SHALL invoke `removeColumn` with: `columnName` (the output column name / alias)

#### Scenario: addJoin tool accepted by LLM

- **WHEN** the user asks to join another source
- **THEN** the LLM SHALL invoke `addJoin` with: `rightRef` (dataset/view name), `leftColumn`, `rightColumn`, `joinType?` (default `INNER`)

#### Scenario: removeJoin tool accepted by LLM

- **WHEN** the user asks to remove a join
- **THEN** the LLM SHALL invoke `removeJoin` with: `rightRef` (the joined source name to remove)

#### Scenario: addFilter tool accepted by LLM

- **WHEN** the user asks to filter the view
- **THEN** the LLM SHALL invoke `addFilter` with: `sourceRef`, `column`, `operator`, `value?`

#### Scenario: removeFilter tool accepted by LLM

- **WHEN** the user asks to remove a filter
- **THEN** the LLM SHALL invoke `removeFilter` with: `column` (the column whose filter to remove)

#### Scenario: renameView tool accepted by LLM

- **WHEN** the user asks to rename the view
- **THEN** the LLM SHALL invoke `renameView` with: `newName` (string)

#### Scenario: deleteView tool accepted by LLM

- **WHEN** the user confirms deletion
- **THEN** the LLM SHALL invoke `deleteView` with: `viewId` (string) — the current context view ID

#### Scenario: setMaterialization tool accepted by LLM

- **WHEN** the user asks to set the materialization strategy
- **THEN** the LLM SHALL invoke `setMaterialization` with: `strategy` (one of: `view`, `table`, `ephemeral`, `incremental`)

#### Scenario: castColumn tool accepted by LLM

- **WHEN** the user asks to cast a column to a type
- **THEN** the LLM SHALL invoke `castColumn` with: `columnName` (output column name), `displayType` (target display type)

#### Scenario: setGrain tool accepted by LLM

- **WHEN** the user asks to define grain
- **THEN** the LLM SHALL invoke `setGrain` with: `timeColumn` (column name), `dimensions` (array of column names)

---

### Requirement: View context guardrail prompts

When `contextType === "view"`, the worker system prompt SHALL include guardrail instructions that explain view-only semantics to the LLM.

#### Scenario: LLM explains dataset-only operations are redirected

- **WHEN** in view context and the user asks to add a row, delete rows, or edit cell values
- **THEN** the LLM SHALL respond: "This is a View — its data is derived from SQL. To add data, switch to the source dataset."
- **AND** the LLM SHALL offer to switch context to the relevant source dataset

#### Scenario: LLM explains cleaning transforms apply to source datasets

- **WHEN** in view context and the user asks to trim whitespace or normalize values on a column
- **THEN** the LLM SHALL explain that cleaning transforms apply to source datasets
- **AND** SHALL identify the source dataset for the column and offer to switch context

#### Scenario: LLM requires a time column before setting grain

- **WHEN** no columns are typed as date, time, or datetime
- **AND** the user asks to set grain
- **THEN** the LLM SHALL explain that grain requires a time column
- **AND** SHALL suggest casting an appropriate column first

#### Scenario: LLM warns about metric columns as grain dimensions

- **WHEN** the user asks to use a decimal or integer column as a grain dimension
- **THEN** the LLM SHALL explain that metric columns cannot be grain dimensions
- **AND** SHALL suggest that metrics are aggregated by the grain, not part of it

#### Scenario: LLM suggests cast for numeric identifiers before dimension use

- **WHEN** a column has `display_type` of `integer` and the user wants it as a grain dimension
- **THEN** the LLM SHALL ask: "This column is numeric — want me to cast it to category or id first?"
- **AND** SHALL wait for user confirmation before proceeding

#### Scenario: LLM rejects incompatible type casts

- **WHEN** the user asks to cast a free-text column as decimal or integer
- **THEN** the LLM SHALL explain that the values may not be compatible with that type
- **AND** SHALL suggest alternative types

#### Scenario: LLM warns about circular dependency

- **WHEN** the user asks to create a view that would reference a source that already depends on the current view
- **THEN** the LLM SHALL explain that this would create a circular dependency
- **AND** the operation SHALL be rejected without invoking the tool
