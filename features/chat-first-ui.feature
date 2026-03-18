Feature: Chat-First UI Redesign
  As a user of Dashboard Chat
  I want the chat to be the primary interface
  So I can immediately interact with my data through natural language

  # --- Layout ---
  Scenario: Default landing page is ChatView
    Given the user is authenticated
    When they navigate to the root URL
    Then the ChatView is displayed with a welcome message
    And suggestion chips are shown (Upload CSV, Browse Projects)
    And the chat input is enabled and ready for typing

  Scenario: Two-panel layout
    Given the user is on any page
    Then the layout shows a collapsible nav sidebar on the left
    And the main content area fills the remaining width
    And there is no permanent chat panel on the right

  Scenario: Nav sidebar collapses
    Given the nav sidebar is expanded
    When the user clicks the collapse toggle
    Then the sidebar collapses to icon-only width
    And the main content area expands to fill the space

  # --- Navigation ---
  Scenario: Nav displays high-level routes
    Given the nav sidebar is visible
    Then it displays these items in order:
      | item            | icon        |
      | New Session      | plus/pencil |
      | Projects         | folder      |
      | Chats            | messages    |
    And recent sessions are displayed at the bottom of the nav

  Scenario: New Session starts a fresh conversation
    Given the user is on any page
    When they click "New Session" in the nav
    Then the main content area shows ChatView
    And the chat history is empty
    And a new session is created

  Scenario: Projects navigates to project grid
    When the user clicks "Projects" in the nav
    Then the main content area shows a grid of project tiles
    And each tile displays project name, description, and dataset count

  Scenario: Selecting a project shows datasets
    Given the user is on the Projects view
    When they click a project tile
    Then the main content area shows a grid of dataset tiles for that project

  Scenario: Selecting a dataset opens table view
    Given the user is viewing a project's datasets
    When they click a dataset tile
    Then the main content area shows the TableView for that dataset

  Scenario: Chats navigates to full session list
    When the user clicks "Chats" in the nav
    Then the main content area shows a list of all chat sessions
    And sessions are sorted by most recent first
    And each session shows title, timestamp, and message preview

  Scenario: Recent sessions in nav
    Given the user has previous chat sessions
    Then the nav displays up to 5 most recent sessions at the bottom
    And each shows a truncated first message as the label
    And clicking a session navigates to ChatView with that session loaded

  # --- ChatView ---
  Scenario: Welcome state with suggestions
    Given no messages have been sent in the current session
    Then the chat area shows a welcome greeting
    And clickable suggestion chips are displayed
    And clicking "Upload CSV" triggers the upload workflow
    And clicking "Browse Projects" navigates to Projects view

  Scenario: Chat input has expanding textarea
    Given the user is typing in the chat input
    When the text wraps to multiple lines
    Then the input area expands vertically to fit the content
    And a gutter remains fixed at the bottom of the input

  Scenario: Dataset context shown in input gutter
    Given a dataset is selected as context
    Then the dataset name is displayed in the input gutter
    And the name is aligned to the right side of the gutter

  Scenario: Chat prompts for dataset selection
    Given no dataset is selected as context
    When the user issues a table operation command (e.g., "filter rows where age > 30")
    Then the chat displays an inline list of available datasets
    And the user can click a dataset to select it as context
    And the command is re-processed with the selected dataset

  Scenario: Chat prompts for project selection during upload
    Given the user initiates a dataset upload
    And there are multiple projects in the organization
    Then the chat displays an inline list of projects to choose from
    When the user selects a project
    Then the upload continues with that project as the target

  Scenario: Single project auto-selected during upload
    Given the user initiates a dataset upload
    And there is only one project in the organization
    Then that project is automatically selected
    And the upload proceeds without prompting for project selection

  Scenario: Resume existing session
    Given the user clicks a session in the nav or Chats view
    Then the ChatView loads with that session's message history
    And the dataset context (if any) is restored from session metadata
    And the user can continue the conversation

  # --- TableView ---
  Scenario: Table view with inline chat input
    Given a dataset is displayed in TableView
    Then a slim chat input bar is visible at the bottom
    And the user can type commands that operate on the displayed table
    And the dataset name is shown in the input gutter

  Scenario: Activity log overlay
    Given the user sends a chat command in TableView
    Then an activity log appears as a transparent overlay on the right side
    And it shows truncated messages with timestamps
    And the most recent entry is at the top
    And full messages are posted to the session history

  Scenario: Return to ChatView from TableView
    Given the user is in TableView
    When they click "New Session" or a recent session in the nav
    Then the main content area switches to ChatView
    And the table view state is preserved for navigation back

  # --- Sessions (org-scoped) ---
  Scenario: Sessions are not scoped to datasets
    Given the user starts a chat session
    Then the session is associated with the organization, not a specific dataset
    And the user can switch dataset context within the same session
    And all messages are recorded in one continuous session

  Scenario: Session title defaults to first message
    When the user sends the first message in a new session
    Then the session title is set to the first message (truncated)
    And the title appears in the nav's recent sessions list

  Scenario: Session title is editable
    Given a session has been created
    When the user edits the session title (in nav or Chats view)
    Then the title updates and persists across page loads

  # TODO: Auto-generated session titles via AI
  # Future: The system generates a descriptive title from the conversation content
