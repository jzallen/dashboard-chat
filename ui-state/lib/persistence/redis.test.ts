// Characterization (seam a) — the FlowEventLog adapter round-trip.
//
// redis.ts is the driven (outbound) adapter: it owns (de)serialization of the
// FlowEventRecord and reconstructs domain FlowEvent objects on read. This pins
// the contract that survives the FlowEvent-class refactor:
//
//   1. append → read preserves the byte-stable record fields
//      (ts, type, payload, request_id) — the ADR-027 persistence contract.
//   2. read returns DOMAIN objects (FlowEvent instances), and their identity
//      (machine / flowKey) is reconstructed from the STREAM KEY the adapter
//      read from — `read(flow_id)` keys off `flow_id`. So getMachine() is
//      TOTAL on a read-back event (it never throws).
//
// The Redis tier needs a live server, so these exercise the noop adapter —
// which mirrors the Redis tier's record round-trip in-process (it serializes
// to a FlowEventRecord on append and rehydrates via FlowEvent.fromCache on
// read), so the same (de)serialization seam is covered without a Redis dep.

import { describe, expect, it } from "vitest";

import { FlowEvent } from "../domain/flow-event.ts";
import { createNoopFlowEventLog } from "./redis.ts";

const FLOW_ID = "project-and-chat-session-management:dev-user-001";

describe("FlowEventLog round-trip (noop adapter, seam a)", () => {
  it("preserves ts/type/payload/request_id across append → read", async () => {
    const log = createNoopFlowEventLog();
    const event = FlowEvent.create("project-and-chat-session-management", "dev-user-001", {
      type: "project_selected",
      payload: { org_id: "org-acme", project: { id: "p1", name: "P1" } },
      request_id: "R-1",
    });

    await log.append(FLOW_ID, event);
    const [readBack] = await log.read(FLOW_ID);

    expect(readBack.ts).toBe(event.ts);
    expect(readBack.type).toBe("project_selected");
    expect(readBack.payload).toEqual({
      org_id: "org-acme",
      project: { id: "p1", name: "P1" },
    });
    expect(readBack.request_id).toBe("R-1");
  });

  it("reconstructs a TOTAL flow identity from the stream key on read", async () => {
    const log = createNoopFlowEventLog();
    // Build the event addressed to one flow, persist under the same key.
    const event = FlowEvent.createForFlow(FLOW_ID, {
      type: "retry_clicked",
      payload: {},
      request_id: "R-2",
    });
    await log.append(FLOW_ID, event);

    const [readBack] = await log.read(FLOW_ID);
    // getMachine() / flowKey are derived from the stream key — never throw,
    // even though the persisted record carries no identity field.
    expect(readBack.getMachine()).toBe("project-and-chat-session-management");
    expect(readBack.flowKey).toBe(FLOW_ID);
  });

  it("round-trips a key whose principal contains no colon and an empty payload", async () => {
    const log = createNoopFlowEventLog();
    const key = "session-chat:";
    const event = FlowEvent.createForFlow(key, {
      type: "session_list_load_started",
      payload: {},
      request_id: "R-3",
    });
    await log.append(key, event);

    const [readBack] = await log.read(key);
    expect(readBack.getMachine()).toBe("session-chat");
    expect(readBack.getFlowId().principal_id).toBe("");
    expect(readBack.payload).toEqual({});
  });
});
