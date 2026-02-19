# Capability: cleaning-chat-tools (delta)

Changes to the chat tool definitions, system prompt, and frontend/worker tool call mapping to support snake_case and kebab-case modes in the case standardization workflow.

---

## MODIFIED Requirements

### Requirement: standardizeCase tool definition

The system SHALL provide a `standardizeCase` tool that previews case standardization on a text column. The tool MUST accept a `column` parameter restricted to text columns (same `enum` restriction as `trimWhitespace`) and a `mode` parameter with `enum` values `["title", "upper", "lower", "snake", "kebab"]`. Both parameters MUST be required. The tool description SHALL explain all five modes, including that snake converts to `snake_case` format and kebab converts to `kebab-case` format.

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

#### Scenario: Standardize text to snake case

- **WHEN** the AI calls `standardizeCase` with `column` set to a text column and `mode` set to `"snake"`
- **THEN** the frontend SHALL call `POST /api/datasets/{id}/transforms/preview` with `{"operation": "case", "mode": "snake"}`
- **THEN** the tool SHALL return a preview with affected count and before/after samples showing snake_cased values

#### Scenario: Standardize text to kebab case

- **WHEN** the AI calls `standardizeCase` with `column` set to a text column and `mode` set to `"kebab"`
- **THEN** the frontend SHALL call `POST /api/datasets/{id}/transforms/preview` with `{"operation": "case", "mode": "kebab"}`
- **THEN** the tool SHALL return a preview with affected count and before/after samples showing kebab-cased values

#### Scenario: Case standardization rejected for non-text column

- **WHEN** the user asks to standardize casing on a numeric or date column
- **THEN** the AI SHALL explain that case operations apply only to text columns
- **THEN** no transform SHALL be created

#### Scenario: Ambiguous casing request triggers clarification

- **WHEN** the user asks to "fix the casing" without specifying a mode
- **THEN** the AI SHALL ask which case format the user wants
- **AND** the AI SHALL list title case, UPPER CASE, lower case, snake_case, and kebab-case as options
- **THEN** the AI SHALL NOT call `standardizeCase` until the user specifies a mode

#### Scenario: User requests snake case using alternate terminology

- **WHEN** the user asks to convert a column to "underscore case"
- **THEN** the AI SHALL treat it as a snake case request and call `standardizeCase` with `mode: "snake"`

#### Scenario: User requests kebab case using alternate terminology

- **WHEN** the user asks to convert a column to "hyphen case"
- **THEN** the AI SHALL treat it as a kebab case request and call `standardizeCase` with `mode: "kebab"`

---

### Requirement: applyCleaningTransform tool definition

The system SHALL provide an `applyCleaningTransform` tool that creates a cleaning transform after the user has confirmed a preview. The tool MUST accept `transformType` (enum: `["clean", "alias", "map"]`), `column` (target column name), `operation` (enum: `["trim", "upper", "lower", "title", "snake", "kebab", "fill_null", "map_values"]`), `expressionConfig` (object containing the cleaning operation configuration), and `name` (human-readable label). All parameters MUST be required. This tool MUST only be called after the user explicitly confirms a previously shown preview.

#### Scenario: Apply snake case transform after confirmation

- **WHEN** the user confirms a snake case preview
- **THEN** the AI SHALL call `applyCleaningTransform` with `operation: "snake"` and `expressionConfig: {"operation": "case", "mode": "snake"}`
- **THEN** the frontend SHALL call `POST /api/datasets/{id}/transforms` with the cleaning transform payload
- **THEN** the transform's `expression_sql` SHALL be `"snake_case(column)"`

#### Scenario: Apply kebab case transform after confirmation

- **WHEN** the user confirms a kebab case preview
- **THEN** the AI SHALL call `applyCleaningTransform` with `operation: "kebab"` and `expressionConfig: {"operation": "case", "mode": "kebab"}`
- **THEN** the transform's `expression_sql` SHALL be `"kebab_case(column)"`

#### Scenario: Apply title case transform after confirmation

- **WHEN** the user confirms a title case preview
- **THEN** the AI SHALL call `applyCleaningTransform` with `operation: "title"` and `expressionConfig: {"operation": "case", "mode": "title"}`
- **THEN** the transform's `expression_sql` SHALL be `"title_case(column)"` (not `"INITCAP(column)"`)

#### Scenario: Apply transform not called without confirmation

- **WHEN** the user says "no" or "cancel" after seeing a preview
- **THEN** the AI SHALL NOT call `applyCleaningTransform`
- **THEN** no transform SHALL be created
- **THEN** the AI SHALL acknowledge the cancellation

---

### Requirement: System prompt cleaning instructions include new modes

The system prompt `INSTRUCTIONS` section SHALL describe all five case modes when explaining the `standardizeCase` tool. The mode descriptions SHALL include: upper (all uppercase), lower (all lowercase), title (capitalize first letter of each word), snake (convert to snake_case), and kebab (convert to kebab-case).

#### Scenario: System prompt lists all five case modes

- **WHEN** the system prompt is generated
- **THEN** the instructions describing the `standardizeCase` tool SHALL reference all five modes: upper, lower, title, snake, and kebab
- **AND** the snake mode description SHALL mention "underscore case" as an alternate name users may use
- **AND** the kebab mode description SHALL mention "hyphen case" as an alternate name users may use

---

### Requirement: Frontend isCase mapping includes snake and kebab

The frontend `executeToolCall.ts` SHALL recognize `"snake"` and `"kebab"` as case operations when mapping tool call arguments to `expression_config` format. The `isCase` check SHALL include `["upper", "lower", "title", "snake", "kebab"]`. When a case operation is detected, the tool call handler SHALL map it to `{ operation: "case", mode: "<operation>" }`.

#### Scenario: Frontend maps snake to case expression config

- **WHEN** the frontend receives a tool call with `operation: "snake"` for the `applyCleaningTransform` tool
- **THEN** it SHALL construct `expressionConfig = { operation: "case", mode: "snake" }` for the transform creation API call

#### Scenario: Frontend maps kebab to case expression config

- **WHEN** the frontend receives a tool call with `operation: "kebab"` for the `applyCleaningTransform` tool
- **THEN** it SHALL construct `expressionConfig = { operation: "case", mode: "kebab" }` for the transform creation API call

#### Scenario: Existing case operations continue to work

- **WHEN** the frontend receives a tool call with `operation: "upper"`, `"lower"`, or `"title"`
- **THEN** the existing mapping to `{ operation: "case", mode: "<operation>" }` SHALL continue to function without change

---

### Requirement: Worker isCase mapping includes snake and kebab

The worker `executeToolCall.ts` (or equivalent tool call mapping) SHALL recognize `"snake"` and `"kebab"` as case operations. The `isCase` check SHALL include `["upper", "lower", "title", "snake", "kebab"]`. When a case operation is detected, the worker SHALL map it to `{ operation: "case", mode: "<operation>" }`.

#### Scenario: Worker maps snake to case expression config

- **WHEN** the worker receives a tool call with `operation: "snake"`
- **THEN** it SHALL construct `expressionConfig = { operation: "case", mode: "snake" }`

#### Scenario: Worker maps kebab to case expression config

- **WHEN** the worker receives a tool call with `operation: "kebab"`
- **THEN** it SHALL construct `expressionConfig = { operation: "case", mode: "kebab" }`

#### Scenario: Existing worker case operations continue to work

- **WHEN** the worker receives a tool call with `operation: "upper"`, `"lower"`, or `"title"`
- **THEN** the existing mapping SHALL continue to function without change

---

### Requirement: Snake case on numeric column is rejected

Case standardization tools (including snake and kebab) SHALL be restricted to text columns only. The `standardizeCase` tool's `column` parameter `enum` SHALL exclude non-string columns. If a user asks to apply snake or kebab case to a numeric column, the AI SHALL explain that case operations apply only to text columns.

#### Scenario: Snake case rejected for numeric column

- **WHEN** the user asks to convert a numeric column to snake case
- **THEN** the AI SHALL explain that case operations apply only to text columns
- **AND** no transform SHALL be created

#### Scenario: Kebab case rejected for numeric column

- **WHEN** the user asks to convert a numeric column to kebab case
- **THEN** the AI SHALL explain that case operations apply only to text columns
- **AND** no transform SHALL be created
