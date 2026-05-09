# Milestone 3 — earned-trust probes (ADR-019 §4, principle 12).
#
# The orchestrator's external dependencies are five places the substrate
# can lie. Each probe is a fault-injection scenario that forces the lie
# and asserts the suite skips with the FAILING PROBE NAMED in the skip
# reason — never silently green.
#
# Composition-root invariant: probe failure -> `pytest.skip(reason)`
# with the probe name in the reason. Behavioral enforcement: the
# session-scoped `eject_orchestrator` fixture invokes `probe()` exactly
# once per session; every test that uses the orchestrator goes through
# this fixture (architecture/brief.md §"Earned-Trust contract").
#
# All scenarios @pending — DELIVER turns them on one at a time.

@earned_trust @probe @real-io @pending
Feature: Earned-trust probes catch the substrate lies before any flow runs

  Background:
    Given the dataset-layer harness is ready against the running compose stack

  Scenario: dbt runner cannot be imported — suite skips with the probe named
    Given the dbt runner cannot be imported
    When the eject orchestrator runs its earned-trust probes
    Then the suite skips with the failing probe named "probe_dbt_runner_importable"

  Scenario: dbt-duckdb adapter cannot be loaded — suite skips with the probe named
    Given the dbt-duckdb adapter cannot be loaded
    When the eject orchestrator runs its earned-trust probes
    Then the suite skips with the failing probe named "probe_dbt_duckdb_loadable"

  Scenario: project export endpoint is unreachable — suite skips with the probe named
    Given the project export endpoint is unreachable
    When the eject orchestrator runs its earned-trust probes
    Then the suite skips with the failing probe named "probe_export_endpoint_reachable"

  Scenario: datalake cannot be read through the seeded profile — suite skips with the probe named
    Given the datalake cannot be read through the seeded profile
    When the eject orchestrator runs its earned-trust probes
    Then the suite skips with the failing probe named "probe_minio_readable_via_duckdb"

  Scenario: dbt result shape no longer matches the parser's expectations — suite skips with the probe named
    Given the dbt result shape no longer matches the parser's expectations
    When the eject orchestrator runs its earned-trust probes
    Then the suite skips with the failing probe named "probe_run_results_shape"

  # Behavioral enforcement reference (ADR-019 §4 — principle 12 self-application):
  # a CI-only test asserts that this entire .feature file produces 5 skip
  # outcomes when the substrate is sabotaged, proving the probe path is
  # actually wired. Implementation lives in DELIVER alongside the
  # probe functions themselves.
