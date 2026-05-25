// Unit tests for FrozenState.shouldAbandon — the computed getter that decides
// whether an event arriving at a frozen flow is buffered for THAW replay or
// the flow is abandoned.
//
// The getter is read fresh on each inbound event (NOT a construction-time
// field) because both inputs vary after construction: the freeze window by
// wall-clock, the replay buffer by arrival. These pin the two abandon triggers
// (window elapsed OR buffer full) and the live case, which the orchestrator's
// freeze/abandon branch (sendCore) depends on byte-for-byte — the same
// thresholds the B4 timeout + B5 overflow behavior tests exercise end-to-end.

import { describe, expect, it } from "vitest";

import { FlowEvent, FlowId } from "./domain/flow-event.ts";
import {
  FREEZE_WINDOW_MS,
  FrozenState,
  REPLAY_BUFFER_CAP,
} from "./orchestrator.ts";

function queuedSlot(seq: number) {
  const flowId = FlowId.of("project-and-chat-session-management", "dev-user");
  return {
    flowId,
    event: FlowEvent.from(flowId, { type: "retry_clicked", request_id: "R" }),
    seq,
  };
}

describe("FrozenState.shouldAbandon", () => {
  it("is true once the freeze window has elapsed (window-expiry)", () => {
    const state = new FrozenState(
      Date.now() - (FREEZE_WINDOW_MS + 1_000),
      "origin-flow",
    );
    expect(state.shouldAbandon).toBe(true);
  });

  it("is true once the replay buffer is full (queue-full)", () => {
    const state = new FrozenState(Date.now(), "origin-flow");
    for (let i = 0; i < REPLAY_BUFFER_CAP; i += 1) {
      state.queued.push(queuedSlot(i));
    }
    expect(state.queued.length).toBe(REPLAY_BUFFER_CAP);
    expect(state.shouldAbandon).toBe(true); // length === cap → abandons
  });

  it("is false for a fresh freeze with room in the buffer", () => {
    const state = new FrozenState(Date.now(), "origin-flow");
    expect(state.shouldAbandon).toBe(false);
  });

  it("is false at one below the cap, true at the cap (the >= boundary)", () => {
    const state = new FrozenState(Date.now(), "origin-flow");
    for (let i = 0; i < REPLAY_BUFFER_CAP - 1; i += 1) {
      state.queued.push(queuedSlot(i));
    }
    expect(state.shouldAbandon).toBe(false); // cap - 1 → still queues
    state.queued.push(queuedSlot(REPLAY_BUFFER_CAP - 1));
    expect(state.shouldAbandon).toBe(true); // cap → abandons
  });
});
