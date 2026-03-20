## ADDED Requirements

### Requirement: Views export as intermediate dbt models

The dbt export use case SHALL generate `models/intermediate/int_{snake_name}.sql` files for each view in the project, in addition to the existing staging model files for datasets.

#### Scenario: View exports to correct file path

- **WHEN** the project has a view named "orders enriched" (or "orders_enriched")
- **THEN** the zip archive SHALL contain `models/intermediate/int_orders_enriched.sql`
- **AND** the filename SHALL use the snake_case form of the view name

#### Scenario: Intermediate model includes materialization config header

- **WHEN** a view has `materialization = "table"`
- **THEN** the exported SQL file SHALL begin with `{{ config(materialized='table') }}`
- **WHEN** a view has `materialization = "view"` (the default)
- **THEN** the exported SQL SHALL begin with `{{ config(materialized='view') }}`
- **WHEN** `materialization = "ephemeral"`
- **THEN** the header SHALL be `{{ config(materialized='ephemeral') }}`

#### Scenario: Intermediate model uses ref() macros for sources

- **WHEN** a view references dataset "orders"
- **THEN** the exported SQL SHALL use `{{ ref('stg_orders') }}` for that source
- **WHEN** a view references another view "customers_cleaned"
- **THEN** the exported SQL SHALL use `{{ ref('int_customers_cleaned') }}`

#### Scenario: Chained view refs resolve through the chain

- **WHEN** view B references view A which references dataset "orders"
- **THEN** view B's exported SQL SHALL reference `{{ ref('int_view_a') }}`
- **AND** view A's exported SQL SHALL reference `{{ ref('stg_orders') }}`
- **AND** the dbt dependency graph resolves correctly through the chain

#### Scenario: No intermediate directory when project has no views

- **WHEN** the project has datasets but no views
- **THEN** the exported zip SHALL NOT contain a `models/intermediate/` directory
- **AND** the export SHALL match the existing staging-only format

---

### Requirement: Datasets continue to export as staging models

The existing dbt staging model export behavior SHALL remain unchanged. Only the intermediate layer is added.

#### Scenario: Dataset exports to staging path as before

- **WHEN** the project has a dataset named "orders"
- **THEN** the zip SHALL contain `models/staging/stg_orders.sql`
- **AND** the staging SQL format SHALL be identical to the existing behavior

---

### Requirement: dbt export reads sql_definition from the view record

The dbt export use case SHALL read the cached `sql_definition` from the `ViewRecord` and apply ref-resolution mode via `ViewSQLGenerator`.

#### Scenario: Export uses cached sql_definition with ref resolution

- **WHEN** the export use case processes a view
- **THEN** it SHALL call `ViewSQLGenerator.generate_executable(view, ref_mode=True)` to produce the ref-resolved SQL
- **AND** SHALL NOT use the stored `sql_definition` directly for intermediate models (ref_mode re-generates with macros)
- **THEN** the result SHALL be written to `models/intermediate/int_{snake_name}.sql`

#### Scenario: Export includes materialization config in the same file

- **WHEN** a view has a materialization strategy set
- **THEN** the config Jinja block SHALL appear as the first line of the exported SQL file
- **AND** the SQL body (SELECT ... FROM ...) SHALL follow immediately after
