# <!-- DES-ENFORCEMENT : exempt -->
# US-206 — Clicking "+ New Session" produces an instant welcome-state with
# no backend write; the session row is eagerly created on first message
# with title = first message[:80]. No ghost rows when the user navigates
# away. Transient create-session failure preserves composer text.
#
# Slice 3 (MR-3). Pure machine extension; no schema delta. Validates the
# DWD-10 lazy-creation contract.

@mr_3 @us-206 @slice-3 @real-io
Feature: New sessions are real on first message, not before
  As Maya, who clicked "+ New Session" but has not typed anything yet,
  I want no ghost-row to appear in my session list,
  So that an exploratory click does not litter my history.

  @happy_path
  Scenario: Clicking "New Session" lands in session_active_no_messages with no backend write
    Given J-002 is in session_list_visible for "Q4 Analytics" with 4 prior sessions
    When Maya clicks "+ New Session" in the nav rail
    Then J-002 transitions to session_active_no_messages
    And the session_id is null
    And no row is created in the sessions table
    And the FE renders the welcome chips "Upload CSV" and "Browse Projects"
    And the chat input is enabled
    And the project chip remains "Q4 Analytics"

  @happy_path
  Scenario: Sending the first message eagerly creates the session row with title from message
    Given J-002 is in session_active_no_messages for "Q4 Analytics"
    When Maya types "Show me top customers by revenue" and presses Enter
    Then J-002 transitions to session_active
    And a session row is created with title equal to the first message (truncated to 80 characters)
    And the session_id equals the new session's id
    And the session appears at the top of the recent-sessions nav rail
    And the agent receives the chat turn with thread_id equal to the new session_id

  @boundary @happy_path
  Scenario: Navigating away from the welcome state leaves NO ghost session row
    Given J-002 is in session_active_no_messages for "Q4 Analytics"
    When Maya clicks project "Q3 Sales" in the nav before typing anything
    Then J-002 transitions through switching_project to project_selected for "Q3 Sales"
    And no session row was created in "Q4 Analytics" during the visit
    And the Q4 Analytics session list is unchanged

  @happy_path
  Scenario: Clicking an existing session from the welcome state cancels the new-session intent
    Given J-002 is in session_active_no_messages for "Q4 Analytics"
    When Maya clicks a recent session "chat-9b2a" in the nav rail
    Then J-002 transitions to resuming_session for "chat-9b2a"
    And no session row was created from the welcome-state visit

  @error_path
  Scenario: Transient create-session failure preserves composer text across retry
    Given J-002 is in session_active_no_messages with composer text "Show me top customers"
    When Maya presses Enter
    And the backend returns a transient failure for create-session
    Then J-002 transitions to error_recoverable with the originating correlation reference
    And the composer still shows the text "Show me top customers"
    When Maya clicks "Try again"
    Then J-002 re-enters session_active_no_messages with the text preserved
    And re-pressing Enter creates the session successfully on the next attempt

  @harness @needs_ts_harness
  Scenario: The TS harness drives the new-session lifecycle end-to-end
    Given the TS harness is in session_list_visible for "Q4 Analytics"
    When the harness calls `harness.j002.start_new_session()`
    Then J-002 reaches session_active_no_messages with session_id == null
    When the harness calls `harness.j002.send_first_message("Show me top customers")`
    Then J-002 reaches session_active with session_id != null
    And `harness.j002.assert_session_active(state.session_id)` succeeds
    And the session's title equals "Show me top customers"
