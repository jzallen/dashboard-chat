# <!-- DES-ENFORCEMENT : exempt -->
# US-205 — Resume restores BOTH transcript AND dataset chip atomically;
# deleted-dataset case degrades gracefully; non-existent session returns
# silently to the session list.
#
# Slice 2 (MR-2). Depends on Migration 009 (DWD-2) — the
# `active_dataset_id` column on the session row. Validates IC-J002-3.

@mr_2 @us-205 @slice-2 @real-io
Feature: Resuming a session restores transcript and dataset together
  As Maya, returning to a prior chat,
  I want the conversation transcript and the dataset I was working on to both be there on first paint,
  So that I can continue where I left off without re-attaching context.

  Background:
    Given J-002 is in session_list_visible for "Q4 Analytics"

  @happy_path
  Scenario: Resuming a session restores BOTH transcript AND dataset chip on the SAME first paint
    Given a session "chat-9b2a" exists with stored active_dataset_id = "sales_2026" and 12 prior messages
    When Maya clicks "chat-9b2a"
    Then J-002 transitions through resuming_session to session_active
    And the session_id equals "chat-9b2a"
    And the active scope's resource_type equals "dataset"
    And the active scope's resource_id equals the id of "sales_2026"
    And the FE renders the transcript with all 12 prior messages
    And the dataset chip in the chat input gutter reads "sales_2026"
    And both the transcript and the dataset chip paint on the SAME first paint

  @happy_path
  Scenario: Resuming a session with no stored dataset enters conversational mode
    Given a session "chat-7y8c" exists with active_dataset_id = null and 3 prior messages
    When Maya clicks "chat-7y8c"
    Then J-002 transitions to session_active
    And the active scope has no resource_id
    And the dataset chip is absent OR shows a "+ attach dataset" CTA
    And the transcript renders with 3 prior messages
    And the chat input is enabled in conversational mode

  @degraded
  Scenario: Resuming a session whose stored dataset has been deleted degrades gracefully
    Given a session "chat-9b2a" has stored active_dataset_id = "sales_2026"
    But "sales_2026" has been deleted
    When Maya clicks "chat-9b2a"
    Then J-002 transitions to session_active
    And the active scope has no resource_id
    And the dataset chip renders an empty-state with copy "the dataset for this session is no longer available"
    And a `session_dataset_unavailable` event is emitted
    And the transcript still renders
    And the chat input is enabled in conversational mode

  @error_path
  Scenario: Resuming a non-existent session returns silently to session_list_visible
    When Maya clicks a session that has been deleted in another tab
    Then J-002 transitions resuming_session → session_list_visible
    And no error panel is shown
    And the session disappears from the list on the next projection refresh

  @harness @needs_ts_harness
  Scenario: The TS harness asserts the resume contract
    Given the TS harness is in session_list_visible with seeded session "chat-9b2a" carrying dataset "sales_2026"
    When the harness calls `harness.j002.resume_session("chat-9b2a")`
    Then J-002 reaches session_active
    And `harness.j002.assert_session_active("chat-9b2a")` succeeds
    And `harness.j002.assert_scope({resource_type: "dataset", resource_id: "<sales_2026-id>"})` succeeds
    And `harness.j002.get_transcript("chat-9b2a")` returns 12 messages
