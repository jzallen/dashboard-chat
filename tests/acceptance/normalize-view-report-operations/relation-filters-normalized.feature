# <!-- DES-ENFORCEMENT : exempt -->
# Phase 03 (slice 03, DC-83) — relation_filters normalized (PATTERN-PROVER).
#
# The first shared relation_* component table keyed by (parent_type, parent_id).
# Establishes the shared component-table repository + repo-enforced polymorphic
# cascade (OQ-4) + expand/contract migration reused by phases 04-07. Adding one
# filter is a single-row INSERT; filters are commutative; a parent delete
# cascades only its own rows; loads are org-scoped. BLOCKED BY Phase 02. All
# scenarios @pending until Phase 03 lands.

@component_normalized @driving_port @pending
Feature: Relation filters are normalized into single-row-addressable component rows
  As a modeler refining a relation through chat,
  I want adding a filter to write a single row
  So that the agent no longer rewrites the whole array and I can query filters directly.

  Scenario: Adding one filter writes exactly one filter row
    Given a relation with an existing set of filters
    When one filter is added to the relation
    Then exactly one filter row is inserted with no whole-array rewrite

  Scenario: The backfill turns every embedded filter into one keyed row
    Given a relation whose embedded filters have been backfilled
    Then every embedded filter maps to exactly one keyed row and the renderer reads from rows

  Scenario: Reordering two filters leaves the rendered SQL unchanged
    Given a relation with two filters
    When the two filters are reordered
    Then the rendered SQL is unchanged

  @polymorphic_cascade
  Scenario: Deleting a relation removes only its own filter rows
    Given a relation with an existing set of filters
    When the relation is deleted
    Then only its own filter rows are removed
    And the other relation's filter rows remain intact

  Scenario: Loading a relation's filters is scoped to its tenant
    Given filter rows belonging to two tenants
    Then loading a relation's filters returns only its own tenant's rows through an org-scoped query
