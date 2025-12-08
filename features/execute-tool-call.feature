Feature: Execute Tool Call
  As a frontend application
  I want to execute AI tool calls to manipulate table data
  So that natural language commands translate to accurate table operations

  Background:
    Given the table is loaded with sample inventory data
    And the executeToolCall function is available with handlers for setColumnFilters, setSorting, and setData

  # Table Filtering

  Scenario: Filter by string column with contains operator
    When executeToolCall receives a filterTable tool call with column "name", operator "contains", and value "Widget"
    Then the function should return "Filtered name contains Widget"
    And the table should display only rows where name contains "Widget"

  Scenario: Filter by numeric column with greater than operator
    When executeToolCall receives a filterTable tool call with column "amount", operator "gt", and value 30
    Then the function should return "Filtered amount gt 30"
    And the table should display only rows where amount is greater than 30

  Scenario: Filter by numeric column with less than operator
    When executeToolCall receives a filterTable tool call with column "quantity", operator "lt", and value 50
    Then the function should return "Filtered quantity lt 50"
    And the table should display only rows where quantity is less than 50

  Scenario: Filter by string column with equals operator
    When executeToolCall receives a filterTable tool call with column "category", operator "equals", and value "Electronics"
    Then the function should return "Filtered category equals Electronics"
    And the table should display only rows where category equals "Electronics"

  Scenario: Filter by boolean column
    When executeToolCall receives a filterTable tool call with column "inStock", operator "equals", and value "true"
    Then the function should return "Filtered inStock equals true"
    And the table should display only rows where inStock is true

  Scenario: Clear active filters
    Given the table has an active filter applied
    When executeToolCall receives a clearFilters tool call
    Then the function should return "Cleared all filters"
    And the table should display all rows without any filters

  # Table Sorting

  Scenario: Sort by column ascending
    When executeToolCall receives a sortTable tool call with column "amount" and direction "asc"
    Then the function should return "Sorted by amount asc"
    And the table should be sorted by amount in ascending order

  Scenario: Sort by column descending
    When executeToolCall receives a sortTable tool call with column "amount" and direction "desc"
    Then the function should return "Sorted by amount desc"
    And the table should be sorted by amount in descending order

  Scenario: Sort by string column alphabetically
    When executeToolCall receives a sortTable tool call with column "name" and direction "asc"
    Then the function should return "Sorted by name asc"
    And the table should be sorted by name in alphabetical order

  Scenario: Clear sorting
    Given the table has active sorting applied
    When executeToolCall receives a clearSort tool call
    Then the function should return "Cleared sorting"
    And the table should return to its original order

  # Table Row Management

  Scenario: Add a new row with all fields specified
    When executeToolCall receives an addRow tool call with data containing id "4", name "New Item", category "C", amount 75, quantity 15, and inStock true
    Then the function should return "Added new row"
    And the table should contain 4 rows
    And the last row should have name "New Item"

  Scenario: Delete a row by index
    Given the table has 3 rows
    When executeToolCall receives a deleteRow tool call with rowIndex 1
    Then the function should return "Deleted row at index 1"
    And the table should have 2 rows
    And the row at index 1 should no longer exist in its original position

  # Error Handling

  Scenario: Invalid JSON arguments
    When executeToolCall receives a tool call with invalid JSON arguments
    Then the function should return "Error: Invalid arguments for filterTable"
    And the table should remain unchanged

  Scenario: Unknown tool name
    When executeToolCall receives a tool call with an unknown tool name "unknownTool"
    Then the function should return "Unknown tool: unknownTool"
    And the table should remain unchanged
