# <!-- DES-ENFORCEMENT : exempt -->
# US-207 — Switching projects atomically retargets the project chip + session
# list within 300ms p95; in-flight chat turn is cancelled; agent never
# receives a mismatched (project_id, session_id); cache invalidation closes
# R9. Validates IC-J002-4.
#
# Slice 4 (MR-4) — the K-J002-4 North Star slice.

@mr_4 @us-207 @slice-4 @real-io
Feature: Project switches retarget chip and session list together, with no cross-tenant chat turns
  As Maya, who clicked a different project while a chat turn was streaming,
  I want the project chip and the session list to retarget atomically,
  So that I never see Q4 sessions in Q3's chat-view and the agent never gets a turn with the wrong project.

  @happy_path
  Scenario: Switching projects atomically retargets active scope and the session list within 300ms p95
    Given J-002 is in session_active for "Q4 Analytics" with session "chat-9b2a"
    When Maya clicks project "Q3 Sales" in the nav rail
    Then J-002 transitions through switching_project to project_selected for "Q3 Sales"
    And the session_id is invalidated to null
    And the active scope's project_id equals the id of "Q3 Sales"
    And the active scope has no resource_id
    And the FE renders the session list for "Q3 Sales"
    And no session from "Q4 Analytics" appears in the list at any point
    And the project chip and the session list paint on the SAME first paint after the switch
    And the switch completes within 300ms at p95

  @error_path @property
  Scenario: A chat turn in flight during a project switch is cancelled before the new loader runs
    Given J-002 is in session_active for "Q4 Analytics" with session "chat-9b2a"
    And Maya has typed "what's the avg rev by region" and pressed Enter
    And the agent's SSE stream is mid-response
    When Maya clicks project "Q3 Sales" before the chat turn completes
    Then the FE closes the SSE stream
    And the agent receives no further frames from that stream
    And the agent never receives a turn carrying both project_id = "Q3 Sales" AND session_id = "chat-9b2a"
    And J-002 transitions to project_selected for "Q3 Sales"
    And the partial response in the Q4 transcript is NOT carried into Q3's chat-view

  @happy_path
  Scenario: Deep-link mid-session switches projects via the loader
    Given J-002 is in session_active for "Q4 Analytics"
    When Maya navigates to "/projects/q3-sales"
    Then the RRv7 loader for the new URL runs
    And J-002 emits switching_project_intent with new_project_id = id of "Q3 Sales"
    And J-002 transitions through switching_project to project_selected for "Q3 Sales"

  @error_path
  Scenario: Switching to a project the user no longer has access to surfaces a named-diagnostic
    Given J-002 is in session_active for "Q4 Analytics"
    And Maya's access to project "Strategic" was revoked an hour ago
    When Maya clicks a stale "Strategic" link in the nav
    Then J-002 transitions switching_project → scope_mismatch_terminal
    And the cause tag is "access_revoked"
    And the panel reads "This project is no longer accessible"
    And J-002 does NOT transition through project_selected for Strategic at any point

  @harness @needs_ts_harness
  Scenario: The TS harness asserts atomic switching and SSE cancellation
    Given the TS harness is in session_active for "Q4 Analytics" with session "chat-9b2a"
    When the harness calls `harness.j002.switch_project("Q3 Sales")`
    Then J-002 reaches project_selected for "Q3 Sales"
    And `harness.j002.assert_scope({project_id: "<q3-id>"})` succeeds
    And `harness.j002.assert_session_active(any)` returns null
    And the seeded chat-turn-in-flight from Q4 is observed as cancelled in the agent's request log
