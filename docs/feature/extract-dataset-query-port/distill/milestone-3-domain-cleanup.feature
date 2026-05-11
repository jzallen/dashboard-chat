<!-- DES-ENFORCEMENT : exempt -->
# Milestone 3 — domain cleanup: Dataset goes back to pure domain.
#
# This file is the DISTILL-wave SSOT of the milestone-3 scenarios. The
# runnable copy lives at:
#   tests/acceptance/extract-dataset-query-port/milestone-3-domain-cleanup.feature
# and is byte-identical to this file. Updates to one MUST update the other
# in the same commit (DWD-2 binding).
#
# After milestone-2 ships, every caller is on the new port. This
# milestone proves the legacy method can be removed AND the dataset
# model is freed of asyncpg / pg_duckdb / sql_functions imports —
# returning `Dataset` to the pure ADR-005 frozen-dataclass shape.
#
# The architectural-enforcement contract (ADR-021 §"Architectural
# enforcement (Principle 11)" + DWD-6) requires three layers — subtype
# (mypy + Protocol), structural (import-linter / pytest-archon), and
# behavioral (gold-test for startup-refused on probe failure). Of
# these, the structural rule is the one a customer-facing scenario
# can express: "the domain model never reaches into infrastructure."
#
# Driving port for this milestone: `QueryEnginePort.execute_dataset_query`
# (the only remaining preview-execution entry point) plus the
# composition root's `wire-then-probe-then-use` invariant exercised
# through the port's `probe()` method.
#
# Scenarios are @pending until DELIVER Phase 02 (domain cleanup).

@adapter-integration @driving_port
Feature: Dataset domain model returns to its pure shape; only the port speaks query engine

  Background:
    Given the query engine port has been wired into the repository container

  @pending
  Scenario: The legacy preview method on Dataset has been retired
    Given the dataset model has completed its deprecation cycle
    When the customer inspects the dataset model's public surface
    Then the legacy preview method is no longer offered on the dataset model
    And the only remaining way to fetch preview rows is through the query engine port

  @pending
  Scenario: The dataset model no longer reaches into the query engine infrastructure
    Given the dataset model has completed its deprecation cycle
    When the project's import boundaries are inspected
    Then the dataset model does not import the query engine connection pool
    And the dataset model does not import the project's macro catalogue
    And the dataset model does not import the asyncpg driver

  @pending
  Scenario: Only the query engine package speaks asyncpg
    Given the dataset model has completed its deprecation cycle
    When the project's import boundaries are inspected
    Then only the query engine package imports the asyncpg driver
    And the query engine package does not import the SQL generator library

  @pending
  Scenario: The query engine port refuses to start when its substrate is unreachable
    Given the query engine substrate is unreachable
    When the application starts up and the port runs its substrate probe
    Then startup is refused with a structured "query engine substrate refused" event
    And the customer never receives a preview from an uninitialised port

  @pending
  Scenario: The query engine port refuses to start when pg_duckdb is missing
    Given the query engine substrate accepts connections but pg_duckdb is not installed
    When the application starts up and the port runs its substrate probe
    Then startup is refused with a structured event naming pg_duckdb as the missing capability
    And the customer never receives a preview from a port that cannot run macros
