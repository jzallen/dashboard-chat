# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 2 — CRITICAL CHARACTERIZATION: pin the silent outbox-payload
# asymmetry between single-file and multi-file uploads.
#
# Per ADR-022 §Context-and-problem-statement bullet (2), §Behaviour-
# preservation-guarantees, DESIGN §1 problem statement bullet (2),
# DESIGN §7 risks #1 (CRITICAL), and DWD-2 in DESIGN's wave-decisions.md
# (HARD GATE), this milestone is non-negotiable. The current production
# behaviour:
#
#   - Multi-file path (`len(results) > 1`) calls
#     `outbox_repo.update_payload(upload_id, {"dataset_ids": [...],
#     "dataset_id": first_id})` after the per-result loop.
#   - Single-file path does NOT update the outbox payload at all
#     (no `dataset_ids`, no `dataset_id` keys are written).
#
# The refactor preserves this with an explicit `if len(results) > 1`
# guard at the unified terminal block (DWD-2 in DESIGN: must appear in
# code, not as a comment). These scenarios pin both halves so the
# refactor cannot silently align the two paths — that would be a
# behaviour change, out of scope per the task brief, and would force a
# coordinated change to the controller envelope (a separate future
# feature; ADR-022 follow-up #2 + #3).
#
# The single-path absence assertion is THE NEW characterization test
# this DISTILL adds (DWD-2 binding effect on DISTILL: "MUST add a new
# absence-assertion characterization test"). The multi-path presence
# assertion already exists at backend/tests/use_cases/dataset/
# test_create_dataset_from_upload.py::TestCreateDatasetFromUploadCharacterization::
# test_multi_dataset_persists_dataset_ids_and_first_id_in_outbox_payload
# and stays Iron-Rule-bound; this feature file restates it as an
# acceptance-level pin so the DELIVER wave's roadmap can sequence the
# absence assertion + the existing presence assertion together as a
# single observable contract.
#
# THE BOUNDARY THAT DETERMINES PAYLOAD WRITE = `len(results) > 1`. The
# canonicalization layer always returns `MultiProcessingResult` with a
# `results` list; the use-case body's terminal block reads
# `len(canonical.results)` and applies the guard. The observable outbox
# payload reflects exactly that boundary.

@milestone_2 @real-io @asymmetry_preservation @characterization @pending
Feature: Outbox-payload asymmetry between single-file and multi-file uploads is preserved verbatim
  As a backend engineer who must NOT silently change observable system behaviour during a modularity refactor,
  I want the single-file upload path to leave the outbox payload free of dataset_ids/dataset_id keys
  and the multi-file upload path to write dataset_ids and dataset_id into the outbox payload exactly as before
  So no consumer of the outbox stream (downstream sync, reporting, audit) sees a behaviour change from this refactor.

  Background:
    Given a fresh SQLite-backed repository container
    And a stubbed object-store client wired into the lake repository

  Scenario: Single-file upload leaves the outbox payload free of dataset_ids and dataset_id keys
    Given a project "Imports" exists in the database
    And an upload event is recorded for "test_data.csv" against that project
    And the stubbed object store will return a 3-row CSV when the raw upload is read
    When the engineer runs the upload-to-dataset use case for that upload
    Then the use case returns a single dataset
    And the outbox payload for that upload does not contain a "dataset_ids" key
    And the outbox payload for that upload does not contain a "dataset_id" key

  Scenario: Multi-file upload records dataset_ids and dataset_id in the outbox payload
    Given a project "Imports" exists in the database
    And an upload event is recorded for "data.mmock" against that project with plugin name "mock_multi"
    And the plugin registry contains a mock multi-result plugin named "mock_multi" producing two datasets
    And the stubbed object store will return raw upload bytes when the file is read
    When the engineer runs the upload-to-dataset use case for that upload
    Then the use case returns a list of datasets
    And the list of returned datasets has length 2
    And the outbox payload for that upload contains a "dataset_ids" list of length 2
    And the outbox payload's "dataset_id" matches the first returned dataset's id

  Scenario: The boundary that determines the payload write is the canonical result length being greater than one
    Given a project "Imports" exists in the database
    And the dispatcher will canonicalize the pipeline result with exactly one entry for one upload
    And the dispatcher will canonicalize the pipeline result with exactly two entries for another upload
    When the engineer runs the upload-to-dataset use case for both uploads
    Then the outbox payload for the one-entry upload does not contain a "dataset_ids" key
    And the outbox payload for the one-entry upload does not contain a "dataset_id" key
    And the outbox payload for the two-entry upload contains a "dataset_ids" key
    And the outbox payload for the two-entry upload contains a "dataset_id" key
