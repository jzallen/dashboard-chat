# Walking-skeleton acceptance for dbt-test-validation (ADR-018, Option β).
#
# Strategy C (real local I/O) per DWD-1: the 5-service compose stack runs
# real auth-proxy + backend + worker + query-engine + MinIO; real Groq via
# the `dataset_layer_env` fixture; real `dbtRunner` from `dbt.cli.main`;
# real DuckDB; real MinIO Parquet read path. The single thin slice through
# the harness facade is what the customer's first ejected run does.
#
# Per the DISTILL skill's Driving Adapter mandate (RCA P1, 2026-04-10), this
# walking-skeleton scenario MUST exercise the user's actual entry point.
# Here that entry point is the DatasetLayerHarness Python facade — the
# canonical test-time driver per architecture/brief.md §"Test architecture".
# The scenario invokes `DatasetLayerHarness.chat_turn(...)` followed by
# `DatasetLayerHarness.eject_and_test(...)` through the public API, NOT
# through internal helpers (no direct EjectAndTestOrchestrator construction
# in step glue).

@walking_skeleton @real-io @driving_adapter
Feature: Customer can re-run validations on an ejected project
  As a Dashboard Chat user who finished a cleaning workflow,
  I want the staging models I produced via chat to behave the same way
  when I unzip the project and run dbt myself
  So I keep my workflow when I outgrow the chat surface.

  Background:
    Given the dataset-layer harness is ready against the running compose stack
    And the eject orchestrator has passed its earned-trust probes

  Scenario: Customer cleans a dataset via chat and re-validates it as ejected dbt
    Given a fresh project with a small orders dataset uploaded
    When the customer asks the chat to "drop rows where order_id is missing"
    And the customer ejects the project and re-runs the validations
    Then the ejected project re-validates successfully
    And every staging model the chat produced was built and tested
