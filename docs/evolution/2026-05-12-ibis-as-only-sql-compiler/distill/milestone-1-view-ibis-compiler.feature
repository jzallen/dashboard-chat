# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 1 — ViewIbisCompiler replaces ViewSQLGenerator (closes Gap 1).
#
# Contracts enforced (per ADR-026 §"Decision outcome", §"Consequences →
# Positive → Closes Gap 1", and the MR-1 row of the MR roadmap):
#
#   1. The view tier's SQL emission moves onto ibis end-to-end. The
#      existing structural surface (SELECT-FROM-JOIN-WHERE produced by
#      `ViewSQLGenerator`) is preserved as a regression invariant —
#      same input shape, equivalent compiled output.
#   2. The `ViewFilter.value` injection vector at
#      `backend/app/use_cases/view/sql_generator.py:160` is closed by
#      construction. Per ADR-026 the closure mechanism is ibis literal
#      escaping — values flow through ibis literals rather than f-string
#      interpolation. No separate Pydantic validator on `value` is
#      required for the injection contract; values containing single
#      quotes round-trip safely as STRING LITERALS.
#   3. Every operator the existing `ViewFilter` dataclass surfaces
#      (`agent/lib/chat/viewToolDefinitions.ts:19-32`) renders
#      deterministically through the ibis compiler: `=`, `!=`, `>`,
#      `>=`, `<`, `<=`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`,
#      `LIKE`, `NOT LIKE`.
#   4. The dbt-eject path produces customer-visible SQL that is
#      EVALUATION-equivalent to today's hand-rolled output — same
#      result-set against test data, even when the rendered SQL text
#      differs syntactically (ibis dialect choices may differ from the
#      legacy generator's hand-shaped output).
#   5. `ViewFilter` becomes a Pydantic discriminated union (MR-1 file
#      scope per ADR-026 §References). Malformed operators are rejected
#      at the validation boundary BEFORE reaching the compiler.
#
# These are CONTRACTS, not mechanisms. The scenarios assert observable
# outcomes (rendered SQL contains the expected clause; ejected dbt
# model is evaluation-equivalent; injection payload round-trips as a
# safe literal; malformed input is rejected with a structured error)
# and never reference the internal ibis operations the compiler uses.
#
# Driving port: the view-creation use-case facade
# `app.use_cases.view.create_view` — the same Python use-case boundary
# the agent's `createView` / `addFilter` / `addJoin` tools land on
# through the backend dispatcher. This is the cleanest port above the
# SQL-compilation layer per CLAUDE.md decorator-stack discipline.
#
# Phase 02 unpends these scenarios as MR-1 implementation drives them
# RED → GREEN one at a time per nwave Outside-In TDD.

@milestone_1 @driving_adapter
Feature: The view-creation surface compiles to safe deterministic SQL and rejects unsafe input by construction
  As an analyst composing views through structured tool calls,
  I want the system to compile my view definition into safe, deterministic SQL
  and reject malformed input before it reaches the compiler
  So that no value I supply — including hostile ones — can break or subvert the SQL the customer ships.

  Scenario: SELECT-FROM-JOIN-WHERE structure is preserved when a view with one filter and one join compiles via the new compiler
    Given the analyst has a project with datasets "orders" and "customers"
    When the analyst creates a view named "active_west_orders" selecting "order_id" and "customer_name" from "orders" joined to "customers" on "customer_id" filtering where "orders.region" equals "west"
    Then the compiled view SQL selects both columns
    And the compiled view SQL joins "orders" to "customers" on the customer_id relationship
    And the compiled view SQL contains a WHERE clause restricting region to "west"
    And evaluating the compiled view against seeded data returns the same rows the previous generator's SQL returned for the same definition

  @security_invariant
  Scenario: A filter value containing a SQL-injection payload is treated as a string literal, never as SQL syntax
    Given the analyst has a project containing an "orders" dataset with a "region" column
    When the analyst creates a view named "trick_view" filtering where "region" equals "'; DROP TABLE projects; --"
    Then the compiled view SQL is well-formed and executable
    And evaluating the compiled view against seeded orders data returns zero rows
    And the "projects" table is still present and unchanged after evaluation
    And the persisted view definition stores the injection payload as the filter's literal value, not as embedded SQL syntax

  Scenario Outline: Every operator the analyst's filter tool surfaces renders deterministically through the new compiler
    Given the analyst has a project containing an "orders" dataset with a numeric "amount" column and a categorical "status" column
    When the analyst creates a view named "<view_name>" filtering where "<column>" with operator "<operator>" and value "<value>"
    Then the compiled view SQL contains the WHERE clause expressing "<column> <operator> <value>" semantically
    And evaluating the compiled view against seeded data returns exactly the rows that satisfy the predicate

    Examples:
      | view_name        | column | operator    | value           |
      | amt_eq           | amount | =           | 100             |
      | amt_neq          | amount | !=          | 100             |
      | amt_gt           | amount | >           | 50              |
      | amt_gte          | amount | >=          | 50              |
      | amt_lt           | amount | <           | 50              |
      | amt_lte          | amount | <=          | 50              |
      | status_in        | status | IN          | (open, pending) |
      | status_not_in    | status | NOT IN      | (closed)        |
      | status_is_null   | status | IS NULL     |                 |
      | status_not_null  | status | IS NOT NULL |                 |
      | status_like      | status | LIKE        | open%           |
      | status_not_like  | status | NOT LIKE    | %archived       |

  Scenario: The customer's dbt export of a compiled view is evaluation-equivalent to the legacy generator's output
    Given the analyst has a project containing an "orders" dataset with "region" and "amount" columns
    And the analyst has created a view named "west_high_value_orders" selecting "order_id" and "amount" from "orders" filtering where "region" equals "west" and "amount" is greater than 1000
    When the customer downloads the dbt project export
    Then the export contains an intermediate model file "int_west_high_value_orders.sql"
    And evaluating that intermediate model against seeded orders data returns the same rows the legacy generator's SQL returns for the same view definition
    And the intermediate model references the upstream "orders" model through a dbt ref macro

  @input_validation_contract
  Scenario: A view filter submitted with a malformed operator is rejected by the validation boundary before reaching the compiler
    Given the analyst has a project containing an "orders" dataset with a "region" column
    When the analyst attempts to create a view with a filter whose operator is "DELETE_ALL"
    Then the request is rejected with a structured validation error
    And the validation error names the rejected field as the filter's operator
    And no view is persisted
    And the compiler is never invoked
