# Walking-skeleton acceptance for dbt-test-validation (ADR-019, Option β).
#
# Strategy C (real local I/O) per DWD-1: the 5-service compose stack runs
# real auth-proxy + backend + worker + query-engine + MinIO; real
# `dbtRunner` from `dbt.cli.main`; real DuckDB; real MinIO Parquet read
# path. The single thin slice through the harness facade is what the
# customer's first ejected run does.
#
# Per the DISTILL skill's Driving Adapter mandate (RCA P1, 2026-04-10), this
# walking-skeleton scenario MUST exercise the user's actual entry point.
# Here that entry point is the DatasetLayerHarness Python facade — the
# canonical test-time driver per architecture/brief.md §"Test architecture".
# The scenario invokes `DatasetLayerHarness.set_dataset_schema_config(...)`
# followed by `DatasetLayerHarness.eject_and_test(...)` through the public
# API, NOT through internal helpers (no direct EjectAndTestOrchestrator
# construction in step glue).
#
# Walking skeleton asserts wiring (model built + test executed). Pass/fail-
# status assertions belong to milestone-1 (Phase 2) where fixtures make
# outcomes deterministic. Per DWD-9.
#
# Setup is fixture-driven (NOT chat-driven): the chat layer has no
# production code path that writes `schema_config.constraints` — no
# prompt, no tool, no endpoint — so a chat-asks @when can never produce
# the constraint that makes the schema.yml exporter emit a dbt test.
# This scenario reuses milestone-1's shape-correct @given to PATCH a
# `required: true` constraint via the dataset API, which deterministically
# drives one model build + one test execution end-to-end. Chat-driven
# wiring coverage (no test assertion) is a candidate follow-up scenario.

@walking_skeleton @driving_adapter
Feature: Customer can re-run validations on an ejected project
  As a Dashboard Chat user who finished a cleaning workflow,
  I want the staging models I produced to behave the same way
  when I unzip the project and run dbt myself
  So I keep my workflow when I outgrow the chat surface.

  Background:
    Given the dataset-layer harness is ready against the running compose stack
    And the eject orchestrator has passed its earned-trust probes

  Scenario: Customer ejects a constraint-aware project and re-validates it as dbt
    Given a fresh project with a small orders dataset uploaded
    And a chat workflow has produced a staging model that is shape-correct
    When the customer ejects the project and re-runs the validations
    Then every staging model in the eject was built and tested
