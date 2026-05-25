// Unit tests for the FlowEvent domain model (the class that replaced the
// anemic interface + companion const).
//
// FlowEvent.create owns construction — it builds its OWN FlowId from machine +
// principal and applies birth invariants (ts defaults to now, payload to {}).
// createForFlow births an event addressed to an existing flow key (the
// strategy/broadcast emission path). fromCache rehydrates from a persisted
// FlowEventRecord, reconstructing the identity from the STREAM KEY so
// getMachine()/getFlowId()/flowKey are TOTAL — the prior transient-flowId /
// getMachine-throws design is gone. createCacheSerialization is the SOLE
// event→bytes encoder.
//
// The class is nominally branded by its #flowId private field: a plain
// FlowEventRecord cannot structurally impersonate a FlowEvent. That guarantee
// is compile-time; its runtime proof is that projection.test.ts /
// projection-property.test.ts must now build events via fromCache (a plain
// object literal no longer type-checks as a FlowEvent).

import { describe, expect, it } from "vitest";

import { FlowEvent, type FlowEventRecord } from "./flow-event.ts";

describe("FlowEvent.create", () => {
  it("builds the owned FlowId from machine+principal and defaults ts/payload", () => {
    const before = Date.now();
    const e = FlowEvent.create("session-onboarding", "u", {
      type: "org_form_submitted",
      request_id: "R-1",
    });
    expect(e.type).toBe("org_form_submitted");
    expect(e.payload).toEqual({});
    expect(e.request_id).toBe("R-1");
    expect(e.getMachine()).toBe("session-onboarding");
    expect(e.flowKey).toBe("session-onboarding:u");
    expect(e.getFlowId().principal_id).toBe("u");
    expect(Date.parse(e.ts)).toBeGreaterThanOrEqual(before);
  });

  it("honors an explicit ts (the deterministic-clock seam)", () => {
    const e = FlowEvent.create(
      "m",
      "p",
      { type: "t", request_id: "r" },
      "2020-01-01T00:00:00.000Z",
    );
    expect(e.ts).toBe("2020-01-01T00:00:00.000Z");
  });

  it("preserves an explicit payload", () => {
    const e = FlowEvent.create("m", "p", {
      type: "t",
      payload: { a: 1 },
      request_id: "r",
    });
    expect(e.payload).toEqual({ a: 1 });
  });
});

describe("FlowEvent.createForFlow", () => {
  it("births an event addressed to an existing flow key (legacy alias preserved verbatim)", () => {
    const e = FlowEvent.createForFlow("login-and-org-setup:u", {
      type: "t",
      request_id: "r",
    });
    expect(e.getMachine()).toBe("login-and-org-setup");
    expect(e.flowKey).toBe("login-and-org-setup:u");
    expect(e.payload).toEqual({});
  });
});

describe("FlowEvent serialization round-trip (createCacheSerialization ∘ fromCache)", () => {
  it("createCacheSerialization yields exactly the 4 byte-stable record fields", () => {
    const e = FlowEvent.create(
      "session-onboarding",
      "u",
      {
        type: "org_created",
        payload: { org: { id: "o1" } },
        request_id: "R-1",
      },
      "2026-05-25T00:00:00.000Z",
    );
    const record = e.createCacheSerialization();
    expect(record).toEqual({
      ts: "2026-05-25T00:00:00.000Z",
      type: "org_created",
      payload: { org: { id: "o1" } },
      request_id: "R-1",
    });
    // The persisted shape is EXACTLY these four keys — no identity leaks in.
    expect(Object.keys(record).sort()).toEqual([
      "payload",
      "request_id",
      "ts",
      "type",
    ]);
  });

  it("fromCache rebuilds the fields + a TOTAL identity from the stream key", () => {
    const record: FlowEventRecord = {
      ts: "2026-05-25T00:00:00.000Z",
      type: "session_started",
      payload: { user: { email: "x@y" } },
      request_id: "R-2",
    };
    const e = FlowEvent.fromCache("session-onboarding:user-x", record);
    expect(e.ts).toBe(record.ts);
    expect(e.type).toBe("session_started");
    expect(e.payload).toEqual({ user: { email: "x@y" } });
    expect(e.request_id).toBe("R-2");
    // Identity reconstructed from the flowKey — getMachine never throws on a
    // read-back event (the record carries no identity field).
    expect(e.getMachine()).toBe("session-onboarding");
    expect(e.flowKey).toBe("session-onboarding:user-x");
  });

  it("round-trips a created event through its cache record", () => {
    const original = FlowEvent.create(
      "project-and-chat-session-management",
      "dev-user",
      {
        type: "project_selected",
        payload: { project: { id: "p1" } },
        request_id: "R-3",
      },
    );
    const rebuilt = FlowEvent.fromCache(
      original.flowKey,
      original.createCacheSerialization(),
    );
    expect(rebuilt.createCacheSerialization()).toEqual(
      original.createCacheSerialization(),
    );
    expect(rebuilt.getMachine()).toBe(original.getMachine());
    expect(rebuilt.flowKey).toBe(original.flowKey);
  });
});
