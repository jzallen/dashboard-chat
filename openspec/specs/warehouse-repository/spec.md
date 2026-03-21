## Purpose

Defines the warehouse repository abstraction for semantic data queries, aligned with MetricFlow conventions. Includes a hardcoded implementation for development.

## Requirements

### Requirement: SemanticQuery model
The system SHALL define a `SemanticQuery` Pydantic model with `metrics` (list of metric ids), `group_by` (list of dimension ids, optional grain suffix), `where` (list of SQL-like filter strings), `order_by` (list of strings, prefix "-" for descending), and optional `limit`.

#### Scenario: Query with metrics and grouping
- **WHEN** a SemanticQuery is created with metrics ["revenue"] and group_by ["region"]
- **THEN** the query SHALL be valid

#### Scenario: Query with descending order
- **WHEN** a SemanticQuery has order_by ["-revenue"]
- **THEN** the "-" prefix SHALL indicate descending order

### Requirement: SemanticQueryResult model
The system SHALL define a `SemanticQueryResult` Pydantic model with `columns` (list of ColumnMetadata), `rows` (list of dicts), and optional `generated_sql`.

#### Scenario: Result with typed columns
- **WHEN** a query returns results
- **THEN** each column in the result SHALL have `name`, `type` (metric/dimension/time_dimension), and `data_type` (string/number/date/boolean)

### Requirement: WarehouseRepository abstract interface
The system SHALL define an abstract `WarehouseRepository` class with two async methods: `query(SemanticQuery) -> SemanticQueryResult` and `list_dimension_values(dimension_id, limit) -> list[str]`.

#### Scenario: Interface contract
- **WHEN** a class implements WarehouseRepository
- **THEN** it MUST provide implementations of both `query` and `list_dimension_values`

### Requirement: HardcodedWarehouseRepository for development
The system SHALL provide a `HardcodedWarehouseRepository` that implements `WarehouseRepository` and returns synthetic data based on manifest field types. It SHALL be initialized with a `SemanticManifest`.

#### Scenario: Query returns synthetic rows
- **WHEN** the hardcoded warehouse receives a SemanticQuery with metrics and group_by
- **THEN** it SHALL return a SemanticQueryResult with synthetic rows containing appropriate data types for each requested field

#### Scenario: List dimension values
- **WHEN** `list_dimension_values` is called for a categorical dimension
- **THEN** it SHALL return a list of synthetic string values up to the specified limit
