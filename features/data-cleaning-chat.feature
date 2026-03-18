Feature: Data Cleaning via Chat
  As a user viewing a dataset with data quality issues
  I can use natural language chat commands
  To clean and standardize my data without altering its meaning

  Background:
    Given a dataset is loaded in the table view
    And the chat panel is available

  # --- Whitespace Trimming ---

  Scenario: Trim whitespace from a specific text column
    When the user asks to trim whitespace from the Name column
    Then the assistant shows a preview with the number of affected cells
    And sample before-and-after values are displayed
    When the user confirms the operation
    Then a cleaning transform is created for the Name column
    And the table view shows trimmed values
    And the assistant confirms how many cells were cleaned

  Scenario: Trim whitespace from all text columns
    When the user asks to trim whitespace from all columns
    Then the assistant shows a preview listing affected columns and cell counts
    When the user confirms the operation
    Then cleaning transforms are applied to each text column
    And numeric and date columns remain unchanged

  Scenario: Trimming a numeric column is rejected
    When the user asks to trim whitespace from a numeric column
    Then the assistant explains that trimming applies only to text columns
    And no transform is created

  # --- Case Standardization ---

  Scenario: Standardize text to title case
    When the user asks to make the City column title case
    Then the assistant shows a preview of affected values
    When the user confirms the operation
    Then a case standardization transform is applied to the City column
    And the table view shows title-cased values

  Scenario: Standardize text to upper case
    When the user asks to make the Status column uppercase
    Then the assistant shows a preview of affected values
    When the user confirms the operation
    Then a case standardization transform is applied with UPPER
    And the table view shows uppercased values

  Scenario: Standardize text to lower case
    When the user asks to make the Email column lowercase
    Then the assistant shows a preview of affected values
    When the user confirms the operation
    Then a case standardization transform is applied with LOWER
    And the table view shows lowercased values

  Scenario: Standardize text to snake case
    When the user asks to convert the Category column to snake case
    Then the assistant shows a preview of affected values
    When the user confirms the operation
    Then a case standardization transform is applied with SNAKE
    And the table view shows snake_cased values

  Scenario: Standardize text to kebab case
    When the user asks to convert the Category column to kebab case
    Then the assistant shows a preview of affected values
    When the user confirms the operation
    Then a case standardization transform is applied with KEBAB
    And the table view shows kebab-cased values

  Scenario: Ambiguous casing request is clarified
    When the user asks to "fix the casing" in the Status column
    Then the assistant asks which case format the user wants
    And lists title case, UPPER CASE, lower case, snake_case, and kebab-case as options
    When the user specifies title case
    Then the assistant shows a preview and proceeds with confirmation

  Scenario: Snake case handles multi-word values correctly
    When the user asks to convert "Product Name" values to snake case
    Then the preview shows "Product Name" becoming "product_name"
    And "FIRST NAME" becoming "first_name"
    And "already_snake" remaining "already_snake"

  Scenario: Kebab case handles multi-word values correctly
    When the user asks to convert "Product Name" values to kebab case
    Then the preview shows "Product Name" becoming "product-name"
    And "FIRST NAME" becoming "first-name"
    And "already-kebab" remaining "already-kebab"

  Scenario: Snake case on a numeric column is rejected
    When the user asks to convert a numeric column to snake case
    Then the assistant explains that case operations apply only to text columns
    And no transform is created

  Scenario: User requests snake case using alternate terminology
    When the user asks to convert the Category column to "underscore case"
    Then the assistant treats it as a snake case request
    And shows a preview of affected values

  # --- Column Aliasing ---

  Scenario: Rename a column via chat
    When the user asks to rename column "emp_id" to "Employee ID"
    Then an alias transform is created immediately without preview
    And the column header displays "Employee ID"
    And the assistant confirms the rename
    And subsequent chat messages refer to the column as "Employee ID"

  Scenario: Rename multiple columns in one request
    When the user asks to rename "emp_id" to "Employee ID" and "dept" to "Department"
    Then alias transforms are created for both columns
    And both column headers update to their new names

  Scenario: Schema view shows alias and original name
    Given the user has renamed "emp_id" to "Employee ID"
    When the user views the schema
    Then the schema shows "Employee ID" as the display name
    And "emp_id" as the actual column name

  Scenario: Revert a column rename
    Given the user has renamed "emp_id" to "Employee ID"
    When the user asks to restore the original column name
    Then the alias transform is disabled
    And the column header reverts to "emp_id"
    And the assistant confirms the revert

  # --- Null Handling ---

  Scenario: Fill null values with a specific value
    When the user asks to fill blanks in the Department column with "Unknown"
    Then the assistant shows a preview with the count of null and empty cells
    And sample affected rows are displayed
    When the user confirms the operation
    Then a null-fill transform is applied to the Department column
    And the table view shows "Unknown" in place of blank values

  Scenario: Fill nulls in a numeric column with a number
    When the user asks to fill blanks in the Salary column with 0
    Then the assistant shows a preview of null cells
    When the user confirms the operation
    Then a null-fill transform is applied with numeric value 0

  Scenario: Type-mismatched fill value is rejected
    When the user asks to fill blanks in a numeric column with "N/A"
    Then the assistant explains the type mismatch
    And suggests providing a numeric value instead
    And no transform is created

  Scenario: AI does not guess fill values
    When the user asks to "fill in the missing data" without specifying a value
    Then the assistant asks what value should be used to fill the blanks
    And no transform is created until the user provides a value

  # --- Value Mapping ---

  Scenario: Replace a single value in a column
    When the user asks to replace "NY" with "New York" in the State column
    Then the assistant shows a preview with the count of matching cells
    When the user confirms the operation
    Then a value-mapping transform is applied to the State column
    And the table view shows "New York" in place of "NY"

  Scenario: Replace multiple values at once
    When the user asks to replace "NY" with "New York" and "CA" with "California" in State
    Then the assistant shows a preview with each mapping and its match count
    When the user confirms the operation
    Then a single value-mapping transform with both replacements is applied

  Scenario: AI suggests additional value mappings
    When the user asks to standardize state abbreviations in the State column
    Then the assistant analyzes the column's unique values
    And suggests mappings based on detected patterns
    When the user selects which mappings to apply
    Then only the confirmed mappings are included in the transform

  Scenario: Value mapping uses exact matches only
    When the user asks to replace "NY" with "New York" in the State column
    Then only cells containing exactly "NY" are affected
    And cells containing "NYC" or "NY State" are not changed

  # --- Preview and Confirm ---

  Scenario: User confirms a cleaning operation after preview
    When the user requests any cleaning operation
    Then the assistant shows a preview including the operation description
    And the number of affected cells
    And up to 5 before-and-after examples
    And a prompt asking to confirm or cancel
    When the user says "yes" or "go ahead"
    Then the cleaning transform is created and applied

  Scenario: User cancels a cleaning operation after preview
    When the user asks to trim whitespace from the Name column
    And the assistant shows a preview of affected cells
    When the user says "no" or "cancel"
    Then no transform is created
    And the assistant acknowledges the cancellation

  Scenario: Column aliasing skips preview
    When the user asks to rename a column
    Then the alias is applied immediately without a preview step
    And the assistant confirms the change

  # --- Reversibility ---

  Scenario: Undo the most recent cleaning transform
    Given the user has applied a cleaning transform
    When the user says "undo" or "revert that"
    Then the most recent cleaning transform is disabled
    And the table view reverts to showing raw values for that column
    And the assistant confirms what was disabled

  Scenario: Re-enable a disabled cleaning transform
    Given the user has disabled a cleaning transform
    When the user asks to re-enable it or says "turn that back on"
    Then the transform is re-enabled
    And the table view reflects the cleaning again
    And the assistant confirms re-enablement

  Scenario: Permanently delete a cleaning transform
    Given the user has applied a cleaning transform
    When the user asks to delete the cleaning rule
    Then the transform is soft-deleted
    And the table view shows raw values
    And the transform cannot be re-enabled

  # --- Composability ---

  Scenario: Multiple cleaning transforms on the same column
    Given the user has applied a whitespace trimming transform to the Name column
    When the user asks to make the Name column title case
    Then a second cleaning transform is applied
    And both transforms compose in creation order
    And the table view reflects trim first then title case

  Scenario: Cleaning transforms and filter transforms coexist
    Given the user has applied a filter transform on the Status column
    When the user applies a case standardization to the Status column
    Then both transforms are active and independent
    And the filter operates on the cleaned values

  # --- Safety Guardrails ---

  Scenario: Case standardization on a numeric column is rejected
    When the user asks to make a numeric column title case
    Then the assistant explains that case operations apply only to text columns
    And no transform is created

  Scenario: Ambiguous column reference is clarified
    When the user asks to clean up "the names" and multiple name-like columns exist
    Then the assistant asks which column the user means
    And lists the candidate columns
    And waits for the user to specify before proceeding

  Scenario: User asks what cleaning has been applied
    Given the user has applied several cleaning transforms
    When the user asks "what cleaning have I applied?"
    Then the assistant lists all active cleaning transforms
    And shows the column and operation for each
