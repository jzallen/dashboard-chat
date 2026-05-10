# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 1 — Split the remaining seven aggregates with parity proof.
#
# Per ADR-020 §Decision outcome and DWD-1 in distill/wave-decisions.md,
# every aggregate goes through the same structural transformation: a new
# per-aggregate repository class, a new `RepositoryContainer` property,
# and an extension of `_LegacyMetadataFacade` to delegate the legacy
# methods to the new repo. The Scenario Outline below parameterises the
# parity contract over each aggregate's representative method (the
# create-method, since every aggregate has one and the assertion shape
# generalises). A failing example in the table localises the regression
# to a single aggregate without disturbing the others.
#
# Each row is a separate scenario from pytest-bdd's perspective; each
# runs against a real SQLite engine seeded with the row's
# `seed_fixture` precondition. The legacy facade keeps working (DWD-2)
# until milestone-2 removes it.

@aggregate_split @real-io @pending
Feature: Each per-aggregate repository preserves the legacy facade's behavior
  As a backend engineer applying the same split mechanism to each aggregate,
  I want one parity scenario per aggregate proving the new repository's
  observable output matches what the legacy MetadataRepository surface
  produces for the same call
  So that I can land the seven remaining aggregates with a uniform safety net.

  Background:
    Given a fresh SQLite-backed repository container

  Scenario Outline: <aggregate> repository create produces identical results through new repo and legacy facade
    Given the database is seeded for the "<aggregate>" aggregate
    When the engineer invokes "<create_method>" through the new "<aggregate>" repository property
    And the engineer invokes "<create_method>" through the legacy metadata facade
    Then both invocations return dictionaries with the same domain fields populated
    And both records are retrievable through their respective entry points

    Examples:
      | aggregate        | create_method            |
      | datasets         | create_dataset           |
      | transforms       | create_transform         |
      | sessions         | create_session           |
      | views            | create_view              |
      | reports          | create_report            |
      | organizations    | create_organization      |
      | project_memories | create_project_memory    |

  Scenario: Legacy facade emits a deprecation warning on construction
    Given a fresh SQLite-backed repository container
    When the engineer first accesses the legacy metadata facade
    Then a deprecation warning is emitted naming the new container properties

  Scenario: Cursor encoding for session pagination is byte-for-byte unchanged after the helpers move
    Given the database is seeded with three sessions for one memory
    When the engineer pages through sessions with limit 2 through the new sessions repository
    And the engineer pages through sessions with limit 2 through the legacy metadata facade
    Then both pagings return the same items in the same order
    And both pagings return identical cursor strings

  Scenario: Exception translation is preserved when the decorator is lifted to the shared base module
    Given the database is in a state where a transform insert violates a foreign key
    When the engineer attempts to create a transform through the new transforms repository
    Then a metadata repository error is raised carrying the SQLAlchemy error message

  Scenario: Foreign-key cascade across aggregates still fires through per-aggregate repositories
    Given a project with one dataset and one transform exists
    When the engineer deletes the project through the new projects repository
    Then the dataset is gone from the database
    And the transform is gone from the database
