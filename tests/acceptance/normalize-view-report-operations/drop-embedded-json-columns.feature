# <!-- DES-ENFORCEMENT : exempt -->
# Story 08 (DC-88) — CONTRACT: drop embedded component columns
# (@infrastructure).
#
# The contract half of expand/contract; no user-visible output. After one
# release of read-from-rows for stories 03-07, drop views.{columns,joins,filters,
# grain} and reports.columns_metadata. The rendered SQL is unchanged from before
# the drop for the same in-test fixture, proving nothing still reads JSON; a
# rollback path re-adds and re-backfills. Depends on stories 03-07 having shipped
# read-from-rows and a one-release production gate. All scenarios @pending until
# this story lands.

@contract_migration @driving_port @pending
Feature: The embedded component columns are retired after one safe release
  As an engineer,
  I want the now-unread stored-together columns dropped after one safe release
  So that the schema holds one source of truth and the write-both bridge is removed.

  Scenario: Dropping the embedded component columns keeps the rendered SQL unchanged
    Given a store where stories 03 to 07 have run read-from-rows for one release
    When the contract migration drops the embedded component columns
    Then the embedded component columns are gone and the rendered SQL is unchanged from before the columns were dropped, for the same in-test fixture

  Scenario: The contract migration has a rollback path that re-adds and re-backfills the columns
    Given a store where stories 03 to 07 have run read-from-rows for one release
    When the rollback path is exercised
    Then the columns are re-added and re-backfilled from the normalized rows
