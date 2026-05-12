# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 2 (MR-3 in the ADR's roadmap, "Milestone 2" in this DISTILL
# pass) — ReportIbisCompiler wires the dormant addDimension /
# addMeasure dispatchers and closes Gap 2.
#
# Contracts enforced (per ADR-026 §"Decision outcome" items 2 and 3,
# §"Consequences → Positive → Closes Gap 2", and the MR-3 row of the
# MR roadmap):
#
#   1. Reports compile via structured composition. The analyst calls
#      `addDimension` and `addMeasure`; the backend dispatcher wires
#      these into the new compiler; the compiler emits
#      `GROUP BY dim AGG(col)` SQL via ibis end-to-end. The dormant
#      tool definitions at
#      `agent/lib/chat/reportToolDefinitions.ts:92-125` get their
#      backend handlers in this milestone.
#
#   2. `createReport.sqlDefinition` is removed in one cut. Per
#      ADR-026 §"Decision outcome" item 2: pre-production codebase, no
#      backfill, no grandfather, no flag-gate. The deprecated path
#      returns a structured rejection naming the deprecated field.
#
#   3. Free-text `expr` fields are removed entirely from the tool
#      schema. Per ADR-026 §"Decision outcome" item 3, future
#      semantic computations land as typed `ComputedField`
#      discriminated-union variants — NEVER as reintroduced free-text.
#      The contract this milestone proves is that the tool-schema
#      layer in the agent REJECTS an `expr` field outright; the
#      backend never sees it because the field does not exist in the
#      schema after MR-3.
#
#   4. Multi-dimension / multi-measure composition (the report-tier
#      analog of the staging tier's typed creativity surface) renders
#      correctly. Composition is the contract; each measure's
#      aggregation behaves independently against the same row set.
#
#   5. Error semantics: a measure without any dimension is semantically
#      a single-row aggregate, which the SCHEMA layer cannot reject
#      (it is a structurally valid composition). The USE-CASE layer
#      rejects it as a report-modeling violation — a report has no
#      dimensions to group by, so calling it a "report" rather than a
#      "scalar query" is the violation. The boundary chosen here is
#      use-case-level rejection. If a future analyst pattern surfaces
#      a legitimate dimensionless report (e.g., a scalar mart for a
#      single global metric), the boundary should move to the schema
#      layer with a typed variant — not by re-admitting an `expr`
#      field. Recorded here so the DELIVER wave inherits the choice.
#
# These are CONTRACTS not mechanisms. Assertions speak to what the
# analyst observes (the compiled report's SQL contains the right
# GROUP BY; the deprecated parameter is rejected with a structured
# error; the schema rejects `expr` outright; multiple measures
# aggregate independently) and never to the internal ibis ops.
#
# Driving ports: two layers, both ports per ADR-026's tier-discipline
# argument:
#   - The backend report-creation use-case facade
#     `app.use_cases.report.create_report` for backend-side contracts
#     (deprecation rejection, structured composition, dimension-less
#     report rejection, multi-measure composition).
#   - The agent's tool-schema layer (`agent/lib/chat/reportToolDefinitions.ts`)
#     for the `expr`-removed contract. That field never reaches the
#     backend because the agent's tool-schema layer is the first port
#     the analyst's call hits.
#
# Phase 03 unpends these scenarios as MR-3 implementation drives them
# RED → GREEN one at a time per nwave Outside-In TDD.

@milestone_2 @driving_adapter @pending
Feature: The report-creation surface compiles structured dimensions and measures and refuses free-form SQL
  As an analyst composing reports through structured tool calls,
  I want the system to compile dimensions and measures into safe deterministic SQL
  and refuse any attempt to author reports as free-form text
  So that the SQL the customer ships is one the compiler typechecked, not one the agent wrote.

  Scenario: An analyst composes a dimension and a measure and the compiled report SQL aggregates correctly
    Given the analyst has a project containing an "orders" dataset with a "region" column and an "order_id" column
    When the analyst creates a report named "orders_by_region" with one categorical dimension on "region" and one count measure on "order_id"
    Then the compiled report SQL groups results by "region"
    And the compiled report SQL produces a count of "order_id" per region
    And the customer's dbt export contains a mart model "mart_orders_by_region" whose SQL also groups by "region"
    And evaluating the compiled report against seeded orders data returns one row per distinct region with the matching count

  @deprecation_contract
  Scenario: A report-creation call carrying the deprecated free-form SQL field is rejected with a structured error
    Given the analyst has a project containing an "orders" dataset
    When the analyst attempts to create a report named "rogue_report" by supplying a free-form SQL definition "SELECT 1"
    Then the request is rejected with a structured deprecation error
    And the deprecation error names the deprecated field as the report's free-form SQL definition
    And no report is persisted
    And the compiler is never invoked

  Scenario: A report submitted with measures but no dimensions is rejected as a report-modeling violation
    Given the analyst has a project containing an "orders" dataset with an "order_id" column
    When the analyst attempts to create a report named "loose_count" with a count measure on "order_id" and no dimensions
    Then the request is rejected with a structured report-modeling error
    And the error explains that a report requires at least one dimension to group by
    And no report is persisted

  Scenario: Two dimensions and three measures compose into a correctly aggregated report
    Given the analyst has a project containing an "orders" dataset with columns "region", "quarter", "amount", and "order_id"
    When the analyst creates a report named "regional_quarterly_summary" with categorical dimensions on "region" and "quarter" and measures count on "order_id", sum on "amount", and average on "amount"
    Then the compiled report SQL groups results by both "region" and "quarter"
    And the compiled report SQL contains a count expression over "order_id"
    And the compiled report SQL contains a sum expression over "amount"
    And the compiled report SQL contains an average expression over "amount"
    And evaluating the compiled report against seeded orders data returns one row per distinct region-quarter pair with each measure computed independently

  @input_surface_contract
  Scenario: A measure-creation call carrying a free-form expression field is rejected at the agent's tool-schema layer before reaching the backend
    Given the analyst's tool surface for adding measures no longer offers a free-form expression field
    When the analyst attempts to add a measure named "tax_adjusted_revenue" with a free-form expression "revenue * tax_rate"
    Then the tool-schema layer rejects the call as a schema violation
    And the schema-violation message names the rejected field as the measure's expression
    And the backend report-creation use case is never invoked
    And no measure is persisted on any report
