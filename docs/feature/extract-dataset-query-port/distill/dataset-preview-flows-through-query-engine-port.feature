<!-- DES-ENFORCEMENT : exempt -->
# Walking-skeleton acceptance for extract-dataset-query-port (ADR-021).
#
# This file is the DISTILL-wave SSOT of the walking-skeleton scenario.
# The runnable copy lives at:
#   tests/acceptance/extract-dataset-query-port/dataset-preview-flows-through-query-engine-port.feature
# and is byte-identical to this file. Updates to one MUST update the other
# in the same commit (DWD-2 binding).
#
# Strategy C (real local I/O) — mirrors dbt-test-validation/dataset-preview-flows-through-query-engine-port.feature
# (DWD-1 there). The 5-service compose stack runs real auth-proxy + backend +
# worker + query-engine (Postgres + pg_duckdb) + MinIO. The walking skeleton
# threads a real `Dataset` whose preview is fetched through the new
# `QueryEnginePort` against the running query-engine pool, and pins the exact
# `outer_sql` / `inner_sql` constants that ``test_dataset.py:963-970`` pin
# today. If those constants change between this scenario and the relocated
# adapter test, the refactor is wrong, not the test (Iron Rule + DWD-4).
#
# The driving port for this feature is `QueryEnginePort.execute_dataset_preview`
# (DESIGN §4 Layout, DWD-1). Step glue calls this through the
# `RepositoryContainer.query_engine` slot the composition root publishes —
# never via a directly-imported adapter constructor (DWD-3).
#
# Walking skeleton asserts the ONE wiring fact that proves the port boundary
# is real: a dataset preview routed through the new port returns the same
# rows AND emits the same SQL the model used to emit. Per nw-test-design-mandates
# Walking Skeleton litmus test, this is the smallest end-to-end demo of
# "the same preview a customer would see, now sourced through the new seam."

@walking_skeleton @real-io @driving_adapter
Feature: Customer's dataset preview survives the query-engine port extraction
  As a Dashboard Chat user with an uploaded dataset and an enabled transform pipeline,
  I want my preview rows to keep arriving exactly as they did before
  the query-engine boundary refactor
  So my workflow is undisturbed by an internal seam change.

  Background:
    Given the query engine pool is reachable on the running compose stack
    And the query engine port has been wired into the repository container

  Scenario: Customer's dataset preview is fetched through the new port and matches the legacy SQL shape
    Given a dataset named "orders" with a single text column "a" stored under project "proj-y" and dataset id "ds-x"
    And the storage bucket is configured as "test-bucket"
    When the dataset's preview rows are fetched through the query engine port with limit 5
    Then the same preview rows the legacy path produced are returned
    And the query engine received exactly one COPY-from-stdout call
    And the outer SQL was "SELECT (r['row'])::text FROM duckdb.query($1) r"
    And the inner SQL was "SELECT CAST(to_json(t) AS VARCHAR) AS row FROM (SELECT * FROM read_parquet('s3://test-bucket/datasets/proj-y/ds-x/**/*.parquet') AS \"t0\") t LIMIT 5"
