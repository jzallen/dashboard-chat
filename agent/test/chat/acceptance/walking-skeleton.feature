# Documentation companion — runnable spec lives at walking-skeleton.test.ts.
# DISTILL SSOT for scenario inventory and tag taxonomy. Reviewers read either; CI runs vitest.

Feature: Walking skeleton — chat-driven trim propagates as a typed event
  Story 1 / AC1.1, AC1.2  |  K2 (no raw tool-call deltas in stream)
  Strategy: B (real local + real Groq under @requires_external)

  Background:
    Given the dev compose stack is running (frontend, agent, auth-proxy, backend, query-engine, minio)
    And GROQ_API_KEY is set in the agent environment

  @walking_skeleton @real-io @requires_external @driving_adapter @kpi @pending @skip
  Scenario: Trim whitespace via chat propagates end-to-end as a typed event
    Given a project owned by dev-user-001 with one CSV uploaded as a parquet dataset
    And one column "region" contains rows with leading or trailing whitespace
    When the test POSTs to http://localhost:8787/chat with the dev Bearer JWT
    And the chat message body is "Trim whitespace on the region column"
    Then the SSE stream from the agent emits an event with type "transform_applied"
    And the emitted event has column "region" and operation "trim"
    And the emitted event's dataset_id matches the uploaded dataset
    And the SSE stream emits no raw Groq tool-call deltas
    And subsequently GET /api/datasets/{id}?include_preview=true returns 200
    And the preview rows show no whitespace-only differences in the region column
