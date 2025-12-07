Feature: Table Sorting via Chat
  As a user
  I want to sort table data through natural language chat commands
  So that I can organize data in meaningful order

  Background:
    Given the table is loaded with sample inventory data
    And the chat UI is visible next to the table

  Scenario: Sort by numeric column ascending
    When I send the chat message "sort by amount ascending"
    Then the AI should call the sortTable tool with column "amount" and direction "asc"
    And the table should be sorted by amount in ascending order

  Scenario: Sort by numeric column descending
    When I send the chat message "sort by quantity from highest to lowest"
    Then the AI should call the sortTable tool with column "quantity" and direction "desc"
    And the table should be sorted by quantity in descending order

  Scenario: Sort by string column alphabetically
    When I send the chat message "sort the table by name"
    Then the AI should call the sortTable tool with column "name" and direction "asc"
    And the table should be sorted by name in alphabetical order

  Scenario: Sort by category
    When I send the chat message "organize by category"
    Then the AI should call the sortTable tool with column "category"
    And the table should be sorted by category

  Scenario: Clear sorting
    Given the table has active sorting applied
    When I send the chat message "clear the sort"
    Then the AI should call the clearSort tool
    And the table should return to its original order
