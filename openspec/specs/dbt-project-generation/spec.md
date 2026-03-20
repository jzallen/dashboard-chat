# dbt-project-generation Specification

## Purpose

Defines the dbt project file structure generated during export. The generated zip contains staging models for datasets, intermediate models for views, and mart models for reports, all generated in memory.

## Requirements

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

### Requirement: dbt_project.yml Generation

The system SHALL generate a valid `dbt_project.yml` file containing the project name in snake_case, a matching profile reference, and the model paths configuration.

- The `name` field SHALL be the project name converted to snake_case.
- The `profile` field SHALL match the `name` field exactly.
- The `model-paths` field SHALL be `["models"]`.
- The `version` field SHALL be `"1.0.0"`.

#### Scenario: Project name conversion to snake_case

- **WHEN** a project is named "Sales Pipeline Q4"
- **THEN** the `dbt_project.yml` `name` field SHALL be `"sales_pipeline_q4"`
- **THEN** the `profile` field SHALL be `"sales_pipeline_q4"`

#### Scenario: dbt_project.yml references correct model paths

- **WHEN** any project is exported
- **THEN** the `dbt_project.yml` SHALL contain `model-paths: ["models"]`
- **THEN** the `version` field SHALL be `"1.0.0"`

---

### Requirement: profiles.yml Generation

The system SHALL generate a `profiles.yml` file that configures a DuckDB target with S3 credential placeholders using dbt's `env_var()` Jinja macro. No real credential values SHALL appear in the exported file.

- The profile name SHALL match the project name in snake_case.
- The target SHALL be named `dev`.
- The output type SHALL be `duckdb` with `path: ":memory:"`.
- The S3 settings SHALL use `env_var()` for `s3_region`, `s3_access_key_id`, `s3_secret_access_key`, and `s3_endpoint`.
- The `httpfs` extension SHALL be listed under `extensions`.

#### Scenario: profiles.yml uses env_var placeholders

- **WHEN** a project is exported
- **THEN** the `profiles.yml` SHALL contain `{{ env_var('S3_ACCESS_KEY_ID') }}` for the access key setting
- **THEN** the `profiles.yml` SHALL contain `{{ env_var('S3_SECRET_ACCESS_KEY') }}` for the secret key setting
- **THEN** the `profiles.yml` SHALL contain `{{ env_var('S3_REGION', 'us-east-1') }}` for the region setting
- **THEN** no actual MinIO or S3 credentials SHALL appear in the file

#### Scenario: profiles.yml configures DuckDB target

- **WHEN** a project named "My Data" is exported
- **THEN** the profile name SHALL be `"my_data"`
- **THEN** the target type SHALL be `"duckdb"` with path `":memory:"`
- **THEN** the `httpfs` extension SHALL be listed

---

### Requirement: sources.yml Generation

The system SHALL generate a `models/staging/sources.yml` file that declares each dataset as a source table with its storage path and dataset ID metadata.

- The source name SHALL be the project name in snake_case.
- Each dataset SHALL appear as a table entry under the source.
- Each table's `name` field SHALL be the dataset name in snake_case (deduplicated if necessary).
- Each table SHALL include a `meta` section containing the dashboard `dataset_id`.
- Each table SHALL include an `external` section (or equivalent dbt metadata) containing the dataset's `storage_path` for reference.

#### Scenario: sources.yml maps datasets to storage paths

- **WHEN** a project has a dataset named "Customer List" with storage path `datasets/proj-1/ds-1/` and ID `ds-1`
- **THEN** the `sources.yml` SHALL contain a table named `"customer_list"`
- **THEN** the table SHALL include `meta: { dataset_id: "ds-1" }`
- **THEN** the table SHALL include the storage path `datasets/proj-1/ds-1/` in its metadata

#### Scenario: sources.yml with empty project

- **WHEN** a project has no datasets
- **THEN** the `sources.yml` SHALL contain the source name but an empty `tables` list

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

---

### Requirement: Model SQL Generation with CTE Pipeline

The system SHALL generate one staging model SQL file per dataset. Each model SHALL use a CTE-based pipeline structure with `{{ source() }}` macro references. The CTE structure SHALL be conditional based on which transform types are present.

- The source CTE SHALL always be present: `SELECT * FROM {{ source('project_name', 'dataset_name') }}`.
- The cleaned CTE SHALL be present only when enabled cleaning or map transforms exist.
- The filtered CTE SHALL be present only when enabled filter transforms exist.
- The final SELECT SHALL apply column aliases if alias transforms exist, or `SELECT * FROM` the last CTE otherwise.
- Only transforms with `status == 'enabled'` SHALL appear in the generated SQL. Disabled and deleted transforms SHALL be excluded entirely.

#### Scenario: Dataset with all transform types

- **WHEN** a dataset has enabled cleaning transforms, filter transforms, and alias transforms
- **THEN** the model SQL SHALL contain CTEs in order: `source`, `cleaned`, `filtered`, `final`
- **THEN** the source CTE SHALL use `{{ source('project_name', 'dataset_name') }}`
- **THEN** the cleaned CTE SHALL apply cleaning expressions
- **THEN** the filtered CTE SHALL apply filter conditions in a WHERE clause
- **THEN** the final SELECT SHALL apply column aliases

#### Scenario: Dataset with no transforms (passthrough)

- **WHEN** a dataset has no transforms applied
- **THEN** the model SQL SHALL be `SELECT * FROM {{ source('project_name', 'dataset_name') }}`
- **THEN** no CTEs SHALL be present

#### Scenario: Dataset with only filter transforms

- **WHEN** a dataset has only enabled filter transforms
- **THEN** the model SQL SHALL contain `source` and `filtered` CTEs
- **THEN** no `cleaned` CTE SHALL be present
- **THEN** the final line SHALL be `SELECT * FROM filtered`

#### Scenario: Dataset with only cleaning transforms

- **WHEN** a dataset has only enabled cleaning transforms
- **THEN** the model SQL SHALL contain `source` and `cleaned` CTEs
- **THEN** no `filtered` CTE SHALL be present
- **THEN** the final line SHALL be `SELECT * FROM cleaned`

#### Scenario: Dataset with only alias transforms

- **WHEN** a dataset has only enabled alias transforms
- **THEN** the model SQL SHALL contain a `source` CTE and a final SELECT with column renames
- **THEN** no `cleaned` or `filtered` CTEs SHALL be present

#### Scenario: Disabled transforms are excluded

- **WHEN** a dataset has both enabled and disabled transforms
- **THEN** only enabled transforms SHALL appear in the generated SQL
- **THEN** disabled transforms SHALL be excluded entirely from all CTEs

---

### Requirement: Cleaning Transform SQL Expressions

The system SHALL map each cleaning transform's `expression_config` to a standard SQL expression in the cleaned CTE. The mapping SHALL produce human-readable SQL compatible with DuckDB.

- Trim: `expression_config.operation == "trim"` SHALL produce `TRIM(column_name) AS column_name`.
- Upper case: `expression_config.operation == "case"` with `case_type == "upper"` SHALL produce `UPPER(column_name) AS column_name`.
- Lower case: `expression_config.operation == "case"` with `case_type == "lower"` SHALL produce `LOWER(column_name) AS column_name`.
- Title case: `expression_config.operation == "case"` with `case_type == "title"` SHALL produce `INITCAP(column_name) AS column_name`.
- Snake case: `expression_config.operation == "case"` with `case_type == "snake"` SHALL produce a `REGEXP_REPLACE`-based expression.
- Kebab case: `expression_config.operation == "case"` with `case_type == "kebab"` SHALL produce a `REGEXP_REPLACE`-based expression.
- Fill null (text): `expression_config.operation == "fill_null"` with text fill SHALL produce `COALESCE(column_name, 'value') AS column_name`.
- Fill null (numeric): `expression_config.operation == "fill_null"` with numeric fill SHALL produce `COALESCE(column_name, value) AS column_name` (no quotes around the value).
- Value mapping: `expression_config.operation == "map_values"` SHALL produce a `CASE WHEN` expression preserving unmapped values via an `ELSE` clause.

#### Scenario: Trim transform generates TRIM SQL

- **WHEN** a dataset has an enabled transform with `expression_config = {"operation": "trim"}` targeting column `name`
- **THEN** the cleaned CTE SHALL include `TRIM(name) AS name`

#### Scenario: Upper case transform generates UPPER SQL

- **WHEN** a dataset has an enabled transform with `expression_config = {"operation": "case", "case_type": "upper"}` targeting column `city`
- **THEN** the cleaned CTE SHALL include `UPPER(city) AS city`

#### Scenario: Title case transform generates INITCAP SQL

- **WHEN** a dataset has an enabled transform with `expression_config = {"operation": "case", "case_type": "title"}` targeting column `name`
- **THEN** the cleaned CTE SHALL include `INITCAP(name) AS name`

#### Scenario: Fill null with text value generates quoted COALESCE

- **WHEN** a dataset has an enabled transform with `expression_config = {"operation": "fill_null", "fill_value": "Unknown", "fill_type": "text"}` targeting column `department`
- **THEN** the cleaned CTE SHALL include `COALESCE(department, 'Unknown') AS department`

#### Scenario: Fill null with numeric value generates unquoted COALESCE

- **WHEN** a dataset has an enabled transform with `expression_config = {"operation": "fill_null", "fill_value": "0", "fill_type": "numeric"}` targeting column `salary`
- **THEN** the cleaned CTE SHALL include `COALESCE(salary, 0) AS salary`

#### Scenario: Value mapping generates CASE WHEN chain

- **WHEN** a dataset has an enabled map transform with `expression_config = {"operation": "map_values", "mappings": [{"from": "NY", "to": "New York"}, {"from": "CA", "to": "California"}]}` targeting column `state`
- **THEN** the cleaned CTE SHALL include a `CASE WHEN state = 'NY' THEN 'New York' WHEN state = 'CA' THEN 'California' ELSE state END AS state` expression

#### Scenario: Unknown operation produces a SQL comment

- **WHEN** a dataset has a transform with an unrecognized `expression_config.operation` value
- **THEN** the generator SHALL produce a SQL comment (e.g., `-- unsupported operation: unknown_op for column col_name`) instead of failing
- **THEN** the zip generation SHALL complete successfully

---

### Requirement: Filter Transform SQL in WHERE Clause

The system SHALL embed enabled filter transforms' `condition_sql` values in the WHERE clause of the filtered CTE. Multiple filter conditions SHALL be combined with AND.

- Each enabled filter transform's `condition_sql` field SHALL appear as a condition in the WHERE clause.
- Multiple filter conditions SHALL be joined with `AND`.
- The filtered CTE SHALL select from the cleaned CTE if cleaning transforms exist, or from the source CTE otherwise.

#### Scenario: Single filter transform

- **WHEN** a dataset has one enabled filter transform with `condition_sql = "status = 'active'"`
- **THEN** the filtered CTE SHALL contain `WHERE status = 'active'`

#### Scenario: Multiple filter transforms combined with AND

- **WHEN** a dataset has two enabled filter transforms with `condition_sql` values `"status = 'active'"` and `"salary > 50000"`
- **THEN** the filtered CTE SHALL contain `WHERE status = 'active' AND salary > 50000`

#### Scenario: Filtered CTE sources from cleaned CTE when both exist

- **WHEN** a dataset has both cleaning and filter transforms
- **THEN** the filtered CTE SHALL select from `cleaned` (not from `source`)

---

### Requirement: Alias Transform in Final SELECT

The system SHALL apply enabled alias transforms as column renames in the final SELECT statement. Unaliased columns SHALL be passed through unchanged.

- Each enabled alias transform SHALL rename `target_column` to the alias name from `expression_config`.
- The alias name SHALL be converted to snake_case for the SQL column identifier.
- Columns without alias transforms SHALL appear as-is in the final SELECT.
- If no alias transforms exist, the final line SHALL be `SELECT * FROM {last_cte}`.

#### Scenario: Alias transforms rename columns in final SELECT

- **WHEN** a dataset has alias transforms renaming `emp_id` to "Employee ID" and `dept` to "Department Name"
- **THEN** the final SELECT SHALL include `emp_id AS employee_id` and `dept AS department_name`
- **THEN** unaliased columns SHALL be passed through unchanged

#### Scenario: No alias transforms produces SELECT star

- **WHEN** a dataset has no alias transforms
- **THEN** the final line of the model SQL SHALL be `SELECT * FROM {last_cte}` where `{last_cte}` is the last generated CTE name

---

### Requirement: Snake_Case Naming with Deduplication

The system SHALL convert dataset names to snake_case for use as dbt model names and file names. When multiple datasets produce the same snake_case name, the system SHALL append numeric suffixes to ensure uniqueness.

- Dataset names SHALL be converted to snake_case using the pattern: lowercase, replace non-alphanumeric sequences with underscore, strip leading/trailing underscores.
- If the conversion produces an empty string, the fallback name SHALL be `"dataset"`.
- When two or more datasets produce the same snake_case name, the system SHALL append `_1`, `_2`, etc. to the duplicates (the first occurrence keeps the base name).
- The deduplication SHALL be deterministic based on the dataset list order.
- The deduplicated names SHALL be used consistently across all generated files (model SQL filename, schema.yml model name, sources.yml table name).

#### Scenario: Simple name conversion

- **WHEN** a dataset is named "Customer List"
- **THEN** the snake_case name SHALL be `"customer_list"`
- **THEN** the model file SHALL be named `stg_customer_list.sql`

#### Scenario: Duplicate names after conversion

- **WHEN** two datasets are named "Sales Data" and "Sales-Data"
- **THEN** the first dataset SHALL use `"sales_data"` and the second SHALL use `"sales_data_1"`
- **THEN** the model files SHALL be `stg_sales_data.sql` and `stg_sales_data_1.sql`
- **THEN** both `sources.yml` and `schema.yml` SHALL use the same deduplicated names

#### Scenario: Empty name after conversion

- **WHEN** a dataset is named "---" (all non-alphanumeric characters)
- **THEN** the snake_case name SHALL fall back to `"dataset"`

#### Scenario: Names are consistent across all files

- **WHEN** a dataset produces the snake_case name `"employee_records"`
- **THEN** the sources.yml table name, schema.yml model name (prefixed with `stg_`), and SQL filename (prefixed with `stg_` and suffixed with `.sql`) SHALL all use `"employee_records"` as the base

---

### Requirement: README Generation

The system SHALL generate a `README.md` file at the archive root that documents the exported dbt project, including the source project name and basic usage instructions.

- The README SHALL include the project name.
- The README SHALL include instructions for setting up environment variables for S3 access.
- The README SHALL include instructions for running `dbt run`.
- The README SHALL note that the project was generated by Dashboard Chat.

#### Scenario: README contains project name and setup instructions

- **WHEN** a project named "Sales Pipeline" is exported
- **THEN** the README SHALL reference "Sales Pipeline" by name
- **THEN** the README SHALL list the required environment variables (S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT)
- **THEN** the README SHALL include a `dbt run` command example

