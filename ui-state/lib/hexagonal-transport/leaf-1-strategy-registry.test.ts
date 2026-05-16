// LEAF-1 — FlowStrategy port + registry keyed by canonical machine-name.
//
// DISTILL-authored binding contract (ADR-040 §D1, §D5). DELIVER-deferred:
// every block is `describe.skip` until LEAF-1 lands — DELIVER removes the
// skip and implements to GREEN (Iron Rule: never weaken a spec to pass).
//
// Behavior-neutrality: BEHAVIOR-NEUTRAL. The outer behavioral pin is the
// J-002 acceptance suite (tests/acceptance/project-and-chat-session-management/,
// mr_1..mr_6) which MUST stay byte-behavior-identical; it is REFERENCED by
// RG-LEAF in roadmap.json, not duplicated here. This file pins only the
// STRUCTURAL delta the acceptance suite cannot see: that dispatch goes
// through the registry and no per-machine string conditional survives in
// the carved path.
//
// Binding source: docs/decisions/adr-040-ui-state-hexagonal-transport.md
//   §D1 (FlowStrategy port owns per-machine orchestration; orchestrator ->
//        thin generic pump + per-machine strategies),
//   §D5 (registry key = canonical machine-name per ADR-039; flow-id is
//        explicitly REJECTED as the key — flow-id = <machine-name>:<principal_id>
//        per ADR-030 §6 is an instance id, not a dispatch key),
//   ADR-028 §"no machine imports another machine" (orchestrator is the only
//        cross-machine mediator — the registry must not re-introduce coupling).

import { describe, it } from "vitest";

// Canonical machine-names = the registry keys (ADR-040 D5 / ADR-039).
// These are the three strategies in the C4 target-state diagram:
// LoginOrgSetupStrategy / ProjectContextStrategy / SessionChatStrategy.
const CANONICAL_MACHINE_NAMES = [
  "login-and-org-setup",
  "project-context",
  "session-chat",
] as const;

describe.skip("LEAF-1 FlowStrategy registry — DELIVER-deferred to LEAF-1", () => {
  it("registers exactly one strategy per canonical machine-name and rejects flow-id as a key", () => {
    // DELIVER LEAF-1 binding assertions:
    //   1. A FlowStrategy port (interface) is defined with the D2 members:
    //      machine definition, begin semantics, event->transition mapping,
    //      and `settle` (the typed member that subsumes the emit obligation).
    //   2. registry.get(name) returns a strategy for each of
    //      CANONICAL_MACHINE_NAMES and ONLY those.
    //   3. registry.get("<machine-name>:<principal_id>") (an instance
    //      flow-id) does NOT resolve — the key is the machine-name, never
    //      the flow-id (ADR-040 D5; ADR-030 §6).
    //   4. The registry is a static map (D1 "explicit static machine
    //      registry"); unknown machine -> registry miss (see next test).
    void CANONICAL_MACHINE_NAMES;
  });

  it("unknown machine resolves to a clean 404 via the registry, no conditional fall-through", () => {
    // DELIVER LEAF-1: drive POST /flow/<unknown>/begin in-process
    // (wireRoutes(app, orchestrator) + app.fetch, the index.test.ts
    // pattern). Assert status 404 and that the 404 originates from a
    // registry miss, NOT from a `machine === "..."` else-branch
    // (ADR-040 Consequences: "unknown-machine becomes a clean 404,
    // no conditional fall-through").
  });

  it("the carved dispatch path contains no per-machine `machine === \"<name>\"` conditional", () => {
    // DELIVER LEAF-1 structural assertion (the new contract the acceptance
    // suite cannot pin): read ui-state/lib/orchestrator.ts (and any file
    // the carved dispatch path imports) and assert ZERO occurrences of the
    // per-machine string conditionals the ADR-040 Context enumerates
    //   (machine === "login-and-org-setup" | "session-chat"
    //    | "project-and-chat-session-management")
    // remain in the carved begin/event/settle dispatch path. Dispatch
    // MUST go through registry.get(machineName).<member>(...).
    // (Failure-simulation knob conditionals that are NOT machine-dispatch
    // are out of scope for this assertion — scope it to the dispatch fork.)
  });

  it("characterization: J-002 acceptance suite + ui-state vitest byte-behavior-identical", () => {
    // DELIVER LEAF-1: this is RG-LEAF (roadmap.json regression_gate_definition).
    // Asserted by RUNNING the existing suites, not duplicated here:
    //   - full mr_1..mr_6 PER-MARKER green (baseline mr_4 14/0/0 · mr_5 7/0
    //     · mr_6 8/0; per-marker because of the D-MR5-02 ordering hazard),
    //   - ui-state vitest green,
    //   - GET /projection payload byte-identical before/after for every
    //     J-002 state-history (see leaf-5 spec for the history catalogue).
  });
});
