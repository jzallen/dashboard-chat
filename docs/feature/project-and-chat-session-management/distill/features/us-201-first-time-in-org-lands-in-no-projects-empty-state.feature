# <!-- DES-ENFORCEMENT : exempt -->
# US-201 — First-time-in-org user lands in the no-projects empty state.
#
# Slice 1 (MR-1) — walking-skeleton territory. Drives J-002's
# `resolving_initial_scope → no_projects_empty_state → creating_project →
# project_selected` happy path plus the validation + transient-failure
# recovery shapes. Strategy C (real local) per DD-2.
#
# Driving port: `reverse-proxy` HTTP ingress. The FE root loader reads
# the J-002 projection on entry; the welcome panel is SSR'd. The CTA
# routes through `auth-proxy → ui-state → backend create_project`.

@mr_1 @us-201 @slice-1 @real-io
Feature: First-time-in-org Maya is foregrounded into creating her first project
  As Maya, who has just completed J-001 with an org but zero projects,
  I want a foregrounded next step at sign-in,
  So that I do not pause to scan the nav wondering what to click first.

  Background:
    Given the J-002 machine is registered with the orchestrator
    And Maya has just completed J-001 with org "Acme Data"
    And Maya's org has zero projects

  @happy_path @walking_skeleton
  Scenario: First sign-in foregrounds the no-projects welcome panel
    When J-002 enters from the J-001 ready broadcast
    Then J-002 transitions through resolving_initial_scope to no_projects_empty_state
    And the FE shows "Welcome to Acme Data, Maya! Let's get started by creating your first project."
    And no project chip is painted on the app shell
    And the active scope has no project_id
    And the welcome-state suggestion chips for "Upload CSV" and "Browse Projects" are not shown
    And the transition completes within 300ms at p95

  @happy_path
  Scenario: Creating a first project lands Maya in project_selected
    Given J-002 is in no_projects_empty_state
    When Maya types "Q4 Analytics" and submits the create-project form
    Then J-002 transitions through creating_project to project_selected
    And the active scope's project_id equals the id of "Q4 Analytics"
    And the FE app shell paints the project chip "Q4 Analytics" on first paint
    And J-002 transitions onward to session_list_visible with a zero-session list

  @error_path @boundary
  Scenario: Empty project name keeps J-002 in no_projects_empty_state with an inline error
    Given J-002 is in no_projects_empty_state
    When Maya submits the create-project form with an empty name
    Then J-002 stays in no_projects_empty_state
    And the FE shows an inline error "Please enter a project name"
    And no project is created
    And no create-project request is sent to the backend

  @error_path
  Scenario: Transient create-project failure surfaces a recoverable-error with the typed name preserved
    Given J-002 is in no_projects_empty_state with composer text "Q4 Analytics"
    When Maya submits the create-project form
    And the backend returns a transient failure for the create-project request
    Then J-002 transitions to error_recoverable
    And the cause tag is "transient"
    And a correlation reference is shown alongside the retry CTA
    And the composer still shows the text "Q4 Analytics"
    When Maya clicks "Try again"
    Then J-002 re-enters creating_project with the same correlation reference
    And on the next success J-002 transitions to project_selected for "Q4 Analytics"

  @harness @needs_ts_harness
  Scenario: The TS harness drives the no-projects path end-to-end
    Given the TS harness has driven J-001 to ready for persona "maya-first-time"
    When the harness calls `harness.j002.create_first_project("Q4 Analytics")`
    Then J-002 reaches project_selected for "Q4 Analytics"
    And `harness.j002.assert_scope({project_id: <q4-id>})` succeeds
