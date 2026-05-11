# Milestone 2 — per-turn validation (β only, ADR-019 §2 Option β).
#
# After ADR-024 Phase 3, this milestone retains ONE scenario:
#   - happy path: shape-correct frame validates in well under the budget
#
# The retry-interaction scenarios (rephrase-success, exhaustion-with-diff)
# were reclassified to `backend/tests/unit/test_retry_semantics.py` —
# they were unit tests wearing acceptance-test clothing (the v1 step
# glue already monkeypatched `PanderaValidator.validate` to drive
# deterministic pass/fail/exhaustion paths). M5.2's structured-exception
# scenario was merged into the same unit file. M2.1 stays here until
# Phase 4 retires the v1 suite.
#
# Driving port: `DatasetLayerHarness.validate_after(dataset_id, schema)`
# for direct shape validation.
#
# Timing budget: the per-turn check is documented in design.md §6 OQ4 as
# "<100ms typical." The acceptance-side budget is 200ms (skill F-004:
# fixtures use ≥200ms to avoid false flakes under parallel load).

@real-io @adapter-integration
Feature: Per-turn validation gives sub-200ms feedback on staging shape

  Background:
    Given the dataset-layer harness is ready against the running compose stack
    And the eject orchestrator has passed its earned-trust probes

  Scenario: Shape-correct staging frame validates within the per-turn budget
    Given a fresh project with a small orders dataset uploaded
    And a chat workflow has produced a staging model that is shape-correct
    When the customer asks the harness to validate the staging frame against the orders schema
    Then the validation reports a successful result
    And the validation completes within 200 milliseconds
