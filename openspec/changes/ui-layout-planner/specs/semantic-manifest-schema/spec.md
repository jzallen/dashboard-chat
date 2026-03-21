## ADDED Requirements

### Requirement: SemanticManifest Pydantic model
The system SHALL provide a `SemanticManifest` Pydantic model that describes available data sources, metrics, dimensions, and relationships in a dbt/MetricFlow-aligned format.

#### Scenario: Parse a valid manifest JSON
- **WHEN** a JSON file conforming to the SemanticManifest schema is loaded
- **THEN** the system SHALL produce a validated SemanticManifest instance with all fields populated

#### Scenario: Reject an invalid manifest
- **WHEN** a JSON file with missing required fields (e.g., no `data_sources`) is loaded
- **THEN** the system SHALL raise a Pydantic ValidationError

### Requirement: DataSource model with typed columns
The system SHALL define a `DataSource` model containing an `id`, `label`, and a list of `Column` entries. Each Column SHALL have an `id`, `label`, `type` (one of "string", "number", "date", "boolean"), and optional `description`.

#### Scenario: DataSource with multiple column types
- **WHEN** a DataSource is defined with columns of types "string", "number", and "date"
- **THEN** each column's type SHALL be validated as one of the allowed literals

### Requirement: Metric model with expression and type
The system SHALL define a `Metric` model with `id`, `label`, `expression` (e.g., "AVG(length_of_stay)"), `type` (one of "simple", "ratio", "cumulative", "derived", defaulting to "simple"), and optional `format` string.

#### Scenario: Metric with default type
- **WHEN** a Metric is created without specifying `type`
- **THEN** the type SHALL default to "simple"

### Requirement: Dimension model with time granularity support
The system SHALL define a `Dimension` model with `id`, `label`, `column_id`, `type` (categorical or time), optional `time_granularity` (day/week/month/quarter/year), and optional `cardinality` (low/medium/high).

#### Scenario: Time dimension with granularity
- **WHEN** a Dimension has type "time" and time_granularity "month"
- **THEN** the Dimension SHALL be valid and represent a monthly time dimension

### Requirement: Relationship model for joins
The system SHALL define a `Relationship` model with `from_source`, `to_source`, `join_key`, and `type` (one_to_many, many_to_one, or one_to_one, defaulting to "many_to_one").

#### Scenario: Default relationship type
- **WHEN** a Relationship is created without specifying `type`
- **THEN** the type SHALL default to "many_to_one"

### Requirement: Round-trip JSON serialization
The system SHALL support round-trip serialization: SemanticManifest → JSON → SemanticManifest with no data loss.

#### Scenario: Serialize and deserialize manifest
- **WHEN** a SemanticManifest is serialized to JSON and then deserialized back
- **THEN** the resulting model SHALL be equal to the original
