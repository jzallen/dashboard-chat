## Purpose

Describes how Reports carry column-level semantic metadata — the `columns_metadata` JSON array that tags each column with a semantic role (entity / dimension / measure), type, and optional expression. It is the data backbone for MetricFlow-style semantic layers and AI-assisted semantic suggestions.

## Requirements

### Requirement: Column Semantic Metadata Structure

The system SHALL support column-level semantic metadata on Reports, stored as a JSON array in the `columns_metadata` field.

- Each column entry SHALL have: `name` (string, required), `semantic_role` (enum, required), `semantic_type` (enum, required), `description` (string, optional), `expr` (string, optional).
- The `semantic_role` field SHALL accept: `"entity"`, `"dimension"`, or `"measure"`.
- Entity `semantic_type` values SHALL be: `"primary"`, `"foreign"`, `"unique"`.
- Dimension `semantic_type` values SHALL be: `"categorical"`, `"time"`.
- Measure `semantic_type` values SHALL be: `"sum"`, `"count"`, `"count_distinct"`, `"avg"`, `"min"`, `"max"`.
- Columns with `semantic_type: "time"` SHALL additionally have a `time_granularity` field with values: `"day"`, `"week"`, `"month"`, `"quarter"`, `"year"`.

#### Scenario: Fact Report with full column metadata

- **WHEN** a Report "Orders" has columns_metadata:
  ```json
  [
    {"name": "order_id", "semantic_role": "entity", "semantic_type": "primary"},
    {"name": "customer_id", "semantic_role": "entity", "semantic_type": "foreign"},
    {"name": "order_date", "semantic_role": "dimension", "semantic_type": "time", "time_granularity": "day"},
    {"name": "region", "semantic_role": "dimension", "semantic_type": "categorical"},
    {"name": "amount", "semantic_role": "measure", "semantic_type": "sum"}
  ]
  ```
- **THEN** the system SHALL accept and store all five column entries with their metadata

#### Scenario: Column with optional fields

- **WHEN** a column entry has `description: "Total order value"` and `expr: "order_total - discount"`
- **THEN** the system SHALL store both optional fields

---

### Requirement: Column Metadata Validation

The system SHALL validate column metadata consistency when creating or updating a Report.

- The `semantic_type` SHALL be valid for the given `semantic_role` (e.g., `"sum"` is only valid for `"measure"` role).
- The `time_granularity` field SHALL be required when `semantic_type` is `"time"` and ignored otherwise.
- If validation fails, the system SHALL return 400 with detail describing the invalid column entry.
- Column metadata is optional — a Report with an empty `columns_metadata` array SHALL be valid.

#### Scenario: Invalid semantic_type for role

- **WHEN** a column entry has `semantic_role: "dimension"` and `semantic_type: "sum"`
- **THEN** the system SHALL return 400 with detail indicating `"sum"` is not valid for dimension role

#### Scenario: Missing time_granularity for time dimension

- **WHEN** a column entry has `semantic_type: "time"` without `time_granularity`
- **THEN** the system SHALL return 400 with detail indicating `time_granularity` is required

#### Scenario: Report without column metadata

- **WHEN** a Report is created with `columns_metadata: []`
- **THEN** the creation SHALL succeed

---

### Requirement: Column Metadata in schema.yml Export

The system SHALL include column semantic metadata in the exported `schema.yml` for Reports that have `columns_metadata` populated.

- Each Report with `columns_metadata` SHALL appear as a model entry in `schema.yml` with column definitions.
- Entity columns SHALL include a `meta` section with `semantic_role: entity` and `semantic_type`.
- Dimension columns SHALL include `meta` with role, type, and `time_granularity` (if time dimension).
- Measure columns SHALL include `meta` with role and type (aggregation method).
- Reports without `columns_metadata` SHALL still appear in `schema.yml` but with an empty `columns` list.
- The `expr` field, if present, SHALL be included in the column's meta section.

#### Scenario: schema.yml with semantic column metadata

- **WHEN** a Report "Orders" has a column `amount` with `semantic_role: "measure"`, `semantic_type: "sum"`
- **THEN** the `schema.yml` entry for `fct_orders` SHALL include:
  ```yaml
  columns:
    - name: amount
      meta:
        semantic_role: measure
        semantic_type: sum
  ```

#### Scenario: Time dimension includes granularity

- **WHEN** a column `order_date` has `semantic_type: "time"` and `time_granularity: "day"`
- **THEN** the `schema.yml` column entry SHALL include `time_granularity: day` in the meta section

#### Scenario: Report without metadata in schema.yml

- **WHEN** a Report has empty `columns_metadata`
- **THEN** the `schema.yml` model entry SHALL have an empty `columns` list

---

### Requirement: AI Semantic Role Suggestions

The AI chat system SHALL suggest semantic roles for Report columns based on column names and types.

- Columns ending in `_id` SHALL be suggested as `entity` role.
- Columns ending in `_at`, `_date`, or `_timestamp` SHALL be suggested as `dimension` with `semantic_type: "time"`.
- Numeric columns not ending in `_id` SHALL be suggested as `measure` candidates.
- String/categorical columns SHALL be suggested as `dimension` with `semantic_type: "categorical"`.
- Suggestions SHALL be presented to the user for confirmation, not auto-applied.

#### Scenario: AI suggests entity role for ID column

- **WHEN** the AI analyzes a Report column named `customer_id`
- **THEN** the AI SHALL suggest `semantic_role: "entity"`, `semantic_type: "foreign"`

#### Scenario: AI suggests time dimension for date column

- **WHEN** the AI analyzes a Report column named `created_at`
- **THEN** the AI SHALL suggest `semantic_role: "dimension"`, `semantic_type: "time"`, `time_granularity: "day"`
