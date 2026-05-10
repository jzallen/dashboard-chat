# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 3 — Call-site stability: HTTP envelope, error responses, and
# external use-case return shape are all unchanged by the refactor.
#
# Per ADR-022 §Decision-Outcome §Behaviour-preservation-guarantees, DESIGN
# §5 Migration / call-site impact ("Single in-tree caller of the use case
# is `HTTPController.post_dataset` … Use-case external signature is
# unchanged"), and DWD-5 in DESIGN's wave-decisions.md ("External use-
# case return shape preserved"), the only in-tree consumer of the use
# case is `DatasetController.post_dataset` at
# backend/app/controllers/dataset_controller.py:107. After the refactor:
#
#   - The controller's JSON envelope for a successful single upload
#     is unchanged (status 201, JSON:API single-resource envelope under
#     the `datasets` type, with the dataset's id appearing in the
#     self-link).
#   - The controller's behaviour for a multi-upload is preserved
#     verbatim — the latent `serialize(list_of_datasets)['id']` raise is
#     pre-existing and is NOT in scope to fix (ADR-022 follow-up #3).
#     This milestone pins that the failure mode is unchanged: the
#     refactor neither makes it worse nor better. The acceptance scenario
#     for the multi-path encodes the current observable: an exception
#     bubbles to the controller with the same error shape as today.
#   - Failure cases (no plugin matches, invalid file content, partial
#     multi-failure) raise the same exceptions to the same call sites
#     with the same `Failure(e)` shape per CLAUDE.md error format
#     conventions.
#
# Driving port = `DatasetController.post_dataset` invoked through its
# normal HTTP-shaped interface (the controller method is the public
# adapter; calling it directly is the same boundary HTTP requests cross
# in production). Step glue invokes the controller method by name with
# the production-shaped arguments and asserts on the returned (envelope,
# status_code) tuple (Mandate 1 — entering through the driving adapter).

@milestone_3 @real-io @driving_adapter @call_site_stability @pending
Feature: HTTPController.post_dataset envelope, status codes, and error shapes are unchanged after the refactor
  As a backend engineer asserting that no caller of the upload pipeline observes a change,
  I want the HTTP controller to return the same JSON envelope and status code
  for a successful single upload, and the same error shapes for the same failure cases
  So I can land the use-case-internal modularity refactor with zero contract change at the HTTP boundary.

  Background:
    Given a fresh SQLite-backed repository container
    And a stubbed object-store client wired into the lake repository
    And the dataset controller is bound to the use cases

  Scenario: Single-file upload returns the same JSON:API envelope and 201 status as before
    Given a project "Imports" exists in the database
    And an upload event is recorded for "test_data.csv" against that project
    And the stubbed object store will return a 3-row CSV when the raw upload is read
    When the engineer posts the dataset through the controller for that upload
    Then the controller returns status code 201
    And the controller envelope's "data" entry has type "datasets"
    And the controller envelope's self-link references the returned dataset id

  Scenario: Multi-file upload preserves today's controller behaviour verbatim
    Given a project "Imports" exists in the database
    And an upload event is recorded for "data.mmock" against that project with plugin name "mock_multi"
    And the plugin registry contains a mock multi-result plugin named "mock_multi" producing two datasets
    And the stubbed object store will return raw upload bytes when the file is read
    When the engineer posts the dataset through the controller for that upload
    Then the controller returns the same observable result as before the refactor for the multi-upload path

  Scenario: When no plugin matches and the file is not valid CSV, the controller surfaces the same error shape
    Given a project "Imports" exists in the database
    And an upload event is recorded for "bad.csv" against that project with no plugin name
    And no plugin registry is provided to the use case
    And the stubbed object store will return non-CSV binary bytes when the raw upload is read
    When the engineer posts the dataset through the controller for that upload
    Then the controller returns a non-success status code
    And the controller envelope describes a domain failure for the upload pipeline

  Scenario: Partial-failure multi-upload preserves today's Failure shape at the controller boundary
    Given a project "Imports" exists in the database
    And an upload event is recorded for "data.mfail" against that project with plugin name "mock_multi_fail"
    And the plugin registry contains a mock multi-result plugin named "mock_multi_fail" producing two datasets
    And the stubbed object store will return raw upload bytes for the read but raise on the second parquet write
    When the engineer posts the dataset through the controller for that upload
    Then the controller returns a non-success status code
    And the controller envelope describes a storage-substrate failure on the second dataset write
