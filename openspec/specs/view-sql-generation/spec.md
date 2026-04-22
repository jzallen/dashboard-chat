## Purpose

Describes the `ViewSQLGenerator` that deterministically renders SQL from the structured View model. It produces two renderings — `executable_sql` using backend SQL types and `display_sql` using human-facing display types — so the runtime SQL and what the user reads stay aligned.

## Requirements

### Requirement: ViewSQLGenerator produces executable and display SQL

The system SHALL have a `ViewSQLGenerator` that synthesizes SQL deterministically from a structured `View` domain object. It SHALL produce two SQL renderings: `executable_sql` (using backend SQL types in CASTs) and `display_sql` (using display types in CASTs, for human reference).

#### Scenario: Executable SQL uses backend types

- **WHEN** `ViewSQLGenerator.generate_executable(view)` is called on a view with a column typed `category`
- **THEN** the generated SQL SHALL contain `CAST("col" AS TEXT)` (not `CAST("col" AS CATEGORY)`)
- **AND** a `decimal` column SHALL produce `CAST("col" AS DECIMAL)`
- **AND** a `serial` column SHALL produce `CAST("col" AS INTEGER)`

#### Scenario: Display SQL uses display types

- **WHEN** `ViewSQLGenerator.generate_display(view)` is called on the same view
- **THEN** the generated SQL SHALL contain `CAST("col" AS category)` for category columns
- **AND** `CAST("col" AS serial)` for serial columns
- **AND** the output SHALL include a comment header: `-- SQL Preview — for reference only`

#### Scenario: Column aliases appear in SELECT

- **WHEN** a `ViewColumn` has an alias set
- **THEN** the generated SQL SHALL render `CAST(source."source_column" AS TYPE) AS "alias"`
- **WHEN** no alias is set
- **THEN** the generated SQL SHALL render `CAST(source."source_column" AS TYPE) AS "source_column"`

#### Scenario: Filters produce a WHERE clause

- **WHEN** a view has one or more `ViewFilter` entries
- **THEN** `ViewSQLGenerator` SHALL generate a `WHERE` clause joining all filter conditions with `AND`
- **AND** `IS NULL` / `IS NOT NULL` operators SHALL not include a value operand

#### Scenario: Joins produce JOIN clauses between sources

- **WHEN** a view has `ViewJoin` entries
- **THEN** the generator SHALL produce `INNER JOIN` (or the specified join type) clauses using the referenced source aliases
- **AND** the primary source (first in `source_refs`) SHALL be aliased `s0`, the joined source `s1`, etc.

#### Scenario: Empty columns produces empty SELECT

- **WHEN** a view has an empty `columns` list
- **THEN** `generate_executable(view)` SHALL produce `SELECT FROM <source>` (valid for schema-only inspection)

---

### Requirement: SQL is regenerated and cached on every structural PATCH

The `update_view` and `create_view` use cases SHALL call `ViewSQLGenerator.generate_executable(view)` and store the result in `sql_definition` before persisting.

#### Scenario: PATCH columns triggers SQL regeneration

- **WHEN** a PATCH request modifies `columns`, `joins`, `filters`, or `grain`
- **THEN** `update_view` SHALL call `ViewSQLGenerator.generate_executable()` with the updated view
- **AND** store the result in `sql_definition`
- **AND** the stored SQL SHALL be returned in the GET response

#### Scenario: PATCH of name or materialization does not require SQL regeneration

- **WHEN** a PATCH request modifies only `name` or `materialization`
- **THEN** the use case MAY skip SQL regeneration (sql_definition is unchanged)

---

### Requirement: ref-resolution mode for dbt export

`ViewSQLGenerator` SHALL support a `ref_mode=True` parameter that replaces source table references with dbt `{{ ref() }}` macro calls.

#### Scenario: Dataset source resolves to stg_ prefix

- **WHEN** `ViewSQLGenerator.generate_executable(view, ref_mode=True)` is called
- **AND** a source ref points to a dataset named `"orders"`
- **THEN** the generated SQL SHALL use `{{ ref('stg_orders') }}` in place of the table reference

#### Scenario: View source resolves to int_ prefix

- **WHEN** a source ref points to a view named `"orders_joined"`
- **THEN** the generated SQL SHALL use `{{ ref('int_orders_joined') }}` in place of the table reference

#### Scenario: ref_mode=False uses direct table identifiers

- **WHEN** `ref_mode=False` (the default)
- **THEN** source refs SHALL use direct schema-qualified table identifiers (e.g., `"schema"."table_name"`)

---

### Requirement: Circular dependency is pre-validated before SQL generation

`ViewSQLGenerator` SHALL assume a valid DAG (no circular dependencies). Circular dependency detection is the responsibility of the existing `DependencyService`, called before `ViewSQLGenerator`.

#### Scenario: Generator does not validate the DAG

- **WHEN** `ViewSQLGenerator.generate_executable(view)` is called
- **THEN** it SHALL not call `DependencyService` — it assumes the caller has already validated

#### Scenario: Circular reference detected before create or update

- **WHEN** a view PATCH would introduce a circular source dependency
- **THEN** the use case SHALL invoke `DependencyService` first
- **AND** if a cycle is detected, SHALL return a domain error without calling `ViewSQLGenerator`
