# Milestone 2 — per-turn validation (β only, ADR-019 §2 Option β).
#
# Two scenarios cover the Pandera-per-turn binding point:
#   - happy path: shape-correct frame validates in well under the budget
#   - retry interaction: when the LLM produces a wrong-shape frame, the
#     existing AC1.5 retry-with-rephrase budget engages; on success after
#     rephrase the chat_turn completes; on exhaustion the chat_turn raises
#     with structured diagnostic context.
#
# Driving ports: `DatasetLayerHarness.validate_after(dataset_id, schema)`
# for direct shape validation, and `DatasetLayerHarness.chat_turn(...)`
# for the retry interaction (the harness owns the retry budget; the
# Pandera check is engaged inside the harness's existing post_turn_check
# mechanism).
#
# Timing budget: the per-turn check is documented in design.md §6 OQ4 as
# "<100ms typical." The acceptance-side budget is 200ms (skill F-004:
# fixtures use ≥200ms to avoid false flakes under parallel load).
#
# All scenarios @pending — DELIVER turns them on one at a time.

@real-io @adapter-integration @pending
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

  Scenario: Wrong-shape frame engages the retry-with-rephrase budget on first rephrase success
    Given a fresh project with a small orders dataset uploaded
    And the chat workflow will produce a wrong-shape staging frame on its first attempt
    And the chat workflow will produce a shape-correct staging frame on its first rephrase
    When the customer runs the chat workflow with retries permitted
    Then the chat workflow completes successfully on the first rephrase
    And the per-turn validation eventually reports a successful result

  Scenario: Wrong-shape frame exhausts the retry budget and raises with diagnostic context
    Given a fresh project with a small orders dataset uploaded
    And the chat workflow will produce a wrong-shape staging frame on every attempt
    When the customer runs the chat workflow with retries permitted
    Then the chat workflow raises after the retry budget is exhausted
    And the diagnostic context names the offending column
