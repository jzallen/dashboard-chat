# <!-- DES-ENFORCEMENT : exempt -->
# Story 01 (DC-81) — Report projection on the typed kernel.
#
# Report's columns_metadata dict-soup is lifted onto Pydantic discriminated
# unions over semantic_role (mirroring ViewFilterVariant over operator). A
# malformed column is rejected at the create-report use-case boundary, never at
# render time; validate_columns_metadata retires. Storage stays JSON this story.
# All scenarios @pending until this story lands.

@boundary_validation @driving_port @pending
Feature: A malformed report column is rejected at the boundary by the typed kernel
  As a modeler authoring a report,
  I want an invalid column rejected the moment I submit it
  So that a malformed projection can never reach the renderer and produce a broken mart.

  Scenario: A report column with an unknown semantic role is rejected at the boundary
    Given a report definition whose column carries an unknown semantic role "sparkle"
    When the report is submitted through the create-report use case
    Then the report is rejected at the boundary and nothing is persisted

  Scenario: A report column with an illegal role and type pairing is rejected by the typed union
    Given a report definition pairing an illegal semantic role and semantic type
    When the report is submitted through the create-report use case
    Then the report is rejected by the typed union rather than the retired free function

  Scenario: Every existing report loads through the typed projection kernel
    Given the store holds every existing report shape
    Then every report hydrates through the typed projection kernel without error
