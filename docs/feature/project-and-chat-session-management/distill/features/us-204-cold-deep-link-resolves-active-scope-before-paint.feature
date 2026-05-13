# <!-- DES-ENFORCEMENT : exempt -->
# US-204 — Cold deep-link to a project URL resolves `active_scope` before
# the page paints; cross-tenant / project-not-found land at
# `scope_mismatch_terminal`; back-to-projects re-enters resolution.
#
# Slice 1 (MR-1) walking-skeleton extension. Exercises ScopeResolver
# invariant 4 (ADR-029 §1) at first paint. Strategy C per DD-2.

@mr_1 @us-204 @slice-1 @real-io
Feature: Cold deep-links resolve active scope before the page paints
  As Maya, opening a bookmarked URL in a fresh tab,
  I want the project context to settle before the page renders,
  So that the first paint reflects where I am, not a placeholder I have to wait through.

  @happy_path
  Scenario: Cold deep-link to a project URL resolves active scope before paint
    Given Maya has access to project "Q4 Analytics"
    When Maya opens "/projects/q4-analytics" cold in a fresh tab and completes sign-in
    Then J-002 enters resolving_initial_scope with intent_project_id = "q4-analytics"
    And J-002 transitions to project_selected with the active scope's project_id equal to "q4-analytics"
    And the project chip reads "Q4 Analytics" on first paint
    And the page body renders project-scoped content on the SAME first paint
    And no chip shows a placeholder (e.g. "Loading...", "Default Project", or empty) at any point
    And the first-paint latency is < 300ms at p95

  @error_path @cross_tenant
  Scenario: Cross-tenant deep-link lands in the scope-mismatch terminal panel
    Given Maya is in org "Acme Data"
    And there exists project "Strategic" in a different org that Maya cannot access
    When Maya opens "/projects/strategic" cold and completes sign-in
    Then J-002 transitions resolving_initial_scope → scope_mismatch_terminal
    And the cause tag is "cross_tenant"
    And the FE shows "This project is no longer accessible"
    And a correlation reference of the form "R-..." is visibly displayed
    And a "Back to projects" CTA is the primary action
    And no project chip with the cross-tenant project's name is painted at any point

  @error_path @boundary
  Scenario: Deep-link to a deleted project surfaces the same panel with a different cause tag
    Given Maya is in org "Acme Data"
    And project "Q3 Sales" existed in "Acme Data" yesterday but was deleted
    When Maya opens "/projects/q3-sales" cold
    Then J-002 transitions to scope_mismatch_terminal
    And the cause tag is "project_not_found"
    And the panel still reads "This project is no longer accessible"
    And a "Back to projects" CTA is the primary action

  @happy_path
  Scenario: Back-to-projects CTA re-enters resolving_initial_scope with intent cleared
    Given J-002 is in scope_mismatch_terminal for intent_project_id = "strategic"
    When Maya clicks "Back to projects"
    Then J-002 transitions to resolving_initial_scope with intent cleared
    And J-002 resolves to project_selected for Maya's last-used project OR to no_projects_empty_state

  @happy_path
  Scenario: Deep-link with an intent_resource carries through to session_active
    Given Maya has access to project "Q4 Analytics" with dataset "sales_2026"
    When Maya opens "/projects/q4-analytics/datasets/sales_2026" cold and completes sign-in
    Then J-002 enters resolving_initial_scope with both intent_project_id AND intent_resource_id
    And J-002 transitions to project_selected with project_id = "q4-analytics"
    And J-002 transitions onward to session_active with the active scope's resource_id = "sales_2026"
    And the dataset chip in the chat input gutter reads "sales_2026" on first paint

  @harness @needs_ts_harness
  Scenario: The TS harness drives deep-link resolution for both happy and cross-tenant paths
    Given the TS harness is initialized
    When the harness calls `harness.j002.open_deep_link({project_id: "q4-analytics"})`
    Then J-002 reaches project_selected for "q4-analytics"
    And `harness.j002.assert_scope({project_id: "q4-analytics"})` succeeds
    When the harness calls `harness.j002.open_deep_link({project_id: "strategic"})`
    Then J-002 reaches scope_mismatch_terminal
    And `harness.j002.assert_scope_mismatch({underlying_cause_tag: "cross_tenant"})` succeeds
