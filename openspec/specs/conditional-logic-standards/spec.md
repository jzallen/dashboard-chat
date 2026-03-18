# conditional-logic-standards Specification

## Purpose
TBD - created by archiving change frontend-readability. Update Purpose after archive.
## Requirements
### Requirement: Named predicates for complex boolean expressions
Frontend code SHALL extract multi-condition boolean expressions (3+ conditions or any expression using nullish coalescing within a boolean context) into named `const` variables or predicate functions that describe the intent.

#### Scenario: Filter transform guard clause
- **WHEN** a guard clause checks `transform.status === "enabled" && (transform.transform_type ?? "filter") === "filter" && transform.condition_json`
- **THEN** the expression SHALL be extracted to a named constant (e.g., `const isApplicableFilter = ...`) before use in the conditional

#### Scenario: Sync button disabled state
- **WHEN** a button's disabled prop evaluates `syncState !== "idle"`
- **THEN** simple single-condition expressions MAY remain inline (extraction is only required for 3+ conditions)

### Requirement: className construction via clsx
Frontend code SHALL use `clsx` (or an equivalent utility) instead of template-literal ternary chains when a className depends on 2+ conditional classes.

#### Scenario: Sync button with state-dependent classes
- **WHEN** a className concatenates multiple ternary expressions to toggle state classes (e.g., spinning, success, cooldown)
- **THEN** the className SHALL use `clsx` with a conditional-object pattern: `clsx(styles.base, { [styles.variant]: condition })`

#### Scenario: Single conditional class
- **WHEN** a className has at most one conditional class alongside a base class
- **THEN** inline ternary or `&&` is acceptable; `clsx` is not required

### Requirement: Flat control flow with early returns
Functions with 3+ levels of nesting SHALL be refactored to use early returns, extracted helper functions, or both, such that no code path exceeds 2 levels of indentation relative to the function body.

#### Scenario: Token refresh pre-check in ChatContext
- **WHEN** the SSE send function checks token expiry with nested if/if/try/if logic
- **THEN** the token refresh logic SHALL be extracted into a named async helper that returns updated auth headers, reducing the caller to a flat sequence

#### Scenario: 401 retry flow in ChatContext
- **WHEN** the SSE send function handles 401 responses with nested try/if/if logic
- **THEN** the retry logic SHALL be extracted into a named async helper, leaving the caller with at most one level of conditional nesting

### Requirement: Consolidated JSX conditional guards
Adjacent JSX elements that share the same rendering condition SHALL be grouped under a single conditional wrapper instead of repeating the guard.

#### Scenario: DatasetView table-mode toolbar buttons
- **WHEN** multiple adjacent buttons each check `viewMode === "table" &&`
- **THEN** the buttons SHALL be wrapped in a single `{viewMode === "table" && (<> ... </>)}` fragment

#### Scenario: Independent conditions on adjacent elements
- **WHEN** adjacent JSX elements have different conditions (e.g., one checks `hasSelection`, another checks `isEditable`)
- **THEN** each element retains its own guard — consolidation only applies to identical conditions

### Requirement: Declarative validation for tool call arguments
The `validateToolCallArgs` function SHALL use a declarative validator map instead of a switch statement with repetitive inline checks.

#### Scenario: Existing tool validation
- **WHEN** `validateToolCallArgs` is called with a known tool name and argument record
- **THEN** the validator map entry for that tool SHALL perform the same type checks and return the same typed `ToolCallArgs` as the current switch case

#### Scenario: Unknown tool name
- **WHEN** `validateToolCallArgs` is called with an unrecognized tool name
- **THEN** the function SHALL throw an error with the message format `Unknown tool: <name>`

#### Scenario: Adding a new tool
- **WHEN** a developer adds support for a new tool call
- **THEN** they add a single entry to the validator map rather than a new switch case

