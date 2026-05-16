# <!-- DES-ENFORCEMENT : exempt -->
# US-210 — J-002 honors FREEZE from J-001's expired_token; THAW replays
# queued intents in FIFO; stale-intent filter drops intents whose target
# no longer applies; replay buffer timeout transitions to error_recoverable.
# Validates IC-J002-6 + the architectural payoff named by ADR-028 §94.
#
# The Praxis F-4 scenario (`@praxis_f4` — concurrent dataset picks during
# FREEZE with FIFO + staleness-guard semantics) is encoded here per the
# DWD-7 + reviewer §5 recommendation: dataset intents replay in FIFO
# order; if intent N passes ScopeResolver I4 and intent N+1 fails, the
# project + resource context for intent N persist — intent N+1 is
# silent-dropped.
#
# Slice 6 (MR-6) — final milestone; substrate amortization payoff.

@mr_6 @us-210 @slice-6 @real-io
Feature: Token expiry mid-mutation pauses J-002 and replays after re-auth
  As Maya, mid-J-002-mutation when my JWT expires,
  I want the mutation to pause silently and resume after re-auth,
  So that I never re-click or re-type a mid-task action.

  @happy_path
  Scenario: Token expiry during session-resume pauses and replays with the original correlation id
    Given J-002 is in session_list_visible for "Q4 Analytics"
    When Maya clicks session "chat-9b2a"
    And while J-002 is in resuming_session, J-001 transitions to expired_token
    Then the orchestrator broadcasts FREEZE
    And J-002 transitions resuming_session → freeze with last_live_state = "resuming_session"
    And the transcript-load response is discarded by J-002 with no transition
    And no further mutations are sent from J-002
    And the FE shows a non-blocking "Refreshing your session..." banner
    When J-001's silent re-auth succeeds and the orchestrator broadcasts THAW
    Then J-002 transitions freeze → resuming_session with the SAME correlation reference
    And the transcript-load fires again with the fresh JWT
    And J-002 reaches session_active with session_id = "chat-9b2a"

  @happy_path
  Scenario: Token expiry during project-switch replays after thaw
    Given J-002 is in session_active for "Q4 Analytics"
    When Maya clicks "Q3 Sales" in the nav
    And while J-002 is in switching_project, J-001 transitions to expired_token
    Then the orchestrator broadcasts FREEZE
    And J-002 transitions switching_project → freeze with last_live_state = "switching_project"
    When silent re-auth succeeds and THAW is broadcast
    Then J-002 transitions freeze → switching_project with the original correlation reference
    And the project-load fires with the fresh JWT
    And J-002 reaches project_selected for "Q3 Sales"

  @boundary
  Scenario: Multiple intents queued during FREEZE replay serially in FIFO; stale intent is observability-dropped
    Given J-002 is in session_active for "Q4 Analytics" with session "chat-9b2a"
    When Maya clicks project "Q3 Sales" AND clicks session "chat-xyz" in rapid succession
    And J-001 transitions to expired_token before either mutation completes
    Then the orchestrator broadcasts FREEZE
    And both intents are queued in the orchestrator's replay buffer with their original correlation references
    When silent re-auth succeeds and THAW is broadcast
    Then the orchestrator replays both intents in their original arrival order
    And J-002 processes the switching_project intent first
    And J-002 reaches project_selected for "Q3 Sales"
    And the session_clicked intent for "chat-xyz" does NOT match Q3's session list
    And a `stale_intent_dropped_after_thaw` event is emitted with intent details
    And J-002 finally settles in session_list_visible for "Q3 Sales"

  @error_path @boundary
  Scenario: Replay buffer timeout transitions J-002 to error_recoverable
    Given J-002 is in freeze with last_live_state = "resuming_session"
    When silent re-auth fails (J-001 transitions to error_recoverable instead of ready)
    And the replay buffer's 5-second timeout elapses
    Then the orchestrator emits `replay_abandoned` for the queued intent
    And J-002 transitions freeze → error_recoverable with the original correlation reference
    And the panel reads "we couldn't complete that action — try again"
    And the originating user-action (session_clicked) is preserved in the failure event payload for re-issue

  @happy_path
  Scenario: FREEZE during session_active_no_messages preserves the welcome view with no flicker
    Given J-002 is in session_active_no_messages
    When J-001 transitions to expired_token while no J-002 mutation is in flight
    Then J-002 transitions session_active_no_messages → freeze
    And the "Refreshing your session..." banner is shown
    And the welcome chips remain visible underneath
    When silent re-auth succeeds and THAW is broadcast
    Then J-002 returns to session_active_no_messages
    And no flicker is observed in the welcome state

  @praxis_f4 @boundary @property
  Scenario: Concurrent dataset picks during FREEZE replay in FIFO; intent N persists if its successor is stale
    Given J-002 is in session_active for "Q4 Analytics" with no dataset
    When Maya picks dataset "patients_2025" AND then picks dataset "deleted_dataset" in rapid succession
    And J-001 transitions to expired_token before either pick completes
    Then the orchestrator broadcasts FREEZE
    And both dataset_resolved_by_agent intents are queued in the replay buffer in FIFO order with their original correlation references
    When silent re-auth succeeds and THAW is broadcast
    Then the orchestrator replays intent N (`patients_2025`) first
    And ScopeResolver invariant 4 OK for "patients_2025"
    And J-002 transitions through switching_dataset_context to session_active with resource_id = id of "patients_2025"
    And the session's active_dataset_id is persisted as the id of "patients_2025"
    When the orchestrator replays intent N+1 (`deleted_dataset`)
    Then ScopeResolver invariant 4 fails for "deleted_dataset" (or the dataset is not found)
    And the intent is silent-dropped with a `stale_intent_dropped_after_thaw` observability event
    And the project context remains "Q4 Analytics"
    And the active scope's resource_id still equals the id of "patients_2025" (intent N persists)
    And no scope_mismatch_terminal is reached
    And `harness.j002.assert_stale_intent_dropped("dataset_resolved_by_agent", <deleted_dataset_id>)` succeeds

  @harness @needs_ts_harness
  Scenario: The TS harness can drive freeze/thaw end-to-end
    Given the TS harness is in session_active for "Q4 Analytics" with session "chat-9b2a"
    When the harness calls `harness.j002.freeze()`
    Then J-002 transitions to freeze with last_live_state = "session_active"
    And subsequent mutations via `harness.j002.*` are queued by the orchestrator
    When the harness calls `harness.j002.thaw()`
    Then J-002 transitions freeze → session_active
    And any queued mutations are replayed
    And `harness.j002.assert_no_stale_intents_dropped()` succeeds for the happy-path test
