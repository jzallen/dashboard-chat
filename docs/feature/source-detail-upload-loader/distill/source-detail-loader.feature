# Source-detail loader — back the upload modal's Files list from the backend (DC-184)
#
# Scenario SSOT for the DISTILL wave. The acceptance harness is vitest + RRv7
# `createMemoryRouter` (route hooks proven through the router, not called
# directly); the network boundary (the server loader's `apiFetch` to the backend)
# is the only faked seam. Business language only — the driving port (the
# `source/:sourceId` route loader) and the JSON:API envelope live in the step
# defs / loader, never in the prose here.
#
# Delivery mechanism: source-detail route loader (confirmed) — NOT catalog-seed.
# Fresh-upload ordering: persisted history first, fresh optimistic rows appended
# after (confirmed; matches the modal's current append direction).

Feature: A source's persisted upload history in the upload modal
  As someone reopening an existing data source
  I want the modal's Files list to show the files already uploaded to it
  So that I see the real history, not just what I uploaded this session

  Background:
    Given a project with an existing source "Sales Orders"

  @walking_skeleton
  Scenario: Opening an existing source shows its persisted files
    Given "Sales Orders" has two ingested files and one still-processing file recorded on the backend
    When I open that source's upload modal
    Then its Files list shows all three files, oldest first
    And each ingested file shows its row count and upload date
    And the still-processing file shows no row count yet

  @skip
  Scenario: A fresh upload appends after the persisted history
    Given "Sales Orders" already shows its persisted files in the modal
    When I upload another file to it in this session
    Then the new file appears after the existing files
    And the earlier files keep their original order

  @skip
  Scenario: A source with no uploads shows the empty state
    Given "Sales Orders" has no files recorded on the backend
    When I open that source's upload modal
    Then its Files list shows "No files yet"

  @skip
  Scenario: A failed history read does not break the modal
    Given the backend cannot return "Sales Orders"'s upload history
    When I open that source's upload modal
    Then the modal still opens
    And its Files list shows no persisted files instead of an error
    And I can still upload a new file, which appears in the list

  @skip
  Scenario: The history read never leaves the same-origin boundary
    When I open an existing source's upload modal
    Then the browser makes no direct call to the backend
    And the upload history is read through the same-origin app server
