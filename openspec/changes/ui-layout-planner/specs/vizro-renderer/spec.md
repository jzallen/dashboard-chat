## ADDED Requirements

### Requirement: Vizro builder converts DashboardPlan to Vizro Dashboard
The system SHALL provide a `build_vizro_dashboard` function that deterministically converts a `DashboardPlan` and `SemanticManifest` into a `vizro.models.Dashboard`. The conversion SHALL be pure code with no LLM calls.

#### Scenario: Single-page dashboard
- **WHEN** a DashboardPlan with sections and filters is converted
- **THEN** the result SHALL be a Vizro Dashboard with one Page containing all components and controls

#### Scenario: Grid layout mapping
- **WHEN** a SectionPlan has a grid matrix [[0, 1], [2, 3]]
- **THEN** the Vizro Page layout SHALL reflect the same grid arrangement

### Requirement: Chart function registry
The system SHALL provide a registry of Plotly figure builder functions mapping chart_type strings to functions that accept a DataFrame and chart parameters and return Plotly figures. Supported types: bar, line, area, scatter, pie, histogram, kpi_card.

#### Scenario: Bar chart function
- **WHEN** the bar chart function receives a DataFrame with x and y columns
- **THEN** it SHALL return a plotly.graph_objects.Figure with a bar trace

#### Scenario: KPI card function
- **WHEN** the kpi_card function receives a DataFrame and metric_id
- **THEN** it SHALL return a figure displaying the metric value with label

### Requirement: Data manager registers warehouse queries
The system SHALL provide a `register_data_sources` function that registers warehouse queries as Vizro data manager functions. Each data source in the manifest SHALL be registered so Vizro components can load data on demand.

#### Scenario: Data source registration
- **WHEN** register_data_sources is called with a warehouse and manifest
- **THEN** each manifest data source SHALL be available in Vizro's data manager

### Requirement: Vizro app serving
The system SHALL provide a `serve` function that loads a DashboardPlan from JSON, builds the Vizro dashboard, registers data sources, and starts the Vizro/Dash server.

#### Scenario: Serve from plan file
- **WHEN** serve is called with a path to a valid plan JSON and manifest
- **THEN** the Vizro app SHALL start and render the dashboard
