// Unit tests for buildProjection — the pure-function driving port.
//
// Per nw-tdd-methodology: pure domain functions ARE their own driving ports;
// calling them directly IS port-to-port testing because the function signature
// is the public interface.
//
// Behavior budget:
//   - Empty event log → initial-state projection (state=verifying).
//   - session_started{user, org:null} → needs_org with user populated at t=0.
//   - session_started{user, org} → ready ([hasOrg] branch replicated).

import { describe, expect,it } from "vitest";

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
    const projection = buildProjection("session-onboarding:user_maya_chen", []);

    expect(projection.state).toBe("verifying");
    expect(projection.sequence_id).toBe(0);
    expect(projection.flow_id).toBe("session-onboarding:user_maya_chen");
    expect(projection.context).toMatchObject({
      user: { email: null, display_name: null },
    });
  });

  it("reaches needs_org with the user populated after session_started{org:null}", () => {
    const events: FlowEvent[] = [
      baseEvent("session_started", {
        user: {
          email: "maya.chen@acme-data.example",
          display_name: "Maya Chen",
        },
        org: null,
      }),
    ];

    const projection = buildProjection(
      "session-onboarding:user_maya_chen",
      events,
    );

    expect(projection.state).toBe("needs_org");
    expect(projection.context).toMatchObject({
      user: {
        email: "maya.chen@acme-data.example",
        display_name: "Maya Chen",
      },
    });
    expect(projection.sequence_id).toBe(1);
  });

  it("reaches ready directly when session_started carries an org ([hasOrg])", () => {
    const events: FlowEvent[] = [
      baseEvent("session_started", {
        user: {
          email: "maya.chen@acme-data.example",
          display_name: "Maya Chen",
        },
        org: { id: "org-1", name: "Acme Data" },
      }),
    ];

    const projection = buildProjection(
      "session-onboarding:user_maya_chen",
      events,
    );

    expect(projection.state).toBe("ready");
    expect(projection.context).toMatchObject({
      org: { id: "org-1", name: "Acme Data" },
    });
  });
});
