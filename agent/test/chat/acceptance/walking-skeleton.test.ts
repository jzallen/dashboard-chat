/**
 * Walking skeleton — see acceptance/walking-skeleton.feature.
 *
 * Tags: @walking_skeleton @real-io @requires_external @driving_adapter @kpi
 *
 * Strategy: Strategy B (real local + real Groq under @requires_external).
 * Skips automatically when GROQ_API_KEY or AGENT_URL is absent — same shape as
 * backend/tests/integration/test_lake_preview_live.py.
 *
 * Permanent guard on the protocol contract once the dev compose stack is up.
 *
 * Wire-format contract (AI SDK v6, `data-*` UIMessage stream):
 *   - Transport: `text/event-stream` SSE, frames separated by `\n\n`.
 *   - Each frame is `data: <UIMessageChunk JSON>` (or `data: [DONE]` sentinel).
 *   - Custom data parts arrive as `{type: 'data-chat-event', data: ChatEvent}`
 *     — replaces the v4 `2:`/`8:` annotation lines.
 *   - Tool deltas arrive as `{type: 'tool-*', ...}` — replaces the v4 `9:` lines.
 *     The acceptance contract asserts NO raw `tool-*` parts surface (the agent
 *     must translate tool calls into typed `data-chat-event` parts).
 */

import { describe, expect, it } from "vitest";

import { consumeChatEvents } from "./_v6SSEParser";

const requiresExternal = !!process.env.GROQ_API_KEY && !!process.env.AGENT_URL;

const DEV_DATASET_ID = process.env.WS_DATASET_ID ?? "";
const DEV_PROJECT_ID = process.env.WS_PROJECT_ID ?? "";
const DEV_JWT = process.env.WS_JWT ?? "dev-token-static";

describe("walking skeleton — chat-driven trim propagates as a typed event", () => {
  const conditional = requiresExternal ? it : it.skip;

  conditional(
    "Trim whitespace via chat propagates end-to-end as a typed event",
    async () => {
      // Given the dev compose stack is running and AGENT_URL points at it
      // And a project owned by dev-user-001 with one CSV uploaded as a parquet dataset
      // (Setup is operator-provisioned; harness reads the IDs from env to keep
      // the skeleton focused on the protocol contract.)
      if (!DEV_DATASET_ID) {
        // Without a dataset to target, the assertion shape is meaningless.
        // The polecat sets WS_DATASET_ID after a manual upload in dev compose.
        return;
      }

      const agentUrl = process.env.AGENT_URL!.replace(/\/$/, "");

      // When the test POSTs to <agent>/chat with the dev Bearer JWT
      const res = await fetch(`${agentUrl}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEV_JWT}`,
        },
        body: JSON.stringify({
          messages: [
            { role: "user", content: "Trim whitespace on the region column" },
          ],
          contextType: "dataset",
          contextId: DEV_DATASET_ID,
          project_id: DEV_PROJECT_ID || undefined,
          tableSchema: {
            columns: [{ id: "region", type: "string" }],
          },
        }),
      });

      // Then HTTP 200 + a parseable SSE stream
      expect(res.status).toBe(200);
      expect(res.body).toBeTruthy();

      const { events, rawToolCallSeen } = await consumeChatEvents(res.body!);

      // The SSE stream emits at least one transform_applied event...
      const applied = events.filter((e) => e.type === "transform_applied");
      expect(applied.length).toBeGreaterThan(0);
      const event = applied[0];
      // ...with column "region" and operation "trim"
      expect(event).toMatchObject({
        type: "transform_applied",
        column: "region",
        operation: "trim",
        dataset_id: DEV_DATASET_ID,
      });
      // And no raw Groq tool-call deltas leaked through
      expect(rawToolCallSeen).toBe(false);
    },
    60_000, // real Groq + real backend; generous timeout
  );
});
