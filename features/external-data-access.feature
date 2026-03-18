Feature: External Data Access via SQL
  As a user with datasets in a project
  I can enable external SQL access to query my data from tools like Excel, Power BI, and Tableau
  So that I can analyze and visualize my data in the tools I already use

  Background:
    Given the user is authenticated and viewing a project
    And the project contains datasets with columns and rows
    And some datasets have transforms applied (filters, cleaning, column aliases)

  # --- Enabling External Access ---

  Scenario: Enable external SQL access for a project
    When the user clicks "Enable SQL Access" in the project toolbar
    Then external SQL access is activated for the project
    And a connection details panel appears with host, port, database name, and credentials
    And the toolbar shows an "Active" indicator for SQL access

  Scenario: Copy connection details to clipboard
    Given external SQL access is enabled for the project
    When the user clicks the copy button next to the connection string
    Then a complete connection string is copied to the clipboard
    And a tooltip confirms "Copied to clipboard"

  Scenario: Disable external SQL access for a project
    Given external SQL access is enabled for the project
    When the user clicks "Disable SQL Access"
    Then external SQL access is deactivated
    And the connection details panel is hidden
    And the toolbar indicator returns to a neutral state

  Scenario: Enable external access for a project with no datasets
    Given the project has no datasets
    When the user clicks "Enable SQL Access" in the project toolbar
    Then a warning displays "Add datasets before enabling SQL access"
    And external SQL access is not activated

  # --- Connecting from External Tools ---

  Scenario: Connect from any SQL-compatible tool using the provided details
    Given external SQL access is enabled for the project
    When a user connects using the provided host, port, database, and credentials
    Then the connection is established successfully
    And the tool can execute SQL queries against the project's datasets

  Scenario: All project datasets appear as queryable tables
    Given external SQL access is enabled for a project with three datasets
    When a connected tool lists available tables
    Then all three datasets are listed
    And no internal tables or system objects are visible

  Scenario: Dataset schema is accurately represented
    Given external SQL access is enabled for the project
    And a dataset has columns "Name" (text), "Revenue" (number), and "Active" (boolean)
    When a connected tool inspects the table schema
    Then the column names match those shown in the web UI catalog view
    And the column types map correctly to SQL types

  Scenario: Standard SQL queries work against datasets
    Given external SQL access is enabled for the project
    When a connected tool runs a SELECT query with WHERE, ORDER BY, and GROUP BY
    Then the query returns correct results
    And aggregate functions like COUNT, SUM, and AVG work as expected

  # --- Data Consistency ---

  Scenario: External query results match the web UI
    Given external SQL access is enabled for the project
    And a dataset shows 150 rows in the web UI table view
    When a connected tool runs SELECT COUNT(*) against that dataset
    Then the count matches the web UI
    And individual row values are identical

  Scenario: Transforms are reflected in external queries
    Given a dataset has filter, cleaning, and column alias transforms applied
    And external SQL access is enabled for the project
    When a connected tool queries the dataset
    Then the returned data reflects all applied transforms
    And column aliases appear as the column names
    And filtered-out rows are not returned

  Scenario: Newly uploaded dataset becomes queryable after sync
    Given external SQL access is enabled for the project
    When the user uploads a new dataset through the web UI
    And clicks "Sync" on the SQL access panel
    Then the new dataset appears as a queryable table in connected tools

  Scenario: Updated transforms are reflected after sync
    Given external SQL access is enabled for the project
    And the user applies a new filter transform in the web UI
    When the user clicks "Sync" on the SQL access panel
    Then connected tools see the updated results on the next query

  # --- Security and Isolation ---

  Scenario: External access only exposes the user's organization's data
    Given external SQL access is enabled for the project
    And another organization also has projects with SQL access enabled
    When the user connects with their credentials
    Then only datasets from the user's own project are visible
    And no data from other organizations is accessible

  Scenario: External connections are read-only
    Given external SQL access is enabled for the project
    When a connected tool attempts to INSERT, UPDATE, or DELETE data
    Then the operation is rejected with a read-only error
    And no data is modified

  Scenario: Credentials are scoped to a single project
    Given the user has SQL access enabled for two separate projects
    When the user connects using the credentials for Project A
    Then only Project A's datasets are queryable
    And Project B's datasets are not visible through that connection

  # --- Connection Lifecycle ---

  Scenario: Connection remains available while SQL access is enabled
    Given external SQL access is enabled for the project
    When a connected tool runs queries over an extended period
    Then the connection continues to work without interruption

  Scenario: Disabling access terminates existing connections
    Given external SQL access is enabled for the project
    And an external tool has an active connection
    When the user disables SQL access in the project toolbar
    Then the active connection is terminated
    And the external tool receives a connection error on the next query

  # --- dbt Integration ---

  Scenario: dbt export includes connection setup when SQL access is enabled
    Given external SQL access is enabled for the project
    When the user exports the project as a dbt project
    Then the exported ZIP includes a database bootstrap script
    And the profiles.yml is pre-configured with the SQL connection details
    And the README includes setup instructions for running the project externally

  Scenario: Exported dbt project can run against the external SQL connection
    Given external SQL access is enabled for the project
    And the user has exported and configured the dbt project
    When the user runs dbt from the command line
    Then dbt connects successfully and executes all models

  # --- Error Scenarios ---

  Scenario: Connection attempt with invalid credentials
    Given external SQL access is enabled for the project
    When a tool attempts to connect with an incorrect password
    Then the connection is rejected with an authentication error

  Scenario: Connection limit reached
    Given external SQL access is enabled for the project
    And the maximum number of simultaneous connections is in use
    When another tool attempts to connect
    Then the connection is rejected with a message indicating the limit has been reached
    And existing connections continue working normally

  Scenario: SQL access endpoint is unavailable
    Given external SQL access was previously enabled for the project
    When the SQL endpoint becomes unavailable
    Then the project toolbar shows a warning indicator
    And the connection details panel displays a status message explaining the issue
