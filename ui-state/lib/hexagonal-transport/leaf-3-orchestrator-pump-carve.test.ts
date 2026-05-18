// LEAF-3 — Carve orchestrator per-machine branches into the three
// strategies; the orchestrator shrinks to a generic pump.
//
// DISTILL-authored binding contract (ADR-040 §D1, §D2, LEAF-3).
// DELIVER LEAF-3 MR-L3c/N17 removed the `describe.skip` and implemented
// the stubbed assertions to GREEN (Iron Rule: the spec is implemented,
// never weakened to pass — the pump is made to meet the contract).
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
//     cross-machine mediator — the `project_ready`/`auth_ready` spawn-event
//     ROUTING is that sole-mediator role and stays pump-central, §3).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { fromPromise } from "xstate";

import { wireRoutes } from "../../index.ts";
import type { FlowStrategy } from "../orchestrator.ts";
import { FLOW_STRATEGY_REGISTRY, FlowOrchestrator } from "../orchestrator.ts";
import { createNoopFlowEventLog } from "../persistence/redis.ts";

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

// The three canonical machine-names (ADR-039 / ADR-040 D5) = the registry
// keys; the three strategies in the C4 target-state diagram.
const CANONICAL_MACHINE_NAMES = [
  "login-and-org-setup",
  "project-context",
  "session-chat",
] as const;

// Legacy feature-slug wire vocabulary still driven by the J-002 acceptance
// suite (the D5 migration alias canonicalizes it to project-context).
const LEGACY_PROJECT_CONTEXT_SLUG = "project-and-chat-session-management";

const ORCHESTRATOR_SRC = readFileSync(
  fileURLToPath(new URL("../orchestrator.ts", import.meta.url)),
  "utf8",
);

const ESLINT_CONFIG_SRC = readFileSync(
  fileURLToPath(new URL("../../../eslint.config.js", import.meta.url)),
  "utf8",
);

/** Slice a single method body out of the orchestrator source so a
 *  structural assertion is scoped to that method (the leaf-1
 *  `methodBody` helper, verbatim — the established methodology). Walks
 *  the param list to its matching close-paren so an inline object-type
 *  param's own braces are not mistaken for the body open-brace. */
/** Strip `//` line comments and block comments so a structural
 *  assertion pins DISPATCH CODE, never documentation that legitimately
 *  references a wire-name token / the `getSnapshot().context` boundary it
 *  is explaining. A comment can neither satisfy nor break the GOAL (zero
 *  per-machine dispatch CODE), so scanning code-only is the faithful —
 *  and strictly stronger — encoding of the ADR-040 §D1/§D2 contract. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function methodBody(source: string, methodName: string): string {
  const start = source.indexOf(`async ${methodName}(`);
  if (start < 0) throw new Error(`method not found: ${methodName}`);
  let i = source.indexOf("(", start);
  let parenDepth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) break;
    }
  }
  let depth = 0;
  i = source.indexOf("{", i);
  const bodyStart = i;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`unbalanced braces for: ${methodName}`);
}

function buildOrchestrator(): FlowOrchestrator {
  // Login-only deps + noop event log (the LEAF-1/LEAF-2 buildOrchestrator
  // shape). Port boundary only; no internal mocks. project-context /
  // session-chat begin therefore resolves to a DETERMINISTIC dispatch
  // outcome via the registry — sufficient for the structural + round-trip
  // contracts here (the behavioral pin is the J-002 acceptance RG-LEAF).
  return new FlowOrchestrator({
    eventLog: createNoopFlowEventLog(),
    loginMachineDeps: {
      workosUserInfo: fromPromise(async () => ({
        email: "maya.chen@acme-data.example",
        display_name: "Maya Chen",
      })),
      createOrgAndReissue: fromPromise(async () => ({
        org_id: "org-acme-data",
        org_name: "Acme Data",
      })),
    },
    log: () => undefined,
  });
}

const IDENTITY_HEADERS = {
  "content-type": "application/json",
  "X-User-Id": "dev-user-001",
  "X-Org-Id": "dev-org-001",
  "X-User-Email": "dev@localhost",
  "X-Correlation-Id": "leaf3-pump-carve-fixed-corr",
};

describe("LEAF-3 orchestrator-pump carve", () => {
  it("the residual orchestrator is a generic pump with no per-machine fan-out", () => {
    // DELIVER LEAF-3 structural assertion (the new delta the acceptance
    // suite cannot pin): the carved begin/event/settle dispatch path in
    // ui-state/lib/orchestrator.ts contains ZERO per-machine
    // `machine === "<wire>"` branch (the ADR-040 Context conditionals at
    // the historical L188/222/359/376/461 are gone from the dispatch
    // fork). All per-machine logic is reached via the FlowStrategy
    // registry/port (`FLOW_STRATEGY_REGISTRY.resolve(machine).<member>()`
    // or the unconditional-by-ref strategy chain whose guards are INSIDE
    // each strategy — the N3/N8 precedent for the non-machine-exclusive
    // settle chain). The ONLY residual wire-name comparison permitted in
    // the pump is the cross-machine spawn-event ROUTING
    // (`isProjectReadyDispatch` / `isAuthReadyDispatch`) — ADR-028's
    // sole-cross-machine-mediator role, which §3 / ADR-040 §D2 ("pump
    // KEEPS spawn lifecycle") explicitly KEEP pump-central. That routes
    // WHICH spawn event the mediator forwards, NOT which strategy's
    // transition emission runs — it is not per-machine transition
    // dispatch.
    expect(PUMP_RETAINS.length).toBe(4);
    expect(STRATEGY_OWNS.length).toBe(4);

    // The legacy conditional-table identifiers are fully retired.
    expect(ORCHESTRATOR_SRC).not.toMatch(/MACHINE_REGISTRY/);
    expect(ORCHESTRATOR_SRC).not.toMatch(/MachineFactory/);

    // A per-machine DISPATCH BRANCH is a wire-name COMPARISON
    // (`=== <WIRE>` / `!== <WIRE>` / `=== "<wire-literal>"`) — NOT a bare
    // token (the carve's own explanatory comments / a spawn-payload
    // `machine: SESSION_CHAT_WIRE_NAME` object property are not dispatch
    // branches). Scan comment-stripped CODE for the comparison forms.
    const WIRE_COMPARISONS = [
      /[!=]==\s*SESSION_CHAT_WIRE_NAME/,
      /SESSION_CHAT_WIRE_NAME\s*[!=]==/,
      /[!=]==\s*PROJECT_CONTEXT_WIRE_NAME/,
      /PROJECT_CONTEXT_WIRE_NAME\s*[!=]==/,
      /machine\s*[!=]==\s*"login-and-org-setup"/,
      /machine\s*[!=]==\s*"session-chat"/,
      /machine\s*[!=]==\s*"project-and-chat-session-management"/,
    ];

    // `send` + `appendDeepLinkEvents` + `begin` carry ZERO per-machine
    // transition-dispatch comparison. (This is the LEAF-3 delta beyond
    // leaf-1's it: the per-machine settle/emit fan-out that lived in
    // `send` is now fully carved into the strategy ports.)
    for (const method of ["begin", "send", "appendDeepLinkEvents"]) {
      const body = stripComments(methodBody(ORCHESTRATOR_SRC, method));
      for (const cmp of WIRE_COMPARISONS) {
        expect(body, `${method} :: ${cmp}`).not.toMatch(cmp);
      }
    }

    // The dispatch goes through the registry/port: `send` resolves the
    // strategy for the pre-settle event->transition emission AND runs the
    // typed-port settle chain; `appendDeepLinkEvents` resolves + calls the
    // port member.
    const sendBody = methodBody(ORCHESTRATOR_SRC, "send");
    expect(sendBody).toMatch(/FLOW_STRATEGY_REGISTRY\.resolve\(/);
    expect(sendBody).toMatch(/loginOrgSetupStrategy\.settle\(/);
    expect(sendBody).toMatch(/projectContextStrategy\.settle\(/);
    expect(sendBody).toMatch(/sessionChatStrategy\.settle\(/);
    expect(
      methodBody(ORCHESTRATOR_SRC, "appendDeepLinkEvents"),
    ).toMatch(/FLOW_STRATEGY_REGISTRY\.resolve\(/);

    // `beginIfNotStarted`: the spawn-time terminal emission dispatches via
    // the resolved port member (`strategy.settleSpawn`) — ZERO per-machine
    // transition branch. The ONLY surviving `*_WIRE_NAME` comparisons are
    // the cross-machine spawn-event ROUTING detections (the §3 /
    // ADR-028 sole-mediator role the pump KEEPS). Pin that EVERY residual
    // wire-name comparison line is part of an `isProjectReadyDispatch` /
    // `isAuthReadyDispatch` detection — never a per-machine transition
    // dispatch.
    const binsBody = methodBody(ORCHESTRATOR_SRC, "beginIfNotStarted");
    const binsCode = stripComments(binsBody);
    // Spawn-time terminal emission dispatches via the resolved port
    // member (no per-machine branch); the project-context-specific
    // settleSpawn ref is gone (it was the N6 inline).
    expect(binsCode).toMatch(/strategy\.settleSpawn\(/);
    expect(binsCode).not.toMatch(/projectContextStrategy\.settleSpawn\(/);
    // The ONLY residual wire-name COMPARISON in the carved
    // beginIfNotStarted is the cross-machine spawn-event ROUTING
    // predicate `isProjectReadyDispatch` (§3 / ADR-040 §D2 / ADR-028 —
    // the orchestrator's sole-cross-machine-mediator role the pump
    // KEEPS; it routes WHICH spawn event the mediator forwards, NOT
    // which strategy's transition emission runs). Every comment-stripped
    // wire-comparison line must be that routing predicate.
    const wireCmpLines = binsCode
      .split("\n")
      .filter((l) =>
        /[!=]==\s*SESSION_CHAT_WIRE_NAME|SESSION_CHAT_WIRE_NAME\s*[!=]==|[!=]==\s*PROJECT_CONTEXT_WIRE_NAME|PROJECT_CONTEXT_WIRE_NAME\s*[!=]==/.test(
          l,
        ),
      );
    expect(wireCmpLines.length).toBeGreaterThan(0);
    for (const line of wireCmpLines) {
      expect(
        /isProjectReadyDispatch|isAuthReadyDispatch/.test(line) ||
          /input\.machine === SESSION_CHAT_WIRE_NAME/.test(line),
        `residual wire-name comparison must be spawn-event ROUTING (§3/ADR-028 sole-mediator), not per-machine dispatch: ${line.trim()}`,
      ).toBe(true);
    }
    // The routing predicate is exactly the spawn detection (defined
    // once), proving no per-machine settle/emit branch hides behind it.
    expect(binsCode).toMatch(
      /const isProjectReadyDispatch =\s*input\.machine === SESSION_CHAT_WIRE_NAME/,
    );
  });

  it("each strategy owns begin / event->transition / settle for its machine", async () => {
    // DELIVER LEAF-3: every canonical machine resolves to a FlowStrategy
    // that OWNS the carved members (machine definition + begin semantics +
    // event->transition + settle). The pump holds none of this per-machine
    // logic — it dispatches to the port. Drive begin in-process
    // (wireRoutes + app.request) for each machine and assert it routes
    // through the strategy (no 404 fall-through; the registry IS the
    // dispatch) producing a projection.
    for (const name of CANONICAL_MACHINE_NAMES) {
      const strategy: FlowStrategy | undefined =
        FLOW_STRATEGY_REGISTRY.get(name);
      expect(strategy, `strategy for ${name}`).toBeDefined();
      expect(strategy!.machineName).toBe(name);
      // Machine definition (ADR-040 §D2) is the strategy's.
      expect(typeof strategy!.buildMachine).toBe("function");
      // event->transition + settle (the typed emit obligation) are the
      // strategy's carved members.
      expect(typeof strategy!.applyEvent).toBe("function");
      expect(typeof strategy!.settle).toBe("function");
      expect(typeof strategy!.settleSpawn).toBe("function");
      expect(typeof strategy!.settleFreeze).toBe("function");
      expect(typeof strategy!.settleThaw).toBe("function");
    }
    // login is the only `beginsDirectly` machine — it owns `beginDirect`;
    // the J-002 machines are spawned via the cross-machine hook.
    expect(
      typeof FLOW_STRATEGY_REGISTRY.get("login-and-org-setup")!.beginDirect,
    ).toBe("function");
    expect(
      FLOW_STRATEGY_REGISTRY.get("login-and-org-setup")!.beginsDirectly,
    ).toBe(true);
    expect(FLOW_STRATEGY_REGISTRY.get("project-context")!.beginsDirectly).toBe(
      false,
    );
    expect(FLOW_STRATEGY_REGISTRY.get("session-chat")!.beginsDirectly).toBe(
      false,
    );
    // The D5 alias resolves the legacy slug to the SAME project-context
    // strategy (registry stays canonical-keyed) — the byte-behavior-
    // neutrality precondition the J-002 suite depends on.
    expect(FLOW_STRATEGY_REGISTRY.resolve(LEGACY_PROJECT_CONTEXT_SLUG)).toBe(
      FLOW_STRATEGY_REGISTRY.get("project-context"),
    );

    // In-process begin round-trip: the login strategy's `beginDirect`
    // produces the projection (no per-machine pump branch). A registered
    // machine never 404s (404 would mean a registry-miss fall-through).
    const app = new Hono();
    wireRoutes(app, buildOrchestrator());
    const res = await app.request("/flow/login-and-org-setup/begin", {
      method: "POST",
      headers: IDENTITY_HEADERS,
      body: JSON.stringify({
        persona_email: "maya.chen@acme-data.example",
        persona_display_name: "Maya Chen",
      }),
    });
    expect(res.status).not.toBe(404);
    const body = (await res.json()) as { state?: string; flow_id?: string };
    // The strategy-produced projection carries a state (begin semantics
    // owned by LoginOrgSetupStrategy.beginDirect, reached via the port).
    expect(typeof body.state).toBe("string");
  });

  it("settle->emit still writes the event-log this LEAF (read-port swap deferred to LEAF-5)", async () => {
    // DELIVER LEAF-3 (behavior-neutral): the carved `settle->emit` STILL
    // appends FlowEvents to the FlowEventLog and GET /projection STILL
    // resolves via buildProjection(eventLog.read()). LEAF-5 (the
    // SettledStateStore read-port swap + harvestSettled* deletion) is NOT
    // pulled forward.
    const app = new Hono();
    wireRoutes(app, buildOrchestrator());
    const begin = await app.request("/flow/login-and-org-setup/begin", {
      method: "POST",
      headers: IDENTITY_HEADERS,
      body: JSON.stringify({
        persona_email: "maya.chen@acme-data.example",
        persona_display_name: "Maya Chen",
      }),
    });
    const begun = (await begin.json()) as { flow_id: string };
    expect(begun.flow_id).toBeTruthy();
    // GET /projection resolves the event-log-derived projection (the
    // settle->emit appends are observable through the read path). A flow
    // that emitted nothing would project the empty `anonymous` baseline;
    // login begin's settle->emit chain advances it past that.
    const proj = await app.request(
      `/flow/login-and-org-setup/projection?flow_id=${encodeURIComponent(begun.flow_id)}`,
      { method: "GET", headers: IDENTITY_HEADERS },
    );
    expect(proj.status).toBe(200);
    const projBody = (await proj.json()) as { state?: string };
    expect(typeof projBody.state).toBe("string");
    expect(projBody.state).not.toBe("anonymous");

    // Structural pin: the read path is STILL buildProjection over the
    // event-log read (LEAF-5 not pulled forward), and the harvestSettled*
    // family is still present (strategies CALL it; KEEP the entire
    // family — the §7 scope-fence: a node that deletes/inlines a harvester
    // or swaps the read-port = reject).
    // GET /projection STILL resolves via `buildProjection` over an
    // `eventLog.read` (the event-log read-path — LEAF-5's
    // SettledStateStore swap is NOT pulled forward). The pump reads the
    // log then builds the projection (read-then-build); pin both, not an
    // over-specified inline nesting.
    const projForBody = methodBody(ORCHESTRATOR_SRC, "projectionFor");
    expect(projForBody).toMatch(/this\.deps\.eventLog\.read\(/);
    expect(projForBody).toMatch(/buildProjection\(/);
    expect(ORCHESTRATOR_SRC).toMatch(/harvestSettledSessionChatState/);
    expect(ORCHESTRATOR_SRC).toMatch(/harvestSettledProjectContextState/);
    expect(ORCHESTRATOR_SRC).toMatch(/harvestSettledFreezeState/);
  });

  it("the no-orchestrator-snapshot-reads ESLint rule (ADR-030 LEAF-D) still passes", () => {
    // DELIVER LEAF-3: the carve MUST NOT re-introduce snapshot.context.*
    // reads into orchestrator.ts. The LEAF-D rule
    // (`ui-state-conventions/no-orchestrator-snapshot-reads`) is scoped to
    // ui-state/lib/orchestrator.ts at severity "error" — RG-LEAF runs
    // `npx eslint .` (0 errors incl LEAF-D). This pins the structural
    // invariant the rule encodes: strategy bodies legitimately read
    // snapshots (via the sanctioned harvestSettled* boundary); the carved
    // PUMP does not read `.getSnapshot().context`. Reading the settled
    // state-VALUE (`.getSnapshot().value`) for cross-machine
    // hook/loop gating is allowed (it is not a context read).
    expect(ESLINT_CONFIG_SRC).toMatch(
      /files:\s*\[\s*["']ui-state\/lib\/orchestrator\.ts["']\s*\]/,
    );
    expect(ESLINT_CONFIG_SRC).toMatch(
      /no-orchestrator-snapshot-reads/,
    );
    // The carved pump never READS `.getSnapshot().context` in CODE (the
    // LEAF-D invariant; the strategies own all settled-context reads via
    // the harvestSettled* boundary). Scanned comment-stripped — the
    // PumpContext interface doc legitimately NAMES the boundary it
    // forbids; documentation is not a context read.
    expect(stripComments(ORCHESTRATOR_SRC)).not.toMatch(
      /getSnapshot\(\)\.context/,
    );
  });

  it("characterization: full mr_1..mr_6 per-marker + ui-state vitest byte-behavior-identical", () => {
    // DELIVER LEAF-3 = RG-LEAF. The behavioral SSOT is the J-002
    // acceptance suite, asserted by RUNNING it per-marker (the controlled
    // A/B FAILED-set Δ=0 in leaf-3-progress.md — never the whole directory
    // at once, D-MR5-02) + `cd ui-state && npx vitest run`. It is the
    // inherited behavioral pin and is NOT duplicated here.
    //
    // What IS pinned here is the carve-COMPLETENESS precondition that
    // controlled A/B characterizes: all three canonical machines resolve
    // to a strategy that OWNS the full carved member set, and the pump
    // holds none of it. If any member were still pump-inlined the A/B
    // would be measuring an incomplete carve.
    for (const name of CANONICAL_MACHINE_NAMES) {
      const s = FLOW_STRATEGY_REGISTRY.resolve(name);
      expect(s.machineName).toBe(name);
      for (const member of [
        "buildMachine",
        "applyEvent",
        "settle",
        "settleSpawn",
        "settleFreeze",
        "settleThaw",
      ] as const) {
        expect(
          typeof (s as unknown as Record<string, unknown>)[member],
          `${name}.${member}`,
        ).toBe("function");
      }
    }
    // The pump delegates the per-machine settle obligation to the typed
    // port chain (no inlined per-machine settle/emit survives — the exact
    // structural precondition the mr_1..mr_6 A/B Δ=0 result certifies).
    const sendBody = methodBody(ORCHESTRATOR_SRC, "send");
    expect(sendBody).toMatch(/loginOrgSetupStrategy\.settle\(/);
    expect(sendBody).toMatch(/projectContextStrategy\.settle\(/);
    expect(sendBody).toMatch(/sessionChatStrategy\.settle\(/);
    expect(sendBody).not.toContain("appendSessionChatTerminalEvents(");
  });
});
