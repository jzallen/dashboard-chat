# transform-preview Specification

## Purpose
TBD - created by archiving change data-cleaning-transforms. Update Purpose after archive.
## Requirements
### Requirement: Preview Endpoint Contract

The system SHALL expose a `POST /api/datasets/{dataset_id}/transforms/preview` endpoint that accepts a JSON request body containing `transform_type` (string), `target_column` (string), and `expression_config` (object). The endpoint SHALL return a JSON response containing `affected_count` (integer), `total_count` (integer), `samples` (array of `{before, after}` objects), `column` (string), and `operation_description` (string). The `column` field in the response MUST echo the `target_column` from the request. The `operation_description` MUST be a human-readable summary of the proposed transform (e.g., "Trim whitespace from Name" or "Convert City to title case").

#### Scenario: Successful preview request returns complete response shape

- **WHEN** a valid preview request is submitted with `transform_type: "clean"`, `target_column: "Name"`, and `expression_config: {"operation": "trim"}`
- **THEN** the endpoint returns HTTP 200 with a JSON body containing all required fields: `affected_count` (integer >= 0), `total_count` (integer > 0), `samples` (array of objects each with `before` and `after` keys), `column` equal to `"Name"`, and `operation_description` (non-empty string)

#### Scenario: Preview request with unknown transform_type is rejected

- **WHEN** a preview request is submitted with `transform_type: "unknown_op"` and otherwise valid fields
- **THEN** the endpoint returns HTTP 400 with an error message indicating the transform type is not supported for preview

---

### Requirement: Trim Preview Behavior

When the preview operation is `trim`, the endpoint SHALL count a row as affected if the column value differs from the trimmed version of that value (i.e., `value != TRIM(value)`). Each sample pair MUST show the original value as `before` and the whitespace-stripped value as `after`.

#### Scenario: Trim preview identifies rows with leading or trailing whitespace

- **WHEN** a preview request is submitted for a `trim` operation on a text column containing values `"  Alice  "`, `"Bob"`, `" Carol"`, and `"Dave "`
- **THEN** the response `affected_count` is 3 (Alice, Carol, Dave)
- **THEN** the `samples` array contains pairs such as `{before: "  Alice  ", after: "Alice"}` showing whitespace removal

#### Scenario: Trim preview on a column with no whitespace issues

- **WHEN** a preview request is submitted for a `trim` operation on a text column where all values are already trimmed
- **THEN** the response `affected_count` is 0
- **THEN** the `samples` array is empty

---

### Requirement: Case Standardization Preview Behavior

When the preview operation is `case` with a `mode` of `title`, `upper`, or `lower`, the endpoint SHALL count a row as affected if the column value differs from the case-converted version. Samples MUST show the original value as `before` and the case-converted value as `after`.

#### Scenario: Title case preview identifies non-title-cased values

- **WHEN** a preview request is submitted with `expression_config: {"operation": "case", "mode": "title"}` on a column containing `"new york"`, `"New York"`, and `"LOS ANGELES"`
- **THEN** the `affected_count` is 2 (`"new york"` and `"LOS ANGELES"`)
- **THEN** the `samples` array contains pairs such as `{before: "new york", after: "New York"}`

#### Scenario: Upper case preview identifies non-uppercased values

- **WHEN** a preview request is submitted with `expression_config: {"operation": "case", "mode": "upper"}` on a column containing `"Active"`, `"ACTIVE"`, and `"pending"`
- **THEN** the `affected_count` is 2 (`"Active"` and `"pending"`)
- **THEN** the `samples` array contains pairs such as `{before: "Active", after: "ACTIVE"}`

#### Scenario: Lower case preview identifies non-lowercased values

- **WHEN** a preview request is submitted with `expression_config: {"operation": "case", "mode": "lower"}` on a column containing `"Email@Test.COM"` and `"already@lower.com"`
- **THEN** the `affected_count` is 1
- **THEN** the `samples` array contains `{before: "Email@Test.COM", after: "email@test.com"}`

---

### Requirement: Fill Null Preview Behavior

When the preview operation is `fill_null`, the endpoint SHALL count a row as affected if the column value is NULL or an empty string (`''`). Each sample pair MUST show `null` (or the empty string) as `before` and the configured `fill_value` as `after`.

#### Scenario: Fill null preview counts null and empty cells

- **WHEN** a preview request is submitted with `expression_config: {"operation": "fill_null", "fill_value": "Unknown"}` on a column containing `null`, `""`, `"Sales"`, and `null`
- **THEN** the `affected_count` is 3 (two nulls and one empty string)
- **THEN** the `samples` array contains pairs such as `{before: null, after: "Unknown"}`

#### Scenario: Fill null preview on a column with no missing values

- **WHEN** a preview request is submitted for a `fill_null` operation on a column where every row has a non-null, non-empty value
- **THEN** the `affected_count` is 0
- **THEN** the `samples` array is empty

---

### Requirement: Map Values Preview Behavior

When the preview operation is `map_values`, the endpoint SHALL count a row as affected if the column value exactly matches any of the source values in the `mappings` array. Each sample pair MUST show the original value as `before` and the mapped replacement as `after`. Only exact matches SHALL be counted; partial or substring matches MUST NOT be included.

#### Scenario: Map values preview identifies exact matches

- **WHEN** a preview request is submitted with `expression_config: {"operation": "map_values", "mappings": [{"from": "NY", "to": "New York"}, {"from": "CA", "to": "California"}]}` on a column containing `"NY"`, `"NYC"`, `"CA"`, `"NY State"`, and `"TX"`
- **THEN** the `affected_count` is 2 (`"NY"` and `"CA"` only)
- **THEN** the `samples` array contains pairs such as `{before: "NY", after: "New York"}` and `{before: "CA", after: "California"}`
- **THEN** `"NYC"` and `"NY State"` are NOT counted as affected

#### Scenario: Map values preview with no matching rows

- **WHEN** a preview request is submitted with `expression_config: {"operation": "map_values", "mappings": [{"from": "ZZ", "to": "Unknown"}]}` on a column that contains no cells with the value `"ZZ"`
- **THEN** the `affected_count` is 0
- **THEN** the `samples` array is empty

---

### Requirement: Alias Operations Do Not Support Preview

The endpoint SHALL reject preview requests where the operation is `alias` because alias transforms (column renames) do not modify cell data and therefore have no meaningful before/after impact to preview. The endpoint MUST return an HTTP 400 response indicating that alias operations do not support preview.

#### Scenario: Preview request for alias operation is rejected

- **WHEN** a preview request is submitted with `expression_config: {"operation": "alias", "alias": "Employee ID"}` and `target_column: "emp_id"`
- **THEN** the endpoint returns HTTP 400
- **THEN** the error message indicates that alias operations do not require or support preview

---

### Requirement: Sample Generation Limit

The endpoint SHALL return at most 5 before/after sample pairs in the `samples` array, regardless of how many rows are affected. When more than 5 rows are affected, the endpoint MUST select a representative subset of 5 pairs. The `affected_count` MUST still reflect the true count of all affected rows, not just the number of samples returned.

#### Scenario: Large dataset returns at most 5 samples

- **WHEN** a preview request is submitted for a `trim` operation on a column where 500 rows have leading or trailing whitespace
- **THEN** the `affected_count` is 500
- **THEN** the `samples` array contains exactly 5 before/after pairs

#### Scenario: Small affected set returns all affected rows as samples

- **WHEN** a preview request is submitted for a `trim` operation on a column where 3 rows have whitespace issues
- **THEN** the `affected_count` is 3
- **THEN** the `samples` array contains exactly 3 before/after pairs

#### Scenario: Zero affected rows returns empty samples

- **WHEN** a preview request is submitted for an operation that matches no rows
- **THEN** the `affected_count` is 0
- **THEN** the `samples` array is empty (length 0)

---

### Requirement: Affected Count Accuracy

The `affected_count` field MUST reflect the exact number of rows in the dataset where the column value would change if the proposed transform were applied. The `total_count` field MUST reflect the total number of rows in the dataset. The affected count MUST be computed via a DuckDB query against the Parquet data, not estimated or approximated.

#### Scenario: Affected count matches actual data changes

- **WHEN** a preview request is submitted for a `trim` operation on a column in a dataset with 1000 total rows, of which 42 have whitespace
- **THEN** the `affected_count` is 42
- **THEN** the `total_count` is 1000

#### Scenario: Total count reflects full dataset size

- **WHEN** a preview request is submitted for any operation on a dataset with 10,000 rows
- **THEN** the `total_count` is 10,000 regardless of how many rows are affected

---

### Requirement: Type Mismatch Rejection

The endpoint SHALL return HTTP 422 when a text-only operation (`trim`, `case`) is requested against a non-text column (numeric, date, boolean, etc.). The error response MUST indicate which column was targeted, its actual type, and that the operation requires a text column.

#### Scenario: Trim on a numeric column returns 422

- **WHEN** a preview request is submitted with `expression_config: {"operation": "trim"}` and `target_column` pointing to an integer or float column
- **THEN** the endpoint returns HTTP 422
- **THEN** the error message indicates that the trim operation applies only to text columns and identifies the column's actual type

#### Scenario: Case standardization on a date column returns 422

- **WHEN** a preview request is submitted with `expression_config: {"operation": "case", "mode": "upper"}` and `target_column` pointing to a date or timestamp column
- **THEN** the endpoint returns HTTP 422
- **THEN** the error message indicates that case operations apply only to text columns

#### Scenario: Fill null on a numeric column with a valid numeric value succeeds

- **WHEN** a preview request is submitted with `expression_config: {"operation": "fill_null", "fill_value": 0}` on a numeric column containing null values
- **THEN** the endpoint returns HTTP 200 with a valid preview response (fill_null is not restricted to text columns)

---

### Requirement: Authorization via Org ID Scoping

The endpoint MUST enforce the same authorization rules as other transform endpoints. Access SHALL be verified by resolving the dataset's parent project and confirming that the requesting user's `org_id` matches the project's `org_id`. Unauthorized access MUST result in an HTTP 403 response.

#### Scenario: User in the correct org receives a preview

- **WHEN** an authenticated user whose `org_id` matches the dataset's parent project `org_id` submits a valid preview request
- **THEN** the endpoint returns HTTP 200 with the preview response

#### Scenario: User in a different org is denied access

- **WHEN** an authenticated user whose `org_id` does NOT match the dataset's parent project `org_id` submits a preview request
- **THEN** the endpoint returns HTTP 403
- **THEN** no data from the dataset is included in the response

#### Scenario: Dataset not found returns 404

- **WHEN** a preview request is submitted with a `dataset_id` that does not exist
- **THEN** the endpoint returns HTTP 404

---

### Requirement: Read-Only Guarantee

The preview endpoint MUST NOT create, modify, or delete any transforms, dataset records, or stored data. It MUST NOT write to the metadata database or modify any Parquet files. The operation MUST be purely read-only: querying existing data via DuckDB to compute the preview result. After a preview request completes, the system state MUST be identical to what it was before the request.

#### Scenario: Preview does not create a transform record

- **WHEN** a preview request is submitted and returns a successful response
- **THEN** no new transform record exists in the metadata database
- **THEN** the count of transforms for the dataset is unchanged

#### Scenario: Preview does not modify Parquet data

- **WHEN** a preview request is submitted against a dataset
- **THEN** the Parquet file's content and modification timestamp remain unchanged

#### Scenario: Repeated preview requests produce identical results

- **WHEN** the same preview request is submitted twice in succession with no intervening state changes
- **THEN** both responses contain identical `affected_count`, `total_count`, `samples`, and `operation_description` values

---

### Requirement: Invalid Configuration Rejection

The endpoint SHALL return HTTP 400 when the `expression_config` is structurally invalid or missing required fields for the given operation. This includes missing `mode` for `case` operations, missing `fill_value` for `fill_null` operations, missing or empty `mappings` for `map_values` operations, and referencing a `target_column` that does not exist in the dataset.

#### Scenario: Case operation without mode is rejected

- **WHEN** a preview request is submitted with `expression_config: {"operation": "case"}` (missing `mode`)
- **THEN** the endpoint returns HTTP 400
- **THEN** the error message indicates that the `mode` field is required for case operations

#### Scenario: Fill null without fill_value is rejected

- **WHEN** a preview request is submitted with `expression_config: {"operation": "fill_null"}` (missing `fill_value`)
- **THEN** the endpoint returns HTTP 400
- **THEN** the error message indicates that `fill_value` is required

#### Scenario: Map values with empty mappings array is rejected

- **WHEN** a preview request is submitted with `expression_config: {"operation": "map_values", "mappings": []}`
- **THEN** the endpoint returns HTTP 400
- **THEN** the error message indicates that at least one mapping is required

#### Scenario: Non-existent target column is rejected

- **WHEN** a preview request is submitted with `target_column: "nonexistent_column"` referencing a column not present in the dataset
- **THEN** the endpoint returns HTTP 400
- **THEN** the error message identifies the column as not found in the dataset schema

---

### Requirement: DuckDB/Parquet Query Execution

All preview computations MUST be performed via the lake repository pattern, querying Parquet files through DuckDB. The endpoint MUST NOT load full datasets into application memory. Column type detection for type mismatch validation MUST be derived from the Parquet schema via DuckDB, not from stored metadata alone.

#### Scenario: Preview queries execute against Parquet via DuckDB

- **WHEN** a preview request is submitted for a dataset whose data is stored as a Parquet file
- **THEN** the affected count and sample pairs are computed by querying the Parquet file through DuckDB
- **THEN** the query leverages Parquet column pruning (only the target column is read)

#### Scenario: Column type is resolved from Parquet schema

- **WHEN** a preview request targets a column whose type needs validation (e.g., trim on a potentially numeric column)
- **THEN** the column's data type is determined from the Parquet file schema via DuckDB, ensuring accuracy even if metadata is stale

