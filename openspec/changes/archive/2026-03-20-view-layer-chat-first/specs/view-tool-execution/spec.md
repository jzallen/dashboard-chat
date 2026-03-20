## ADDED Requirements

### Requirement: View tool handler registered by ViewDetailView

The frontend SHALL have a view tool handler module (`lib/toolCalls/viewTools.ts`) that `ViewDetailView` registers on mount and unregisters on unmount.

#### Scenario: View tool handler is registered on ViewDetailView mount

- **WHEN** `ViewDetailView` mounts with a valid `viewId`
- **THEN** `registerViewToolHandler(viewId)` SHALL be called on the active `ChatContext`
- **AND** incoming view tool calls from the SSE stream SHALL be routed to this handler

#### Scenario: View tool handler is unregistered on ViewDetailView unmount

- **WHEN** `ViewDetailView` unmounts
- **THEN** the view tool handler SHALL be unregistered from `ChatContext`
- **AND** subsequent view tool calls SHALL not be executed silently (they SHALL be ignored or logged as warnings)

---

### Requirement: View mutations use read-modify-write against TanStack Query cache

All view mutation tool calls (addColumn, removeColumn, addJoin, removeJoin, addFilter, removeFilter, castColumn, setGrain) SHALL use a read-modify-write pattern: read the current view from TanStack Query cache, compute the new state, then PATCH the full arrays to the backend.

#### Scenario: addColumn tool call appends to columns array

- **WHEN** the `addColumn` tool call is executed
- **THEN** the handler SHALL read `columns` from the current view cache entry
- **AND** append the new `ViewColumn` (with `display_type` defaulting to `text` if not specified)
- **AND** PATCH the full updated `columns` array to `PATCH /api/projects/{projectId}/views/{viewId}`
- **AND** invalidate the view query key on success

#### Scenario: removeColumn tool call removes from columns array

- **WHEN** the `removeColumn` tool call is executed with `columnName`
- **THEN** the handler SHALL filter out the column matching `columnName` from the cache
- **AND** PATCH the remaining `columns` array to the backend

#### Scenario: castColumn tool call updates display_type in-place

- **WHEN** the `castColumn` tool call is executed with `columnName` and `displayType`
- **THEN** the handler SHALL find the column by name in the cache, update its `display_type`
- **AND** PATCH the full `columns` array with the updated column

#### Scenario: setGrain tool call updates grain field

- **WHEN** the `setGrain` tool call is executed
- **THEN** the handler SHALL PATCH `{ grain: { timeColumn, dimensions } }` to the backend
- **AND** the backend SHALL re-derive all grain roles server-side
- **AND** the view query key SHALL be invalidated so the updated grain roles are fetched

#### Scenario: addJoin appends to joins array

- **WHEN** the `addJoin` tool call is executed
- **THEN** the handler SHALL append the new `ViewJoin` to the `joins` array and PATCH

#### Scenario: removeJoin removes from joins array

- **WHEN** the `removeJoin` tool call is executed with `rightRef`
- **THEN** the handler SHALL filter out the join matching `rightRef` and PATCH

#### Scenario: addFilter appends to filters array

- **WHEN** the `addFilter` tool call is executed
- **THEN** the handler SHALL append the new `ViewFilter` to the `filters` array and PATCH

#### Scenario: removeFilter removes from filters array

- **WHEN** the `removeFilter` tool call is executed with `column`
- **THEN** the handler SHALL filter out the ViewFilter matching `column` and PATCH

---

### Requirement: createView triggers context switch to the new view

The `createView` tool call execution SHALL: POST to create the view, receive the new view ID from the backend, call `setContext("view", id)`, and navigate to `/view/{id}`.

#### Scenario: createView execution flow

- **WHEN** the LLM invokes `createView` with `name` and `sourceRefs`
- **THEN** the frontend handler SHALL call `POST /api/projects/{projectId}/views` with `{ name, sourceRefs }`
- **AND** on success (201 response with `{ id }`), SHALL call `setContext("view", id)`
- **AND** SHALL navigate to `/view/{id}`

#### Scenario: Context indicator updates after createView

- **WHEN** context switches to the new view
- **THEN** the context indicator SHALL display "View / {newViewName}"
- **AND** subsequent chat commands SHALL operate in view context

#### Scenario: createView followed by addColumn tool calls

- **WHEN** the LLM invokes `createView` then immediately invokes `addColumn` tool calls
- **THEN** the `addColumn` calls SHALL execute against the newly created view ID
- **AND** the view detail page SHALL show all added columns after navigation

---

### Requirement: deleteView warns about dependent views via chat message

The `deleteView` tool call execution SHALL check for dependent views and surface warnings in the chat, not in a modal.

#### Scenario: deleteView with no dependents proceeds immediately

- **WHEN** the `deleteView` tool call is executed
- **AND** no other views reference the current view
- **THEN** the handler SHALL call `DELETE /api/projects/{projectId}/views/{viewId}`
- **AND** on success, SHALL call `setContext(null, null)`

#### Scenario: deleteView with dependents surfaces warning in chat

- **WHEN** the `deleteView` tool call is executed
- **AND** one or more views reference the current view (detected via `GET /api/projects/{projectId}/views/{viewId}/dependents`)
- **THEN** the handler SHALL NOT immediately delete
- **AND** SHALL inject a warning message into the chat stream: "Warning: {dependentViewName} depends on this view. Confirm deletion to proceed."
- **AND** SHALL wait for user to confirm before calling DELETE

#### Scenario: renameView updates name field

- **WHEN** the `renameView` tool call is executed with `newName`
- **THEN** the handler SHALL PATCH `{ name: newName }` to the backend
- **AND** the context indicator SHALL update to "View / {newName}"

#### Scenario: setMaterialization updates materialization field

- **WHEN** the `setMaterialization` tool call is executed with `strategy`
- **THEN** the handler SHALL PATCH `{ materialization: strategy }` to the backend

---

### Requirement: Ephemeral display tools do not mutate view definition

When in view context, `filterTable` and `sortTable` tool calls SHALL manipulate TanStack Table display state only, and SHALL NOT modify the view's `filters` or any other persisted view field.

#### Scenario: filterTable in view context applies display filter only

- **WHEN** the user asks to "show only orders over $100" in view context
- **THEN** the LLM SHALL invoke `filterTable`
- **AND** the handler SHALL apply the filter to the TanStack Table column filter state
- **AND** no PATCH SHALL be made to the view's `filters` field in the backend
