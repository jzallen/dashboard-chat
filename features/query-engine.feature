Feature: Query Engine Management
  As a user in an organization
  I can view and manage persistent query engine nodes that provide SQL access to my data lake
  So that I can connect BI tools with stable credentials and see my data stay in sync automatically

  Background:
    Given the user is authenticated and belongs to an organization
    And the organization has at least one query engine node running
    And the user has projects containing datasets with transforms applied

  # --- Engine List View ---

  Scenario: View all query engine nodes for the organization
    When the user navigates to the Query Engines page from org settings
    Then a list of all engine nodes for the organization is displayed
    And each node shows a name, status, endpoint, and connected project count

  Scenario: Engine status indicators
    Given the organization has three engine nodes
    And one is running, one is degraded, and one is unreachable
    When the user views the engine list
    Then each node displays its current status with a distinct visual indicator
    And status updates appear automatically without requiring a page refresh

  Scenario: Navigate to engine detail from the list
    When the user clicks on an engine node in the list
    Then the engine detail view opens for that node

  # --- Engine Detail View ---

  Scenario: View connection details for an engine node
    When the user opens the detail view for a running engine node
    Then the view displays host, port, and database name
    And an ODBC connection string is shown with a copy button
    And a JDBC connection string is shown with a copy button
    And a PostgreSQL connection string is shown with a copy button

  Scenario: Copy connection string to clipboard
    Given the user is viewing the engine detail page
    When the user clicks the copy button next to the ODBC connection string
    Then the string is copied to the clipboard
    And a tooltip confirms "Copied to clipboard"

  Scenario: View connected projects on engine detail
    Given two projects are connected to the engine node
    When the user views the engine detail page
    Then both projects are listed with their schema name, sync status, and last synced time

  Scenario: Quick-start connection guides
    When the user views the engine detail page
    Then quick-start guides are available for Excel (ODBC), Power BI, Tableau, psql, and dbt
    And each guide shows the specific connection parameters for that tool

  Scenario: Test engine connection
    Given the user is viewing the detail page for a running engine node
    When the user clicks "Test Connection"
    Then the system verifies the engine is reachable and responding
    And a success or failure message is displayed

  Scenario: Engine detail for a degraded node
    Given the engine node has a "degraded" status
    When the user views the engine detail page
    Then a warning banner explains what is wrong
    And connection details are still shown (they may or may not work)

  Scenario: Engine detail for an unreachable node
    Given the engine node has an "unreachable" status
    When the user views the engine detail page
    Then an error banner explains the engine is not responding
    And connection details are shown for reference but marked as unavailable

  # --- Project Permissions & Sync Page ---

  Scenario: Enable SQL access for a project
    Given the project does not have SQL access enabled
    When the user navigates to the project's SQL Access page
    Then a prompt explains that enabling creates schema mappings in the org's query engine
    When the user clicks "Enable SQL Access"
    Then the project's schemas and roles are created in the engine
    And the page transitions to show the permissions and sync status view
    And no new container is provisioned

  Scenario: View permissions and sync status for an enabled project
    Given SQL access is enabled for the project
    When the user views the project's SQL Access page
    Then the page shows which engine node the project is connected to
    And each dataset in the project is listed with its sync status
    And the project's reader credentials are shown (password masked)
    And a link to the engine detail page is visible for full connection info

  Scenario: Dataset sync status indicators
    Given SQL access is enabled and the project has three datasets
    And two are synced and one has a pending transform change
    When the user views the project's SQL Access page
    Then two datasets show "Synced" status
    And one dataset shows "Pending" status with a brief syncing indicator

  Scenario: Sync error with retry
    Given a dataset sync event failed
    When the user views the project's SQL Access page
    Then the affected dataset shows "Error" status with an error message
    And a "Retry" button is available next to the failed dataset

  Scenario: Force sync all datasets
    Given SQL access is enabled for the project
    When the user clicks "Force Sync" on the SQL Access page
    Then all dataset mappings are regenerated and pushed to the engine
    And sync status indicators update as each dataset completes

  Scenario: Disable SQL access for a project
    Given SQL access is enabled for the project
    When the user clicks "Disable SQL Access"
    Then a confirmation dialog warns that external connections will stop working
    When the user confirms
    Then the project's schemas and roles are removed from the engine
    And the engine node continues running (unaffected)
    And the page returns to the enable prompt

  # --- Event-Driven Dataset Sync ---

  Scenario: New dataset upload automatically syncs to engine
    Given SQL access is enabled for the project
    When the user uploads a CSV file through the web UI
    Then the dataset is created and Parquet is written to the data lake
    And the backend automatically fires a sync event to the query engine
    And the new dataset becomes queryable from external tools without manual intervention
    And the project SQL Access page shows the new dataset as "Synced"

  Scenario: Transform change automatically syncs to engine
    Given SQL access is enabled and a dataset is synced to the engine
    When the user applies a new filter transform in the web UI
    Then the backend automatically fires a sync event with the updated view definition
    And external tools see the filtered results on the next query
    And the dataset briefly shows "Pending" then transitions to "Synced"

  Scenario: Dataset deletion automatically syncs to engine
    Given SQL access is enabled and a dataset is synced to the engine
    When the user deletes the dataset through the web UI
    Then the backend automatically fires a sync event to drop the view
    And external tools no longer see the table
    And the dataset is removed from the project SQL Access page

  Scenario: Cleaning transform automatically syncs
    Given SQL access is enabled and a dataset is synced
    When the user applies a cleaning transform (trim, case change, fill null, map values)
    Then the sync event updates the view definition with the cleaning CTE
    And external query results reflect the cleaning operation

  Scenario: Column alias automatically syncs
    Given SQL access is enabled and a dataset is synced
    When the user renames a column using an alias transform
    Then the sync event updates the view definition
    And external tools see the new column name on the next query

  Scenario: Disabled transform does not affect external queries
    Given SQL access is enabled and a dataset has a disabled filter transform
    When an external tool queries the dataset
    Then the disabled filter has no effect on returned rows

  # --- Credentials ---

  Scenario: View project credentials
    Given SQL access is enabled for the project
    When the user views the project SQL Access page
    Then the username is displayed
    And the password is masked with a reveal toggle
    And a "Regenerate Credentials" button is available

  Scenario: Regenerate credentials
    Given SQL access is enabled for the project
    When the user clicks "Regenerate Credentials"
    Then a new password is generated and displayed once
    And the old credentials stop working immediately
    And the project's schema mappings, roles, and data access are unaffected
    And a warning reminds the user to update their BI tool configuration

  Scenario: Credentials do not expose underlying engine details
    Given SQL access is enabled for the project
    When the user views the connection details
    Then the credentials are proxy credentials that do not reveal internal role names or engine topology
    And regenerating credentials does not require rebuilding any permission scaffolding

  # --- Data Isolation ---

  Scenario: Project isolation via schema
    Given two projects in the same org both have SQL access enabled on the same engine
    When a user connects with Project A's credentials
    Then only Project A's datasets are visible
    And Project B's datasets are not accessible

  Scenario: Organization isolation
    Given two organizations use separate engine nodes
    When a user from Org A connects with their credentials
    Then no data from Org B is accessible

  Scenario: Read-only enforcement
    Given SQL access is enabled for the project
    When an external tool attempts to INSERT, UPDATE, DELETE, CREATE, or DROP
    Then the operation is rejected with a permission error
    And no data or schema is modified

  Scenario: Connection limit reached
    Given the maximum number of simultaneous connections is in use for a project
    When another tool attempts to connect with that project's credentials
    Then the connection is rejected with a limit-reached message
    And existing connections continue working

  # --- External Tool Compatibility ---

  Scenario: Connect from any PostgreSQL-compatible tool
    Given SQL access is enabled and the engine is running
    When a user connects using the provided host, port, database, and credentials
    Then the connection is established via PostgreSQL wire protocol
    And the tool can list tables and execute standard SQL queries

  Scenario: All synced datasets appear as queryable tables
    Given SQL access is enabled and three datasets are synced
    When a connected tool lists available tables
    Then all three datasets are listed
    And no internal tables or system objects are visible

  Scenario: Schema matches web UI
    Given a dataset has columns "Name" (text), "Revenue" (number), and "Active" (boolean)
    When a connected tool inspects the table schema
    Then column names match the web UI (with alias transforms applied)
    And column types map correctly to SQL types

  Scenario: Query results match the web UI
    Given the web UI shows 150 rows for a dataset
    When a connected tool runs SELECT COUNT(*) against that dataset
    Then the count matches the web UI
    And individual row values are identical

  Scenario: Standard SQL queries work
    Given SQL access is enabled for the project
    When a connected tool runs SELECT with WHERE, ORDER BY, GROUP BY, and aggregates
    Then the query returns correct results

  # --- dbt Integration ---

  Scenario: dbt export uses stable engine endpoint
    Given SQL access is enabled for the project
    When the user exports the project as a dbt project
    Then the exported profiles.yml references the stable engine endpoint
    And the connection details do not change between exports

  # --- Multiple Engine Nodes ---

  Scenario: Organization with multiple engine nodes
    Given the organization has two engine nodes
    When the user views the Query Engines page
    Then both nodes are listed with independent status and connection details

  Scenario: Projects can be on different engine nodes
    Given the organization has two engine nodes
    And Project A is on Engine 1 and Project B is on Engine 2
    When the user views each project's SQL Access page
    Then Project A shows Engine 1's connection details
    And Project B shows Engine 2's connection details
