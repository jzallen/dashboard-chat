Feature: Table Display with TanStack Table
  As a user
  I want to see my data displayed in a functional table
  So that I can view and understand the information clearly

  Background:
    Given the application is loaded with sample inventory data

  Scenario: Table displays all columns
    Then the table should display a column for ID
    And the table should display a column for Name
    And the table should display a column for Category
    And the table should display a column for Amount
    And the table should display a column for Quantity
    And the table should display a column for In Stock

  Scenario: Table displays all data rows
    Then the table should display all inventory items
    And each row should show values for all columns

  Scenario: Table supports pagination
    Given there are more rows than fit on one page
    Then I should see pagination controls
    And I should be able to navigate between pages
    And the current page indicator should update

  Scenario: Table columns are sortable via UI
    When I click on a column header
    Then the table should sort by that column
    And a sort indicator should appear on the header

  Scenario: Table reflects filter state
    Given a filter is applied via chat
    Then the table should only display matching rows
    And the row count should decrease accordingly
