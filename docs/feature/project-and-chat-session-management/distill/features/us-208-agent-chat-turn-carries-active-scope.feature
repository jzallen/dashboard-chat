# <!-- DES-ENFORCEMENT : exempt -->
# US-208 — Every J-002-originating chat turn carries X-Active-Scope from
# the projection; agent rejects missing org_id / project_id with 400;
# rejects header.org_id != jwt.org_id with 403; falls back to body
# project_id during the migration window. Compile-time sunset (DWD-3)
# enforces flag removal. Validates IC-J002-7.
#
# Slice 4 (MR-4) — load-bearing for the agent-contract cutover.

@mr_4 @us-208 @slice-4 @real-io
Feature: Every chat turn from J-002 carries the active scope to the agent
  As Maya, sending chat turns from any J-002 state,
  I want the agent to receive my project context exclusively from the same projection my UI reads,
  So that there is no path for a turn to leak into the wrong project or org.

  @happy_path
  Scenario: A chat turn from session_active carries X-Active-Scope with org_id AND project_id
    Given J-002 is in session_active for "Q4 Analytics" with session "chat-9b2a"
    When Maya sends a chat turn "what's the avg rev by region"
    Then the outgoing chat request carries an "X-Active-Scope" header
    And the header's org_id is non-null and equals the value rendered in the FE org chip on the same paint
    And the header's project_id is non-null and equals the value rendered in the FE project chip on the same paint
    And the request body does NOT carry a project_id field after the migration window has closed

  @error_path
  Scenario: Agent rejects a chat turn missing org_id with 400 and a named diagnostic
    Given the agent enforces the X-Active-Scope contract
    When a chat request arrives with X-Active-Scope carrying only project_id
    Then the agent responds with status 400
    And the response body identifies the missing field as "org_id"
    And no LLM call is made

  @error_path
  Scenario: Agent rejects a chat turn missing project_id with 400 and a named diagnostic
    Given the agent enforces the X-Active-Scope contract
    When a chat request arrives with X-Active-Scope carrying only org_id
    Then the agent responds with status 400
    And the response body identifies the missing field as "project_id"

  @error_path
  Scenario: Agent rejects a chat turn whose X-Active-Scope org_id mismatches the JWT
    Given the auth-proxy injects X-Org-Id "acme-data-abc123"
    When a chat request arrives with an X-Active-Scope whose org_id is "other-org"
    Then the agent responds with status 403
    And the response body names the mismatch between JWT and X-Active-Scope

  @harness @needs_ts_harness
  Scenario: The TS harness asserts the agent received scope on every turn
    Given the TS harness is in session_active and intercepts agent chat requests
    When Maya sends 5 chat turns via the harness
    Then for each turn `harness.j002.assert_agent_received_scope(turn_index)` succeeds
    And each header's org_id equals the harness's J-001 projection org_id
    And each header's project_id equals the harness's J-002 projection project_id

  @degraded
  Scenario: During the migration window, the agent falls back to body project_id and emits an observability event
    Given the migration-window flag is enabled
    And a legacy client sends a chat request with no X-Active-Scope header but project_id in the body
    When the agent middleware processes the request
    Then the agent emits a `scope_header_fallback_used` log event
    And the agent proceeds with project_id read from the body
    And the log event names the calling client by its User-Agent for migration tracking

  @error_path @boundary
  Scenario: The compile-time sunset check fails the agent build after the sunset date if the flag is still on
    Given the SCOPE_HEADER_FALLBACK_SUNSET date has passed
    And the SCOPE_HEADER_FALLBACK_ENABLED flag is still set to "true" in the environment
    When the agent process starts
    Then the agent fails fast at module load with a sunset-violation error
    And the agent does not bind its HTTP server
