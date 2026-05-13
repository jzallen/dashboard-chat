# Milestone 2 — caller migration: legacy facade -> direct port use.
#
# After milestone-1 ships, `Dataset.query_preview_rows` is a thin
# delegator that calls `QueryEnginePort.execute_dataset_query(self, ...)`
# under the hood (DWD-5). Milestone-2 proves the in-tree caller
# (`DatasetService.fetch_dataset`) can switch from the legacy method
# to direct port invocation, AND that the legacy method continues to
# behave identically while it remains for one minor release.
#
# Driving port: `QueryEnginePort.execute_dataset_query(dataset, limit)`
# is the new entry point. The legacy method is exercised because it
# IS the migration shim — its observable behavior must not regress.
# Both paths are asserted to produce the same rows.
#
# Scenarios are @pending until DELIVER Phase 01 (caller migration).

@adapter-integration @driving_port
Feature: Callers transition from the legacy method to direct port invocation

  Background:
    Given the query engine port has been wired into the repository container

  @pending
  Scenario: Legacy method delegates to the new port and produces identical preview rows
    Given a dataset named "N" with a single text column "a" under project "proj-y" and dataset id "ds-x"
    And the storage bucket is configured as "test-bucket"
    And a recording connection that captures every operation it receives
    When the customer fetches preview rows through the legacy dataset method with limit 5
    And the customer also fetches preview rows directly through the query engine port with limit 5
    Then both paths return identical preview rows
    And both paths emitted the same outer and inner SQL on the recording connection

  @pending
  Scenario: Legacy method emits a deprecation notice naming the new port
    Given a dataset named "N" with a single text column "a" under project "proj-y" and dataset id "ds-x"
    And the storage bucket is configured as "test-bucket"
    And a recording connection that captures every operation it receives
    When the customer fetches preview rows through the legacy dataset method with limit 5
    Then the customer is shown a deprecation notice naming "QueryEnginePort.execute_dataset_query" as the replacement
    And the preview rows the legacy method returned still match what the new port returns

  @pending
  Scenario: Dataset service fetches preview rows through the port, not through the dataset model
    Given a dataset named "N" with a single text column "a" under project "proj-y" and dataset id "ds-x"
    And the storage bucket is configured as "test-bucket"
    And a recording connection that captures every operation it receives
    When the customer requests a dataset detail with preview included
    Then the dataset service obtained preview rows through the query engine port
    And the dataset model was not asked to execute the preview query itself

  @pending
  Scenario: Dataset service handles a port failure as a named query engine error
    Given a dataset whose transforms request a snake-case clean operation
    And a connection whose pg_duckdb extension is not loaded
    When the customer requests a dataset detail with preview included
    Then the customer sees a query engine error naming pg_duckdb as the missing capability
    And no preview rows are attached to the dataset detail
