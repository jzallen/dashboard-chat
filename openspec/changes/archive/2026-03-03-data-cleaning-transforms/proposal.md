## Why

Users working with real-world datasets frequently encounter data quality issues — inconsistent casing, leading/trailing whitespace, null values, and unstandardized categorical data. Currently the chat interface only supports filter and sort operations (WHERE/ORDER BY). Users must leave the app to clean data externally, breaking their workflow. Adding chat-driven data cleaning lets users fix these issues through natural language without leaving the table view, directly extending the existing transform system.

## What Changes

- **Extend the Transform model** with four new columns (`transform_type`, `target_column`, `expression_sql`, `expression_config`) to support cleaning, alias, and value-mapping transforms alongside existing filter transforms
- **Add five cleaning operations**: whitespace trimming, case standardization (title/upper/lower), null filling, value mapping (exact match replacement), and column aliasing (display name rename)
- **Add a preview endpoint** (`POST /transforms/preview`) that analyzes actual data via DuckDB to return affected-cell counts and before/after samples — enabling a preview → confirm → apply interaction pattern
- **Extend SQL generation** in `Dataset._build_table()` to apply cleaning transforms as SELECT expressions (Ibis `.mutate()`) and aliases as column renames, composing with existing WHERE filters
- **Add 8 new chat tools** to the shared chat module: `trimWhitespace`, `standardizeCase`, `renameColumn`, `fillNulls`, `mapValues`, `applyCleaningTransform`, `undoCleaningTransform`, `reEnableCleaningTransform`
- **Extend the system prompt** with active cleaning transform awareness and column alias context so the AI uses display names and knows what cleaning has been applied
- **Extend frontend tool execution** to handle preview tools (call preview API, return data for AI to format), immediate tools (column rename), apply tools (create transform after confirmation), and undo/re-enable tools

## Capabilities

### New Capabilities
- `cleaning-transforms`: Data model, API schemas, validation rules, and CRUD lifecycle for cleaning/alias/map transform types (extends the existing filter transform system)
- `transform-preview`: Backend endpoint that evaluates a proposed cleaning operation against actual dataset data and returns impact statistics without persisting anything
- `cleaning-sql-generation`: Ibis expression builder that converts `expression_config` JSON into column-level SELECT expressions, and the `_build_table()` pipeline extension (mutate → filter → rename)
- `cleaning-chat-tools`: Eight new tool definitions, system prompt updates, and frontend tool execution handlers for driving cleaning operations through the chat interface

### Modified Capabilities
<!-- openspec/specs/ is currently empty — no existing specs to modify -->

## Impact

- **Backend model layer**: New Alembic migration, extended Transform dataclass + ORM record, extended Pydantic schemas with cross-field validation by transform_type
- **Backend query layer**: `Dataset._build_table()` pipeline change (additive — existing filter path unchanged), new DuckDB preview queries in lake repository
- **Backend API surface**: One new endpoint (`POST /transforms/preview`), one extended endpoint (`POST /transforms` accepts cleaning payloads)
- **Shared chat module**: Extended `TableSchema` type, 8 new tool definitions in `prompts.ts`, updated system prompt sections
- **Frontend execution layer**: New handlers in `executeToolCall.ts`, new `previewCleaningTransform()` API function, expanded tool call context interface
- **Frontend display layer**: Column alias rendering in table headers and schema view, active cleaning transforms passed to chat context
- **Database**: Migration adds 4 nullable columns to `transforms` table — fully backward-compatible, no data migration
