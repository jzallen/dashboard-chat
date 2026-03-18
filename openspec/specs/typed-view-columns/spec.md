# typed-view-columns Specification

## Purpose
TBD - created by archiving change sql-access-fixes. Update Purpose after archive.
## Requirements
### Requirement: Views use explicit typed columns for ODBC visibility
Bootstrap SQL views SHALL use explicit column selection with PostgreSQL type casts derived from the dataset's `schema_config`, instead of `SELECT *`. This ensures ODBC clients (Excel, Power BI) see individual typed columns in `information_schema.columns`.

#### Scenario: Dataset with schema_config generates typed view
- **WHEN** `generate_bootstrap_sql()` processes a dataset with `schema_config = {"fields": {"name": {"type": "text"}, "salary": {"type": "number"}, "active": {"type": "boolean"}}}`
- **THEN** the generated view SQL SHALL be:
  ```sql
  CREATE OR REPLACE VIEW "schema"."view_name" AS
    SELECT
      r['name']::text AS "name",
      r['salary']::double precision AS "salary",
      r['active']::boolean AS "active"
    FROM read_parquet('s3://...') r;
  ```

#### Scenario: Dataset without schema_config falls back to SELECT *
- **WHEN** `generate_bootstrap_sql()` processes a dataset with empty `schema_config` (no `fields` key or empty fields dict)
- **THEN** the generated view SQL SHALL use `SELECT * FROM read_parquet(...)` as a degraded fallback

#### Scenario: ODBC client inspects view metadata
- **WHEN** an ODBC client queries `information_schema.columns` for a typed view
- **THEN** each column SHALL appear as a separate row with its PostgreSQL type (not a single `USER-DEFINED` composite column)

### Requirement: DuckDB-to-PostgreSQL type mapping
The system SHALL maintain a mapping from application schema types to PostgreSQL cast types for use in view column expressions.

#### Scenario: All standard types are mapped
- **WHEN** a dataset field has type `text`, `number`, `boolean`, `select`, `datetime`, or `integer`
- **THEN** the mapping SHALL produce:
  | App Type   | PostgreSQL Type      |
  |-----------|---------------------|
  | text      | text                |
  | number    | double precision    |
  | boolean   | boolean             |
  | select    | text                |
  | datetime  | timestamptz         |
  | integer   | bigint              |

#### Scenario: Unknown type falls back to text
- **WHEN** a dataset field has a type not in the mapping
- **THEN** the system SHALL cast to `text` as a safe default

### Requirement: Column identifiers are safely quoted
All column names in generated view SQL SHALL be double-quoted to handle reserved words and special characters.

#### Scenario: Column name is a SQL reserved word
- **WHEN** a dataset has a column named `select` or `order`
- **THEN** the generated SQL SHALL use `r['select']::text AS "select"`

