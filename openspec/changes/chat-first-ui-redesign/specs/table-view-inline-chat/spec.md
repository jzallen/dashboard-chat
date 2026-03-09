## ADDED Requirements

### Requirement: TableView with Inline Chat Input

The system SHALL provide a full-width TableView at `/table/:datasetId` that includes a slim chat input bar at the bottom instead of a separate ChatPanel sidebar.

- TableView SHALL render the data table at full width (no 384px sidebar reservation).
- A slim chat input bar SHALL be fixed at the bottom of the TableView.
- The input bar SHALL have the same expanding textarea behavior as ChatView.
- The input bar's gutter SHALL display the current dataset name (derived from the `datasetId` route param).
- The input bar SHALL share the current session's chat engine — messages sent here are part of the same session.
- The dataset context SHALL be automatically set to the dataset being viewed.

#### Scenario: User sends a table command from TableView

- **GIVEN** the user is viewing dataset "Sales Q4" in TableView
- **WHEN** the user types "filter rows where region = 'West'" and submits
- **THEN** the message SHALL be sent via the chat engine with the table's current schema as context
- **THEN** the tool call result SHALL be applied to the table immediately
- **THEN** the message SHALL appear in the activity log overlay

#### Scenario: Dataset context auto-set on navigation

- **GIVEN** the user navigates to `/table/ds-123`
- **THEN** the session's dataset context SHALL be updated to `ds-123` via `PATCH /sessions/:id`
- **THEN** the input gutter SHALL display the dataset name

---

### Requirement: Activity Log Overlay

When messages are sent from the TableView's inline chat input, an activity log overlay SHALL appear showing recent activity.

- The activity log SHALL appear as a semi-transparent overlay on the right side of the TableView.
- The log SHALL show the most recent messages with timestamps, newest first.
- Message text SHALL be truncated (e.g., 80 characters) with full text available on hover or click.
- The log SHALL auto-dismiss after a configurable timeout (e.g., 5 seconds of inactivity) or be dismissible by the user.
- The log SHALL NOT block interaction with the table underneath.
- Full messages SHALL be posted to the session history regardless of truncation.

#### Scenario: Activity log shows recent commands

- **GIVEN** the user sends "sort by revenue desc" from TableView
- **THEN** the activity log overlay SHALL appear on the right side
- **THEN** it SHALL display the user message and assistant response with timestamps
- **THEN** the table SHALL update with the sort applied

#### Scenario: Activity log auto-dismisses

- **GIVEN** the activity log is visible
- **WHEN** 5 seconds pass with no new messages
- **THEN** the activity log SHALL fade out automatically

---

### Requirement: Navigation State Preservation

When the user navigates away from TableView and returns, the table state SHALL be preserved.

- Table filters, sorting, column visibility, and scroll position SHALL persist when navigating to ChatView and back.
- The session's dataset context SHALL be restored when returning to the same dataset's TableView.
- State preservation SHALL use React state (not URL params) — it only needs to survive within the same browser session.

#### Scenario: Round-trip navigation preserves table state

- **GIVEN** the user has filters and sorting applied in TableView for dataset "Sales Q4"
- **WHEN** the user clicks "New Session" in the nav (navigating to ChatView)
- **AND** then navigates back to `/table/ds-sales-q4`
- **THEN** the filters and sorting SHALL still be applied
