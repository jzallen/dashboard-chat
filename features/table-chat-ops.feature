Feature: Table Chat Operations
  As a user viewing a data table
  I can use natural language chat commands
  To filter, sort, add, and delete table data

  Background:
    Given a table with product data is displayed
    And a chat input is available

  # --- Filtering ---
  Scenario: Filter by numeric comparison
    When the user asks to show products where quantity is greater than 50
    Then only matching products are displayed

  Scenario: Filter by text contains
    When the user asks to find items with "Widget" in the name
    Then only products containing "Widget" are shown

  Scenario: Filter by category
    When the user asks to show only Electronics
    Then only Electronics products are displayed

  Scenario: Filter by multiple criteria
    When the user asks to show Electronics with quantity greater than 50
    Then only matching products are displayed

  Scenario: Clear filters
    Given filters have been applied
    When the user asks to clear all filters
    Then all products are displayed

  # --- Sorting ---
  Scenario: Sort by column descending
    When the user asks to sort by amount descending
    Then products are ordered from highest to lowest amount

  Scenario: Sort by column ascending
    When the user asks to sort by amount ascending
    Then products are ordered from lowest to highest amount

  Scenario: Sort alphabetically
    When the user asks to sort alphabetically by name
    Then products are ordered A to Z by name

  Scenario: Multi-column sort
    When the user asks to sort by category then by amount descending
    Then products are grouped by category with highest amounts first

  Scenario: Clear sorting
    Given sorting has been applied
    When the user asks to remove sorting
    Then products return to default order

  # --- Adding Rows ---
  Scenario: Add a complete product
    When the user asks to add a product with all fields specified
    Then the new product appears in the table
    And the row count increases

  Scenario: Add a product with partial data
    When the user asks to add a product with only some fields
    Then the new product is added with available fields populated

  # --- Deleting Rows ---
  Scenario: Delete a product by name
    When the user asks to delete a specific product
    Then the product is removed from the table
    And the row count decreases

  # --- Complex Operations ---
  Scenario: Multiple operations in one command
    When the user asks to add a product, delete another, filter, and sort
    Then all operations are applied in sequence
    And the table reflects the final state
