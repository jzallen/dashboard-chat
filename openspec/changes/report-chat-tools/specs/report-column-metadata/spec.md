## MODIFIED Requirements

### Requirement: AI Semantic Role Suggestions

The AI chat system SHALL suggest semantic roles for Report columns based on column names and types.

- Columns ending in `_id` SHALL be suggested as `entity` role.
- Columns ending in `_at`, `_date`, or `_timestamp` SHALL be suggested as `dimension` with `semantic_type: "time"`.
- Numeric columns not ending in `_id` SHALL be suggested as `measure` candidates.
- String/categorical columns SHALL be suggested as `dimension` with `semantic_type: "categorical"`.
- Suggestions SHALL be presented to the user for confirmation, not auto-applied.
- The `suggestStructure` chat tool SHALL trigger suggestion generation by analyzing `tableSchema.layerContext.sourceSchemas`.
- Suggestion heuristics SHALL execute in the agent's system prompt context, not via a backend endpoint.

#### Scenario: AI suggests entity role for ID column

- **WHEN** the AI analyzes a Report column named `customer_id`
- **THEN** the AI SHALL suggest `semantic_role: "entity"`, `semantic_type: "foreign"`

#### Scenario: AI suggests time dimension for date column

- **WHEN** the AI analyzes a Report column named `created_at`
- **THEN** the AI SHALL suggest `semantic_role: "dimension"`, `semantic_type: "time"`, `time_granularity: "day"`

#### Scenario: suggestStructure tool triggers heuristic analysis

- **WHEN** the user asks the agent to suggest a report structure
- **THEN** the agent SHALL invoke the `suggestStructure` tool
- **THEN** the agent SHALL analyze all columns from `sourceSchemas` and present categorized suggestions
- **THEN** the user SHALL confirm, modify, or reject each suggestion before it is applied via `addDimension` / `addMeasure` tool calls
