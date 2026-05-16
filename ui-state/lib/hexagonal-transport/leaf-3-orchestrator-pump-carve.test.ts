// LEAF-3 — Carve orchestrator per-machine branches into the three
// strategies; the orchestrator shrinks to a generic pump.
//
// DISTILL-authored binding contract (ADR-040 §D1, §D2, LEAF-3).
// DELIVER-deferred: `describe.skip` until LEAF-3 lands.
//
// Behavior-neutrality: BEHAVIOR-NEUTRAL. settle->emit STILL writes the
// Redis-Streams event-log this LEAF (the read-port swap is LEAF-5). The
// outer behavioral pin is the J-002 acceptance suite (REFERENCED via
// RG-LEAF, not duplicated). This file pins the STRUCTURAL delta only.
//
// Binding source:
//   ADR-040 §D1 (orchestrator decomposed into thin generic pump + per-
//     machine strategies; decomposition of the existing class, not a new
//     parallel subsystem),
//   ADR-040 §D2 (generic pump KEEPS: actor-system ownership & spawn
//     lifecycle, FREEZE/THAW broadcast, the bounded intent-replay buffer,
//     the FE projection-read endpoint; the FlowStrategy owns machine
//     definition / begin / event->transition / settle),
//   ADR-040 LEAF-3 ("settle->emit still writes the event-log
//     (behavior-neutral)"),
//   ADR-030 §"Amendment 2026-05-15 — Projection as primary read model"
//     (the read-path contract — orchestrator reads from the projection,
//     never snapshot.context — is PRESERVED; the no-orchestrator-snapshot-
//     reads ESLint rule (LEAF-D) must still pass on the carved orchestrator),
//   ADR-028 §"no machine imports another machine" (the carve must not
//     introduce machine-to-machine coupling; orchestrator stays the only
//     cross-machine mediator).

import { describe, it } from "vitest";

// What the generic pump RETAINS after the carve (ADR-040 §D2 — central /
// driven / cross-cutting). A per-machine fan-out remaining in any of these
// would mean the carve is incomplete.
const PUMP_RETAINS = [
  "actor-system ownership & spawn lifecycle",
  "FREEZE/THAW broadcast (cross-machine; cannot belong to one strategy)",
  "bounded intent-replay buffer (US-210 scope)",
  "FE projection-read endpoint (ADR-027 §1 contract at the adapter edge)",
] as const;

// What moves OUT of the orchestrator into each FlowStrategy (ADR-040 §D2).
const STRATEGY_OWNS = [
  "machine definition",
  "begin semantics",
  "event->transition mapping",
  "settle (the typed member subsuming the emit obligation)",
] as const;

describe.skip("LEAF-3 orchestrator-pump carve — DELIVER-deferred to LEAF-3", () => {
  it("the residual orchestrator is a generic pump with no per-machine fan-out", () => {
    // DELIVER LEAF-3 structural assertion: read ui-state/lib/orchestrator.ts
    // and assert the carved begin/event/settle dispatch path contains ZERO
    // per-machine `machine === "..."` branches (the ADR-040 Context
    // conditionals at the historical L188/222/359/376/461 are gone from
    // the dispatch fork). All per-machine logic is reached via
    // registry.get(machineName).<member>() (LEAF-1's port).
    void PUMP_RETAINS;
    void STRATEGY_OWNS;
  });

  it("each strategy owns begin / event->transition / settle for its machine", () => {
    // DELIVER LEAF-3: drive begin + a representative event + settle for
    // each of login-and-org-setup / project-context / session-chat
    // in-process (wireRoutes + app.fetch) and assert the transition
    // outcome (projection.state) is produced by the strategy, identical to
    // the pre-carve orchestrator output for the same input.
  });

  it("settle->emit still writes the event-log this LEAF (read-port swap deferred to LEAF-5)", () => {
    // DELIVER LEAF-3: assert a settle still appends a FlowEvent to the
    // FlowEventLog and GET /projection still resolves via
    // buildProjection(eventLog.read()). Behavior-neutral: the GET
    // /projection payload is byte-identical before/after the carve for
    // every J-002 state-history (catalogue in the leaf-5 spec).
  });

  it("the no-orchestrator-snapshot-reads ESLint rule (ADR-030 LEAF-D) still passes", () => {
    // DELIVER LEAF-3: the carve MUST NOT re-introduce snapshot.context.*
    // reads into orchestrator.ts (eslint.config.js scopes the
    // ui-state-conventions/no-orchestrator-snapshot-reads rule to
    // ui-state/lib/orchestrator.ts at severity "error"). Strategy bodies
    // legitimately read snapshots; the pump does not. RG-LEAF runs eslint.
  });

  it("characterization: full mr_1..mr_6 per-marker + ui-state vitest byte-behavior-identical", () => {
    // DELIVER LEAF-3 = RG-LEAF. Asserted by running the existing suites
    // per-marker (D-MR5-02 ordering hazard — never the whole directory at
    // once). The acceptance suite is the inherited behavioral SSOT; it is
    // NOT duplicated here.
  });
});
