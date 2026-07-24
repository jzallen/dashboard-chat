# <!-- DES-ENFORCEMENT : exempt -->
# Phase 08 (slice 08, DC-88) — CONTRACT: drop embedded component columns
# (@infrastructure).
#
# The contract half of expand/contract; no user-visible output. After one
# release of read-from-rows for phases 03-07, drop views.{columns,joins,filters,
# grain} and reports.columns_metadata. Snapshot byte-identical proves nothing
# still reads JSON; a rollback path re-adds and re-backfills. BLOCKED BY Phases
# 03-07 + a one-release production gate. All scenarios @pending until Phase 08
# lands.

@contract_migration @driving_port @pending
Feature: The embedded component columns are retired after one safe release
  As an engineer,
  I want the now-unread stored-together columns dropped after one safe release
  So that the schema holds one source of truth and the write-both bridge is removed.

  Scenario: Dropping the embedded component columns keeps the rendered SQL byte-identical
    Given a store where phases 03 to 07 have run read-from-rows for one release
    When the contract migration drops the embedded component columns
    Then the embedded component columns are gone and the rendered SQL is byte-identical

  Scenario: The contract migration has a rollback path that re-adds and re-backfills the columns
    Given a store where phases 03 to 07 have run read-from-rows for one release
    When the rollback path is exercised
    Then the columns are re-added and re-backfilled from the normalized rows
