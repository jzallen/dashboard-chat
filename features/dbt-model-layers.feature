Feature: dbt Model Layers — Views (Intermediate) and Reports (Mart)
  As a user with a project containing datasets
  I can create intermediate Views and consumption-ready Reports
  So that I can build a complete data pipeline from raw data to business-facing output

  Background:
    Given a project exists with datasets and transforms
    And the user is authenticated and has access to the project

  # --- View (Intermediate Layer) Creation ---

  Scenario: Create a View from a single Dataset
    Given the project has a dataset "orders" with cleaning transforms
    When the user asks to "create a view that selects order_id, customer_id, and total from orders"
    Then a View named "orders_selected" is created in the project
    And the View SQL references the "orders" dataset as its source
    And the View SQL contains only a SELECT with the specified columns

  Scenario: Create a View that joins two Datasets
    Given the project has datasets "orders" and "customers"
    When the user asks to "join orders with customers on customer_id"
    Then a View is created with SQL that JOINs both staging sources
    And the View references both datasets as dependencies

  Scenario: Create a View with aggregation
    Given the project has a dataset "order_lines"
    When the user asks to "aggregate order lines to get total per order"
    Then a View is created with SQL containing GROUP BY and SUM
    And the grain changes from order-line to order level

  Scenario: Create a View from another View
    Given the project has a View "orders_joined_to_customers"
    When the user asks to "aggregate the joined orders view by customer"
    Then a new View is created referencing the existing View as its source
    And the dependency chain is Dataset → View → View

  # --- View SQL Guardrails ---

  Scenario: View supports window functions
    When the user asks to "add a running total of amount partitioned by customer"
    Then the View SQL contains a window function with OVER and PARTITION BY

  Scenario: View supports UNION
    Given the project has datasets "web_orders" and "phone_orders"
    When the user asks to "combine web and phone orders into one view"
    Then the View SQL contains a UNION ALL of both staging sources

  Scenario: View supports CASE WHEN business logic
    When the user asks to "categorize orders as small, medium, or large based on total"
    Then the View SQL contains a CASE WHEN expression with the size categories

  Scenario: View supports filtering with WHERE
    When the user asks to "create a view of only completed orders"
    Then the View SQL contains a WHERE clause filtering by status

  # --- Report (Mart Layer) Creation ---
  # NOTE: The chat-first interaction model for Reports is specified in
  # report-layer-chat-first.feature, which supersedes the scenarios below.
  # The scenarios here describe intent but assume raw SQL responses from the AI.
  # The structured tool call approach (D3 principle — backend assembles GROUP BY SQL
  # deterministically from dimension and measure definitions) is the authoritative spec.

  Scenario: Create a fact Report from a View
    Given the project has a View "orders_enriched"
    When the user asks to "create a fact report for orders"
    Then a Report is created with report_type "fact"
    And the Report is named with a "fct_" prefix in dbt export
    And the Report SQL references the View as its source

  Scenario: Create a dimension Report from a View
    Given the project has a View "customers_deduplicated"
    When the user asks to "create a dimension report for customers"
    Then a Report is created with report_type "dimension"
    And the Report is named with a "dim_" prefix in dbt export

  Scenario: Report with lite aggregation
    Given the project has a View "orders_with_customer"
    When the user asks to "create a customer report with total orders and average order value"
    Then the Report SQL contains COUNT and AVG aggregations
    And the aggregations use pre-computed columns from the View where possible

  Scenario: Report with denormalization
    Given the project has Views "orders_enriched" and "customers_cleaned"
    When the user asks to "create an orders report with customer name included"
    Then the Report SQL joins orders with customer dimension attributes
    And the result is a wide, denormalized table

  # --- Report Domains ---

  Scenario: Report defaults to Organization domain
    When the user creates a Report without specifying a domain
    Then the Report domain is set to "Organization"

  Scenario: Report assigned to a specific domain
    When the user asks to "create a finance report for invoices"
    Then the Report is created with domain "Finance"

  Scenario: Domain maps to mart subdirectory in dbt export
    Given Reports exist in domains "Finance" and "Marketing"
    When the user exports the project as a dbt project
    Then "models/marts/finance/" contains the Finance domain Reports
    And "models/marts/marketing/" contains the Marketing domain Reports

  # --- Column Semantic Metadata ---

  Scenario: Annotate Report columns with semantic roles
    Given a Report "fct_orders" exists with columns
    When the user annotates "order_id" as entity:primary
    And the user annotates "customer_id" as entity:foreign
    And the user annotates "ordered_at" as dimension:time with granularity "day"
    And the user annotates "order_status" as dimension:categorical
    And the user annotates "order_total" as measure:sum
    Then each column stores its semantic role and type
    And "ordered_at" is set as the primary time dimension

  Scenario: AI suggests semantic roles based on column names
    Given a Report exists with columns "order_id", "customer_id", "ordered_at", "status", "total_amount"
    When the user asks to "suggest column roles"
    Then the AI suggests "order_id" as entity:primary
    And the AI suggests "customer_id" as entity:foreign
    And the AI suggests "ordered_at" as dimension:time
    And the AI suggests "status" as dimension:categorical
    And the AI suggests "total_amount" as measure:sum

  Scenario: Report works without column metadata
    Given a Report exists with no semantic annotations
    When the user exports the project as a dbt project
    Then the Report SQL exports correctly
    And the schema.yml lists columns with types but no semantic metadata

  Scenario: Primary time dimension is required when measures exist
    Given a Report has columns annotated as measures
    When no column is annotated as a time dimension
    Then a warning is shown that MetricFlow requires a primary time dimension
    And the export proceeds but flags the missing annotation

  # --- Context Awareness UX ---

  Scenario: Chat displays current context
    Given the user is viewing the Dataset "orders"
    Then the chat panel shows a context indicator displaying "Dataset / orders"

  Scenario: Context indicator updates on navigation
    Given the user is viewing the Dataset "orders"
    When the user navigates to the View "orders_enriched"
    Then the context indicator updates to "View / orders_enriched"

  Scenario: Context indicator shows layer and name for Reports
    Given the user is viewing the Report "fct_orders"
    Then the context indicator displays "Report / fct_orders"

  Scenario: AI announces target before making changes
    Given the user is viewing the View "orders_enriched"
    When the user asks to "add a total_amount column"
    Then the AI response begins by stating it is modifying "orders_enriched" (View)
    And then describes the change

  Scenario: AI announces context switch when creating a new layer
    Given the user is viewing the Dataset "orders"
    When the user asks to "aggregate orders by customer"
    Then the AI explains this requires a View (not a Dataset operation)
    And the AI announces it is creating a new View
    And the context indicator updates to show the new View

  Scenario: AI announces context switch when redirecting between layers
    Given the user is viewing the Dataset "orders"
    And a View "orders_by_customer" already exists
    When the user asks to "add a revenue metric to the customer aggregation"
    Then the AI announces it is switching context to "orders_by_customer" (View)
    And the context indicator updates accordingly

  # --- Layer-Specific SQL Guardrails ---

  Scenario: Aggregation request on a Dataset redirects to View
    Given the user is viewing a Dataset
    When the user asks to "group by category and sum the amounts"
    Then the AI explains that aggregation belongs in a View or Report
    And the AI offers to create a View with the requested aggregation

  Scenario: Staging operations work normally on Datasets
    Given the user is viewing a Dataset
    When the user asks to "rename 'amt' to 'amount'"
    Then the alias transform is applied to the Dataset as usual
    And no redirect to another layer occurs

  Scenario: JOIN request on a Dataset redirects to View
    Given the user is viewing a Dataset
    When the user asks to "join this with the customers dataset"
    Then the AI explains that JOINs belong in a View
    And the AI offers to create a View joining the two datasets

  # --- dbt Export — Multi-Layer ---

  Scenario: Export produces four-layer directory structure
    Given the project has Datasets, Views, and Reports
    When the user exports the project as a dbt project
    Then the zip contains "models/staging/" with stg_*.sql files
    And the zip contains "models/intermediate/" with int_*.sql files
    And the zip contains "models/marts/" with fct_*.sql and dim_*.sql files
    And the zip contains "models/schema.yml" with all model definitions

  Scenario: Intermediate models use ref() to reference staging
    Given a View references a Dataset named "orders"
    When the user exports the project as a dbt project
    Then the View SQL contains "{{ ref('stg_orders') }}"
    And does not use the source() macro

  Scenario: Mart models use ref() to reference intermediate
    Given a Report references a View named "orders_enriched"
    When the user exports the project as a dbt project
    Then the Report SQL contains "{{ ref('int_orders_enriched') }}"

  Scenario: Schema.yml includes semantic metadata for Reports
    Given a Report has columns with semantic annotations
    When the user exports the project as a dbt project
    Then the schema.yml includes semantic role metadata for annotated columns
    And entity columns include their entity type
    And dimension columns include their dimension type
    And measure columns include their aggregation type
    And time dimensions include their granularity

  Scenario: Export respects DAG ordering
    Given a Report depends on a View which depends on a Dataset
    When the user exports the project as a dbt project
    Then the dependency chain is source → stg_ → int_ → fct_/dim_
    And no model references a downstream model

  Scenario: Materialization config is included in export
    Given a View has materialization set to "ephemeral"
    And a Report has materialization set to "table"
    When the user exports the project as a dbt project
    Then the View SQL includes "{{ config(materialized='ephemeral') }}"
    And the Report SQL includes "{{ config(materialized='table') }}"

  # --- Naming Conventions (dbt Export) ---

  Scenario: View name follows verb convention in export
    When the user creates a View by asking "aggregate orders by customer"
    Then the suggested View name includes a descriptive verb
    And the dbt filename follows "int_{entity}_{verb}.sql" pattern

  Scenario: Report name follows fact/dimension convention in export
    When the user creates a Report with report_type "fact"
    Then the dbt filename follows "fct_{entity}.sql" pattern
    When the user creates a Report with report_type "dimension"
    Then the dbt filename follows "dim_{entity}.sql" pattern

  # --- Dependency & Lineage ---

  Scenario: Circular dependency is prevented
    Given View A references View B
    When the user tries to make View B reference View A
    Then the operation is rejected with a circular dependency error

  Scenario: Deleting a Dataset warns about dependent Views
    Given a View references a Dataset
    When the user tries to delete the Dataset
    Then a warning shows which Views depend on it
    And deletion requires confirmation

  Scenario: View dependencies are visible
    Given a View references two Datasets
    When the user views the View details
    Then the source dependencies are listed
    And the user can navigate to each source

  # --- Edge Cases ---

  Scenario: Project with only Datasets exports as staging-only
    Given the project has Datasets but no Views or Reports
    When the user exports the project as a dbt project
    Then the export matches the current staging-only format
    And no intermediate/ or marts/ directories are created

  Scenario: Duplicate View names after snake_case conversion
    Given two Views have names that produce the same snake_case value
    When the user exports the project as a dbt project
    Then each model file has a unique filename with a numeric suffix

  # --- Auth & Multi-tenancy ---

  Scenario: Views and Reports are org-scoped
    Given a View belongs to a project in organization A
    When a user from organization B tries to access the View
    Then the request is rejected with 403 Forbidden

  Scenario: Views and Reports are project-scoped
    When the user lists Views and Reports
    Then only items from the current project are returned
    And items from other projects are not visible
