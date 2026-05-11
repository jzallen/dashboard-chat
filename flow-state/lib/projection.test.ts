// Unit tests for buildProjection — the pure-function driving port.
//
// Per nw-tdd-methodology: pure domain functions ARE their own driving ports;
// calling them directly IS port-to-port testing because the function signature
// is the public interface.
//
// Behavior budget for step 01-01:
//   - Empty event log → initial-state projection (state=anonymous).
//   - sign_in_clicked + auth_callback_resolved sequence → authenticated_no_org.

import { describe, it, expect } from "vitest";

import { buildProjection, type FlowEvent } from "./projection.ts";

const baseEvent = (
  type: string,
  payload: Record<string, unknown> = {},
  correlation_id = "corr-1",
): FlowEvent => ({
  ts: "2026-05-11T22:00:00.000Z",
  type,
  payload,
  correlation_id,
});

describe("buildProjection (pure projection builder)", () => {
  it("returns the initial state when no events have been recorded", () => {
    const projection = buildProjection("login-and-org-setup:user_maya_chen", []);

    expect(projection.state).toBe("anonymous");
    expect(projection.sequence_id).toBe(0);
    expect(projection.flow_id).toBe("login-and-org-setup:user_maya_chen");
    expect(projection.context).toMatchObject({
      user: { email: null, display_name: null },
    });
  });

  it("reaches authenticated_no_org after a successful sign-in sequence", () => {
    const events: FlowEvent[] = [
      baseEvent("sign_in_clicked", {}),
      baseEvent("auth_callback_resolved", {
        user: {
          email: "maya.chen@acme-data.example",
          display_name: "Maya Chen",
        },
      }),
    ];

    const projection = buildProjection(
      "login-and-org-setup:user_maya_chen",
      events,
    );

    expect(projection.state).toBe("authenticated_no_org");
    expect(projection.context).toMatchObject({
      user: {
        email: "maya.chen@acme-data.example",
        display_name: "Maya Chen",
      },
    });
    expect(projection.sequence_id).toBe(2);
  });
});
