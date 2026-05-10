# Milestone 1 — eject-and-test happy path + drift detector + customer-fidelity
# invariant. Covers the per-flow validation surface that ALL three β/α/γ
# realizations share (ADR-019 §2).
#
# The driving port is `DatasetLayerHarness.eject_and_test(project_id)`
# (architecture/brief.md §"Test architecture"; ADR-019 Decision outcome).
# Step glue invokes the harness facade method only; the orchestrator is
# constructed exclusively by the session-scoped `eject_orchestrator`
# fixture (composition root invariant — design.md §4 "wire then probe
# then use").
#
# Scenarios are toggled @pending one at a time as DELIVER lands sub-tasks.
# Step 02-02 unpends the drift-detector scenario; the happy-path and
# customer-fidelity scenarios remain @pending until 02-03+.

@real-io @adapter-integration
Feature: Per-flow eject-and-test gives the customer-fidelity validation gate

  Background:
    Given the dataset-layer harness is ready against the running compose stack
    And the eject orchestrator has passed its earned-trust probes

  @pending
  Scenario: Customer's project ejects and validates green when staging is correct
    Given a fresh project with a small orders dataset uploaded
    And a chat workflow has produced a staging model that is shape-correct
    When the customer ejects the project and re-runs the validations
    Then the ejected project re-validates successfully
    And the report names at least one model that was built
    And the report names at least one validation that was executed

  Scenario: Drift detector — eject fails when an exported test would fail
    Given a fresh project with a small orders dataset uploaded
    And a chat workflow has produced a staging model whose exported tests would fail
    When the customer ejects the project and re-runs the validations
    Then the ejected project re-validates as failed
    And the report names the failing validation by name

  @pending
  Scenario: Customer-fidelity invariant — eject reads the same lake the app reads
    Given a fresh project with a small orders dataset uploaded
    And a chat workflow has produced a staging model that is shape-correct
    When the customer ejects the project and re-runs the validations
    Then the seeded read path points at the same datalake bucket the running app uses
    And the seeded read endpoint matches the running app's storage endpoint
