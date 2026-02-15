# Capability: cleaning-sql-generation

Ibis expression builder that converts `expression_config` JSON into column-level SELECT expressions, and the `_build_table()` pipeline extension (mutate -> filter -> rename).

## ADDED Requirements

### Requirement: CleaningExpression trim operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "trim"}` into an Ibis column expression equivalent to `TRIM(column)`. The expression MUST strip both leading and trailing whitespace from the target column's values.

#### Scenario: Trim whitespace from a text column

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "trim"}` and `target_column = "name"`
- **THEN** the generated Ibis expression SHALL produce SQL equivalent to `TRIM(name)` and the column values in the result set SHALL have leading and trailing whitespace removed

#### Scenario: Trim on a column with no whitespace

- **WHEN** a trim transform is applied to a column where no values contain leading or trailing whitespace
- **THEN** the generated SQL SHALL still include the `TRIM()` expression and all values SHALL remain unchanged

---

### Requirement: CleaningExpression case upper operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "case", "mode": "upper"}` into an Ibis column expression equivalent to `UPPER(column)`.

#### Scenario: Standardize a text column to upper case

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "case", "mode": "upper"}` and `target_column = "status"`
- **THEN** the generated Ibis expression SHALL produce SQL equivalent to `UPPER(status)` and all text values in the column SHALL be converted to uppercase

---

### Requirement: CleaningExpression case lower operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "case", "mode": "lower"}` into an Ibis column expression equivalent to `LOWER(column)`.

#### Scenario: Standardize a text column to lower case

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "case", "mode": "lower"}` and `target_column = "email"`
- **THEN** the generated Ibis expression SHALL produce SQL equivalent to `LOWER(email)` and all text values in the column SHALL be converted to lowercase

---

### Requirement: CleaningExpression case title operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "case", "mode": "title"}` into an Ibis column expression equivalent to `INITCAP(column)`. The expression MUST capitalize the first letter of each word.

#### Scenario: Standardize a text column to title case

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "case", "mode": "title"}` and `target_column = "city"`
- **THEN** the generated Ibis expression SHALL produce SQL equivalent to `INITCAP(city)` and multi-word values like `"new york"` SHALL become `"New York"`

---

### Requirement: CleaningExpression fill_null operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "fill_null", "fill_value": "<value>"}` into an Ibis column expression equivalent to `COALESCE(column, '<value>')`. The `fill_value` MUST be treated as a literal value, never as a SQL fragment.

#### Scenario: Fill null values with a string

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "fill_null", "fill_value": "Unknown"}` and `target_column = "department"`
- **THEN** the generated Ibis expression SHALL produce SQL equivalent to `COALESCE(department, 'Unknown')` and NULL values in the column SHALL be replaced with `"Unknown"`

#### Scenario: Fill null values with a numeric value

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "fill_null", "fill_value": 0}` and `target_column = "salary"`
- **THEN** the generated Ibis expression SHALL produce SQL equivalent to `COALESCE(salary, 0)` and NULL values in the column SHALL be replaced with `0`

#### Scenario: Fill value containing SQL-special characters is safe

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "fill_null", "fill_value": "O'Brien; DROP TABLE"}` and `target_column = "name"`
- **THEN** the `fill_value` SHALL be treated as a literal string by Ibis and SHALL NOT be interpreted as SQL

---

### Requirement: CleaningExpression map_values operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "map_values", "mappings": [{"from": "<old>", "to": "<new>"}, ...]}` into an Ibis CASE expression equivalent to `CASE WHEN column = '<old>' THEN '<new>' ... ELSE column END`. Mappings MUST use exact match comparison. Unmapped values MUST pass through unchanged via the ELSE clause.

#### Scenario: Map a single value

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "map_values", "mappings": [{"from": "NY", "to": "New York"}]}` and `target_column = "state"`
- **THEN** the generated Ibis expression SHALL produce SQL equivalent to `CASE WHEN state = 'NY' THEN 'New York' ELSE state END`

#### Scenario: Map multiple values

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "map_values", "mappings": [{"from": "NY", "to": "New York"}, {"from": "CA", "to": "California"}]}` and `target_column = "state"`
- **THEN** the generated Ibis expression SHALL produce SQL equivalent to `CASE WHEN state = 'NY' THEN 'New York' WHEN state = 'CA' THEN 'California' ELSE state END`

#### Scenario: Value mapping uses exact match only

- **WHEN** a map_values transform maps `"NY"` to `"New York"` on the `state` column
- **THEN** cells containing exactly `"NY"` SHALL be replaced, and cells containing `"NYC"` or `"NY State"` SHALL NOT be affected

#### Scenario: Value mapping with empty mappings list

- **WHEN** a cleaning transform exists with `expression_config = {"operation": "map_values", "mappings": []}` and `target_column = "state"`
- **THEN** the expression SHALL be equivalent to returning the column unchanged (identity expression)

---

### Requirement: CleaningExpression alias operation

The `CleaningExpression` builder SHALL convert an `expression_config` with `{"operation": "alias", "alias": "<display_name>"}` into a column rename, not a mutate expression. Alias transforms MUST be handled in the RENAME stage of `_build_table()` via Ibis `.rename()`, producing SQL equivalent to `column AS "<display_name>"`.

#### Scenario: Rename a column with an alias

- **WHEN** an alias transform exists with `expression_config = {"operation": "alias", "alias": "Employee ID"}` and `target_column = "emp_id"`
- **THEN** the generated SQL SHALL include `emp_id AS "Employee ID"` and the result set column SHALL be named `"Employee ID"`

#### Scenario: Alias does not affect mutate stage

- **WHEN** an alias transform exists for a column
- **THEN** the alias SHALL NOT be applied during the MUTATE stage and other transforms referencing the column SHALL continue to use the original column name

---

### Requirement: Three-stage pipeline order in _build_table()

The `_build_table()` method SHALL apply transforms in a fixed three-stage pipeline: (1) MUTATE -- apply cleaning transforms as column expressions via Ibis `.mutate()`, (2) FILTER -- apply filter transforms as WHERE clauses via Ibis `.filter()` (existing behavior), (3) RENAME -- apply alias transforms as column renames via Ibis `.rename()`. This order MUST be deterministic and MUST NOT vary based on transform `created_at` timestamps or insertion order across stages.

#### Scenario: Mutate executes before filter

- **WHEN** a dataset has a cleaning transform that trims the `name` column AND a filter transform that matches `name = 'Alice'`
- **THEN** the filter SHALL operate on the trimmed value, so a row with `name = ' Alice '` SHALL be trimmed to `'Alice'` first and then SHALL match the filter

#### Scenario: Rename executes after filter

- **WHEN** a dataset has an alias transform renaming `emp_id` to `"Employee ID"` AND a filter transform on `emp_id > 100`
- **THEN** the filter SHALL reference `emp_id` (the original column name) and the rename SHALL apply after filtering, so the output column is named `"Employee ID"`

#### Scenario: Full three-stage pipeline

- **WHEN** a dataset has a trim transform on `name`, a filter on `name = 'Alice'`, and an alias renaming `name` to `"Full Name"`
- **THEN** the pipeline SHALL (1) trim the `name` column, (2) filter rows where trimmed `name = 'Alice'`, (3) rename `name` to `"Full Name"` in the output

---

### Requirement: Ordering within the mutate stage

When multiple cleaning transforms target the same column, they MUST be applied in `created_at` ascending order. Each mutate SHALL replace the column value, so subsequent transforms in the sequence SHALL operate on the already-transformed value from the preceding transform.

#### Scenario: Trim then title case on the same column

- **WHEN** two cleaning transforms exist on the `name` column: a trim transform created at `T1` and a title case transform created at `T2` where `T1 < T2`
- **THEN** the trim SHALL be applied first, followed by title case, such that `" john doe "` becomes `"john doe"` (after trim) then `"John Doe"` (after title case)

#### Scenario: Reverse creation order produces different result

- **WHEN** two cleaning transforms exist on the `name` column: a title case transform created at `T1` and a trim transform created at `T2` where `T1 < T2`
- **THEN** the title case SHALL be applied first, followed by trim, such that `" john doe "` becomes `" John Doe "` (after title case) then `"John Doe"` (after trim)

#### Scenario: Transforms on different columns are independent

- **WHEN** a trim transform exists on the `name` column and an upper transform exists on the `status` column
- **THEN** the two transforms SHALL be applied independently and their `created_at` ordering relative to each other SHALL NOT affect each other's result

---

### Requirement: Composability of cleaning and filter transforms

Cleaning transforms and filter transforms SHALL coexist independently. Adding a cleaning transform MUST NOT alter, remove, or interfere with existing filter transforms. Adding a filter transform MUST NOT alter, remove, or interfere with existing cleaning transforms. Filters SHALL operate on the cleaned (post-mutate) column values.

#### Scenario: Filter operates on cleaned values

- **WHEN** a dataset has a cleaning transform that uppercases the `status` column AND a filter transform that matches `status = 'ACTIVE'`
- **THEN** a row with raw value `status = 'active'` SHALL match the filter because the mutate stage uppercases it to `'ACTIVE'` before the filter stage evaluates

#### Scenario: Adding a cleaning transform does not affect existing filters

- **WHEN** a dataset has an active filter transform on the `status` column
- **THEN** adding a cleaning transform on any column SHALL NOT modify, disable, or remove the existing filter transform

#### Scenario: Disabling a cleaning transform does not affect filters

- **WHEN** a dataset has both a cleaning transform and a filter transform on the `status` column
- **THEN** disabling the cleaning transform SHALL leave the filter transform active and unmodified, though the filter will now operate on the raw (uncleaned) column values

---

### Requirement: Existing filter behavior unchanged

The addition of the cleaning transform pipeline MUST NOT change the behavior of existing filter-only datasets. When a dataset has no cleaning or alias transforms, the `_build_table()` method MUST produce identical SQL output to the pre-change implementation. The MUTATE and RENAME stages SHALL be no-ops when no cleaning or alias transforms are active.

#### Scenario: Filter-only dataset produces identical SQL

- **WHEN** a dataset has only filter transforms (no cleaning, no alias transforms)
- **THEN** the `staging_sql` and `display_sql` output SHALL be identical to the output produced by the pre-change `_build_table()` implementation

#### Scenario: Dataset with no transforms produces identical SQL

- **WHEN** a dataset has no transforms of any type
- **THEN** the `staging_sql` and `display_sql` output SHALL be a plain SELECT of all columns with no WHERE, MUTATE, or RENAME clauses

---

### Requirement: SQL output correctness for staging_sql and display_sql

Both the `staging_sql` and `display_sql` properties MUST reflect all active cleaning, filter, and alias transforms. The `staging_sql` SHALL include the compact S3 path form. The `display_sql` SHALL include the human-readable dataset name and alias. Both SHALL include SELECT expressions from cleaning transforms, WHERE clauses from filter transforms, and column aliases from alias transforms.

#### Scenario: staging_sql includes cleaning expressions

- **WHEN** a dataset has an active trim transform on the `name` column
- **THEN** the `staging_sql` output SHALL include a SELECT expression equivalent to `TRIM(name)` rather than a plain `name` column reference

#### Scenario: display_sql includes cleaning expressions

- **WHEN** a dataset has an active trim transform on the `name` column
- **THEN** the `display_sql` output SHALL include a SELECT expression equivalent to `TRIM(name)` and SHALL use the human-readable dataset name and alias

#### Scenario: SQL output includes alias renames

- **WHEN** a dataset has an active alias transform renaming `emp_id` to `"Employee ID"`
- **THEN** both `staging_sql` and `display_sql` SHALL include `emp_id AS "Employee ID"` (or equivalent Ibis-generated rename syntax) in the output

#### Scenario: SQL output reflects combined cleaning, filter, and alias

- **WHEN** a dataset has a trim transform on `name`, a filter on `status = 'ACTIVE'`, and an alias renaming `name` to `"Full Name"`
- **THEN** both `staging_sql` and `display_sql` SHALL include the trim expression in the SELECT, the filter in the WHERE clause, and the alias in the column output

---

### Requirement: Invalid expression_config handling

The `CleaningExpression` builder SHALL reject invalid `expression_config` JSON gracefully. An `expression_config` missing the `operation` field, containing an unrecognized `operation` value, or missing required fields for a given operation MUST raise a descriptive error. The error MUST NOT produce a partial or incorrect SQL expression.

#### Scenario: Missing operation field

- **WHEN** a cleaning transform has `expression_config = {}` (no `operation` key)
- **THEN** the `CleaningExpression` builder SHALL raise an error indicating that the `operation` field is required

#### Scenario: Unrecognized operation value

- **WHEN** a cleaning transform has `expression_config = {"operation": "reverse"}`
- **THEN** the `CleaningExpression` builder SHALL raise an error indicating that `"reverse"` is not a supported operation

#### Scenario: Case operation missing mode field

- **WHEN** a cleaning transform has `expression_config = {"operation": "case"}` (no `mode` key)
- **THEN** the `CleaningExpression` builder SHALL raise an error indicating that the `mode` field is required for the `case` operation

#### Scenario: Case operation with invalid mode value

- **WHEN** a cleaning transform has `expression_config = {"operation": "case", "mode": "reverse"}`
- **THEN** the `CleaningExpression` builder SHALL raise an error indicating that `"reverse"` is not a valid case mode and SHALL list the valid modes (`upper`, `lower`, `title`)

#### Scenario: fill_null operation missing fill_value field

- **WHEN** a cleaning transform has `expression_config = {"operation": "fill_null"}` (no `fill_value` key)
- **THEN** the `CleaningExpression` builder SHALL raise an error indicating that the `fill_value` field is required for the `fill_null` operation

#### Scenario: map_values operation missing mappings field

- **WHEN** a cleaning transform has `expression_config = {"operation": "map_values"}` (no `mappings` key)
- **THEN** the `CleaningExpression` builder SHALL raise an error indicating that the `mappings` field is required for the `map_values` operation

#### Scenario: alias operation missing alias field

- **WHEN** a cleaning transform has `expression_config = {"operation": "alias"}` (no `alias` key)
- **THEN** the `CleaningExpression` builder SHALL raise an error indicating that the `alias` field is required for the `alias` operation

#### Scenario: Invalid expression_config does not corrupt pipeline

- **WHEN** a dataset has one valid cleaning transform and one with invalid `expression_config`
- **THEN** the `_build_table()` method SHALL raise an error rather than silently skipping the invalid transform or producing partial SQL

---

### Requirement: Disabled transforms excluded from pipeline

Only transforms with `is_enabled = True` SHALL be included in the `_build_table()` pipeline. Disabled cleaning, filter, and alias transforms MUST be excluded from all three stages. This is consistent with the existing behavior for filter transforms.

#### Scenario: Disabled cleaning transform is skipped

- **WHEN** a dataset has a cleaning transform with `is_enabled = False`
- **THEN** the MUTATE stage SHALL NOT apply that transform and the SQL output SHALL not include its expression

#### Scenario: Disabled alias transform is skipped

- **WHEN** a dataset has an alias transform with `is_enabled = False`
- **THEN** the RENAME stage SHALL NOT apply that alias and the output column SHALL retain its original name

#### Scenario: Mix of enabled and disabled transforms

- **WHEN** a dataset has two cleaning transforms on the same column, one enabled and one disabled
- **THEN** only the enabled transform SHALL be applied in the MUTATE stage
