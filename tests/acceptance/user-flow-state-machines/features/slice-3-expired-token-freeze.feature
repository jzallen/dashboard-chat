# Slice 3 — US-005 expired-token cross-flow freeze + replay.
#
# Failure mode from journey YAML: token_expired_midflight.
# Demonstrates the cross-machine FREEZE actor-tree pattern (ADR-028).

@slice-3 @us-005 @driving_port
Feature: Maya's chat survives a mid-question token expiry without re-typing

  As Maya in the middle of a long session,
  I want my in-flight requests to keep going when my access expires and renews behind the scenes
  So that the app feels reliable across all-day work without breaking my train of thought.

  Background:
    Given Maya is signed in and her organization "Acme Data" is set up

  @skip @us-005 @happy-path @real-io @with-pre-commit
  Scenario: Maya's chat question replays silently after her access renews
    Given Maya has just sent the chat question "what's the average revenue by region"
    And Maya's access will expire before the answer can stream
    When Maya's access expires mid-question
    Then within 100 milliseconds Maya sees a non-blocking "Refreshing your session..." banner
    And Maya's chat question replays without Maya re-typing it
    And the streaming answer reaches Maya as if her access had not expired
    And the banner clears once the answer begins streaming

  @skip @us-005 @error-path @silent_reauth_failed
  Scenario: Maya sees a recoverable-error keyed to her original question when silent renewal fails
    Given Maya has just sent the chat question with reference code "R-chat-9b2a"
    And the identity session itself has expired so silent renewal will fail
    When Maya's access expires mid-question
    Then Maya sees a recoverable-error page worded for the sign-in-again case
    And the reference code on the recoverable-error page is "R-chat-9b2a"
    And the reference code is the one from Maya's original question, not a new one from the renewal attempt

  @skip @us-005 @edge-case @concurrent_requests
  Scenario: Maya's two in-flight requests both replay after a single renewal
    Given Maya has a chat question and a dataset preview in flight
    And Maya's access will expire before either responds
    When Maya's access expires
    Then both Maya's requests pause together
    And exactly one access renewal is performed
    And both Maya's responses reach her after renewal completes

  @skip @us-005 @cross_machine_freeze @real-io
  Scenario: Maya's other actions are paused while her session refreshes
    Given Maya is mid-flow with both chat and a transform preview open
    When Maya's access expires
    Then Maya's "Apply transform" button is paused with a "Refreshing your session..." indicator
    And Maya's transform is not duplicated when her access renews
    And after renewal Maya's "Apply transform" button is responsive again

  @skip @us-005 @boundary @replay_buffer_overflow
  Scenario: Maya's replay is abandoned when renewal exceeds the safe window
    Given Maya has sent a chat question
    And Maya's access renewal will take 8 seconds
    When Maya's access expires
    Then Maya's chat question is not replayed automatically
    And Maya's original question is preserved as a draft in the chat composer
    And Maya sees the recoverable-error page worded for the sign-in-again case

  @skip @us-005 @degraded @with-pre-commit
  Scenario: Maya's signed-in session survives a flow-state restart
    Given Maya is signed in and her organization "Acme Data" is set up
    When the flow-state service is restarted while Maya is mid-session
    Then within 60 seconds Maya can continue without re-signing-in
    And Maya's active organization remains "Acme Data"
