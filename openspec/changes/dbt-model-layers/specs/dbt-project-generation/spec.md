## MODIFIED Requirements

### Requirement: dbt Project File Structure

The system SHALL generate a zip archive containing a complete, valid dbt project directory structure when exporting a project with datasets, views, and reports.

- The zip archive SHALL contain the following files at minimum:
  - `dbt_project.yml` at the archive root
  - `profiles.yml` at the archive root
  - `models/staging/sources.yml`
  - `models/schema.yml`
  - `README.md` at the archive root
- For each dataset in the project, the zip SHALL contain a staging model SQL file at `models/staging/stg_{snake_case_name}.sql`.
- For each View in the project, the zip SHALL contain an intermediate model SQL file at `models/intermediate/int_{snake_case_name}.sql`.
- For each Report in the project, the zip SHALL contain a mart model SQL file at `models/marts/{domain_snake}/{prefix}_{snake_case_name}.sql` where `prefix` is `fct` for fact reports and `dim` for dimension reports.
- The zip SHALL NOT contain any files outside the expected dbt project structure.
- The zip SHALL be generated entirely in memory using Python's `zipfile` module with `BytesIO`.

#### Scenario: Export a project with two datasets

- **WHEN** a project named "Sales Pipeline" has two datasets named "Leads" and "Opportunities" with transforms applied
- **THEN** the generated zip SHALL contain `dbt_project.yml`, `profiles.yml`, `models/staging/sources.yml`, `models/schema.yml`, `README.md`, `models/staging/stg_leads.sql`, and `models/staging/stg_opportunities.sql`
- **THEN** every file in the zip SHALL be a valid text file (UTF-8 encoded)

#### Scenario: Export an empty project with no datasets

- **WHEN** a project has no datasets, views, or reports
- **THEN** the generated zip SHALL contain `dbt_project.yml`, `profiles.yml`, `models/staging/sources.yml`, `models/schema.yml`, and `README.md`
- **THEN** the `models/staging/` directory SHALL contain no `stg_*.sql` files
- **THEN** `sources.yml` SHALL contain an empty tables list
- **THEN** `schema.yml` SHALL contain an empty models list

#### Scenario: Export a project with all three layers

- **WHEN** a project has Datasets "Orders" and "Customers", View "Orders Enriched", and Report "Monthly Revenue" (fact, domain "Finance")
- **THEN** the zip SHALL contain `models/staging/stg_orders.sql`, `models/staging/stg_customers.sql`, `models/intermediate/int_orders_enriched.sql`, and `models/marts/finance/fct_monthly_revenue.sql`
- **THEN** `schema.yml` SHALL include model entries for staging models and mart models with column metadata

---

### Requirement: schema.yml Generation

The system SHALL generate a `models/schema.yml` file that declares each dataset as a dbt model with column definitions derived from the dataset's `schema_config`, and each Report as a dbt model with semantic column metadata.

- Each staging model's `name` field SHALL be `stg_{snake_case_dataset_name}` (matching the SQL file name without extension).
- Each staging model SHALL include a `columns` list derived from the dataset's `schema_config.fields`.
- Each column entry SHALL include the column `name` and a `data_type` mapped from the schema config type.
- The type mapping SHALL be: `text` -> `string`, `number` -> `float64`, `boolean` -> `boolean`, `select` -> `string`.
- Each mart model's `name` field SHALL be `{prefix}_{snake_case_report_name}` where prefix is `fct` or `dim`.
- Each mart model SHALL include a `columns` list derived from the Report's `columns_metadata`, with semantic role and type in a `meta` section.
- Reports without `columns_metadata` SHALL have an empty `columns` list.

#### Scenario: schema.yml contains column definitions

- **WHEN** a dataset named "Employees" has `schema_config.fields` with columns `name` (text), `salary` (number), and `active` (boolean)
- **THEN** the `schema.yml` SHALL contain a model named `stg_employees`
- **THEN** the model SHALL list columns: `name` (string), `salary` (float64), `active` (boolean)

#### Scenario: Dataset with no schema_config

- **WHEN** a dataset has an empty `schema_config` or no `fields` key
- **THEN** the model SHALL still appear in `schema.yml`
- **THEN** the model SHALL have an empty `columns` list
- **THEN** the corresponding model SQL SHALL still generate correctly

#### Scenario: schema.yml model names match SQL filenames

- **WHEN** a dataset named "Customer List" is exported
- **THEN** the model name in `schema.yml` SHALL be `stg_customer_list`
- **THEN** the SQL file SHALL be named `stg_customer_list.sql`
- **THEN** these names SHALL match exactly

#### Scenario: schema.yml includes mart models with semantic metadata

- **WHEN** a Report "Orders" (fact) has column `amount` with `semantic_role: "measure"`, `semantic_type: "sum"`
- **THEN** the `schema.yml` SHALL contain a model named `fct_orders`
- **THEN** the model SHALL include column `amount` with `meta: {semantic_role: measure, semantic_type: sum}`
