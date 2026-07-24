# <!-- DES-ENFORCEMENT : exempt -->
# Phase 05 (slice 05, DC-85) — relation_joins normalized (order honored).
#
# Joins carry an explicit declaration-ordered sequence backfilled by array
# position (not created_at). Swapping sequence changes SQL; reading in sequence
# order keeps the snapshot byte-identical. BLOCKED BY Phase 03. All scenarios
# @pending until Phase 05 lands.

@component_normalized @driving_port @pending
Feature: Join order is honored through an explicit declaration-ordered sequence
  As a modeler composing multi-source views,
  I want join order preserved as an explicit row sequence
  So that the compiled SQL is identical after normalization and reordering joins
  changes the result deterministically.

  Scenario: Swapping two joins' sequence produces different SQL
    Given a relation with two joins in declaration order
    When the two joins' sequence values are swapped
    Then the rendered SQL differs

  Scenario: Joins read in declaration order keep the rendered SQL byte-identical
    Given a relation with two joins in declaration order
    When the joins are read back in sequence order
    Then the rendered SQL is byte-identical to the characterization snapshot

  Scenario: The backfill assigns join sequence from array position not creation time
    Given a relation whose joins have been backfilled from the embedded array
    Then each join's sequence follows the embedded array position rather than creation time
