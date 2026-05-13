Feature: J-002 — Project + Chat Session Management
  As a returning Dashboard Chat user with at least one project
  I want my project context, session, and dataset scope to materialize
  consistently across sign-in, deep-link, switching, and recovery paths
  So that every downstream user action (chat turn, upload, transform)
  operates inside a coherent project+session context with no flicker
  and no cross-project state bleed

  Background:
    Given the user "Maya Chen" has completed J-001 with org "Acme Data"
    And the orchestrator is running with J-001 and J-002 actors registered
    And the agent's X-Active-Scope contract is enforced (ADR-029 §4)

  # ─── Initial scope resolution ────────────────────────────────────

  Scenario: Returning user with one project lands in project_selected
    Given Maya's org "Acme Data" has one project "Q4 Analytics"
    And Maya has at least one prior session in "Q4 Analytics"
    When Maya completes J-001 sign-in
    Then J-002 transitions through resolving_initial_scope to project_selected
    And active_scope.project_id equals the id of "Q4 Analytics"
    And the FE app shell paints the project chip "Q4 Analytics" on first paint
    And the project chip and the org chip paint on the SAME first paint

  Scenario: First-time-in-org user with zero projects lands in no_projects_empty_state
    Given Maya's org "Acme Data" has zero projects
    When Maya completes J-001 sign-in
    Then J-002 transitions through resolving_initial_scope to no_projects_empty_state
    And the FE shows "Welcome to Acme Data, Maya! Let's get started by creating your first project."
    And no project chip is painted (active_scope.project_id is null)
    And the welcome chips ("Upload CSV", "Browse Projects") are NOT shown until a project exists

  Scenario: Returning user with multiple projects lands in last-used project
    Given Maya's org has three projects: "Q3 Sales", "Q4 Analytics", "Marketing 2026"
    And the most-recent session across all three is in "Q4 Analytics"
    When Maya completes J-001 sign-in
    Then J-002 enters project_selected with project_id equal to "Q4 Analytics"
    And the project chip reads "Q4 Analytics"

  Scenario: Cold deep-link to a project URL resolves active_scope before page paint
    Given Maya has access to project "Q4 Analytics"
    When Maya opens "/projects/q4-analytics" cold in a fresh tab and completes sign-in
    Then J-002 enters resolving_initial_scope with intent_project_id matching the URL
    And J-002 transitions to project_selected
    And the project chip reads "Q4 Analytics" on first paint
    And the page body renders project-scoped content on the SAME first paint
    And no chip shows a placeholder at any point

  Scenario: Cold deep-link with a cross-tenant project_id surfaces a named-diagnostic
    Given Maya is in org "Acme Data"
    And there exists project "Strategic" in a different org "Other Org Inc" that Maya cannot access
    When Maya opens the URL for "Strategic" cold and completes sign-in
    Then J-002 transitions resolving_initial_scope → scope_mismatch_terminal
    And the FE shows "This project is no longer accessible"
    And a correlation_id of the form "R-..." is visibly displayed
    And a "Back to projects" CTA is the primary action
    And no project chip is painted with the cross-tenant project's name at any point

  # ─── Project create from no-projects empty state ────────────────

  Scenario: Creating a first project lands in project_selected
    Given J-002 is in no_projects_empty_state
    When Maya types "Q4 Analytics" and clicks "Create project"
    Then J-002 transitions through creating_project to project_selected
    And active_scope.project_id equals the new project's id
    And the project chip reads "Q4 Analytics"
    And the FE transitions to session_list_visible with no_sessions_empty_state because the new project has zero sessions

  Scenario: Project name validation failure stays in no_projects_empty_state
    Given J-002 is in no_projects_empty_state
    When Maya submits an empty project name
    Then J-002 stays in no_projects_empty_state
    And an inline error "Please enter a project name" is shown
    And no project is created

  # ─── Session list + resume ──────────────────────────────────────

  Scenario: Session list renders sorted most-recent-first
    Given J-002 is in project_selected for "Q4 Analytics"
    And the project has 4 sessions with last_active_at timestamps T1 < T2 < T3 < T4
    When loading_session_list completes
    Then session_list_visible is entered
    And the FE renders the sessions in order T4, T3, T2, T1

  Scenario: Resuming a session restores the transcript and dataset chip
    Given J-002 is in session_list_visible for "Q4 Analytics"
    And a session "chat-9b2a" exists with stored active_dataset_id = "sales_2026" and 12 prior messages
    When Maya clicks "chat-9b2a"
    Then J-002 transitions through resuming_session to session_active
    And state.session_id equals "chat-9b2a"
    And active_scope.resource_type equals "dataset"
    And active_scope.resource_id equals the id of "sales_2026"
    And the FE renders the transcript with all 12 prior messages
    And the dataset chip in the chat input gutter reads "sales_2026"
    And both the transcript and the dataset chip paint on the SAME first paint

  Scenario: Resuming a session whose stored dataset has been deleted degrades gracefully
    Given J-002 is in session_list_visible for "Q4 Analytics"
    And a session "chat-9b2a" exists with stored active_dataset_id = "sales_2026"
    But "sales_2026" has been deleted
    When Maya clicks "chat-9b2a"
    Then J-002 transitions to session_active
    And active_scope.resource_* is null
    And the dataset chip renders an empty-state with copy "the dataset for this session is no longer available"
    And the transcript still renders with all prior messages
    And the chat input is enabled in conversational mode

  Scenario: Resuming a session that no longer exists returns to session_list_visible silently
    Given J-002 is in session_list_visible for "Q4 Analytics"
    When Maya clicks a session that has been deleted in another tab
    Then J-002 transitions resuming_session → session_list_visible (no error panel)
    And the session disappears from the list

  # ─── New session lifecycle ──────────────────────────────────────

  Scenario: Clicking "New Session" lands in session_active_no_messages with no session row created
    Given J-002 is in session_list_visible for "Q4 Analytics" with 4 prior sessions
    When Maya clicks "+ New Session"
    Then J-002 transitions to session_active_no_messages
    And state.session_id is null
    And no row is created in the sessions table
    And the welcome chips ("Upload CSV", "Browse Projects") are visible
    And the chat input is enabled

  Scenario: Sending the first message in a new session creates the session row eagerly with title
    Given J-002 is in session_active_no_messages for "Q4 Analytics"
    When Maya types "Show me top customers by revenue" and presses Enter
    Then J-002 transitions to session_active
    And a session row is created in the backend with title "Show me top customers by revenue" (truncated to 80 chars)
    And state.session_id equals the new session id
    And the session appears at the top of the recent-sessions nav

  Scenario: Navigating away from session_active_no_messages without typing leaves no ghost row
    Given J-002 is in session_active_no_messages for "Q4 Analytics"
    When Maya clicks a different project in the nav
    Then J-002 transitions through switching_project to a new project_selected
    And no session row was created in "Q4 Analytics" during the visit

  # ─── Project switching ──────────────────────────────────────────

  Scenario: Switching projects atomically retargets active_scope and the session list
    Given J-002 is in session_active for project "Q4 Analytics" with session "chat-9b2a"
    When Maya clicks project "Q3 Sales" in the nav
    Then J-002 transitions through switching_project to project_selected for "Q3 Sales"
    And state.session_id is invalidated to null
    And active_scope.project_id equals the id of "Q3 Sales"
    And active_scope.resource_* is null
    And the FE renders the session list for "Q3 Sales"
    And no session from "Q4 Analytics" appears in the list

  Scenario: A chat turn in flight during a project switch does not land at the agent under the new project
    Given J-002 is in session_active for "Q4 Analytics" with an in-flight chat turn
    When Maya clicks project "Q3 Sales" before the chat turn completes
    Then the in-flight chat turn is cancelled at the FE boundary
    And the agent never receives a turn carrying both project_id="Q3 Sales" and the Q4 Analytics session_id
    And J-002 transitions to project_selected for "Q3 Sales"

  # ─── Agent scope contract ───────────────────────────────────────

  Scenario: Every chat-agent invocation carries active_scope.{org_id, project_id} from J-002's projection
    Given J-002 is in session_active for project "Q4 Analytics" with session "chat-9b2a"
    When Maya sends a chat turn "what's the avg rev by region"
    Then the request to the agent's POST /chat carries X-Active-Scope: {"org_id":"<acme>","project_id":"<q4>","resource_type":null,"resource_id":null}
    And the X-Active-Scope values equal the values rendered in the FE shell on the same paint
    And the agent does not perform a separate fetch to derive scope

  Scenario: The agent rejects a chat turn missing org_id with a named diagnostic
    Given the agent's middleware is enforcing the X-Active-Scope contract
    When a request to POST /chat arrives with X-Active-Scope missing org_id
    Then the agent responds 400 with body containing "agent invocation missing scope: missing org_id"

  Scenario: The agent rejects a chat turn missing project_id with a named diagnostic
    Given the agent's middleware is enforcing the X-Active-Scope contract
    When a request to POST /chat arrives with X-Active-Scope missing project_id
    Then the agent responds 400 with body containing "agent invocation missing scope: missing project_id"

  # ─── Dataset context switching (resolve_dataset and direct) ─────

  Scenario: Agent's resolve_dataset tool drives switching_dataset_context
    Given J-002 is in session_active for "Q4 Analytics" with session "chat-9b2a"
    And active_scope.resource_* is null
    When Maya types "filter rows where age > 30" referring to a dataset by name
    And the agent's stream returns a resolve_dataset tool call for name "patients"
    And the FE intercepts the data-agent-request typed part
    And Maya picks "patients_2025" from the inline list
    Then J-002 transitions through switching_dataset_context to session_active
    And active_scope.resource_type equals "dataset"
    And active_scope.resource_id equals the id of "patients_2025"
    And the dataset chip in the chat input gutter reads "patients_2025"
    And session.active_dataset_id is updated to the id of "patients_2025"

  Scenario: Re-submitted chat turn after dataset resolution carries the new X-Active-Scope
    Given the prior scenario resulted in active_scope.resource_id = id of "patients_2025"
    When the FE re-submits the original chat turn "filter rows where age > 30"
    Then the new POST /chat request carries X-Active-Scope with resource_type "dataset" and resource_id equal to id of "patients_2025"
    And the agent dispatches filterTable with the correct dataset id

  Scenario: Picking a dataset that the user cannot access falls back gracefully
    Given J-002 is in session_active
    And there exists a dataset "restricted_dataset" that Maya does not have access to
    When Maya picks "restricted_dataset" directly (via a dataset list)
    Then J-002 enters switching_dataset_context
    And the ScopeResolver returns 403 with named diagnostic
    And J-002 transitions back to session_active
    And active_scope.resource_* remains at its prior value
    And an inline copy "you don't have access to that dataset" is shown in the chat input gutter

  # ─── Cross-machine FREEZE/THAW ─────────────────────────────────

  Scenario: A token expiry during a session resume pauses the resume and replays after re-auth
    Given J-002 is in session_list_visible for "Q4 Analytics"
    When Maya clicks session "chat-9b2a"
    And while J-002 is in resuming_session J-001 transitions to expired_token
    Then the orchestrator broadcasts FREEZE
    And J-002 transitions to freeze with last_live_state = resuming_session
    And no further mutations are sent from J-002
    And the FE shows a non-blocking "Refreshing your session..." banner
    When J-001's silent_reauth succeeds and the orchestrator broadcasts THAW
    Then J-002 re-enters resuming_session WITH THE SAME correlation_id as the original click
    And the session resume completes
    And J-002 reaches session_active with state.session_id = "chat-9b2a"

  Scenario: Concurrent J-002 mutations during freeze all replay after thaw
    Given J-002 is in session_active for "Q4 Analytics" with session "chat-9b2a"
    When Maya clicks a different session AND clicks a different project simultaneously
    And J-001 transitions to expired_token before either mutation completes
    Then the orchestrator broadcasts FREEZE
    And both intents are queued in the orchestrator's replay buffer
    When silent_reauth succeeds and THAW is broadcast
    Then the orchestrator replays both intents in their original order
    And J-002 settles in a state consistent with the last intent (last click wins per ADR-027 §5)

  # ─── TS harness composition ────────────────────────────────────

  Scenario: TS harness drives J-002 entry from a J-001 fixture
    Given a TS harness fixture has driven J-001 to ready for persona "maya"
    When the developer calls await harness.j002.open_project("Q4 Analytics")
    Then J-002 reaches project_selected for "Q4 Analytics"
    And harness.j002.assert_scope({project_id: "<q4>"}) succeeds
    And no Python harness call is required for this composition

  Scenario: TS harness assert_scope diff names the diverged dimension on mismatch
    Given the harness is in session_active with project "Q4 Analytics" and no dataset
    When the developer calls harness.j002.assert_scope({project_id: "wrong-id"})
    Then the assertion fails
    And the failure output contains "project_id   expected: wrong-id   actual: <q4>"
    And the failure points at the active_scope contract from wave-decisions.md §D9
