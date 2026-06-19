Feature: Canonical operations IR for dataset staging
  As a chat-driven author or agent shaping a dataset's staging layer
  I want my changes captured as one canonical, ordered, tool-agnostic list of operations
  So that the preview, the ejected dbt, and any imported M all describe the same intent

  Background:
    Given a dataset with an empty staging operations list

  # --- Step 1+2: submit & boundary validation (US-2, SJ-2) ---

  Scenario: A well-formed operation set is persisted with explicit sequence
    When I POST a clean "trim" operation and a clean "lowercase" operation to /api/datasets/{id}/transforms
    Then the response is 200
    And each created operation has a non-null sequence
    And the two operations have distinct sequence values

  Scenario: A malformed operation is rejected at the boundary and never persisted
    When I POST an operation with an unknown discriminator value to /api/datasets/{id}/transforms
    Then the response is 422
    And the error names the offending field or discriminator
    And the staging operations list is unchanged
    And no "-- Error generating SQL" comment is ever produced for this operation

  # --- Step 3: deterministic render (US-1, US-3, SJ-1, SJ-3) ---

  Scenario: Staging SQL renders in sequence order and is reproducible
    Given a persisted operations list
    When I request the preview twice via POST /api/datasets/{id}/transforms/preview
    Then both responses contain byte-identical staging SQL
    And the operations are rendered in ascending sequence order

  # --- Step 4: order is honored, not clock-derived (US-1, SJ-1) ---

  Scenario: Swapping two MUTATE operations changes the rendered SQL
    Given two MUTATE operations on the same target column
    When I swap their sequence via PATCH /api/datasets/{id}/transforms
    And I request the preview
    Then the rendered SQL differs from the pre-swap SQL

  # --- Renderer completeness (US-3, SJ-3) — build-time guard ---

  Scenario: A visitor missing an operation discriminator fails the build
    Given an operation discriminator with no entry in the ibis visitor
    When the renderer-completeness probe runs
    Then the build fails naming the unhandled discriminator
    And no silent runtime skip is possible

  # --- Sidecar fidelity (US-4, SJ-4) ---

  Scenario: A sidecar's reason-to-exist is pinned by a divergence test
    Given a "trim" operation whose ibis render diverges from a faithful M render
    And an operation_ibis_args sidecar row capturing that delta
    When the sidecar row is removed
    Then the render drifts from the neutral intent in a way a test detects

  Scenario: The neutral operation never carries a target's dialect
    Given any persisted operation
    Then its serialized customer-facing form contains no ibis-specific or M-specific shaping args

  # --- Step 5: bounded inbound M import (US-5, SJ-5) ---

  Scenario: The supported M subset imports as neutral operations
    When I import an M script containing only Text.Trim and Text.Lower steps
       via POST /api/datasets/{id}/transforms/import-m
    Then the response is 200
    And the staging operations list contains the equivalent neutral operations in script order

  Scenario: An out-of-vocabulary M construct is rejected by name with no partial import
    When I import an M script containing a Table.Join step
       via POST /api/datasets/{id}/transforms/import-m
    Then the response is 422
    And the error names the unsupported construct "Table.Join"
    And the staging operations list is unchanged
