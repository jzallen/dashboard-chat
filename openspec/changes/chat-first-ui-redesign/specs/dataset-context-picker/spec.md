## ADDED Requirements

### Requirement: Inline Dataset Selection

When the user issues a table operation command in ChatView without a dataset selected as context, the system SHALL prompt for dataset selection inline within the chat.

- The system SHALL detect table operation commands (filter, sort, add row, delete row, cleaning transforms) that require a dataset context.
- Detection SHALL occur on the frontend by checking if `datasetId` is set in the chat context before sending to the worker.
- When no dataset is selected, the system SHALL display an inline list of available datasets (fetched from the backend).
- Each dataset item SHALL show the dataset name and parent project name.
- Clicking a dataset SHALL:
  1. Set it as the session's dataset context via `PATCH /sessions/:id` with `dataset_id`.
  2. Update the input gutter to show the dataset name.
  3. Re-process the original command with the selected dataset's table schema.

#### Scenario: Table command without dataset triggers picker

- **GIVEN** the user is in ChatView with no dataset context
- **WHEN** the user types "filter rows where age > 30"
- **THEN** the system SHALL display an assistant message: "Which dataset would you like to work with?"
- **THEN** an inline list of datasets SHALL be rendered below the message
- **WHEN** the user clicks dataset "Employees"
- **THEN** the dataset context SHALL be set to "Employees"
- **THEN** the command "filter rows where age > 30" SHALL be re-sent with the Employees table schema

#### Scenario: Dataset context already set

- **GIVEN** the user is in ChatView with dataset "Sales Q4" selected
- **WHEN** the user types "sort by revenue desc"
- **THEN** the command SHALL proceed directly with the Sales Q4 table schema
- **THEN** no dataset picker SHALL be shown

---

### Requirement: Inline Project Selection for Upload

When the user initiates a CSV upload and the organization has multiple projects, the system SHALL prompt for project selection inline.

- If the organization has exactly one project, it SHALL be auto-selected without prompting.
- If the organization has multiple projects, the system SHALL display an inline list of projects.
- Each project item SHALL show the project name and dataset count.
- Clicking a project SHALL continue the upload flow with that project as the target.

#### Scenario: Upload with multiple projects

- **GIVEN** the user's organization has projects "Analytics" and "Marketing"
- **WHEN** the user initiates a CSV upload (via chip or command)
- **THEN** the system SHALL display: "Which project should this dataset belong to?"
- **THEN** an inline list of projects SHALL be rendered
- **WHEN** the user clicks "Analytics"
- **THEN** the upload SHALL proceed with project "Analytics" as the target

#### Scenario: Upload with single project

- **GIVEN** the user's organization has only one project "Main"
- **WHEN** the user initiates a CSV upload
- **THEN** the project "Main" SHALL be auto-selected
- **THEN** the upload SHALL proceed immediately without a project picker

---

### Requirement: Dataset Context Persistence

Once a dataset is selected as context (via picker or TableView navigation), it SHALL persist for the remainder of the session unless explicitly changed.

- The dataset context SHALL be stored on the session metadata via `PATCH /sessions/:id`.
- Navigating to `/table/:datasetId` SHALL update the session's dataset context.
- Returning to ChatView from TableView SHALL retain the dataset context set in TableView.
- The user SHALL be able to clear or change the dataset context by clicking the dataset name in the input gutter.

#### Scenario: Context persists across views

- **GIVEN** the user selects dataset "Sales Q4" via the inline picker in ChatView
- **WHEN** the user navigates to `/projects` and then back to `/`
- **THEN** the input gutter SHALL still display "Sales Q4"
- **THEN** table commands SHALL use the Sales Q4 schema
