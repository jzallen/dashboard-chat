// LEAF-1 — FlowStrategy port + registry keyed by canonical machine-name.
//
// DISTILL-authored binding contract (ADR-040 §D1, §D5). DELIVER LEAF-1
// removed the `describe.skip` and implemented to GREEN (Iron Rule: the
// spec is implemented, never weakened to pass).
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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { fromPromise } from "xstate";

import { wireRoutes } from "../../index.ts";
import type { FlowStrategy } from "../orchestrator.ts";
import {
  FLOW_STRATEGY_REGISTRY,
  FlowOrchestrator,
  UnknownMachineError,
} from "../orchestrator.ts";
import { createNoopFlowEventLog } from "../persistence/redis.ts";

// Canonical machine-names = the registry keys (ADR-040 D5 / ADR-039).
// These are the three strategies in the C4 target-state diagram:
// LoginOrgSetupStrategy / ProjectContextStrategy / SessionChatStrategy.
const CANONICAL_MACHINE_NAMES = [
  "login-and-org-setup",
  "project-context",
  "session-chat",
] as const;

// Legacy feature-slug wire vocabulary still driven by the J-002 acceptance
// suite (handoff §6). ADR-040 D5: registry stays keyed by the canonical
// machine-name; the migration-safe alias resolves the legacy segment so the
// suite stays byte-behavior-identical. The HTTP-routing-level alias mount is
// a separate concern (LEAF-2) — this is the registry-level canonicalization.
const LEGACY_PROJECT_CONTEXT_SLUG = "project-and-chat-session-management";

const ORCHESTRATOR_SRC = readFileSync(
  fileURLToPath(new URL("../orchestrator.ts", import.meta.url)),
  "utf8",
);

/** Slice a single method body out of the orchestrator source so the
 *  structural assertion is scoped to the LEAF-1 *carved dispatch path*
 *  (machine resolution) — NOT the per-machine settle/emit fan-out, which
 *  is LEAF-3 and explicitly out of this assertion's scope. */
function methodBody(source: string, methodName: string): string {
  const start = source.indexOf(`async ${methodName}(`);
  if (start < 0) throw new Error(`method not found: ${methodName}`);
  // Walk the parameter list to its matching close paren (the signature may
  // contain an inline object-type param with its own braces — slicing on the
  // first `{` would wrongly capture the param type, not the body).
  let i = source.indexOf("(", start);
  let parenDepth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) break;
    }
  }
  // First `{` after the params is the body open brace; brace-match it.
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

describe("LEAF-1 FlowStrategy registry", () => {
  it("registers exactly one strategy per canonical machine-name and rejects flow-id as a key", () => {
    // 1. The FlowStrategy port exposes the ADR-040 D2 members: a canonical
    //    machine-name (the key), a machine definition (`buildMachine`), and
    //    the begin-semantics discriminator (`beginsDirectly`) — the typed
    //    members LEAF-1 carves the dispatch fork onto. (Transition-logic
    //    relocation onto begin/event/settle bodies is LEAF-3.)
    for (const name of CANONICAL_MACHINE_NAMES) {
      const strategy: FlowStrategy | undefined =
        FLOW_STRATEGY_REGISTRY.get(name);
      expect(strategy, `strategy for ${name}`).toBeDefined();
      expect(strategy!.machineName).toBe(name);
      expect(typeof strategy!.buildMachine).toBe("function");
      expect(typeof strategy!.beginsDirectly).toBe("boolean");
    }

    // 2. registry.get returns a strategy for each canonical name and ONLY
    //    those — exactly three keys, no more.
    expect([...FLOW_STRATEGY_REGISTRY.canonicalNames()].sort()).toEqual(
      [...CANONICAL_MACHINE_NAMES].sort(),
    );

    // 3. A flow-id (`<machine-name>:<principal_id>`, ADR-040 D5 / ADR-030 §6
    //    instance id) does NOT resolve — the key is the machine-name, never
    //    the flow-id.
    expect(
      FLOW_STRATEGY_REGISTRY.get("project-context:dev-user-001"),
    ).toBeUndefined();
    expect(
      FLOW_STRATEGY_REGISTRY.get("login-and-org-setup:user_maya"),
    ).toBeUndefined();

    // 4. The registry is the static map (D1 "explicit static machine
    //    registry"): unknown machine -> registry miss; the legacy wire slug
    //    is NOT a canonical key (it resolves only via the explicit
    //    migration alias — see the characterization test below).
    expect(FLOW_STRATEGY_REGISTRY.get("totally-unknown")).toBeUndefined();
    expect(
      FLOW_STRATEGY_REGISTRY.get(LEGACY_PROJECT_CONTEXT_SLUG),
    ).toBeUndefined();

    // login-and-org-setup is the only direct-begin machine (the WorkOS
    // entry body); the J-002 machines are spawned via the cross-machine
    // broadcast hook (beginIfNotStarted).
    expect(FLOW_STRATEGY_REGISTRY.get("login-and-org-setup")!.beginsDirectly)
      .toBe(true);
    expect(FLOW_STRATEGY_REGISTRY.get("project-context")!.beginsDirectly)
      .toBe(false);
    expect(FLOW_STRATEGY_REGISTRY.get("session-chat")!.beginsDirectly)
      .toBe(false);
  });

  it("unknown machine resolves to a clean 404 via the registry, no conditional fall-through", async () => {
    const app = new Hono();
    wireRoutes(app, buildOrchestrator());

    const res = await app.request("/flow/totally-unknown-machine/begin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-User-Id": "dev-user-001",
        "X-Org-Id": "dev-org-001",
      },
      body: JSON.stringify({}),
    });

    // ADR-040 Consequences: "unknown-machine becomes a clean 404, no
    // conditional fall-through" — a registry miss, not a `machine === "..."`
    // else-branch (which historically surfaced as a 500 begin_failed).
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; machine?: string };
    expect(body.error).toBe("unknown_machine");
    expect(body.machine).toBe("totally-unknown-machine");

    // The miss is a typed registry miss, not a thrown generic Error.
    expect(() =>
      FLOW_STRATEGY_REGISTRY.resolve("totally-unknown-machine"),
    ).toThrow(UnknownMachineError);
  });

  it("the carved dispatch path contains no per-machine `machine === \"<name>\"` conditional", () => {
    // Structural contract (the new delta the acceptance suite cannot pin):
    // the LEAF-1 carved dispatch path = the machine-RESOLUTION fork in
    // begin / beginIfNotStarted / appendDeepLinkEvents. The per-machine
    // settle/emit fan-out deeper in `send` is LEAF-3 and is explicitly OUT
    // of this assertion's scope (spec: "scope it to the dispatch fork").

    // The legacy conditional-table identifier is fully retired — dispatch
    // no longer routes through a `Record<string, MachineFactory>` keyed by
    // wire name; it routes through the FlowStrategy registry.
    expect(ORCHESTRATOR_SRC).not.toMatch(/MACHINE_REGISTRY/);
    expect(ORCHESTRATOR_SRC).not.toMatch(/MachineFactory/);

    for (const method of [
      "begin",
      "beginIfNotStarted",
      "appendDeepLinkEvents",
    ]) {
      const body = methodBody(ORCHESTRATOR_SRC, method);
      // No per-machine string conditional in the carved resolution fork.
      expect(body, method).not.toMatch(/"login-and-org-setup"/);
      expect(body, method).not.toMatch(/"session-chat"/);
      expect(body, method).not.toMatch(/"project-and-chat-session-management"/);
      // Dispatch goes through registry.resolve(machineName).
      expect(body, method).toMatch(/FLOW_STRATEGY_REGISTRY\.resolve\(/);
    }
  });

  it("characterization: legacy wire slug stays behavior-neutral via the D5 migration alias", () => {
    // The acceptance suite + ui-state vitest are the behavioral pin and are
    // asserted by RUNNING them (RG-LEAF in roadmap.json — full mr_1..mr_6
    // PER-MARKER + `cd ui-state && npx vitest run`), not duplicated here.
    //
    // What IS pinned here is the byte-behavior-neutrality precondition the
    // suite depends on: the J-002 suite drives the legacy feature-slug wire
    // name, so `resolve` MUST canonicalize it to the project-context
    // strategy (registry key stays canonical per D5; HTTP-routing alias
    // mounts are LEAF-2).
    const viaLegacy = FLOW_STRATEGY_REGISTRY.resolve(
      LEGACY_PROJECT_CONTEXT_SLUG,
    );
    const viaCanonical = FLOW_STRATEGY_REGISTRY.resolve("project-context");
    expect(viaLegacy).toBe(viaCanonical);
    expect(viaLegacy.machineName).toBe("project-context");

    // The two canonical-≡-legacy vocabularies resolve to themselves.
    expect(FLOW_STRATEGY_REGISTRY.resolve("session-chat").machineName).toBe(
      "session-chat",
    );
    expect(
      FLOW_STRATEGY_REGISTRY.resolve("login-and-org-setup").machineName,
    ).toBe("login-and-org-setup");
  });
});
