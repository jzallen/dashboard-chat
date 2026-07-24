# <!-- DES-ENFORCEMENT : exempt -->
# Phase 04 (slice 04, DC-84) — relation_columns normalized (shared projection).
#
# Both view and report projected columns move into one shared relation_columns
# table (shared ColumnRole entity/dimension/time/measure). position is
# presentation-only. BLOCKED BY Phases 01 + 03. All scenarios @pending until
# Phase 04 lands.

@component_normalized @driving_port @pending
Feature: Projected columns are normalized into one shared table across views and reports
  As a modeler or operator,
  I want every projected column to be a row in one shared table
  So that I can ask which relations project column X across both views and reports.

  Scenario: One query lists every view and report projecting the same column
    Given a view and a report each projecting the same output column
    When the columns are queried across all relations
    Then both the view and the report are returned in one result set

  Scenario: Reordering columns leaves the rendered SQL unchanged
    Given a view and a report each projecting the same output column
    When the columns are reordered
    Then the rendered SQL is unchanged after reordering columns

  Scenario: Changing a column's presentation position leaves the rendered SQL unchanged
    Given a view and a report each projecting the same output column
    When a column's presentation position is changed
    Then the rendered SQL is unchanged after changing position

  Scenario: Adding one column writes exactly one column row
    Given a view and a report each projecting the same output column
    When one column is added to the relation
    Then exactly one column row is inserted
