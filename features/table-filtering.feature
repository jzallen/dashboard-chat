Feature: Table Filtering via Chat
  As a user
  I want to filter table data through natural language chat commands
  So that I can quickly find relevant rows without manual UI interaction

  Background:
    Given the table is loaded with sample inventory data
    And the chat UI is visible next to the table

  Scenario: Filter by numeric column with greater than operator
    When I send the chat message "get all items with amount greater than 10"
    Then the AI should call the filterTable tool with column "amount" and operator "gt" and value "10"
    And the table should display only rows where amount is greater than 10

  Scenario: Filter by numeric column with less than operator
    When I send the chat message "show items with quantity less than 50"
    Then the AI should call the filterTable tool with column "quantity" and operator "lt" and value "50"
    And the table should display only rows where quantity is less than 50

  Scenario: Filter by string column with equals operator
    When I send the chat message "filter by category equals Electronics"
    Then the AI should call the filterTable tool with column "category" and operator "equals" and value "Electronics"
    And the table should display only rows where category equals "Electronics"

  Scenario: Filter by string column with contains operator
    When I send the chat message "find all items with name containing Widget"
    Then the AI should call the filterTable tool with column "name" and operator "contains" and value "Widget"
    And the table should display only rows where name contains "Widget"

  Scenario: Filter by boolean column
    When I send the chat message "show me items that are in stock"
    Then the AI should call the filterTable tool with column "inStock" and operator "equals" and value "true"
    And the table should display only rows where inStock is true

  Scenario: Clear active filters
    Given the table has an active filter applied
    When I send the chat message "clear all filters"
    Then the AI should call the clearFilters tool
    And the table should display all rows without any filters
