/**
 * Cross-stack v6 SSE wire-format contract — frontend half.
 *
 * Loads the same canonical v6 SSE byte stream from the SSOT fixture
 * (`shared/chat/__fixtures__/v6-wire-contract`) that the agent and backend
 * harness contract tests consume, and asserts the frontend `readSSEStream`
 * parser surfaces the same `expected_events` to its `onChatEvent` handler.
 *
 * See also:
 *   - `agent/test/chat/acceptance/wire-contract.test.ts` (agent parser)
 *   - `backend/tests/integration/dataset_layer/test_wire_contract.py`
 *     (harness parser)
 *
 * If any one of these three tests fails while the others pass, the parsers
 * have drifted apart on the v6 envelope shape — fix the offending parser to
 * match the SSOT.
 */

import {
  V6_CONTRACT_BYTES,
  V6_CONTRACT_EXPECTED_EVENTS,
} from "@dashboard-chat/shared-chat/__fixtures__/v6-wire-contract";
import { describe, expect, it } from "vitest";

import { type ChatEvent } from "../events";
import { readSSEStream } from "../services/chatStream";

describe("v6 wire contract — frontend chatStream parser", () => {
  it("parses the canonical v6 SSE byte stream into the SSOT expected ChatEvent[]", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(V6_CONTRACT_BYTES);
        controller.close();
      },
    });

    const observedEvents: ChatEvent[] = [];
    let doneCalled = false;

    await readSSEStream(stream, {
      onContent: () => {
        // text-delta accumulation is not part of the chat-event contract
      },
      onChatEvent: (event) => {
        observedEvents.push(event);
      },
      onDone: () => {
        doneCalled = true;
      },
    });

    expect(observedEvents).toEqual(V6_CONTRACT_EXPECTED_EVENTS);
    // The fixture includes a `finish` frame, so `onDone` MUST have fired.
    expect(doneCalled).toBe(true);
  });
});
