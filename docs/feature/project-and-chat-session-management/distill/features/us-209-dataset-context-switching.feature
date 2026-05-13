# <!-- DES-ENFORCEMENT : exempt -->
# US-209 — Dataset context switches via the agent's `resolve_dataset`
# tool-return path AND via direct selection; cross-tenant pick is
# rejected with prior scope preserved; concurrent picks serialize.
# Validates IC-J002-5.
#
# Slice 5 (MR-5). Depends on Migration 009 (MR-2 prerequisite) AND
# MR-4's `X-Active-Scope` writer contract.

@mr_5 @us-209 @slice-5 @real-io
Feature: The dataset chip retargets when a dataset is picked, by agent or directly
  As Maya, in a chat session where I just resolved a dataset name,
  I want the dataset chip to update and the next chat turn to carry the new dataset,
  So that the next instruction is interpreted against the dataset I just chose.

  @happy_path
  Scenario: Agent's resolve_dataset → user pick → J-002 switches scope and persists
    Given J-002 is in session_active for "Q4 Analytics" with session "chat-9b2a"
    And the active scope has no resource_id
    When Maya types "filter rows where age > 30" referring to a dataset by name
    And the agent's stream returns a `resolve_dataset` tool call for name "patients"
    And the FE intercepts the data-agent-request typed part
    And the FE shows an inline list ["patients_2025", "patients_archive"]
    When Maya clicks "patients_2025"
    Then the FE emits `dataset_resolved_by_agent` with resource_type "dataset" and resource_id of "patients_2025"
    And J-002 transitions through switching_dataset_context to session_active
    And the active scope's resource_type equals "dataset"
    And the active scope's resource_id equals the id of "patients_2025"
    And the session's active_dataset_id is persisted as the id of "patients_2025"
    And the dataset chip in the chat input gutter reads "patients_2025"

  @happy_path
  Scenario: Re-submitted chat turn carries the new X-Active-Scope after dataset attaches
    Given the prior scenario completed with the active scope's resource_id = id of "patients_2025"
    When the FE re-submits the original chat turn "filter rows where age > 30"
    Then the new chat request carries an X-Active-Scope with:
      | field          | value                  |
      | org_id         | <acme-org-id>          |
      | project_id     | <q4-analytics-id>      |
      | resource_type  | dataset                |
      | resource_id    | <patients_2025-id>     |
    And the agent dispatches the filterTable tool with the resolved dataset id

  @happy_path
  Scenario: Direct dataset selection updates active scope and persists
    Given J-002 is in session_active for "Q4 Analytics" with the active scope's resource_id = "sales_2026"
    When Maya clicks the dataset chip and selects "customers_2025" from the inline list
    Then the FE emits `dataset_picked_directly` with resource_type "dataset" and resource_id of "customers_2025"
    And J-002 transitions through switching_dataset_context to session_active
    And the active scope's resource_id equals the id of "customers_2025"
    And the session's active_dataset_id is updated to the id of "customers_2025"

  @error_path @cross_tenant
  Scenario: Cross-tenant dataset access is rejected and J-002 stays in session_active with prior scope
    Given J-002 is in session_active with the active scope's resource_id = "sales_2026"
    And there exists a dataset "restricted_dataset" Maya does not have access to
    When Maya picks "restricted_dataset" directly
    Then J-002 enters switching_dataset_context
    And the scope-resolver rejects the pick with a "scope mismatch: dataset access denied" diagnostic
    And J-002 transitions back to session_active
    And the active scope's resource_id still equals "sales_2026" (unchanged)
    And the FE shows inline copy "you don't have access to that dataset" in the gutter
    And the session's active_dataset_id is NOT updated

  @boundary @property
  Scenario: Concurrent dataset picks serialize via XState semantics; most-recent wins
    Given J-002 is in session_active with no dataset
    When two `dataset_resolved_by_agent` events fire in rapid succession with different resource_ids
    Then J-002 processes them serially (XState single-event-at-a-time)
    And only the most-recent pick's resource_id wins
    And the session's active_dataset_id equals the most-recent pick

  @harness @needs_ts_harness
  Scenario: The TS harness drives both attach paths and asserts scope
    Given the TS harness is in session_active for "Q4 Analytics" with no dataset
    When the harness calls `harness.j002.attach_dataset_via_agent("patients_2025")`
    Then J-002 reaches session_active with the active scope's resource_id = "<patients_2025-id>"
    And `harness.j002.assert_scope({resource_type: "dataset", resource_id: "<patients_2025-id>"})` succeeds
    When the harness calls `harness.j002.attach_dataset_directly("customers_2025")`
    Then J-002 transitions through switching_dataset_context to session_active
    And the active scope's resource_id equals "<customers_2025-id>"
