# Capability: cleaning-sql-generation (delta)

Changes to the Ibis expression builder and SQL generation pipeline to fix title case correctness, add snake/kebab case modes, and use DuckDB macros via Ibis builtin UDFs for readable SQL output.

---

## MODIFIED Requirements

### Requirement: CleaningExpression case title operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "case", "mode": "title"}` into an Ibis expression using the `title_case()` builtin UDF. The expression MUST capitalize the first letter of each word in multi-word strings. The `to_display_sql()` method SHALL return `title_case(column)` as the display string.

#### Scenario: Standardize a text column to title case

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "case", "mode": "title"}` and `target_column = "city"`
- **THEN** the `as_ibis_expr()` method SHALL return `title_case(table["city"])` using the Ibis builtin UDF
- **AND** the generated SQL SHALL contain `title_case(` as a function call
- **AND** multi-word values like `"san francisco"` SHALL become `"San Francisco"`

#### Scenario: Title case display SQL is accurate

- **WHEN** `to_display_sql()` is called for a title case expression with `target_column = "city"`
- **THEN** the result SHALL be `"title_case(city)"`
- **AND** the display SQL SHALL NOT be `"INITCAP(city)"`

#### Scenario: Title case with leading/trailing whitespace

- **WHEN** a title case transform is applied to a column containing `"  hello  world  "`
- **THEN** the result SHALL be `"Hello World"` (whitespace is trimmed before capitalization)

---

### Requirement: CleaningExpression valid case modes

The `CleaningExpression` class SHALL validate the `mode` field against the set `("upper", "lower", "title", "snake", "kebab")`. An `expression_config` with `{"operation": "case", "mode": "<invalid>"}` SHALL raise a descriptive error listing all valid modes.

#### Scenario: Valid modes include snake and kebab

- **WHEN** a cleaning transform has `expression_config = {"operation": "case", "mode": "snake"}`
- **THEN** the `CleaningExpression` builder SHALL NOT raise a validation error

#### Scenario: Invalid mode lists all five valid options

- **WHEN** a cleaning transform has `expression_config = {"operation": "case", "mode": "reverse"}`
- **THEN** the `CleaningExpression` builder SHALL raise an error indicating that `"reverse"` is not a valid case mode
- **AND** the error message SHALL list `upper`, `lower`, `title`, `snake`, `kebab` as valid modes

---

## ADDED Requirements

### Requirement: CleaningExpression case snake operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "case", "mode": "snake"}` into an Ibis expression using the `snake_case()` builtin UDF. The expression MUST trim whitespace, lowercase the string, and replace runs of non-alphanumeric characters with single underscores. The `to_display_sql()` method SHALL return `snake_case(column)`.

#### Scenario: Standardize a text column to snake case

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "case", "mode": "snake"}` and `target_column = "category"`
- **THEN** the `as_ibis_expr()` method SHALL return `snake_case(table["category"])` using the Ibis builtin UDF
- **AND** a value of `"Product Name"` SHALL become `"product_name"`

#### Scenario: Snake case display SQL

- **WHEN** `to_display_sql()` is called for a snake case expression with `target_column = "category"`
- **THEN** the result SHALL be `"snake_case(category)"`

#### Scenario: Snake case handles all-uppercase input

- **WHEN** a snake case transform is applied to a column containing `"FIRST NAME"`
- **THEN** the result SHALL be `"first_name"`

#### Scenario: Snake case is idempotent

- **WHEN** a snake case transform is applied to a column containing `"already_snake"`
- **THEN** the result SHALL be `"already_snake"` (unchanged)

#### Scenario: Snake case handles special characters

- **WHEN** a snake case transform is applied to a column containing `"Product #1"`
- **THEN** the result SHALL be `"product_1"`

---

### Requirement: CleaningExpression case kebab operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "case", "mode": "kebab"}` into an Ibis expression using the `kebab_case()` builtin UDF. The expression MUST trim whitespace, lowercase the string, and replace runs of non-alphanumeric characters with single hyphens. The `to_display_sql()` method SHALL return `kebab_case(column)`.

#### Scenario: Standardize a text column to kebab case

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "case", "mode": "kebab"}` and `target_column = "slug"`
- **THEN** the `as_ibis_expr()` method SHALL return `kebab_case(table["slug"])` using the Ibis builtin UDF
- **AND** a value of `"Product Name"` SHALL become `"product-name"`

#### Scenario: Kebab case display SQL

- **WHEN** `to_display_sql()` is called for a kebab case expression with `target_column = "slug"`
- **THEN** the result SHALL be `"kebab_case(slug)"`

#### Scenario: Kebab case handles all-uppercase input

- **WHEN** a kebab case transform is applied to a column containing `"FIRST NAME"`
- **THEN** the result SHALL be `"first-name"`

#### Scenario: Kebab case is idempotent

- **WHEN** a kebab case transform is applied to a column containing `"already-kebab"`
- **THEN** the result SHALL be `"already-kebab"` (unchanged)

#### Scenario: Kebab case handles special characters

- **WHEN** a kebab case transform is applied to a column containing `"Product #1"`
- **THEN** the result SHALL be `"product-1"`

---

### Requirement: Preview endpoint handles snake and kebab modes

The `preview_cleaning_operation()` function in the lake repository SHALL support `mode: "snake"` and `mode: "kebab"` for case operations. The affected-row predicate SHALL compare `col != snake_case(col)` or `col != kebab_case(col)` respectively. The preview samples SHALL show before/after values using the corresponding macro.

#### Scenario: Snake case preview returns affected count and samples

- **WHEN** a preview is requested for `{"operation": "case", "mode": "snake"}` on a column containing `["Product Name", "already_snake", "FIRST NAME"]`
- **THEN** the affected count SHALL be `2` (the two values that change)
- **AND** the samples SHALL show `"Product Name"` -> `"product_name"` and `"FIRST NAME"` -> `"first_name"`
- **AND** `"already_snake"` SHALL NOT appear in the samples (it is unaffected)

#### Scenario: Kebab case preview returns affected count and samples

- **WHEN** a preview is requested for `{"operation": "case", "mode": "kebab"}` on a column containing `["Product Name", "already-kebab", "FIRST NAME"]`
- **THEN** the affected count SHALL be `2`
- **AND** the samples SHALL show `"Product Name"` -> `"product-name"` and `"FIRST NAME"` -> `"first-name"`

#### Scenario: Title case preview uses corrected macro

- **WHEN** a preview is requested for `{"operation": "case", "mode": "title"}` on a column containing `["san francisco", "San Francisco"]`
- **THEN** the affected count SHALL be `1` (only `"san francisco"` changes)
- **AND** the sample SHALL show `"san francisco"` -> `"San Francisco"`

---

### Requirement: Operation description for snake and kebab modes

The `_build_operation_description()` function in the transform use case SHALL return descriptive strings for the snake and kebab modes. For snake mode, the description SHALL be `"Convert to snake_case"`. For kebab mode, the description SHALL be `"Convert to kebab-case"`.

#### Scenario: Snake case operation description

- **WHEN** a transform is created with `{"operation": "case", "mode": "snake"}`
- **THEN** the operation description stored with the transform SHALL be `"Convert to snake_case"`

#### Scenario: Kebab case operation description

- **WHEN** a transform is created with `{"operation": "case", "mode": "kebab"}`
- **THEN** the operation description stored with the transform SHALL be `"Convert to kebab-case"`
