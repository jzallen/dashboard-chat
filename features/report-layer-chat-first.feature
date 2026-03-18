Feature: Report Layer — Chat-First Experience
  As a user with a project containing views
  I can create and manage Reports through natural language in the chat
  So that I can aggregate view-grain data into business-facing mart models

  # Note: This feature file supersedes the Report creation and annotation scenarios
  # in dbt-model-layers.feature (lines 57–97: fact report, dimension report, lite
  # aggregation, denormalization; and lines 99–130: column semantic metadata).
  # Those scenarios assumed raw SQL responses from the AI. This spec replaces that
  # with structured tool calls (D3 principle) where the backend assembles GROUP BY
  # SQL deterministically from dimension and measure definitions.

  # --- SQL Assembly ---
  # The backend constructs Report SQL deterministically from columns_metadata:
  #   - dimension:entity / dimension:categorical   → GROUP BY column
  #   - dimension:time + granularity               → DATE_TRUNC('week', column) in GROUP BY
  #   - measure:avg/sum/count/min/max              → aggregate function in SELECT
  #
  # Example assembled SQL for a weekly user activity report:
  #   SELECT
  #     user_id,
  #     DATE_TRUNC('week', event_date) AS event_date,
  #     AVG(event_value) AS avg_event_value,
  #     COUNT(*) AS event_count
  #   FROM {{ ref('int_events_enriched') }}
  #   WHERE status = 'completed'
  #   GROUP BY user_id, DATE_TRUNC('week', event_date)
  #
  # The assembled sql_definition is stored on the Report record and is used for
  # both dbt export and DuckDB preview execution.
  #
  # --- Grain Seeding ---
  # On createReport, if the source View has grain defined, the backend can propose
  # initial dimensions (from grain time/entity/dimension columns) and measures
  # (from grain metric columns). This seeding drives the suggestStructure flow.
  #
  # --- Materialization as Table ---
  # When materialized as a table, DuckDB writes aggregated results to Parquet at
  # reports/{project_id}/{report_id}/. This is new lake capability distinct from
  # Views, which are typically ephemeral. Preview execution reuses the
  # query_preview_rows pattern from the Dataset layer.
  #
  # --- Report Tool Set ---
  # createReport(name, source_view_id, report_type, domain?)
  # addDimension(column, granularity?)
  # removeDimension(column)
  # addMeasure(column, aggregation, alias?)   -- aggregation: sum/avg/count/min/max
  # removeMeasure(alias)
  # addFilter(column, operator, value)        -- WHERE applied before GROUP BY
  # removeFilter(column)
  # addJoin(view_id, join_condition)          -- denormalization join before aggregating
  # removeJoin(view_id)
  # setMaterialization(strategy)             -- ephemeral/view/table/incremental
  # setDomain(domain)
  # setReportType(type)                      -- fact | dimension
  # renameReport(name)
  # deleteReport()                           -- requires explicit confirmation
  # suggestStructure()                       -- AI proposes dims + measures from grain

  Background:
    Given the user is authenticated and has access to a project
    And the project has at least one view with defined columns
    And the chat session is active with contextType and contextId tracking
    And the backend assembles Report SQL deterministically from dimension and measure definitions

  # --- Unified Context Model ---

  Scenario: Context picker shows datasets, views, and reports
    Given the project has a dataset "events", a view "int_events_enriched", and a report "fct_weekly_activity"
    When the user triggers the context picker
    Then the picker displays all three items in one list
    And datasets show a dataset type badge
    And views show a view type badge
    And reports show a report type badge

  Scenario: Selecting a report sets context type and ID
    Given the context picker is displayed
    When the user selects the report "fct_weekly_activity"
    Then the channel custom data is updated with contextId set to the report ID
    And contextType is set to "report"
    And the context indicator displays "Report / fct_weekly_activity"

  Scenario: Context indicator tooltip shows report details
    Given a report "fct_weekly_activity" is in context
    And the report has source view "int_events_enriched" and joined view "dim_users"
    And the report has report_type "fact", domain "Marketing", and output grain "user_id × week"
    When the user hovers over the context indicator
    Then a tooltip displays source views, report_type, domain, and output grain

  # --- Report Creation via Chat ---

  Scenario: Create a fact report from a view context
    Given the view "int_events_enriched" is in context
    When the user asks to "create a fact report for weekly user activity"
    Then the AI invokes createReport with name "weekly_user_activity", source_view_id set to the view, and report_type "fact"
    And the AI invokes addDimension for "user_id"
    And the AI invokes addDimension for "event_date" with granularity "week"
    And the AI invokes addMeasure for "event_value" with aggregation "avg" and alias "avg_event_value"
    And a report is created in the project
    And context switches to the new report automatically
    And the context indicator updates to "Report / weekly_user_activity"

  Scenario: Create a dimension report from a view context
    Given the view "int_customers_cleaned" is in context
    When the user asks to "create a dimension report for customers"
    Then the AI invokes createReport with report_type "dimension" and source_view_id set to the view
    And the report is named with a "dim_" prefix in dbt export
    And context switches to the new report

  Scenario: AI suggests name, type, and domain from natural language
    Given the view "int_events_enriched" is in context
    When the user asks to "create a marketing report aggregating weekly event activity by user"
    Then the AI suggests report name "weekly_user_activity"
    And infers report_type "fact" from the word "report" and aggregation intent
    And infers domain "Marketing" from the word "marketing"
    And confirms these choices with the user before proceeding

  Scenario: Grain auto-seed when source view has grain defined
    Given the view "int_events_enriched" is in context
    And the view has grain defined with time column "event_date" and dimension "user_id" and metric "event_value"
    When the user asks to "create a fact report from this view"
    Then the AI presents the proposed structure before invoking any tools:
      """
      I've proposed the following structure based on the view's grain:
        Dimensions: user_id (GROUP BY), event_date at week granularity (GROUP BY)
        Measures: event_value as avg (avg_event_value)
      Confirm or adjust before I create the report.
      """
    And after user confirmation the AI invokes createReport, addDimension, and addMeasure tools

  Scenario: View has no grain — AI uses suggestStructure
    Given the view "int_orders_raw" is in context
    And the view has no grain defined
    When the user asks to "create a fact report from this view"
    Then the AI invokes suggestStructure
    And the backend returns proposed dimensions and measures inferred from column names and types
    And the AI presents the suggestions to the user for confirmation

  Scenario: Creating a report from dataset context redirects to view first
    Given the dataset "orders" is in context
    When the user asks to "create a fact report from this dataset"
    Then the AI explains "Reports must reference a View. Want me to create an intermediate View from this dataset first?"
    And no report is created until a view exists

  Scenario: Create report with no context set
    Given contextType is null and contextId is null
    When the user asks to "create a fact report from int_events_enriched"
    Then the AI resolves the view name by searching the current project
    And creates the report with that view as its source
    And context switches to the new report

  # --- Building Report Structure via Structured Tools ---

  Scenario: Add a categorical dimension
    Given the report "fct_weekly_activity" is in context
    When the user asks to "group by user_id"
    Then the AI invokes addDimension("user_id")
    And the schema display shows user_id as a GROUP BY column

  Scenario: Add a time dimension with granularity
    Given the report "fct_weekly_activity" is in context
    And "event_date" is a datetime column in the source view
    When the user asks to "group by week"
    Then the AI invokes addDimension("event_date", granularity="week")
    And the SQL preview shows DATE_TRUNC('week', event_date) in the GROUP BY clause

  Scenario: Add a time dimension with month granularity
    Given the report "fct_monthly_revenue" is in context
    When the user asks to "aggregate by month"
    Then the AI invokes addDimension("order_date", granularity="month")
    And the SQL preview shows DATE_TRUNC('month', order_date) in the GROUP BY clause

  Scenario: Add a measure with an aggregation function
    Given the report "fct_weekly_activity" is in context
    When the user asks to "average the event value"
    Then the AI invokes addMeasure("event_value", "avg", "avg_event_value")
    And the schema display shows avg_event_value as an aggregate column with aggregation "AVG"

  Scenario: Add a sum measure
    Given the report "fct_revenue" is in context
    When the user asks to "sum the order total"
    Then the AI invokes addMeasure("order_total", "sum", "total_revenue")
    And the SQL preview shows SUM(order_total) AS total_revenue in the SELECT clause

  Scenario: Add a count measure without a source column
    Given the report "fct_weekly_activity" is in context
    When the user asks to "count the number of events"
    Then the AI invokes addMeasure("*", "count", "event_count")
    And the SQL preview shows COUNT(*) AS event_count in the SELECT clause

  Scenario: Remove a dimension
    Given the report "fct_weekly_activity" has user_id as a dimension
    When the user asks to "remove the user_id grouping"
    Then the AI invokes removeDimension("user_id")
    And the schema display no longer shows user_id as a GROUP BY column
    And the SQL preview updates accordingly

  Scenario: Remove a measure
    Given the report "fct_weekly_activity" has measure "avg_event_value"
    When the user asks to "remove the average event value"
    Then the AI invokes removeMeasure("avg_event_value")
    And the schema display no longer shows that aggregate column

  Scenario: Add a pre-aggregation filter
    Given the report "fct_weekly_activity" is in context
    When the user asks to "only include completed events"
    Then the AI invokes addFilter("status", "equals", "completed")
    And the SQL preview shows WHERE status = 'completed' before the GROUP BY clause

  Scenario: Remove a pre-aggregation filter
    Given the report "fct_weekly_activity" has a WHERE filter on "status"
    When the user asks to "remove the status filter"
    Then the AI invokes removeFilter("status")
    And the SQL preview no longer shows the WHERE clause for status

  Scenario: Add a denormalization join before aggregating
    Given the report "fct_weekly_activity" is in context
    And the project has a view "dim_users" with a "user_id" key column
    When the user asks to "include the user's region from dim_users"
    Then the AI invokes addJoin(view_id="dim_users", join_condition="source.user_id = dim_users.user_id")
    And columns from dim_users are available as dimensions in the schema display

  Scenario: Remove a denormalization join
    Given the report "fct_weekly_activity" has a join on "dim_users"
    When the user asks to "remove the join with dim_users"
    Then the AI invokes removeJoin("dim_users")
    And dimensions sourced exclusively from dim_users are removed from the schema

  Scenario: Set materialization strategy
    Given the report "fct_weekly_activity" is in context
    When the user asks to "materialize this as a table"
    Then the AI invokes setMaterialization("table")
    And the report definition stores materialization "table"

  Scenario: Set domain
    Given the report "fct_weekly_activity" is in context
    When the user asks to "assign this to the Marketing domain"
    Then the AI invokes setDomain("Marketing")
    And the report domain is updated to "Marketing"

  Scenario: Set report type
    Given a report is in context with report_type "fact"
    When the user asks to "change this to a dimension report"
    Then the AI invokes setReportType("dimension")

  Scenario: Rename a report
    Given the report "fct_weekly_activity" is in context
    When the user asks to "rename this to weekly_user_events"
    Then the AI invokes renameReport("weekly_user_events")
    And the context indicator updates to "Report / weekly_user_events"

  Scenario: Delete a report
    Given the report "fct_weekly_activity" is in context
    When the user asks to "delete this report"
    Then the AI confirms the deletion with the user
    And after confirmation invokes deleteReport()
    And the report is removed from the project
    And context resets to null

  Scenario: All report modifications use predefined tools
    Given a report is in context
    When the user requests any modification to the report
    Then the AI translates the request into one or more predefined tool calls
    And the backend assembles SQL deterministically from the structured operations
    And the AI never writes raw SQL that gets executed directly

  # --- SQL Preview ---

  Scenario: SQL preview shows DATE_TRUNC for time dimensions
    Given the report has time dimension "event_date" with granularity "week"
    When the user views the SQL preview
    Then the preview shows DATE_TRUNC('week', event_date) in the GROUP BY clause
    And the SELECT clause aliases it as "event_date"

  Scenario: SQL preview shows aggregate functions for measures
    Given the report has measures "avg_event_value" (avg) and "event_count" (count)
    When the user views the SQL preview
    Then the preview shows AVG(event_value) AS avg_event_value
    And the preview shows COUNT(*) AS event_count

  Scenario: SQL preview is read-only and collapsible
    Given the SQL preview panel is visible for a report
    When the user collapses the panel
    Then the SQL is hidden and the schema panel remains visible
    And the SQL preview is clearly labeled as assembled output, not user-editable

  Scenario: SQL preview shows WHERE before GROUP BY
    Given the report has a filter on "status" equals "completed"
    And dimensions "user_id" and "event_date" at week granularity
    When the user views the SQL preview
    Then the WHERE clause appears before the GROUP BY clause
    And all dimensions appear in both the SELECT and GROUP BY clauses

  # --- Querying Report Results ---

  Scenario: Filter materialized report results
    Given the report "fct_weekly_activity" is in context
    And the report is materialized as a table
    When the user asks to "show only rows where avg_event_value > 50"
    Then the display filters the materialized results
    And this is an ephemeral display filter, not a change to the report SQL

  Scenario: Sort report results by a measure
    Given the report "fct_weekly_activity" is in context
    When the user asks to "sort by event_count descending"
    Then the display sorts the materialized results by event_count descending
    And this is an ephemeral display sort, not a structural change

  Scenario: Ask questions about report data
    Given the report "fct_weekly_activity" is in context
    When the user asks "what's the highest avg_event_value?" or "which user has the most events?"
    Then the AI answers based on the materialized report results
    And no tool call modifies the report structure

  # --- Guardrails: Dataset-Only Operations ---

  Scenario: Adding rows redirects to source dataset
    Given the report "fct_weekly_activity" is in context
    When the user asks to "add a new row"
    Then the AI explains "Reports are derived aggregations. To add source data, switch to the source dataset."
    And the AI offers to switch context to the relevant source dataset

  Scenario: Deleting rows redirects to source dataset
    Given the report "fct_weekly_activity" is in context
    When the user asks to "delete rows where event_count is 0"
    Then the AI explains that row deletion is a source dataset operation
    And offers to switch context to the source dataset

  Scenario: Cleaning transforms redirect to source dataset
    Given the report "fct_weekly_activity" is in context
    When the user asks to "trim whitespace on user_id"
    Then the AI explains "Cleaning transforms apply to source datasets. Switch to the source dataset to apply this."
    And offers to switch context to the source dataset

  Scenario: Raw SQL expression in a measure request is translated to a tool call
    Given the report "fct_weekly_activity" is in context
    When the user asks to "add COALESCE(SUM(revenue), 0) as total_revenue"
    Then the AI translates the intent to addMeasure("revenue", "sum", "total_revenue")
    And explains that null handling is managed by the backend, not raw SQL expressions
    And never emits raw SQL in the tool call

  Scenario: JOIN that would change source grain redirects to a new view
    Given the report "fct_weekly_activity" is in context
    When the user asks to "join in the order_lines dataset to get line-level detail"
    Then the AI explains "That join would change the grain, which belongs in an intermediate View."
    And offers to create a new view first before building the report on top of it

  Scenario: Changing time granularity warns about output row count change
    Given the report has time dimension "event_date" with granularity "month"
    And the report has measures avg_event_value and event_count
    When the user asks to "change to weekly granularity"
    Then the AI warns "Changing from month to week granularity will produce more output rows."
    And asks the user to confirm before invoking addDimension with the new granularity

  # --- View Structural Tools Unavailable in Report Context ---

  Scenario: castColumn is not available in report context
    Given the report "fct_weekly_activity" is in context
    When the user asks to "cast event_date as datetime"
    Then the AI explains that column casting applies to Views, not Reports
    And suggests switching to the source view to cast the column there

  Scenario: setGrain is not available in report context
    Given the report "fct_weekly_activity" is in context
    When the user asks to "set the grain for this report"
    Then the AI explains that grain is defined on Views, not Reports
    And the Report's output grain is determined by its GROUP BY dimensions

  Scenario: addColumn (structural) is not available in report context
    Given the report "fct_weekly_activity" is in context
    When the user asks to "add a column from the source view"
    Then the AI explains that structural columns are added via addDimension or addMeasure
    And prompts the user to clarify whether they want a dimension or a measure

  # --- Worker Routing ---

  Scenario: Worker routes to report tool set for report context
    Given a chat message is sent with contextType "report" in the request metadata
    Then the worker routes to the report tool set
    And dataset-only tools (addRow, deleteRow, trimWhitespace, standardizeCase, fillNulls, mapValues) are not available to the LLM
    And view structural tools (castColumn, setGrain, addColumn, removeColumn) are not available to the LLM
    And no additional LLM turn is needed for routing

  Scenario: Worker uses dataset tools for dataset context
    Given a chat message is sent with contextType "dataset" in the request metadata
    Then the worker routes to the dataset tool set
    And report-only tools are not available to the LLM

  Scenario: Worker handles null context gracefully
    Given a chat message is sent with contextType null
    Then the worker provides conversational response tools only
    And no table, view, or report operation tools are available

  # --- Visual Presentation ---

  Scenario: Schema panel shows dimension and measure columns
    Given the report "fct_weekly_activity" has dimensions user_id and event_date (week)
    And measures avg_event_value (avg) and event_count (count)
    When the user views the schema panel
    Then each column shows: Column Name, Type, Role, Aggregation, Source
    And user_id shows role "Dimension", type "id", no aggregation
    And event_date shows role "Dimension (Time)", type "datetime", granularity "week", no aggregation
    And avg_event_value shows role "Measure", aggregation "AVG", source column "event_value"
    And event_count shows role "Measure", aggregation "COUNT", source column "*"

  Scenario: Output grain indicator is visible
    Given the report has dimensions user_id and event_date (week)
    When the user views the report detail
    Then an "Output Grain" indicator displays "user_id × week"

  Scenario: Source dependencies list is visible and navigable
    Given the report "fct_weekly_activity" has source view "int_events_enriched" and joined view "dim_users"
    When the user views the report detail
    Then the source dependencies are listed with names and type badges
    And the user can navigate to each source view

  # --- dbt Export ---

  Scenario: Fact report exports to marts domain subdirectory
    Given a report "fct_weekly_activity" has report_type "fact" and domain "Marketing"
    When the user exports the project as a dbt project
    Then the zip contains "models/marts/marketing/fct_weekly_activity.sql"

  Scenario: Dimension report exports to marts domain subdirectory
    Given a report "dim_customers" has report_type "dimension" and domain "Organization"
    When the user exports the project as a dbt project
    Then the zip contains "models/marts/organization/dim_customers.sql"

  Scenario: Exported SQL uses ref() macro for source view
    Given the report sources from view "int_events_enriched"
    When the user exports the project as a dbt project
    Then the exported SQL contains "{{ ref('int_events_enriched') }}"
    And does not reference the dataset directly

  Scenario: Exported SQL includes GROUP BY with DATE_TRUNC for time dimensions
    Given the report has time dimension "event_date" at week granularity
    And categorical dimension "user_id"
    And measure avg_event_value (avg of event_value)
    When the user exports the project as a dbt project
    Then the exported SQL contains:
      """
      SELECT
        user_id,
        DATE_TRUNC('week', event_date) AS event_date,
        AVG(event_value) AS avg_event_value
      FROM {{ ref('int_events_enriched') }}
      GROUP BY user_id, DATE_TRUNC('week', event_date)
      """

  Scenario: Exported SQL includes WHERE clause before GROUP BY
    Given the report has a filter status equals "completed"
    When the user exports the project as a dbt project
    Then the exported SQL contains a WHERE clause before the GROUP BY clause

  Scenario: Exported schema.yml includes semantic metadata
    Given a report "fct_weekly_activity" has:
      - user_id as entity:foreign
      - event_date as dimension:time with granularity "week"
      - avg_event_value as measure:avg
      - event_count as measure:count
    When the user exports the project as a dbt project
    Then the schema.yml entry for "fct_weekly_activity" includes:
      - user_id with type "foreign_key"
      - event_date with type "time" and granularity "week"
      - avg_event_value with agg_type "average"
      - event_count with agg_type "count"

  Scenario: Materialization config is included in export
    Given a report has materialization set to "table"
    When the user exports the project as a dbt project
    Then the exported SQL includes "{{ config(materialized='table') }}"

  Scenario: Export is blocked when report has no structure
    Given a report exists with no dimensions and no measures defined
    When the user exports the project as a dbt project
    Then the export is blocked with a warning explaining the report has no GROUP BY structure
    And the user is prompted to add at least one dimension and one measure

  Scenario: Joined views are included in exported ref() calls
    Given the report has a denormalization join on view "dim_users"
    When the user exports the project as a dbt project
    Then the exported SQL references "{{ ref('dim_users') }}" in the JOIN clause

  # --- Dependency Validation ---

  Scenario: Deleting a source view warns about dependent reports
    Given the report "fct_weekly_activity" references view "int_events_enriched"
    When the user tries to delete "int_events_enriched"
    Then the AI warns that "fct_weekly_activity" depends on it
    And deletion requires explicit confirmation from the user

  Scenario: Source view referenced in createReport must exist
    Given the user asks to create a report referencing view "int_nonexistent"
    Then the AI reports that the referenced view does not exist in the project
    And no report is created

  Scenario: Reports are leaf nodes — views cannot reference reports
    Given a report "fct_weekly_activity" exists in the project
    When the user tries to create a view referencing the report as a source
    Then the AI explains that views cannot reference reports in the DAG
    And offers to create a new view from the underlying source view instead

  # --- Auth & Multi-tenancy ---

  Scenario: Reports are org-scoped
    Given a report belongs to a project in organization A
    When a user from organization B tries to access the report
    Then the request is rejected with 403 Forbidden

  Scenario: Reports are project-scoped
    When the user lists reports
    Then only reports from the current project are returned
    And reports from other projects are not visible
