# <!-- DES-ENFORCEMENT : exempt -->
# Story 06 (DC-86) — relation_grain normalized (one row per parent).
#
# Grain (time column + dimension keys) stored as queryable rows, ONE row per
# parent (OQ-3 resolved 1:1 — ViewGrain is a single immutable VO per view;
# Report has no grain). Set-like: reorder leaves SQL unchanged. Depends on the
# shared component-table repository (story 03). All scenarios @pending until this
# story lands.

@component_normalized @driving_port @pending
Feature: A relation's grain is normalized into queryable rows
  As a modeler,
  I want a relation's grain stored as rows
  So that the grain is queryable and feeds the report aggregation step from one place.

  Scenario: A relation's grain keys are queryable as rows
    Given a relation with a declared grain
    When the relation's grain is queried
    Then its grain keys are returned as rows

  Scenario: Reordering grain keys leaves the rendered SQL unchanged
    Given a relation with a declared grain
    When the grain keys are reordered
    Then the rendered SQL is unchanged after reordering grain keys

  Scenario: The backfill produces exactly one grain row per relation
    Given a relation whose grain has been backfilled
    Then exactly one grain row exists for the relation
