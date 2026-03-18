Feature: View Layer — Chat-First Experience
  As a user with a project containing datasets
  I can create and manage Views through natural language in the chat
  So that I can shape raw data into typed, grain-defined intermediate models

  # Note: This feature file supersedes the View creation and SQL sections
  # of dbt-model-layers.feature (scenarios on lines 10-55: single-dataset views,
  # joins, aggregation, chained views, window functions, UNION, CASE WHEN).
  # Those scenarios assumed the AI writes raw SQL. This spec replaces that with
  # structured tool calls (D3). Window functions, UNION, and CASE WHEN are
  # deferred until dedicated tools are added for those constructs.

  Background:
    Given the user is authenticated and has access to a project
    And the project has at least one dataset
    And the chat session is active with contextType and contextId tracking
    And the backend supports structured column definitions for views

  # --- Unified Context Model ---

  Scenario: Context picker shows both datasets and views
    Given the project has datasets "orders" and "customers"
    And the project has a view "orders_enriched"
    When the user triggers the context picker
    Then the picker displays all three items in one list
    And datasets show a dataset type badge
    And views show a view type badge

  Scenario: Selecting a view sets context type and ID
    Given the context picker is displayed
    When the user selects the view "orders_enriched"
    Then the channel custom data is updated with contextId set to the view ID
    And contextType is set to "view"
    And the context indicator displays "View / orders_enriched"

  Scenario: Selecting a dataset sets context type and ID
    Given the context picker is displayed
    When the user selects the dataset "orders"
    Then the channel custom data is updated with contextId set to the dataset ID
    And contextType is set to "dataset"
    And the context indicator displays "Dataset / orders"

  Scenario: Context indicator tooltip shows view details
    Given a view "orders_enriched" is in context
    And the view has sources "orders" and "customers"
    And the view has grain defined as "order_date × region"
    When the user hovers over the context indicator
    Then a tooltip displays the source list and grain definition

  # --- View Creation via Chat ---

  Scenario: Create a view from a single dataset
    Given the dataset "orders" is in context
    When the user asks to "create a view selecting order_id, customer_id, and total"
    Then the AI invokes the createView tool with name and sources
    And invokes addColumn tools for each requested column
    And a view is created in the project
    And context switches to the new view
    And the context indicator updates to show the view name

  Scenario: Create a view joining two datasets
    Given the dataset "orders" is in context
    When the user asks to "join this with customers on customer_id"
    Then the AI invokes createView with both sources
    And invokes addJoin with the join condition
    And the view references both datasets as dependencies
    And context switches to the new view

  Scenario: AI names the view or asks for a name
    When the user asks to "create a view of active orders"
    Then the AI suggests a descriptive name for the view
    And the user can accept or provide an alternative name

  Scenario: Create a view from another view (chained views)
    Given the project has a view "orders_joined"
    And "orders_joined" is in context
    When the user asks to "create a new view that aggregates this by customer"
    Then the AI invokes createView with the existing view as a source
    And the new view's source_refs reference the view, not the underlying datasets
    And the dependency chain is Dataset → View → View
    And dbt export resolves refs correctly through the chain

  Scenario: Create a view with no context set
    Given contextType is null and contextId is null
    When the user asks to "create a view from orders and customers joined on customer_id"
    Then the AI resolves dataset names by searching the current project
    And creates the view with both datasets as sources
    And context switches to the new view

  Scenario: Context switches automatically on view creation
    Given the dataset "orders" is in context
    When a new view is created from the chat
    Then the AI announces the context switch
    And the context indicator updates to the new view
    And subsequent commands operate on the view

  # --- View Modification via Structured Tools ---

  Scenario: Add a column to a view
    Given the view "orders_enriched" is in context
    When the user asks to "add the email column from customers"
    Then the AI invokes the addColumn tool with source and column name
    And the schema display refreshes to include the new column

  Scenario: Remove a column from a view
    Given the view "orders_enriched" is in context
    When the user asks to "remove the phone_number column"
    Then the AI invokes the removeColumn tool
    And the schema display no longer shows that column

  Scenario: Add a filter to a view
    Given the view "orders_enriched" is in context
    When the user asks to "only include completed orders"
    Then the AI invokes the addFilter tool with column, operator, and value
    And the SQL preview updates to reflect the WHERE clause

  Scenario: Add a join to an existing view
    Given the view "orders_selected" is in context with one source
    When the user asks to "also join in the products dataset on product_id"
    Then the AI invokes the addJoin tool with the new source and join condition
    And the view's source dependencies update to include the new dataset

  Scenario: Add a column with alias
    Given the view "orders_enriched" is in context
    When the user asks to "add the customer name column as buyer_name"
    Then the AI invokes the addColumn tool with source, column, and alias "buyer_name"
    And the schema display shows "buyer_name" as the column name
    And the SQL preview shows the alias in the SELECT clause

  Scenario: Remove a filter from a view
    Given the view "orders_enriched" is in context
    And the view has a WHERE clause filtering by status
    When the user asks to "remove the status filter"
    Then the AI invokes the removeFilter tool
    And the SQL preview no longer shows the WHERE clause for status

  Scenario: Rename a view
    Given the view "orders_enriched" is in context
    When the user asks to "rename this view to enriched_orders"
    Then the AI invokes the renameView tool with the new name
    And the context indicator updates to "View / enriched_orders"

  Scenario: Delete a view
    Given the view "orders_enriched" is in context
    When the user asks to "delete this view"
    Then the AI confirms the deletion with the user
    And the view is removed from the project
    And context resets to null

  Scenario: Deleting a view warns about dependent views
    Given view "orders_enriched" is referenced by view "customer_summary"
    When the user asks to delete "orders_enriched"
    Then the AI warns that "customer_summary" depends on it
    And deletion requires explicit confirmation

  Scenario: Set materialization strategy
    Given the view "orders_enriched" is in context
    When the user asks to "materialize this as a table"
    Then the AI invokes the setMaterialization tool with strategy "table"

  Scenario: All view modifications use predefined tools
    Given the view "orders_enriched" is in context
    When the user requests any modification to the view
    Then the AI translates the request into one or more predefined tool calls
    And the backend assembles SQL deterministically from the structured operations
    And the AI never writes raw SQL that gets executed directly

  # --- Type Casting ---

  Scenario: All columns default to text
    Given a new view is created with columns from a source dataset
    Then all columns in the view schema display as type "text"

  Scenario: Cast a column to a specific type
    Given the view "orders_enriched" is in context
    When the user asks to "cast order_date as datetime and total as decimal"
    Then the AI invokes the castColumn tool for each column
    And the schema display updates to show the new types

  Scenario: Cast a column to category
    Given the view "orders_enriched" is in context
    When the user asks to "cast region as category"
    Then the schema display shows the column type as "category"
    And the backend stores the type as "text"

  Scenario: Cast a column to id
    Given the view "orders_enriched" is in context
    When the user asks to "cast customer_id as id"
    Then the schema display shows the column type as "id"
    And the backend stores the type as "text"

  Scenario: Cast a column to serial
    Given the view "orders_enriched" is in context
    When the user asks to "cast order_number as serial"
    Then the schema display shows the column type as "serial"
    And the backend stores the type as "integer"

  Scenario: AI rejects incompatible type cast
    Given the view has a column "notes" containing free-form text
    When the user asks to "cast notes as decimal"
    Then the AI explains that the column values may not be compatible with decimal
    And suggests alternative types

  Scenario: SQL preview shows human-readable pseudo-SQL with display types
    Given the view has columns cast as "category", "id", and "serial"
    When the user views the SQL preview
    Then a human-readable pseudo-SQL rendering is displayed
    And CAST expressions show display types ("category", "id", "serial")
    And the backend generates executable SQL using "text", "text", and "integer" respectively
    And the preview is clearly labeled as a readable summary, not executable SQL

  # Allowed data types reference:
  # | Display Type | Backend Type | Purpose                              |
  # |-------------|-------------|--------------------------------------|
  # | text        | text        | Free-form strings                    |
  # | category    | text        | Categorical/dimensional values       |
  # | id          | text        | Text entity keys (customer_id, sku)  |
  # | serial      | integer     | Numeric entity keys (auto-increment) |
  # | integer     | integer     | Whole numbers                        |
  # | decimal     | decimal     | Fractional numbers                   |
  # | boolean     | boolean     | True/false                           |
  # | date        | date        | Date only                            |
  # | time        | time        | Time only                            |
  # | datetime    | datetime    | Date + time                          |

  # --- Grain Definition ---

  Scenario: Define grain with time column and dimensions
    Given the view "orders_enriched" is in context
    And "order_date" is cast as "datetime"
    And "region" is cast as "category"
    When the user asks to "set grain to order_date by region"
    Then the AI invokes the setGrain tool with timeColumn and dimensions
    And the schema display shows grain roles: order_date as Time, region as Dimension

  Scenario: Grain requires a time column
    Given the view "orders_enriched" is in context
    And no columns are typed as date, time, or datetime
    When the user asks to "set grain by region"
    Then the AI explains that grain requires a time column
    And suggests casting an appropriate column to date, time, or datetime first

  Scenario: Grain dimensions must be text, category, id, or serial
    Given the view has "total" cast as "decimal"
    When the user asks to "set grain to order_date by total"
    Then the AI explains that metric columns cannot be grain dimensions
    And suggests that metrics are aggregated by the grain, not part of it

  Scenario: Entity columns can serve as grain dimensions
    Given the view has "customer_id" cast as "id"
    And "order_date" cast as "datetime"
    When the user asks to "set grain to order_date by customer_id"
    Then the grain is set with customer_id as a dimension with Entity grain role
    And the schema display shows customer_id with grain role "Entity"

  Scenario: Numeric identifier suggested for cast before use as dimension
    Given the view has "zip_code" typed as "integer"
    When the user asks to "use zip_code as a grain dimension"
    Then the AI suggests "zip_code is numeric — want me to cast it to category or id first?"
    And waits for user confirmation before proceeding

  Scenario: Metric grain role is auto-assigned when grain is defined
    Given the view has "total" cast as "decimal" and "quantity" cast as "integer"
    And grain is defined with a time column and dimensions
    Then "total" is automatically assigned grain role "Metric"
    And "quantity" is automatically assigned grain role "Metric"
    And no user action is needed to classify metric columns

  Scenario: Boolean columns cannot be grain dimensions
    Given the view has "is_active" cast as "boolean"
    When the user asks to "use is_active as a grain dimension"
    Then the AI explains that boolean columns cannot serve as grain dimensions
    And suggests casting to category if the values represent meaningful categories

  Scenario: Plain text columns are not auto-assigned to grain
    Given the view has "notes" typed as "text" (not cast to category or id)
    And grain is defined with a time column and dimensions
    Then "notes" shows no grain role in the schema display
    And the user must cast it to "category" to use it as a dimension

  Scenario: Grain is optional
    Given a view exists without grain defined
    Then the view functions normally for filtering and sorting
    And no grain roles appear in the schema display

  Scenario: Schema display shows grain roles when defined
    Given a view has grain set to "order_date × region"
    Then the schema table shows a Grain Role column
    And "order_date" shows "Time"
    And "region" shows "Dimension"
    And "customer_id" (id type) shows "Entity"
    And "total" (decimal type) shows "Metric"
    And "notes" (plain text) shows no grain role

  # --- Querying View Results ---

  Scenario: Filter materialized view results
    Given the view "orders_enriched" is in context
    When the user asks to "show only orders over $100"
    Then the display filters the materialized results
    And this is an ephemeral display filter, not a change to the view SQL

  Scenario: Sort materialized view results
    Given the view "orders_enriched" is in context
    When the user asks to "sort by order_date descending"
    Then the display sorts the materialized results
    And this is an ephemeral display sort, not a change to the view SQL

  Scenario: Ask questions about view data
    Given the view "orders_enriched" is in context
    When the user asks "how many rows are there?" or "what's the average total?"
    Then the AI answers based on the materialized view results

  # --- Guardrails: Dataset-Only Operations ---

  Scenario: Adding rows redirects to source dataset
    Given the view "orders_enriched" is in context
    When the user asks to "add a new row"
    Then the AI explains "This is a View — its data is derived from SQL. To add data, switch to the source dataset."
    And the AI offers to switch context to the relevant source dataset

  Scenario: Deleting rows redirects to source dataset
    Given the view "orders_enriched" is in context
    When the user asks to "delete rows where status is cancelled"
    Then the AI explains that row deletion is a source dataset operation
    And offers to switch context

  Scenario: Cleaning transforms redirect to source dataset
    Given the view "orders_enriched" is in context
    When the user asks to "trim whitespace on customer_name"
    Then the AI explains "Cleaning transforms apply to source datasets. The customers dataset is the source for that column."
    And offers to switch context to the "customers" dataset

  Scenario: Entity columns reject value modifications
    Given the view has "customer_id" with grain role "Entity"
    When the user asks to modify customer_id values
    Then the AI explains "customer_id is an entity key — its values are immutable."
    And suggests filtering by it instead

  # --- Worker Routing ---

  Scenario: Worker forks early based on context type
    Given a chat message is sent with contextType "view" in the request metadata
    Then the worker routes to the view tool set
    And dataset-only tools are not available to the LLM
    And no additional LLM turn is needed for routing

  Scenario: Worker uses dataset tools for dataset context
    Given a chat message is sent with contextType "dataset" in the request metadata
    Then the worker routes to the dataset tool set
    And view-only tools are not available to the LLM

  Scenario: Worker handles null context gracefully
    Given a chat message is sent with contextType null
    Then the worker provides conversational response tools only
    And no table or view operation tools are available

  # --- Visual Presentation ---

  Scenario: View detail shows schema with source attribution
    Given the view "orders_enriched" joins "orders" and "customers"
    When the user views the schema
    Then columns display their name, type, source dataset, and grain role
    And source attribution shows which dataset each column originates from

  Scenario: View detail shows source dependencies
    Given the view "orders_enriched" references datasets "orders" and "customers"
    When the user views the view detail
    Then the source dependencies are listed with names and types
    And the user can navigate to each source

  Scenario: View detail shows SQL preview
    Given the view "orders_enriched" is in context
    When the user expands the SQL preview panel
    Then a read-only SQL rendering is displayed
    And display types are used (category, id, serial) instead of backend types
    And the SQL is formatted for readability

  Scenario: SQL preview is collapsible
    Given the SQL preview panel is visible
    When the user collapses the panel
    Then the SQL is hidden and the schema remains visible

  # --- dbt Export ---

  Scenario: Views export as intermediate models
    Given the project has a view "orders_enriched"
    When the user exports the project as a dbt project
    Then the zip contains "models/intermediate/int_orders_enriched.sql"
    And the SQL uses ref() macros for source references

  Scenario: Datasets export as staging models
    Given the project has a dataset "orders"
    When the user exports the project as a dbt project
    Then the zip contains "models/staging/stg_orders.sql"

  Scenario: View refs resolve to correct layer prefix
    Given a view references dataset "orders" and view "customers_cleaned"
    When the user exports the project as a dbt project
    Then the exported SQL contains "{{ ref('stg_orders') }}"
    And the exported SQL contains "{{ ref('int_customers_cleaned') }}"

  Scenario: Materialization config is included in export
    Given a view has materialization set to "ephemeral"
    When the user exports the project as a dbt project
    Then the exported SQL includes "{{ config(materialized='ephemeral') }}"

  Scenario: Project with only datasets exports staging-only
    Given the project has datasets but no views
    When the user exports the project as a dbt project
    Then no "models/intermediate/" directory is created
    And the export matches the existing staging-only format

  # --- Dependency Validation ---

  Scenario: Circular dependency is prevented
    Given view A references view B
    When the user tries to make view B reference view A
    Then the AI explains a circular dependency would be created
    And the operation is rejected

  Scenario: Deleting a dataset warns about dependent views
    Given a view references the dataset "orders"
    When the user tries to delete the "orders" dataset
    Then the AI warns which views depend on it
    And deletion requires explicit confirmation

  Scenario: Source refs validated on creation
    Given the user asks to create a view referencing dataset "nonexistent"
    Then the AI reports that the referenced dataset does not exist in the project

  # --- Auth & Multi-tenancy ---

  Scenario: Views are org-scoped
    Given a view belongs to a project in organization A
    When a user from organization B tries to access the view
    Then the request is rejected with 403 Forbidden

  Scenario: Views are project-scoped
    When the user lists views
    Then only views from the current project are returned
