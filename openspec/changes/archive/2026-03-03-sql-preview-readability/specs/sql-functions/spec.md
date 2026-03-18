# Capability: sql-functions

DuckDB SQL macro definitions, Ibis `@udf.scalar.builtin` declarations, macro registration on DuckDB connection, and the reusable pattern for adding readable SQL functions to future cleaning operations.

---

## ADDED Requirements

### Requirement: title_case DuckDB macro

The system SHALL register a DuckDB macro `title_case(s)` that capitalizes the first letter of each word in a string. The macro SHALL trim leading and trailing whitespace before processing. Words SHALL be delimited by spaces. The macro SHALL use `LIST_REDUCE` over `STRING_SPLIT` to uppercase the first character and lowercase the remainder of each word, then rejoin with single spaces.

#### Scenario: Title case a multi-word string

- **WHEN** `title_case('san francisco')` is evaluated by DuckDB
- **THEN** the result SHALL be `'San Francisco'`

#### Scenario: Title case with leading and trailing whitespace

- **WHEN** `title_case('  hello  world  ')` is evaluated by DuckDB
- **THEN** the result SHALL be `'Hello World'` with no leading or trailing whitespace

#### Scenario: Title case a single word

- **WHEN** `title_case('hello')` is evaluated by DuckDB
- **THEN** the result SHALL be `'Hello'`

#### Scenario: Title case with mixed case input

- **WHEN** `title_case('jOHN dOE')` is evaluated by DuckDB
- **THEN** the result SHALL be `'John Doe'`

#### Scenario: Title case an already title-cased string

- **WHEN** `title_case('San Francisco')` is evaluated by DuckDB
- **THEN** the result SHALL be `'San Francisco'` (idempotent)

---

### Requirement: snake_case DuckDB macro

The system SHALL register a DuckDB macro `snake_case(s)` that converts a string to snake_case format. The macro SHALL trim leading and trailing whitespace, lowercase the entire string, replace all runs of non-alphanumeric (excluding underscore) characters with a single underscore, and strip leading/trailing underscores from the result.

#### Scenario: Snake case a multi-word string

- **WHEN** `snake_case('Product Name')` is evaluated by DuckDB
- **THEN** the result SHALL be `'product_name'`

#### Scenario: Snake case an all-uppercase string

- **WHEN** `snake_case('FIRST NAME')` is evaluated by DuckDB
- **THEN** the result SHALL be `'first_name'`

#### Scenario: Snake case an already snake_cased string

- **WHEN** `snake_case('already_snake')` is evaluated by DuckDB
- **THEN** the result SHALL be `'already_snake'` (idempotent)

#### Scenario: Snake case with special characters

- **WHEN** `snake_case('Product #1')` is evaluated by DuckDB
- **THEN** the result SHALL be `'product_1'` (special characters replaced with underscore)

#### Scenario: Snake case with leading and trailing whitespace

- **WHEN** `snake_case('  hello world  ')` is evaluated by DuckDB
- **THEN** the result SHALL be `'hello_world'` with no leading or trailing underscores

#### Scenario: Snake case with consecutive spaces

- **WHEN** `snake_case('Product   Name')` is evaluated by DuckDB
- **THEN** the result SHALL be `'product_name'` (consecutive spaces produce a single underscore)

---

### Requirement: kebab_case DuckDB macro

The system SHALL register a DuckDB macro `kebab_case(s)` that converts a string to kebab-case format. The macro SHALL trim leading and trailing whitespace, lowercase the entire string, replace all runs of non-alphanumeric (excluding hyphen) characters with a single hyphen, and strip leading/trailing hyphens from the result.

#### Scenario: Kebab case a multi-word string

- **WHEN** `kebab_case('Product Name')` is evaluated by DuckDB
- **THEN** the result SHALL be `'product-name'`

#### Scenario: Kebab case an all-uppercase string

- **WHEN** `kebab_case('FIRST NAME')` is evaluated by DuckDB
- **THEN** the result SHALL be `'first-name'`

#### Scenario: Kebab case an already kebab-cased string

- **WHEN** `kebab_case('already-kebab')` is evaluated by DuckDB
- **THEN** the result SHALL be `'already-kebab'` (idempotent)

#### Scenario: Kebab case with special characters

- **WHEN** `kebab_case('Product #1')` is evaluated by DuckDB
- **THEN** the result SHALL be `'product-1'` (special characters replaced with hyphen)

#### Scenario: Kebab case with leading and trailing whitespace

- **WHEN** `kebab_case('  hello world  ')` is evaluated by DuckDB
- **THEN** the result SHALL be `'hello-world'` with no leading or trailing hyphens

#### Scenario: Kebab case with consecutive spaces

- **WHEN** `kebab_case('Product   Name')` is evaluated by DuckDB
- **THEN** the result SHALL be `'product-name'` (consecutive spaces produce a single hyphen)

---

### Requirement: Ibis builtin UDF declarations

The system SHALL declare Ibis `@ibis.udf.scalar.builtin` functions for `title_case`, `snake_case`, and `kebab_case`. Each function SHALL accept a single string column argument and return a string column. When Ibis generates SQL via `to_sql()`, it SHALL emit the function name directly (e.g., `title_case(t0.city)`) without expanding the macro body.

#### Scenario: Ibis title_case UDF emits clean SQL

- **WHEN** `title_case(table.city)` is used in an Ibis expression and compiled to SQL
- **THEN** the generated SQL SHALL contain `title_case(` as a function call, not the macro expansion

#### Scenario: Ibis snake_case UDF emits clean SQL

- **WHEN** `snake_case(table.category)` is used in an Ibis expression and compiled to SQL
- **THEN** the generated SQL SHALL contain `snake_case(` as a function call

#### Scenario: Ibis kebab_case UDF emits clean SQL

- **WHEN** `kebab_case(table.slug)` is used in an Ibis expression and compiled to SQL
- **THEN** the generated SQL SHALL contain `kebab_case(` as a function call

---

### Requirement: Macro registration function

The system SHALL provide a `register_duckdb_macros(conn)` function in `backend/app/utils/sql_functions.py` that registers all DuckDB macros on a given DuckDB connection. This function SHALL use `CREATE OR REPLACE MACRO` statements so it is safe to call multiple times on the same connection. The lake repository SHALL call this function when establishing DuckDB connections.

#### Scenario: Macros available after registration

- **WHEN** `register_duckdb_macros(conn)` is called on a DuckDB connection
- **THEN** the macros `title_case`, `snake_case`, and `kebab_case` SHALL be available for use in SQL queries on that connection

#### Scenario: Registration is idempotent

- **WHEN** `register_duckdb_macros(conn)` is called multiple times on the same connection
- **THEN** no error SHALL be raised and the macros SHALL continue to function correctly

#### Scenario: New macros follow the same pattern

- **WHEN** a developer needs to add a new readable SQL function for a future cleaning operation
- **THEN** they SHALL add the macro SQL to `register_duckdb_macros()`, declare a matching `@ibis.udf.scalar.builtin` function in the same module, and use the UDF in `CleaningExpression` — following the pattern established by `title_case`, `snake_case`, and `kebab_case`

---

### Requirement: sql_functions module structure

The `backend/app/utils/sql_functions.py` module SHALL export:
1. Ibis builtin UDF functions: `title_case()`, `snake_case()`, `kebab_case()`
2. The `register_duckdb_macros(conn)` registration function
3. Macro SQL string constants (for testing and documentation)

The module SHALL NOT depend on any application-specific imports (models, repositories, config). It SHALL only depend on `ibis` and `duckdb`.

#### Scenario: Module exports are importable

- **WHEN** `from app.utils.sql_functions import title_case, snake_case, kebab_case, register_duckdb_macros` is executed
- **THEN** all four names SHALL be importable without error

#### Scenario: Module has no application dependencies

- **WHEN** the module is imported
- **THEN** it SHALL NOT import from `app.models`, `app.repositories`, `app.config`, or any other application module
