<!-- DES-ENFORCEMENT : exempt -->
# Milestone 1 — port-extraction correctness for the new QueryEnginePort.
#
# This file is the DISTILL-wave SSOT of the milestone-1 scenarios. The
# runnable copy lives at:
#   tests/acceptance/extract-dataset-query-port/query-engine-port-honors-boundary-contract.feature
# and is byte-identical to this file. Updates to one MUST update the other
# in the same commit (DWD-2 binding).
#
# This milestone proves the port boundary is honored AFTER the new
# package (`backend/app/query_engine/`) ships and the `_FakeConnection`
# ladder relocates per DWD-4. The legacy `Dataset.query_preview_rows`
# method is still in place at this milestone — it temporarily delegates
# to the adapter (Mikado-style: tests move first, code delegates next,
# refactor finishes last). What the customer sees is unchanged.
#
# Driving port: `QueryEnginePort.execute_dataset_query(dataset, limit)`.
# Scenarios stay at the port boundary — internal helpers (ALL_MACROS
# iteration, asyncpg copy_from_query mechanics) are exercised
# indirectly through observable outputs the port either returns or
# emits to the connection it acquired.
#
# Scenarios are toggled @pending one at a time as DELIVER lands the
# adapter and its connection-scoped tests. M1 unlocks alongside Phase
# 00 (walking skeleton + fixture relocation) per roadmap.json.

@adapter-integration @driving_port
Feature: Query engine port preserves the COPY route, macros, and pool semantics

  Background:
    Given the query engine port has been wired into the repository container

  @pending
  Scenario: COPY-from-stdout route is preserved byte-for-byte through the new port
    Given a dataset named "N" with a single text column "a" under project "proj-y" and dataset id "ds-x"
    And the storage bucket is configured as "test-bucket"
    And a recording connection that captures every operation it receives
    When the dataset's preview rows are fetched through the query engine port with limit 5
    Then the recording connection received exactly one COPY-from-stdout call
    And the recorded outer SQL was "SELECT (r['row'])::text FROM duckdb.query($1) r"
    And the recorded inner SQL was "SELECT CAST(to_json(t) AS VARCHAR) AS row FROM (SELECT * FROM read_parquet('s3://test-bucket/datasets/proj-y/ds-x/**/*.parquet') AS \"t0\") t LIMIT 5"
    And no macro registrations were issued on the recording connection

  @pending
  Scenario: Empty-schema dataset short-circuits without touching the connection pool
    Given a dataset with no schema columns configured
    When the dataset's preview rows are fetched through the query engine port
    Then no preview rows are returned
    And the connection pool was never acquired

  @pending
  Scenario: Custom-case transforms register every macro through pg_duckdb's raw_query shim
    Given a dataset with a single text column "name" and a clean transform with mode "snake"
    And a recording connection that captures every operation it receives
    When the dataset's preview rows are fetched through the query engine port with limit 10
    Then the recording connection received one macro registration call per registered macro
    And every macro registration call ran the SQL "SELECT duckdb.raw_query($1)"
    And the macro bodies recorded as positional arguments equal the project's macro catalogue in order

  @pending
  Scenario: Built-in case modes do not trigger custom macro registration
    Given a dataset with a single text column "name" and a clean transform with mode "upper"
    And a recording connection that captures every operation it receives
    When the dataset's preview rows are fetched through the query engine port with limit 10
    Then no macro registrations were issued on the recording connection

  @pending
  Scenario: Macros register on the same connection that runs the preview query
    Given a dataset whose transforms request a snake-case clean operation
    And a recording connection that captures every operation it receives
    When the dataset's preview rows are fetched through the query engine port with limit 10
    Then the same connection that ran the COPY-from-stdout call also received the macro registrations
    And the macro registrations happened before the COPY-from-stdout call

  @pending
  Scenario: Sequential previews on the same dataset acquire and release pool connections cleanly
    Given a dataset whose transforms request a snake-case clean operation
    When the dataset's preview rows are fetched through the query engine port three times in a row
    Then each preview call acquires its own connection from the pool
    And each call registers the customer's macros exactly once on its own connection
    And no connection receives the same macro registration twice

  @pending
  Scenario: Adapter rejects a connection that cannot speak pg_duckdb with a named error
    Given a connection whose pg_duckdb extension is not loaded
    And a dataset whose transforms request a snake-case clean operation
    When the dataset's preview rows are fetched through the query engine port with limit 10
    Then the customer sees a query engine error naming pg_duckdb as the missing capability
    And no preview rows are returned
