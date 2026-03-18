Feature: Create Dataset via Chat Upload
  As a user viewing a project
  I can upload a CSV file through the chat panel
  To create a new dataset in my project

  Background:
    Given a project is loaded in the application
    And the chat panel is visible

  Scenario: Open action menu and trigger upload
    When the user clicks the "+" button next to the chat input
    Then an action menu appears with "Create Dataset" option
    When the user clicks "Create Dataset"
    Then an assistant message appears with an upload widget
    And the file upload dialog opens automatically

  Scenario: Select and send a CSV file
    Given the upload widget is displayed in the chat
    When the user selects a CSV file
    Then the widget shows the filename with an "x" button and a "Send" button
    When the user clicks "Send"
    Then the file is uploaded and a dataset is created
    And the widget shows "Uploaded"
    And the new dataset appears in the sidebar and grid

  Scenario: Remove selected file before sending
    Given a file has been selected in the upload widget
    When the user clicks the "x" button
    Then the selected file is removed
    And the widget returns to "Browse" state

  Scenario: Auto-navigate and rename dataset
    Given a dataset was just created via upload
    Then the app navigates to the new dataset
    And the dataset breadcrumb is focused for editing
    When the user types a new name and unfocuses
    Then the dataset name is updated via PATCH
    And a chat message confirms the name change

  Scenario: Editable dataset breadcrumb
    Given a dataset is displayed
    When the user clicks the dataset name in the breadcrumb
    Then the breadcrumb becomes an editable text input
    And if the name is "New Dataset" it appears as placeholder text
    When the user types a new name and presses Enter or unfocuses
    Then the dataset is renamed via PATCH /api/datasets/{id}

  Scenario: Upload error is displayed in chat
    Given the upload widget is displayed in the chat
    When the user selects an invalid file and clicks "Send"
    Then the widget shows the error message with a "Retry" button
    And an assistant message displays the error in the chat
