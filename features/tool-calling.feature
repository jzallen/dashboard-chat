Feature: AI Tool Calling System
  As a user
  I want the AI to correctly interpret my commands and call appropriate tools
  So that my natural language requests translate to accurate table operations

  Background:
    Given the application is loaded with the table and chat UI
    And the backend is connected to the AI model

  Scenario: AI receives tool definitions
    When a chat request is sent to the backend
    Then the request should include tool definitions for filterTable
    And the request should include tool definitions for sortTable
    And the request should include tool definitions for addRow
    And the request should include tool definitions for deleteRow
    And the request should include tool definitions for clearFilters
    And the request should include tool definitions for clearSort

  Scenario: AI receives table schema context
    When a chat request is sent to the backend
    Then the request should include the current table schema
    And the schema should list all column names and their types
    And the schema should include the current row count

  Scenario: Tool call is executed on the frontend
    When the AI returns a tool call in the stream
    Then the frontend should parse the tool call
    And the frontend should execute the corresponding table operation
    And the table state should update accordingly

  Scenario: Multiple tool calls in single response
    When I send the chat message "clear all filters and sort by name"
    Then the AI may return multiple tool calls
    And each tool call should be executed in sequence
    And the table should reflect all operations

  Scenario: AI provides text response alongside tool call
    When I send the chat message "show items with amount over 100"
    Then the AI should return a tool call for filterTable
    And the AI should also return a text response confirming the action
    And both should be displayed in the chat
