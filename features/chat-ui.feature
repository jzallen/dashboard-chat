Feature: Chat User Interface
  As a user
  I want a functional chat interface next to the table
  So that I can interact with the AI to control table operations

  Background:
    Given the application is loaded

  Scenario: Layout displays table and chat side by side
    Then I should see the data table on one side
    And I should see the chat interface on the other side
    And both should be visible simultaneously

  Scenario: Send a message via chat input
    When I type a message in the chat input field
    And I submit the message
    Then my message should appear in the chat history
    And the message should be marked as a user message

  Scenario: Display AI response in chat
    When I send a chat message
    And the AI responds
    Then the AI response should appear in the chat history
    And the response should be marked as an assistant message

  Scenario: Chat input is disabled during loading
    When I send a chat message
    Then the chat input should be disabled while waiting for a response
    And the input should be re-enabled after the response completes

  Scenario: Chat auto-scrolls to latest message
    Given the chat has multiple messages
    When a new message is added
    Then the chat should automatically scroll to show the latest message

  Scenario: Display tool execution in chat
    When the AI calls a tool
    Then the chat should indicate which tool was called
    And the user should understand what operation was performed
