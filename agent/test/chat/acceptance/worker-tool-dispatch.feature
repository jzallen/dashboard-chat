# Documentation companion — runnable specs live alongside as *.test.ts files.
# DISTILL SSOT for worker-side scenario inventory.

Feature: Worker is the single dispatcher for chat tool calls
  Story 1 / AC1.1, AC1.2, AC1.3, AC1.4  |  Story 4 / AC4.1, AC4.2

  Background:
    Given the dev compose stack is running

  # ---- PR 0: Scaffolding contract ----------------------------------------

  @pr0 @real-io @adapter-integration @pending @skip
  Scenario: ChatEventSchema parses every event the worker may emit
    Given the agent's events.ts module exports ChatEventSchema
    When a sample of every event variant in the closed vocabulary is parsed
    Then every parse returns a valid ChatEvent
    And no parse throws

  @pr0 @real-io @adapter-integration @pending @skip
  Scenario: Worker forwards JWT via auth-proxy when calling backend
    Given a DispatchContext with a known JWT
    When the worker's backend-client issues POST /api/datasets/{id}/transforms
    Then auth-proxy receives Authorization: Bearer <JWT> on the request
    And auth-proxy strips Authorization before forwarding to backend
    And backend receives X-User-Id, X-Org-Id, X-User-Email headers

  # ---- PR 1: Cleaning tools ----------------------------------------------

  @pr1 @real-io @adapter-integration @pending @skip
  Scenario: applyCleaningTransform dispatch emits transform_applied
    Given a chat turn that triggers applyCleaningTransform with column "region", operation "trim"
    When the worker dispatches the tool call (Groq replayed from fixture)
    Then the worker calls auth-proxy POST /api/datasets/{id}/transforms once
    And the SSE stream emits a transform_applied event with column "region", operation "trim"
    And the event's transform_id matches what backend returned
    And the tool's execute callback returns { ok: true, transform_id }

  @pr1 @real-io @adapter-integration @pending @skip
  Scenario: applyCleaningTransform emits error_occurred on backend failure
    Given a chat turn that triggers applyCleaningTransform
    And the backend is configured to return 500 for the next call
    When the worker dispatches the tool call
    Then the SSE stream emits an error_occurred event with phase "backend_dispatch"
    And the error_occurred event has failed_tool "applyCleaningTransform"
    And the tool's execute callback returns { ok: false, error: <message> }
    And the SSE stream is NOT terminated (Q7 — continue past errors)

  @pr1 @real-io @adapter-integration @pending @skip
  Scenario: Multiple cleaning tools in one turn — partial-progress emits per call
    Given a chat turn that triggers three applyCleaningTransform calls
    And the backend is configured to fail on the second call only
    When the worker dispatches all three (Groq replayed from fixture)
    Then the SSE stream contains exactly two transform_applied events
    And the SSE stream contains exactly one error_occurred event with failed_tool "applyCleaningTransform"
    And the events appear in the order: success, error, success
    And the tool execute results in the message thread reflect 2x ok:true and 1x ok:false

  # ---- PR 2: Row + column mutations --------------------------------------

  @pr2 @real-io @adapter-integration @pending @skip
  Scenario: addRow emits row_added with backend-issued id
    Given a chat turn that triggers addRow with values for the dataset's columns
    When the worker dispatches the tool call (Groq replayed from fixture)
    Then the SSE stream emits a row_added event
    And the event's row_id matches what backend returned
    And the event's dataset_id matches the chat context

  @pr2 @real-io @adapter-integration @pending @skip
  Scenario: deleteRow emits row_deleted
    Given a chat turn that triggers deleteRow on an existing row
    When the worker dispatches the tool call (Groq replayed from fixture)
    Then the SSE stream emits a row_deleted event with the requested row_id

  @pr2 @real-io @adapter-integration @pending @skip
  Scenario: renameColumn emits column_renamed with old + new names
    Given a chat turn that triggers renameColumn from "region" to "geo_region"
    When the worker dispatches the tool call (Groq replayed from fixture)
    Then the SSE stream emits a column_renamed event
    And the event has old_name "region" and new_name "geo_region"

  @pr2 @real-io @adapter-integration @pending @skip
  Scenario: undoCleaningTransform with disable mode emits transform_undone mode=disable
    Given an applied transform t-abc on the dataset
    When the worker dispatches undoCleaningTransform with mode "disable" (Groq replayed)
    Then the SSE stream emits a transform_undone event
    And the event has mode "disable" and transform_id "t-abc"

  @pr2 @real-io @adapter-integration @pending @skip
  Scenario: undoCleaningTransform with delete mode emits transform_undone mode=delete
    Given an applied transform t-abc on the dataset
    When the worker dispatches undoCleaningTransform with mode "delete" (Groq replayed)
    Then the SSE stream emits a transform_undone event with mode "delete"

  @pr2 @real-io @adapter-integration @pending @skip
  Scenario: reEnableCleaningTransform emits transform_re_enabled
    Given a previously disabled transform t-abc
    When the worker dispatches reEnableCleaningTransform (Groq replayed)
    Then the SSE stream emits a transform_re_enabled event with transform_id "t-abc"

  # ---- PR 3: UI directives -----------------------------------------------

  @pr3 @in-memory @pending @skip
  Scenario: sortTable emits sort_directive without calling backend
    Given a chat turn that triggers sortTable column "region", direction "asc"
    When the worker dispatches the tool call (Groq replayed from fixture)
    Then the SSE stream emits a sort_directive event with column "region", direction "asc"
    And no HTTP request is made to auth-proxy or backend during dispatch

  @pr3 @in-memory @pending @skip
  Scenario: filterTable emits filter_directive
    Given a chat turn that triggers filterTable column "region", filters [{op:"in", values:["US","EU"]}]
    When the worker dispatches the tool call (Groq replayed from fixture)
    Then the SSE stream emits a filter_directive event
    And the event's filters array equals the input filters

  @pr3 @in-memory @pending @skip
  Scenario: clearFilters emits filters_cleared
    Given a chat turn that triggers clearFilters
    When the worker dispatches the tool call (Groq replayed from fixture)
    Then the SSE stream emits a filters_cleared event with no other payload fields

  # ---- Structural: backend stays chat-unaware (AC1.4 / K2) ---------------

  @structural @kpi @pending @skip
  Scenario: Backend production code references no chat / Groq / SSE concepts
    Given the repository is at the post-PR-3 state
    When `rg -i 'groq|sse|tool_call|tool_calls' backend/app/` runs
    Then the command exits with non-zero (zero matches)
    And the same command run against agent/lib/chat/ DOES return matches
