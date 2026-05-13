# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 1 — UploadPluginDispatcher extracted as its own class.
#
# Per ADR-022 §Decision Outcome and DWD-1 in DESIGN's wave-decisions.md,
# this milestone proves the new `UploadPluginDispatcher` class:
#   - dispatches plugins by content-type / filename precedence
#   - raises typed errors when no plugin matches (preserves the current
#     Failure(e) shape per CLAUDE.md error format conventions)
#   - returns a `MultiProcessingResult` with one entry for single-file
#     uploads (degenerate-multi reframing — DWD-1)
#   - returns a `MultiProcessingResult` with N entries for multi-file
#     uploads
#
# Driving port = the existing `create_dataset_from_upload` use case
# entered through `RepositoryContainer` wiring — same as the walking
# skeleton, same as `HTTPController.post_dataset` in production. The
# dispatcher class itself is a use-case-internal coordinator (DWD-8 in
# DESIGN's wave-decisions); these acceptance scenarios exercise it via
# the use case to keep the hexagonal boundary honest (Mandate 1).
# Dispatcher-internal precedence/timeout micro-behaviour is covered by
# the ~5 dispatcher unit tests added in DELIVER Phase 01 alongside this
# milestone, per DWD-1.

@milestone_1 @real-io @driving_adapter @pending
Feature: Upload pipeline routes through the new UploadPluginDispatcher
  As a backend engineer reviewing the dispatcher extraction,
  I want each upload class (single-plugin, multi-plugin, fallback CSV, no-match)
  to flow through a single class with a uniform pipeline output shape
  So future plugin-protocol evolution touches the dispatcher only and not the use-case body.

  Background:
    Given a fresh SQLite-backed repository container
    And a stubbed object-store client wired into the lake repository

  Scenario: Single-plugin upload produces a one-entry canonical pipeline result
    Given a project "Imports" exists in the database
    And an upload event is recorded for "data.mock" against that project with plugin name "mock_single"
    And the plugin registry contains a mock single-result plugin named "mock_single"
    And the stubbed object store will return raw upload bytes when the file is read
    When the engineer runs the upload-to-dataset use case for that upload
    Then the use case returns a single dataset
    And the returned dataset's name is "Plugin Dataset"
    And the dispatcher canonical result contained exactly one entry

  Scenario: Multi-plugin upload produces an N-entry canonical pipeline result
    Given a project "Imports" exists in the database
    And an upload event is recorded for "data.mmock" against that project with plugin name "mock_multi"
    And the plugin registry contains a mock multi-result plugin named "mock_multi" producing two datasets
    And the stubbed object store will return raw upload bytes when the file is read
    When the engineer runs the upload-to-dataset use case for that upload
    Then the use case returns a list of datasets
    And the list of returned datasets has length 2
    And the returned dataset names are "Type A" and "Type B" in that order
    And the dispatcher canonical result contained exactly two entries

  Scenario: No-registry CSV fallback still produces a one-entry canonical pipeline result
    Given a project "Imports" exists in the database
    And an upload event is recorded for "test_data.csv" against that project with no plugin name
    And no plugin registry is provided to the use case
    And the stubbed object store will return a 3-row CSV when the raw upload is read
    When the engineer runs the upload-to-dataset use case for that upload
    Then the use case returns a single dataset
    And the returned dataset's row count is 3
    And the dispatcher canonical result contained exactly one entry
    And the returned dataset's name defaults to "New Dataset"

  Scenario: Plugin name on the event takes precedence over filename extension matching
    Given a project "Imports" exists in the database
    And an upload event is recorded for "data.unknown" against that project with plugin name "mock_single"
    And the plugin registry contains a recording mock single-result plugin named "mock_single"
    And the plugin registry also contains a different plugin claiming the ".unknown" extension
    And the stubbed object store will return raw upload bytes when the file is read
    When the engineer runs the upload-to-dataset use case for that upload
    Then the use case returns a single dataset
    And the recording plugin named "mock_single" was invoked
    And the plugin claiming the ".unknown" extension was not invoked
