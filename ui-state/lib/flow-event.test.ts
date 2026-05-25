// Unit tests for the FlowEvent companion object (R6 — the design note's
// getMachine-throws-on-deserialized contract + the from() construction
// invariants).
//
// FlowEvent.from owns the "an event always has a ts" invariant and attaches
// the transient routing FlowId; FlowEvent.getMachine is the send/dispatch
// path's machine accessor and must FAIL LOUD if a deserialized (flowId-less)
// event ever reaches it — strictly better than the old split(":")[0] which
// would silently mis-key.

import { describe, expect, it } from "vitest";

// FlowEvent is both an interface (type) and a companion const (value); a
// single named import brings both. FlowId shares the same module.
import { FlowEvent, FlowId } from "./domain/flow-event.ts";

describe("FlowEvent.from", () => {
  it("defaults ts to now(), payload to {}, and attaches the flowId", () => {
    const before = Date.now();
    const e = FlowEvent.from(FlowId.of("session-onboarding", "u"), {
      type: "org_form_submitted",
      request_id: "R-1",
    });
    expect(e.type).toBe("org_form_submitted");
    expect(e.payload).toEqual({});
    expect(e.request_id).toBe("R-1");
    expect(e.flowId).toEqual(FlowId.of("session-onboarding", "u"));
    expect(Date.parse(e.ts)).toBeGreaterThanOrEqual(before);
  });

  it("honors an explicit ts (the deterministic-clock seam)", () => {
    const e = FlowEvent.from(
      FlowId.of("m", "p"),
      { type: "t", request_id: "r" },
      "2020-01-01T00:00:00.000Z",
    );
    expect(e.ts).toBe("2020-01-01T00:00:00.000Z");
  });

  it("preserves an explicit payload", () => {
    const e = FlowEvent.from(FlowId.of("m", "p"), {
      type: "t",
      payload: { a: 1 },
      request_id: "r",
    });
    expect(e.payload).toEqual({ a: 1 });
  });
});

describe("FlowEvent.getMachine", () => {
  it("returns the flowId's machine segment (legacy alias preserved verbatim)", () => {
    const e = FlowEvent.from(FlowId.of("login-and-org-setup", "u"), {
      type: "t",
      request_id: "r",
    });
    expect(FlowEvent.getMachine(e)).toBe("login-and-org-setup");
  });

  it("THROWS on a deserialized (flowId-less) event reaching the dispatch path", () => {
    // The shape redis deserialize() reconstructs — no flowId.
    const deserialized: FlowEvent = {
      ts: "2020-01-01T00:00:00.000Z",
      type: "t",
      payload: {},
      request_id: "r",
    };
    expect(() => FlowEvent.getMachine(deserialized)).toThrow(/no flowId/);
  });
});
