# <!-- DES-ENFORCEMENT : exempt -->
# US-203 — Session list renders most-recent-first; recent-sessions nav
# caps at 5; pagination at >30; cross-tab refresh via SSE.
#
# Slice 2 (MR-2). Depends on MR-1 substrate. The cross-tab scenario
# exercises the NEW `/ui-state/flow/.../projection/stream` endpoint
# (DWD-9; lands in MR-2 DELIVER per the handoff "Open items" O2).

@mr_2 @us-203 @slice-2 @real-io
Feature: Session list renders most-recent-first and refreshes across tabs
  As Maya, in a project with multiple chat sessions,
  I want the session list to surface my most recent work first,
  So that resuming a session is one click and the list does not go stale across tabs.

  Background:
    Given J-002 is in project_selected for "Q4 Analytics"

  @happy_path
  Scenario: Session list renders sorted most-recent-first on project entry
    Given the project has 4 sessions with last-active timestamps in the order T1 < T2 < T3 < T4
    When loading_session_list completes
    Then J-002 enters session_list_visible
    And the FE renders sessions in the order: T4-session, T3-session, T2-session, T1-session
    And each session row displays the title (truncated first message)
    And each session row displays a recency timestamp

  @happy_path
  Scenario: Recent-sessions nav caps at 5 rows
    Given the project has 10 sessions
    When the FE app shell paints
    Then the recent-sessions nav rail shows the 5 most-recent sessions only
    And the Chats nav link is visible at the top of the rail

  @boundary
  Scenario: Project with zero sessions enters the no-sessions empty-state sub-shape
    Given the project has no sessions
    When loading_session_list completes with zero items
    Then J-002 enters session_list_visible with the no-sessions empty-state sub-shape
    And the recent-sessions nav rail is empty
    And the main pane shows "What would you like to do?" welcome copy
    And the suggestion chips "Upload CSV" and "Browse Projects" are visible

  @happy_path
  Scenario: Session list is paginated for projects with >30 sessions
    Given the project has 50 sessions
    When loading_session_list completes
    Then session_list_visible carries 30 items
    And the next-page cursor is non-null
    When Maya navigates to the Chats page and clicks "Load more"
    Then the next 20 sessions append to the list with the original sort preserved

  @happy_path
  Scenario: Session created in another tab refreshes Tab A's session list within 1 second
    Given Tab A is in session_list_visible for "Q4 Analytics" with 4 sessions
    When Tab B creates a new session in "Q4 Analytics"
    Then the projection stream pushes the updated session list to Tab A
    And Tab A's session list refreshes within 1 second
    And the new session appears at the top
    And no full-page refresh is triggered

  @harness @needs_ts_harness
  Scenario: The TS harness asserts session-list ordering
    Given the TS harness is in project_selected for "Q4 Analytics" with seeded sessions
    When the harness calls `harness.j002.get_session_list()`
    Then the returned items are sorted by last-active time descending
    And the items match what the FE would render
