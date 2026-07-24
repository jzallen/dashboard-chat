# <!-- DES-ENFORCEMENT : exempt -->
# Story 07 (DC-87) — relation_aggregations (report-only) + report rules on typed
# rows.
#
# Report-only aggregation table binds measure -> aggregation function. Report
# rules (measure-requires-dimension, no-mart-to-mart) enforced over typed rows,
# not dict probes; no-mart-to-mart is a first-class method on the shared
# composition service. report_type stays a semantic label (OQ-2). Depends on the
# shared relation_columns (story 04) and relation_grain (story 06). All scenarios
# @pending until this story lands.

@component_normalized @report_rules @driving_port @pending
Feature: Report aggregations are normalized and report rules run over typed rows
  As a modeler authoring a fact report,
  I want measure-requires-dimension and no-mart-to-mart enforced over the
  normalized rows
  So that a dimensionless aggregation or a report sourcing another report is
  rejected at the boundary with a clear error.

  @boundary_validation
  Scenario: A report with a measure and no dimension is rejected over typed rows
    Given a report definition with a measure and no dimension
    When the report is submitted for aggregation
    Then it is rejected as requiring a dimension, evaluated over the typed rows

  @boundary_validation
  Scenario: A report sourcing another report is rejected by the composition service
    Given a report definition whose source is another report
    When the report is submitted for aggregation
    Then it is rejected by the shared composition service as a mart-to-mart reference

  Scenario: Binding a valid measure writes exactly one aggregation row
    Given a report definition with a valid measure
    When the measure is bound to an aggregation function
    Then exactly one aggregation row binds the measure to its function

  Scenario: Reordering aggregations leaves the rendered SQL unchanged
    Given a report definition with a valid measure
    When the aggregations are reordered
    Then the rendered SQL is unchanged after reordering aggregations
