/**
 * Cross-stack v6 SSE wire-format contract — agent half.
 *
 * One canonical v6 SSE byte stream is loaded from the SSOT fixture under
 * `shared/chat/__fixtures__/`. The same bytes are parsed by:
 *
 *   1. The agent walking-skeleton parser (`consumeChatEvents`)        — here
 *   2. The frontend chatStream parser (`readSSEStream`)                — see
 *      `frontend/src/core/chat/__tests__/wire-contract.test.ts`
 *   3. The backend harness parser (`parse_chat_event_frames`)          — see
 *      `backend/tests/integration/dataset_layer/test_wire_contract.py`
 *
 * All three MUST extract the same `expected_events` (same items, same order)
 * declared in the SSOT fixture. This test asserts (1) against the fixture's
 * declared expected output. Drift in any one parser surfaces as one of the
 * three contract tests failing.
 */

import {
  V6_CONTRACT_BYTES,
  V6_CONTRACT_EXPECTED_EVENTS,
} from "@dashboard-chat/shared-chat/__fixtures__/v6-wire-contract";
import { describe, expect, it } from "vitest";

import { consumeChatEventsFromBytes } from "./_v6SSEParser";

describe("v6 wire contract — agent walking-skeleton parser", () => {
  it("parses the canonical v6 SSE byte stream into the SSOT expected ChatEvent[]", async () => {
    const { events, rawToolCallSeen } = await consumeChatEventsFromBytes(V6_CONTRACT_BYTES);

    expect(rawToolCallSeen).toBe(false);
    expect(events).toEqual(V6_CONTRACT_EXPECTED_EVENTS);
  });
});
