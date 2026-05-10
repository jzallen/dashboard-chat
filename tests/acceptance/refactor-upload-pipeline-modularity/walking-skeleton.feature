# <!-- DES-ENFORCEMENT : exempt -->
# Walking-skeleton acceptance for refactor-upload-pipeline-modularity (ADR-022).
#
# Strategy: real I/O via SQLite + boto3.Stubber (DWD-1 in distill/wave-decisions.md).
# The "real adapter" surface for this refactor is:
#   1. The SQLAlchemy AsyncSession bound to an in-memory aiosqlite engine
#      (the same engine `backend/tests/conftest.py` uses), exercising the
#      OutboxRepository and MetadataRepository through the real
#      RepositoryContainer wiring used in production.
#   2. A boto3 Stubber wrapping a real `MinIOLakeRepository` instance so
#      the LakeRepository code path under refactor (CSV read +
#      partitioned-parquet write) executes verbatim — exactly as
#      backend/tests/use_cases/dataset/test_create_dataset_from_upload.py
#      drives it today.
# This is deliberately NOT a compose-stack walking skeleton: this refactor
# is purely use-case-internal (DESIGN §2 Option α; DWD-9 surface fence).
# No new external integration is in scope; the "real I/O" surface that
# proves the new wiring is exactly the one the existing 15 tests pin.
#
# The driving port is the existing `create_dataset_from_upload` use-case
# function — its external signature (`Result[Dataset | list[Dataset], str]`)
# does NOT change in this refactor (DWD-5 in DESIGN's wave-decisions). The
# walking skeleton enters through that public function the way
# `HTTPController.post_dataset` does in production, and asserts the
# observable single-file outcome: a `Success(Dataset)` returned to the
# caller, with the Dataset persisted and visible through normal repo reads.
#
# What the WS proves about the refactor:
#   - The new `UploadPluginDispatcher` class is reachable on the upload
#     pipeline (single-file CSV path).
#   - The internal `MultiProcessingResult` canonicalization is in place
#     (the dispatcher always returns the canonical shape; the use case
#     unwraps len-1 back to a single Dataset before returning).
#   - The external signature is preserved (still `Success(Dataset)` for a
#     single-file upload, NOT `Success([Dataset])`).
# If the dispatcher were swapped for an InMemory stand-in or the
# canonicalization layer skipped, this scenario would either fail (no
# dispatcher reachable) or change observable behaviour (return shape
# would shift). The WS is testing real wiring, not a fake (Mandate 6 /
# Dim 9d litmus test).

@walking_skeleton @real-io @driving_adapter
Feature: Single-file upload flows through the new dispatcher and canonicalization without breaking the external use-case shape
  As a backend engineer landing the upload-pipeline modularity refactor,
  I want a single-file CSV upload to flow through the new UploadPluginDispatcher
  and the new internal MultiProcessingResult canonicalization
  and still return a single Dataset to the caller exactly as before
  So I can land Phase 00 of the refactor without changing observable behaviour at the call site.

  Background:
    Given a fresh SQLite-backed repository container
    And a stubbed object-store client wired into the lake repository

  Scenario: Customer uploads a single CSV and receives a single dataset back through the new dispatcher
    Given a project "Quarterly Report" exists in the database
    And an upload event is recorded for "test_data.csv" against that project
    And the stubbed object store will return a 3-row CSV when the raw upload is read
    When the engineer runs the upload-to-dataset use case for that upload
    Then the use case returns a single dataset
    And the returned dataset's row count is 3
    And the returned dataset's column names are name, age, active
    And the dispatcher was used to produce the pipeline result
    And the pipeline result was canonicalized as a multi-result with exactly one entry
