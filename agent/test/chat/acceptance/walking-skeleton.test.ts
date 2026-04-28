/**
 * Walking skeleton — see acceptance/walking-skeleton.feature.
 *
 * Tags: @walking_skeleton @real-io @requires_external @driving_adapter @kpi
 *
 * SKIPPED until PR 1 lands. The PR-1 polecat un-skips the single `it.skip`
 * below and ships the implementation that makes it green. Subsequently this
 * is a permanent guard on the protocol contract.
 *
 * Strategy: Strategy B (real local + real Groq under @requires_external).
 * Skips automatically when GROQ_API_KEY is absent or when localhost services
 * are unreachable, the same shape as backend/tests/integration/test_lake_preview_live.py.
 */

import { describe, it, expect } from "vitest";

const requiresExternal = !!process.env.GROQ_API_KEY && !!process.env.AGENT_URL;

describe.skip("walking skeleton — chat-driven trim propagates as a typed event", () => {
  const conditional = requiresExternal ? it : it.skip;

  conditional(
    "Trim whitespace via chat propagates end-to-end as a typed event",
    async () => {
      // Given the dev compose stack is running (frontend, agent, auth-proxy, backend, query-engine, minio)
      // And a project owned by dev-user-001 with one CSV uploaded as a parquet dataset
      // And one column "region" contains rows with leading or trailing whitespace
      // (Setup harness — created by PR 1 polecat; uses real boto upload + project create.)

      // When the test POSTs to http://localhost:8787/chat with the dev Bearer JWT
      // And the chat message body is "Trim whitespace on the region column"

      // Then the SSE stream from the agent emits an event with type "transform_applied"
      // And the emitted event has column "region" and operation "trim"
      // And the emitted event's dataset_id matches the uploaded dataset
      // And the SSE stream emits no raw Groq tool-call deltas
      // And subsequently GET /api/datasets/{id}?include_preview=true returns 200
      // And the preview rows show no whitespace-only differences in the region column

      expect.fail("Walking skeleton not yet implemented — PR 1 polecat un-skips and implements.");
    },
    60_000, // real Groq + real backend; generous timeout
  );
});
