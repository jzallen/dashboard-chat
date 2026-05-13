# <!-- DES-ENFORCEMENT : exempt -->
# US-202 — Returning user lands in their last-used project.
#
# Slice 1 (MR-1) walking-skeleton story. Validates the resolver's
# happy path (last-used), the lexicographic fallback for projects-but-
# no-sessions, the tie-breaker invariant, and OQ-J002-4's partial-result
# degraded resolution. Strategy C (real local) per DD-2.

@mr_1 @us-202 @slice-1 @real-io
Feature: Returning Maya lands in her last-used project on sign-in
  As Maya, who has multiple projects and was last active in one of them,
  I want sign-in to put me back where I was,
  So that I can resume work without an extra "pick a project" step.

  Background:
    Given the J-002 machine is registered with the orchestrator
    And Maya completes J-001 for org "Acme Data"

  @happy_path
  Scenario: Resolution picks the project carrying the most-recent session
    Given Maya has projects "Q3 Sales", "Q4 Analytics", "Marketing 2026"
    And the most-recent session across all three is in "Q4 Analytics"
    When J-002 transitions through resolving_initial_scope to project_selected
    Then the active scope's project_id equals the id of "Q4 Analytics"
    And the FE app shell paints the project chip "Q4 Analytics" on first paint
    And the project chip and the org chip paint on the SAME first paint

  @happy_path
  Scenario: Projects with no sessions fall back to lexicographically smallest project name
    Given Maya has projects "Marketing 2026", "Q3 Sales", "Q4 Analytics"
    But none of the projects has any sessions yet
    When J-002 transitions through resolving_initial_scope to project_selected
    Then the project chip reads "Marketing 2026"
    And the session list is empty (no-sessions empty-state sub-shape)
    And the welcome chips "Upload CSV" and "Browse Projects" are visible

  @boundary @property
  Scenario: Tie-broken last-active times pick the lexicographically smaller project id deterministically
    Given Maya has projects A and B with most-recent session timestamps both equal to T
    When J-002 resolves the last-used project
    Then J-002 picks the project with the lexicographically smaller id
    And the choice is deterministic across cold restarts

  @error_path @degraded
  Scenario: Transient list-sessions failure during last-used resolution does not block sign-in
    Given Maya has projects "Q3 Sales", "Q4 Analytics"
    But list-sessions for "Q4 Analytics" returns a transient failure
    When J-002 resolves the last-used project
    Then J-002 picks "Q3 Sales" based on partial-result resolution
    And a `last_used_resolution_degraded` event is emitted with the degraded project id
    And Maya still lands in project_selected for "Q3 Sales" within 800ms at p95

  @harness @needs_ts_harness
  Scenario: The TS harness asserts the initial-project resolution
    Given the TS harness has driven J-001 to ready for persona "maya-returning"
    And the fixture seeds three projects with the most-recent session in "Q4 Analytics"
    When the harness calls `harness.j002.assert_initial_project("Q4 Analytics")`
    Then the assertion succeeds
    And the assertion reads the active scope's project_id from the J-002 projection
