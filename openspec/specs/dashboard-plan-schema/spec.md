## Purpose

Defines the DashboardPlan Pydantic model hierarchy — the intermediate format between LLM agents and the Vizro renderer. Designed for LLM-friendly generation with flat references and simple grid matrices.

## Requirements

### Requirement: DashboardPlan as intermediate format
The system SHALL provide a `DashboardPlan` Pydantic model that represents the LLM-generated dashboard structure. It SHALL contain `version` (default "1.0"), `title`, optional `description`, `data_source_ids`, `filters` list, and `sections` list.

#### Scenario: Create a minimal dashboard plan
- **WHEN** a DashboardPlan is created with a title and one section
- **THEN** the plan SHALL be valid with version defaulting to "1.0" and empty filters list

### Requirement: ChartSpec for visualization components
The system SHALL define a `ChartSpec` model with `chart_type` (one of "bar", "line", "area", "scatter", "pie", "histogram", "kpi_card"), `title`, optional `x_axis` (dimension_id), optional `y_axis` (metric_id or list of metric_ids), optional `color_by` (dimension_id), optional `metric_id` (for kpi_card), and optional `format`.

#### Scenario: Bar chart spec
- **WHEN** a ChartSpec is created with chart_type "bar", x_axis, and y_axis
- **THEN** the spec SHALL be valid

#### Scenario: KPI card spec
- **WHEN** a ChartSpec is created with chart_type "kpi_card" and metric_id
- **THEN** the spec SHALL be valid

### Requirement: TableSpec for tabular components
The system SHALL define a `TableSpec` model with `title`, `columns` (list of column_ids), `sortable` (default True), and `page_size` (default 20).

#### Scenario: Default table settings
- **WHEN** a TableSpec is created with only title and columns
- **THEN** sortable SHALL default to True and page_size to 20

### Requirement: TextSpec for markdown content
The system SHALL define a `TextSpec` model with `content` (markdown string) and `style` (one of "header", "card", "body", defaulting to "body").

#### Scenario: Default text style
- **WHEN** a TextSpec is created with only content
- **THEN** style SHALL default to "body"

### Requirement: ComponentSpec as discriminated union
The system SHALL define a `ComponentSpec` model with `id`, `type` (one of "chart", "table", "text"), and `spec` (a union of ChartSpec, TableSpec, or TextSpec matched by type).

#### Scenario: Chart component
- **WHEN** a ComponentSpec is created with type "chart" and a ChartSpec
- **THEN** the component SHALL be valid

### Requirement: SectionPlan with grid layout
The system SHALL define a `SectionPlan` model with `id`, `title`, optional `description`, `components` list, and `grid` (a list of lists of integers representing a Vizro-style grid matrix where integers are component indices).

#### Scenario: Section with 2x2 grid
- **WHEN** a SectionPlan has 4 components and grid `[[0, 1], [2, 3]]`
- **THEN** the section SHALL be valid with each grid cell referencing a component index

### Requirement: FilterSpec for sidebar controls
The system SHALL define a `FilterSpec` model with `dimension_id`, `widget_type` (one of "dropdown", "checklist", "slider", "range_slider", "date_picker"), and optional `label`.

#### Scenario: Dropdown filter
- **WHEN** a FilterSpec is created with widget_type "dropdown"
- **THEN** the filter SHALL be valid

### Requirement: Round-trip JSON serialization
The system SHALL support round-trip serialization: DashboardPlan → JSON → DashboardPlan with no data loss.

#### Scenario: Serialize and deserialize plan
- **WHEN** a DashboardPlan is serialized to JSON and then deserialized back
- **THEN** the resulting model SHALL be equal to the original
