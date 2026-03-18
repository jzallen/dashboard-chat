# Capability: RAQB Conversion Correctness

**Status**: MODIFIED
**Domain**: frontend (raqb, table-tools)

## Overview

Fix SQL identifier escaping for correctness, surface warnings when OR semantics are lost during conversion, and add test coverage for the TanStack→RAQB direction.

---

## MODIFIED Requirements

### Requirement: SQL Identifier Escaping Uses Quoting

`escapeIdentifier()` in `toSql.ts` SHALL use double-quote SQL quoting instead of character stripping.

- Identifiers SHALL be wrapped in double quotes with internal quotes escaped by doubling.
- Column names containing hyphens, spaces, or other special characters SHALL be preserved correctly.
- The function `escapeIdentifier("user-id")` SHALL return `"user-id"` (quoted), not `userid` (stripped).

#### Scenario: Column name with hyphen

- **WHEN** `escapeIdentifier("user-id")` is called
- **THEN** it SHALL return `'"user-id"'`

#### Scenario: Column name with double quote

- **WHEN** `escapeIdentifier('column"name')` is called
- **THEN** it SHALL return `'"column""name"'` (quote escaped by doubling)

#### Scenario: Simple alphanumeric column name

- **WHEN** `escapeIdentifier("price")` is called
- **THEN** it SHALL return `'"price"'`

---

### Requirement: OR Group Conversion Warning

When RAQB trees with OR conjunctions are converted to TanStack filters, the conversion SHALL surface a warning.

- `raqbToTanstack` SHALL return a `warnings` array alongside the filters.
- When an OR group is flattened to AND semantics, a warning SHALL be included describing the lost semantics.
- The caller SHALL have the option to display or log the warning.

#### Scenario: OR group is flattened

- **WHEN** a RAQB tree contains `{ conjunction: "OR", rules: [...] }`
- **THEN** the conversion result SHALL include a warning: `"OR group flattened to AND — filter results may be broader than expected"`
- **THEN** the filters SHALL still be returned (best-effort conversion)

#### Scenario: AND group produces no warning

- **WHEN** a RAQB tree contains only AND conjunctions
- **THEN** the conversion result SHALL have an empty warnings array

---

### Requirement: TanStack→RAQB Test Coverage

The `tanstackToRaqb.ts` module SHALL have test coverage for `filterTableToRaqb()` and `generateFilterDescription()`.

- Tests SHALL cover: single filter, multiple filters on different columns, compound filter value, empty filter array.
- Tests SHALL verify the operator mapping from TanStack operators to RAQB operators.
- At least one round-trip test SHALL verify `RAQB → TanStack → RAQB` produces an equivalent tree.

#### Scenario: Single filter round-trip

- **WHEN** a RAQB tree `{ conjunction: "AND", rules: [{ field: "price", operator: "greater", value: [100] }] }` is converted to TanStack and back
- **THEN** the resulting RAQB tree SHALL be semantically equivalent to the original
