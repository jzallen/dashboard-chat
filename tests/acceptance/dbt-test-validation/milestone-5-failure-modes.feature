# Milestone 5 — failure modes (testing-inversion safety).
#
# After ADR-024 Phase 3, this milestone retains ONE scenario:
#
#   - Risk #1 from design.md §13: the load-bearing dependency on
#     `dbt-project-export` correctness. If the exported profiles.yml
#     references an undefined env var, the seeder must raise with a
#     debugging-friendly message that names the missing variable —
#     not a generic KeyError. This is the testing-inversion safety net.
#
# The retry-exhaustion-with-diff scenario was reclassified to
# `backend/tests/unit/test_retry_semantics.py` (merged with M2.3 — both
# scenarios drove the same path through `chat_turn` raising
# `StructuredRetryExhaustion`). The unit port asserts both the formatted-
# message contract (column + diff visible) and the typed-attribute contract
# (`prompt`, `attempts`, `validation_diff`, `sse_transcript`).

@real-io
Feature: Failure-mode coverage for the load-bearing dependencies

  Background:
    Given the dataset-layer harness is ready against the running compose stack
    And the eject orchestrator has passed its earned-trust probes

  Scenario: Export references an undefined credential — seeder fails with a named-variable error
    Given a fresh project with a small orders dataset uploaded
    And the project export will reference a credential variable that is not set in the environment
    When the customer ejects the project and re-runs the validations
    Then the seeder fails with an error that names the missing credential variable
    And the orchestrator does not silently substitute an empty value
