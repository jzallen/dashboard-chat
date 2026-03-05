# Capability: Type-Safe Tool Call Boundary

**Status**: MODIFIED
**Domain**: frontend (table-tools, types, customFilterFn)

## Overview

Replace `Record<string, unknown>` with discriminated unions at the LLM→table boundary. Add runtime validation where tool call arguments enter the system. Extend filter value types to include compound filters natively.

---

## MODIFIED Requirements

### Requirement: Discriminated Union for Tool Call Arguments

Tool call arguments SHALL be typed as a discriminated union rather than `Record<string, unknown>`.

- The `executeToolCall` function SHALL accept arguments typed by tool name.
- Each tool case SHALL destructure from a properly typed variant, not cast from `Record<string, unknown>`.
- A runtime validation function SHALL verify required fields before execution and throw a descriptive error if fields are missing.

#### Scenario: LLM omits required field

- **WHEN** the LLM returns a `filterTable` tool call without a `column` field
- **THEN** the runtime validator SHALL throw an error with message indicating the missing field
- **THEN** the tool call SHALL NOT create a filter with `id: undefined`

#### Scenario: Valid tool call arguments pass through

- **WHEN** the LLM returns a `sortTable` tool call with `column: "price"` and `direction: "asc"`
- **THEN** the arguments SHALL be narrowed to the sort variant without any `as` cast

---

### Requirement: Discriminated Union for Filter Values

`TanStackFilterValue` SHALL be a discriminated union that includes both single-condition and compound-condition forms.

- A single condition SHALL have shape `{ operator: TanStackOperator; value: unknown; transformId?: string }`.
- A compound condition SHALL have shape `{ conditions: Array<{ operator: string; value: unknown; transformId?: string }> }`.
- The `as unknown as TanStackFilterValue` double assertion in `raqbToTanstack.ts` SHALL be removed.
- The `customFilterFn` SHALL use a type guard to distinguish single vs compound filters.

#### Scenario: Compound filter created from multi-condition RAQB rule

- **WHEN** a `between` operator is converted from RAQB to TanStack format
- **THEN** the result SHALL be typed as the compound variant of `TanStackFilterValue`
- **THEN** no `as unknown` assertion SHALL be required

#### Scenario: Filter evaluation handles both forms

- **WHEN** `customFilterFn` receives a compound filter value
- **THEN** it SHALL evaluate all conditions using AND logic
- **WHEN** `customFilterFn` receives a single filter value
- **THEN** it SHALL evaluate the single condition

---

### Requirement: Exhaustive Operator Handling in customFilterFn

The `default` case in `customFilterFn` operator switch SHALL NOT return `true` (match all rows).

- Unknown operators SHALL return `false` (reject the row) and log a warning.
- TypeScript exhaustiveness checking SHOULD surface unhandled operators at compile time where possible.

#### Scenario: Unknown operator rejects row

- **WHEN** a filter has an operator not in the known set
- **THEN** `customFilterFn` SHALL return `false` for that condition
- **THEN** a console warning SHALL be logged with the unknown operator name

---

### Requirement: Typed Expression Config

The `expression_config` field on transforms SHALL use a discriminated union instead of `Record<string, unknown> | null`.

- Each transform type (trim, case, fill_null, map_values, alias) SHALL have a typed config variant.
- The `useTableConfig` hook SHALL access config properties via type narrowing, not `as` casts.

#### Scenario: Alias config accessed type-safely

- **WHEN** `useTableConfig` reads the alias from an alias transform
- **THEN** it SHALL narrow the config via the operation discriminant
- **THEN** no `as Record<string, unknown>` cast SHALL be needed
