# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 2 — Remove `_LegacyMetadataFacade` and the legacy access surface.
#
# Phase 03 in the roadmap. After every use case has migrated off the
# facade (Phase 02 exit criterion), the facade is deleted and the
# architectural rule (`pytest-archon` per DWD-7 in DESIGN's wave-
# decisions) is promoted from warn to error. These scenarios prove the
# removal is safe AND that the architectural enforcement bites.

@facade_removal @pending
Feature: Legacy MetadataRepository facade is removed without breaking callers
  As a backend engineer landing the terminal phase of the refactor,
  I want proof that no production code still depends on the facade
  And that an attempt to re-introduce a dependency is caught at CI
  So that the refactor's safety net stays intact after the facade is gone.

  Scenario: No use case in the migrated codebase imports MetadataRepository or the facade
    Given the production source tree under "backend/app/use_cases"
    When the engineer scans for legacy metadata repository imports
    Then no module imports MetadataRepository or LegacyMetadataFacade

  Scenario: Accessing the legacy metadata property raises after removal
    Given a fresh SQLite-backed repository container with the facade removed
    When the engineer accesses the legacy metadata property on the container
    Then an attribute error is raised

  Scenario: Accessing the legacy metadata_repository key raises after removal
    Given a fresh SQLite-backed repository container with the facade removed
    When the engineer requests the legacy "metadata_repository" key from the container
    Then a key error is raised naming the unknown repository

  Scenario: Architectural enforcement rule rejects a re-introduced legacy import
    Given a candidate use-case module that re-introduces a MetadataRepository import
    When the architectural rule is evaluated against the production source tree
    Then the rule fails naming the offending module

  Scenario: All eight per-aggregate repositories are reachable through container properties
    Given a fresh SQLite-backed repository container with the facade removed
    When the engineer requests each per-aggregate property in turn
    Then each property yields a constructed repository instance bound to the same session
