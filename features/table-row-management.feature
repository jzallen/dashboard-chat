Feature: Table Row Management via Chat
  As a user
  I want to add and remove rows through natural language chat commands
  So that I can modify table data without manual form entry

  Background:
    Given the table is loaded with sample inventory data
    And the chat UI is visible next to the table

  Scenario: Add a new row with all fields specified
    When I send the chat message "add a new item called Sensor Pro in category Electronics with amount 75.00 and quantity 30 that is in stock"
    Then the AI should call the addRow tool with the specified data
    And the table should contain a new row with name "Sensor Pro"
    And the new row should have category "Electronics"
    And the new row should have amount 75.00
    And the new row should have quantity 30
    And the new row should have inStock true

  Scenario: Add a row with partial fields
    When I send the chat message "add a new product Widget Z with amount 19.99"
    Then the AI should call the addRow tool with name "Widget Z" and amount 19.99
    And the table should contain a new row with name "Widget Z"

  Scenario: Delete a row by index
    Given the table has 10 rows
    When I send the chat message "delete the first row"
    Then the AI should call the deleteRow tool with index 0
    And the table should have 9 rows
    And the previously first row should no longer exist

  Scenario: Delete a row by position reference
    Given the table has 10 rows
    When I send the chat message "remove the last item"
    Then the AI should call the deleteRow tool with the last index
    And the table should have 9 rows
