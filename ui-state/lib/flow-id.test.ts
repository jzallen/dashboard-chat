// Unit tests for the FlowId value object (R6 — the design note's
// fromKey∘toKey round-trip + first-colon contract).
//
// FlowId is the single home of the `${machine}:${principal_id}` encoding the
// actor map, the Redis key prefix, and projection.flow_id all share. These
// pin the encoding contract so the orchestrator's bridge sites
// (FlowId.toKey / FlowId.fromKey) stay byte-faithful to the old
// `flow_id.split(":")` readers they replace.

import { describe, expect, it } from "vitest";

import { FlowId } from "./domain/flow-event.ts";

describe("FlowId.toKey", () => {
  it("encodes the pair as `${machine}:${principal_id}`", () => {
    expect(FlowId.toKey(FlowId.of("session-onboarding", "user-x"))).toBe(
      "session-onboarding:user-x",
    );
  });

  it("preserves a legacy-alias machine segment verbatim (LEAF-2)", () => {
    // toKey() must reproduce the EXACT minted key — canonicalization stays at
    // resolve(), never at FlowId construction.
    expect(FlowId.toKey(FlowId.of("login-and-org-setup", "user-x"))).toBe(
      "login-and-org-setup:user-x",
    );
  });
});

describe("FlowId.fromKey", () => {
  it("splits on the FIRST colon — machine is the head segment", () => {
    const id = FlowId.fromKey("session-onboarding:user-x");
    expect(id.machine).toBe("session-onboarding");
    expect(id.principal_id).toBe("user-x");
  });

  it("keeps a colon-bearing principal intact (first-colon contract)", () => {
    // The old parsePrincipal did split(":")[1], which would DROP "b:c";
    // indexOf/slice preserves it.
    const id = FlowId.fromKey("a:b:c");
    expect(id.machine).toBe("a");
    expect(id.principal_id).toBe("b:c");
  });

  it("yields an empty principal_id for a key with no colon", () => {
    const id = FlowId.fromKey("session-onboarding");
    expect(id.machine).toBe("session-onboarding");
    expect(id.principal_id).toBe("");
  });
});

describe("FlowId round-trip (fromKey ∘ toKey)", () => {
  it.each([
    ["session-onboarding", "user-x"],
    ["login-and-org-setup", "user-x"],
    ["project-and-chat-session-management", "dev-user-001"],
    ["session-chat", ""],
    // colon-bearing principal — the strictly-safer fromKey contract
    ["machine", "b:c"],
  ])("toKey then fromKey reproduces (%s, %s)", (machine, principal) => {
    const original = FlowId.of(machine, principal);
    const roundTripped = FlowId.fromKey(FlowId.toKey(original));
    expect(roundTripped).toEqual(original);
  });
});
