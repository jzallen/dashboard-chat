# <!-- DES-ENFORCEMENT : exempt -->
# Cross-cutting integration checkpoints IC-J002-1 through IC-J002-7 from
# the journey YAML's `integration_checkpoints` block. These are property
# invariants — they hold across every J-002 transition that crosses the
# stated boundary, regardless of which user story exercises it.
#
# Praxis F-5 deferred (review §3) is encoded here as a property under
# IC-J002-1: at `resolving_initial_scope` entry, `context.org_id` MUST
# equal the JWT's decoded `org_id` claim AND J-001's projection
# `active_scope.org_id` at the same sequence_id boundary (within 100ms
# for clock skew).

@property @journey @real-io
Feature: J-002 honors its cross-state invariants on every transition
  As an architect verifying J-002's structural promises,
  I want every cross-state boundary to hold the contract the journey YAML names,
  So that an implementation that drifts from any IC-J002-* fails the suite, not just one user-story test.

  @mr_1 @ic-j002-1 @praxis_f5
  Scenario: Entry from J-001 ready reads org_id from J-001 projection, not from a separate JWT decode
    Given J-001 has settled in ready with a known org_id
    When J-002 enters resolving_initial_scope via the orchestrator's j001_ready broadcast
    Then J-002's context.org_id equals J-001's projection active_scope.org_id at the same sequence_id boundary
    And the value also equals the JWT's decoded org_id claim
    And the consistency holds within 100ms of the broadcast (clock-skew tolerance)
    And no separate `/api/orgs/me` or JWT-decode fetch is observed in the request log

  @mr_1 @ic-j002-2
  Scenario: project_selected entry has non-null project_id AND a user-authorized scope
    When J-002 transitions to project_selected from any predecessor
    Then on entry the active scope's project_id is non-null AND equal to context.project.id
    And the JWT held by the FE/harness authorizes access to that project
    And no cross-tenant project_id ever reaches project_selected (rejection happens BEFORE entry via scope_mismatch_terminal)

  @mr_2 @ic-j002-3
  Scenario: resuming_session → session_active materializes transcript AND resource_* atomically
    When J-002 transitions through resuming_session to session_active
    Then on entry to session_active both writes are visible: context.transcript is loaded AND active_scope.resource_* reflects session.active_dataset_id (or is null if no dataset is attached)
    And no observation of session_active shows mixed or partially-loaded state (transcript present but resource still resolving)

  @mr_4 @ic-j002-4
  Scenario: switching_project entry invalidates session_id and resource_* BEFORE the new project's loading_session_list fires
    When J-002 transitions through switching_project to project_selected → loading_session_list
    Then on entry to switching_project, context.session_id becomes null AND context.resource is cleared
    And no chat-turn dispatch during the switch window carries the OLD project's session_id or dataset_id
    And the agent receives no further turns from the old chat-view instance once the SSE is cancelled

  @mr_5 @ic-j002-5
  Scenario: dataset_resolved_by_agent produces exactly one active_scope.resource_* update via the projection
    When J-002 processes a `dataset_resolved_by_agent` event from session_active
    Then exactly one update to active_scope.resource_type/resource_id is observed via the projection
    And the agent's NEXT turn after the update carries the new resource_id in its X-Active-Scope header
    And the session metadata's active_dataset_id is updated BEFORE the next chat turn is dispatched

  @mr_6 @ic-j002-6
  Scenario: FREEZE pauses every outgoing mutation; intents queue with original correlation references
    When the orchestrator broadcasts FREEZE while J-002 is in any non-terminal state
    Then J-002 pauses all outgoing mutations (no backend POSTs, no projection writes, no agent turns are emitted from J-002)
    And queued intents arrive at the orchestrator's replay buffer with their original correlation references
    When the orchestrator broadcasts THAW
    Then queued intents replay against the live state machine

  @mr_4 @ic-j002-7
  Scenario: Every chat-agent invocation originating in a J-002 state carries X-Active-Scope from the projection
    Given the J-002 chat-turn-emitting states are `session_active` and `session_active_no_messages` (post-`first_message_sent`)
    When a chat turn is dispatched from any J-002 chat-turn-emitting state
    Then the request to the agent carries an X-Active-Scope header with org_id AND project_id populated from the same projection the FE shell reads
    And the agent's middleware rejects invocations missing either field with 400 and a named diagnostic
