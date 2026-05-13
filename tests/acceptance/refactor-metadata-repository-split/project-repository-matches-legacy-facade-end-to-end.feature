# <!-- DES-ENFORCEMENT : exempt -->
# Walking-skeleton acceptance for refactor-metadata-repository-split (ADR-020).
#
# Strategy: real I/O via SQLite (DWD-1 in distill/wave-decisions.md). The
# repository layer's "real adapter" is the SQLAlchemy session bound to an
# in-memory SQLite engine — the same engine `backend/tests/conftest.py`
# uses for the existing per-aggregate test files. No compose stack is
# needed; no in-memory doubles are used. If the real adapter were swapped
# for a stub, this scenario would silently pass and prove nothing about
# the refactor's wiring (Mandate 6 / Dim 9d litmus test).
#
# The driving port is the `RepositoryContainer` — both the new
# `.projects` property (the post-split entry point) AND the legacy
# `.metadata` facade (the transitional shim per DWD-2). The scenario
# proves: same public-method invocation, same observable result. That is
# the entire contract of the refactor.

@walking_skeleton @real-io
Feature: Per-aggregate Project repository preserves the legacy facade's behavior
  As a backend engineer migrating call sites off the god-object,
  I want the new ProjectRepository and the legacy MetadataRepository facade
  to produce identical results for project create/read/update/delete
  So that I can migrate call sites incrementally without behavior risk.

  Background:
    Given a fresh SQLite-backed repository container

  Scenario: Project create-read-update-delete returns identical results through new repo and legacy facade
    Given an organization "Org-1" exists in the database
    When the engineer creates a project "Quarterly Report" through the new projects repository
    And the engineer creates a project "Quarterly Report" through the legacy metadata facade
    Then both projects carry the same observable dictionary shape
    And both projects are readable through their respective entry points
    And updating each project's description through its entry point persists identically
    And deleting each project through its entry point removes it from the database
