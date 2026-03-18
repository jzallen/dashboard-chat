## ADDED Requirements

### Requirement: Upload flow e2e test
The e2e suite SHALL include tests that verify the full dataset upload flow via the chat panel.

#### Scenario: Open upload widget via action menu
- **WHEN** the user clicks the "+" button next to the chat input
- **AND** clicks "Create Dataset"
- **THEN** the chat SHALL display an upload widget with a file input

#### Scenario: Select and upload a CSV file
- **WHEN** the upload widget is visible
- **AND** the user selects a CSV file via the file input
- **AND** clicks "Send"
- **THEN** the widget SHALL show "Uploaded" status
- **AND** the new dataset SHALL appear in the sidebar

#### Scenario: Remove selected file before sending
- **WHEN** a file has been selected in the upload widget
- **AND** the user clicks the "x" button
- **THEN** the file selection SHALL be cleared
- **AND** the widget SHALL return to browse state

### Requirement: Dataset rename e2e test
The e2e suite SHALL include tests that verify dataset renaming via the breadcrumb.

#### Scenario: Rename dataset via breadcrumb
- **WHEN** a dataset has just been created via upload
- **AND** the user clicks the dataset name in the breadcrumb
- **AND** types a new name and presses Enter
- **THEN** the dataset name SHALL be updated
- **AND** the breadcrumb SHALL display the new name

### Requirement: Upload error e2e test
The e2e suite SHALL include a test that verifies error handling during upload.

#### Scenario: Invalid file shows error in chat
- **WHEN** the user selects an invalid file and clicks "Send"
- **THEN** the upload widget SHALL show an error message
- **AND** a "Retry" button SHALL be visible
