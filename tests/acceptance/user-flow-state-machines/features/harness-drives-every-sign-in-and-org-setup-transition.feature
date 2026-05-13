# Slice 2 — US-004 TS UserFlowHarness is itself an acceptance-test target.
#
# These scenarios exercise the harness's public surface end-to-end. The
# harness IS the test driver for every other scenario; this file is the
# only place where it is both the driver AND the target.

@slice-2 @us-004 @adapter-integration @driving_port
Feature: The user-flow test harness drives every sign-in and org-setup transition end-to-end

  As a developer writing a test for any user-facing flow,
  I want to set Maya's auth-and-org context up in a handful of lines
  So that my flow test starts from the same state Maya would, with no parallel re-implementation.

  @skip @us-004 @happy-path @real-io @clean
  Scenario: Beginning Maya's sign-in reaches the post-sign-in state
    Given a clean environment with no organization yet owned by Maya
    When the test harness begins Maya's sign-in
    Then the harness reports Maya is in the post-sign-in state
    And the harness reports Maya's email is "maya.chen@acme-data.example"

  @skip @us-004 @happy-path @real-io @clean
  Scenario: Submitting Maya's organization reaches the ready state with the correct organization claim
    Given the harness has begun Maya's sign-in
    When the harness submits "Acme Data" as Maya's organization
    Then the harness reports Maya is in the ready state
    And the harness reports Maya's access token carries the organization id Maya now owns

  @skip @us-004 @error-path @transient_failure @real-io @clean
  Scenario: Forcing a transient failure drives Maya into the recoverable-error state with the original reference code
    Given the harness has begun Maya's sign-in with reference code "R-7a4f-901c"
    When the harness forces a transient identity-verification failure
    Then the harness reports Maya is in the recoverable-error state
    And the harness reports the displayed reference code is "R-7a4f-901c"

  @skip @us-004 @happy-path
  Scenario: The harness's scope assertion names every diverged dimension when it fails
    Given the harness has driven Maya to the ready state with project "Q4 Analytics" active
    When a developer asserts Maya's scope matches organization "Acme Data" and a different project "Q5 Analytics"
    Then the assertion fails with output that names "project_id" as the diverged dimension
    And the failure output names the expected and actual project on separate lines

  @skip @us-004 @error-path @missing_scope
  Scenario: The harness surfaces a missing-scope diagnostic when a chat turn is sent without project context
    Given the harness has driven Maya to the ready state without a project chosen
    When a downstream chat turn is sent without an active project
    Then the harness surfaces a test failure naming "agent invocation missing scope: missing project_id"
    And the failure points at the scope contract, not at the chat agent's internal state

  @skip @us-004 @composition
  Scenario: The harness composes with a sibling flow harness without re-implementing sign-in
    Given the harness has driven Maya to the ready state with organization "Acme Data"
    When a sibling flow harness for transforms is initialized
    Then the sibling harness sees Maya is signed in and her organization is set up
    And no additional sign-in calls are needed in the sibling harness's setup
