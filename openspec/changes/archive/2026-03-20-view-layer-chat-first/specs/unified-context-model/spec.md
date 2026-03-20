## ADDED Requirements

### Requirement: Channel custom data uses contextType and contextId

The Stream Chat channel custom data schema SHALL use `contextType` ("dataset" | "view" | null) and `contextId` (string | null) instead of the legacy `datasetId` field.

#### Scenario: New channel writes contextType and contextId

- **WHEN** a new chat channel is created or a context is selected
- **THEN** the channel custom data SHALL include `contextType` and `contextId`
- **AND** SHALL NOT write `datasetId` to new channels

#### Scenario: Legacy channel with only datasetId is read as dataset context

- **WHEN** a channel has `datasetId` set but `contextType` is absent or null
- **THEN** the system SHALL treat `contextType` as `"dataset"` and `contextId` as the `datasetId` value
- **AND** this fallback SHALL be read-only — no automatic migration of the channel data

#### Scenario: Null context is valid

- **WHEN** both `contextType` and `contextId` are null
- **THEN** the channel operates in conversational-only mode with no entity context

---

### Requirement: ChatContext exposes setContext API

`ChatContext` SHALL expose a `setContext(type: "dataset" | "view" | null, id: string | null)` function that updates both `contextType` and `contextId` on the active channel in a single operation.

#### Scenario: setContext updates channel custom data

- **WHEN** `setContext("view", "view-123")` is called
- **THEN** the channel custom data SHALL be updated with `contextType: "view"` and `contextId: "view-123"`
- **AND** downstream consumers reading the channel SHALL see the new context immediately

#### Scenario: setContext(null, null) clears context

- **WHEN** `setContext(null, null)` is called
- **THEN** `contextType` SHALL be null and `contextId` SHALL be null in the channel custom data

#### Scenario: setContext replaces registerDatasetId

- **WHEN** code previously called `registerDatasetId(id)`
- **THEN** it SHALL instead call `setContext("dataset", id)`
- **AND** `registerDatasetId` SHALL be removed from the public ChatContext API

---

### Requirement: useChatEngine passes contextType and contextId in POST /chat

The `useChatEngine` hook SHALL include `contextType` and `contextId` in the request body when calling the worker's POST /chat endpoint.

#### Scenario: Dataset context sends contextType and contextId

- **WHEN** `contextType` is `"dataset"` and `contextId` is set
- **THEN** the POST /chat body SHALL include `{ contextType: "dataset", contextId: "<id>", tableSchema: <schema> }`
- **AND** `tableSchema` SHALL be included (required for dataset context)

#### Scenario: View context sends contextType and contextId without tableSchema

- **WHEN** `contextType` is `"view"` and `contextId` is set
- **THEN** the POST /chat body SHALL include `{ contextType: "view", contextId: "<id>" }`
- **AND** `tableSchema` SHALL be omitted (not applicable for view context)

#### Scenario: Null context sends no contextType

- **WHEN** `contextType` is null
- **THEN** the POST /chat body SHALL include `{ contextType: null, contextId: null }`
- **AND** `tableSchema` SHALL be omitted

---

### Requirement: Unified context picker shows datasets and views

The context picker component SHALL display datasets and views in a single unified list, each item tagged with its entity type.

#### Scenario: Picker shows both datasets and views

- **WHEN** the user opens the context picker
- **THEN** the picker SHALL display all project datasets AND all project views in one list
- **AND** datasets SHALL show a "Dataset" type badge
- **AND** views SHALL show a "View" type badge

#### Scenario: Two parallel API calls, no new endpoint

- **WHEN** the picker is opened
- **THEN** the frontend SHALL call `GET /api/projects/{id}/datasets` and `GET /api/projects/{id}/views` in parallel
- **AND** results SHALL be merged and displayed in a single list (datasets first, then views, or sorted by name)

#### Scenario: Selecting a view sets view context

- **WHEN** the user selects a view from the picker
- **THEN** `setContext("view", viewId)` SHALL be called
- **AND** the context indicator SHALL update to display "View / {viewName}"

#### Scenario: Selecting a dataset sets dataset context

- **WHEN** the user selects a dataset from the picker
- **THEN** `setContext("dataset", datasetId)` SHALL be called
- **AND** the context indicator SHALL display "Dataset / {datasetName}"

---

### Requirement: Context indicator resolves contextType and contextId to display label

The chat input gutter or context indicator SHALL resolve the active `contextType`+`contextId` to a human-readable label using the appropriate entity name.

#### Scenario: View context displays "View / {name}"

- **WHEN** `contextType` is `"view"` and `contextId` is a valid view ID
- **THEN** the indicator SHALL display "View / {viewName}"

#### Scenario: Dataset context displays "Dataset / {name}"

- **WHEN** `contextType` is `"dataset"` and `contextId` is a valid dataset ID
- **THEN** the indicator SHALL display "Dataset / {datasetName}"

#### Scenario: Null context displays no entity label

- **WHEN** `contextType` is null
- **THEN** no entity label SHALL appear (conversational mode indicator only)

#### Scenario: View context indicator tooltip shows sources and grain

- **WHEN** a view is in context and the user hovers over the context indicator
- **THEN** a tooltip SHALL display the view's source list (dataset and view names) and grain definition if set
