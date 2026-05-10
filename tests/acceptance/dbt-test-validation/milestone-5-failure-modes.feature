# Milestone 5 — failure modes (testing-inversion safety + retry exhaustion).
#
# Two scenarios cover failure paths the design explicitly carries forward:
#
#   - Risk #1 from design.md §13: the load-bearing dependency on
#     `dbt-project-export` correctness. If the exported profiles.yml
#     references an undefined env var, the seeder must raise with a
#     debugging-friendly message that names the missing variable —
#     not a generic KeyError. This is the testing-inversion safety net.
#
#   - The validate-after retry exhaustion path (Milestone 2 §3 references
#     this; here it is asserted from the project-level perspective so
#     the milestone-5 file owns all failure-mode coverage in one place).
#
# All scenarios @pending — DELIVER turns them on one at a time.

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

  Scenario: Retry budget is exhausted — chat workflow fails with the validation diff visible
    Given a fresh project with a small orders dataset uploaded
    And the chat workflow will produce a wrong-shape staging frame on every attempt
    When the customer runs the chat workflow with retries permitted
    Then the chat workflow raises after the retry budget is exhausted
    And the failure context includes the validation diff
