## ADDED Requirements

### Requirement: ViewDetailView component at /view/:viewId route

The frontend SHALL have a `ViewDetailView` component mounted at `/view/:viewId`, parallel to `TableView` at `/table/:datasetId`.

#### Scenario: Navigating to /view/:viewId renders ViewDetailView

- **WHEN** the user navigates to `/view/view-123`
- **THEN** the `ViewDetailView` component SHALL render with the view data fetched from `GET /api/projects/{projectId}/views/view-123`
- **AND** loading and error states SHALL be displayed while the fetch is pending or failed

#### Scenario: ViewDetailView registers view tool handler on mount

- **WHEN** `ViewDetailView` mounts
- **THEN** it SHALL register the view tool handler with the active `ChatContext`
- **AND** SHALL unregister on unmount (mirroring `TableView`'s dataset tool handler pattern)

---

### Requirement: Schema table displays column name, type, source, and grain role

The schema table within `ViewDetailView` SHALL display one row per column with: Name, Type (display type), Source (dataset/view name), and Grain Role (only shown when grain is defined).

#### Scenario: Schema table shows all columns

- **WHEN** the view has columns from multiple sources
- **THEN** each column SHALL appear as a row with its output name, display type, and source dataset/view name

#### Scenario: Grain Role column appears only when grain is defined

- **WHEN** the view has grain defined
- **THEN** a "Grain Role" column SHALL appear in the schema table
- **WHEN** the view has no grain defined
- **THEN** no Grain Role column SHALL appear in the schema table

#### Scenario: Columns without a grain role show empty cell

- **WHEN** grain is defined and a column has `grain_role = None`
- **THEN** the Grain Role cell for that column SHALL be empty (not a placeholder or dash)

#### Scenario: Grain role values are displayed as human labels

- **WHEN** a column has `grain_role = "Time"`
- **THEN** the cell SHALL display "Time"
- **WHEN** `grain_role = "Dimension"`
- **THEN** "Dimension"
- **WHEN** `grain_role = "Entity"`
- **THEN** "Entity"
- **WHEN** `grain_role = "Metric"`
- **THEN** "Metric"

---

### Requirement: SQL preview panel shows display_sql

The `ViewDetailView` SHALL include a collapsible SQL preview panel showing the `display_sql` rendering of the view.

#### Scenario: SQL preview panel is collapsible

- **WHEN** the SQL preview panel is expanded
- **THEN** the `display_sql` from the API response SHALL be rendered in a read-only code block
- **WHEN** the user collapses the panel
- **THEN** the SQL is hidden and the schema table remains visible

#### Scenario: SQL preview is labeled "for reference only"

- **WHEN** the SQL preview is expanded
- **THEN** a visible label SHALL read "SQL Preview — for reference only"
- **AND** the panel SHALL use a visually distinct style (e.g., muted/secondary) to reinforce that it is not executable

#### Scenario: SQL preview shows display types in CASTs

- **WHEN** a column has `display_type = "category"`
- **THEN** the display SQL SHALL show `CAST(... AS category)` not `CAST(... AS TEXT)`

---

### Requirement: Source dependency list with navigation links

The `ViewDetailView` SHALL display a source dependency list — one entry per `source_ref` — resolved to the source entity's name and type, with a navigation link.

#### Scenario: Source list shows datasets and views with type labels

- **WHEN** the view sources include dataset "orders" and view "customers_cleaned"
- **THEN** the source list SHALL show "orders (Dataset)" and "customers_cleaned (View)"
- **AND** each entry SHALL be a clickable link navigating to the source's detail view

#### Scenario: Clicking a dataset source navigates to TableView

- **WHEN** the user clicks a dataset source link
- **THEN** the app SHALL navigate to `/table/{datasetId}`

#### Scenario: Clicking a view source navigates to ViewDetailView

- **WHEN** the user clicks a view source link
- **THEN** the app SHALL navigate to `/view/{viewId}`

---

### Requirement: TanStack Query view key invalidated after tool call

The TanStack Query cache key for the active view SHALL be invalidated after any successful view tool call execution.

#### Scenario: Schema table refreshes after addColumn tool call

- **WHEN** an `addColumn` tool call succeeds (PATCH returns 200)
- **THEN** the TanStack Query view cache key SHALL be invalidated
- **AND** the schema table SHALL re-render with the updated column list

#### Scenario: Invalidation does not affect unrelated query keys

- **WHEN** a view tool call succeeds
- **THEN** dataset query keys SHALL NOT be invalidated

---

### Requirement: UnifiedNav includes recent views in session list

The unified navigation sidebar SHALL display recent views alongside recent datasets in the session/channel list, distinguishable by contextType.

#### Scenario: View channels appear in session list with type indicator

- **WHEN** the session list renders channels
- **THEN** channels with `contextType = "view"` SHALL display a view type indicator (badge or icon)
- **AND** channels with `contextType = "dataset"` SHALL display a dataset type indicator
