// Characterization (R1) — the LEAF-2 legacy `login-and-org-setup` alias
// SEND path.
//
// The design note's single highest-value gap: NO existing test drives a
// flow whose flow_id carries the legacy `login-and-org-setup:` prefix
// through `send`. The existing index.test.ts "legacy alias" test sends the
// legacy name in the /event BODY, but the router keys that flow by the
// canonical `session-onboarding:<principal>` — so the legacy-PREFIXED
// flow_id (the actor-map / Redis key) is never exercised on the send path.
//
// This pins the CURRENT behavior before the FlowId VO change: a flow minted
// with the legacy machine name keys the actor map at `login-and-org-setup:x`
// (verbatim, NOT canonicalized), resolves to the session-onboarding
// strategy via resolve()'s alias map, and emits the terminal `org_created`.
// It must stay byte-behavior-identical through the refactor: FlowId.machine
// preserves the minted segment so toKey() reproduces the same key, and
// getMachine() feeds the legacy segment into resolve() — the single
// canonicalization point (LEAF-2).
//
// Port-to-port: enters through BeginFlowOrchestrator.begin + FlowOrchestrator
// .send and observes via the projection + the event log (the SSOT the
// acceptance suite reads). The only double is the mock `fetch` at the WorkOS
// / backend driven-port boundary.

import { afterEach, describe, expect, it } from "vitest";

import { FlowId } from "./flow-id.ts";
import type { RequestClient } from "./machines/session-onboarding/index.ts";
import { SessionOnboardingBeginStrategy } from "./machines/session-onboarding/strategy.ts";
import {
  BeginFlowOrchestrator,
  FlowActorRegistry,
  FlowOrchestrator,
} from "./orchestrator.ts";
import { createNoopFlowEventLog } from "./persistence/redis.ts";
import { makeMockFetch, makeTestConfig } from "./testing/test-config.ts";

const LEGACY_MACHINE = "login-and-org-setup";
const PROFILE_MAYA = { email: "maya@acme", name: "Maya Chen" };
const CONFIG = makeTestConfig();

/** NEW user: re-verify OK, /api/orgs/me 404 (no org), create/reissue OK. */
function okFetch(): RequestClient {
  return makeMockFetch({ profile: PROFILE_MAYA, orgId: "org-1" });
}

function buildOrchestrator(): FlowOrchestrator {
  return new FlowOrchestrator(
    { eventLog: createNoopFlowEventLog(), log: () => {} },
    new FlowActorRegistry(),
  );
}

/** Begin a session-onboarding flow under the LEGACY machine name, so the
 *  minted flow_id key carries the `login-and-org-setup:` prefix. */
async function beginLegacy(
  orch: FlowOrchestrator,
  principal: string,
  requestId: string,
): Promise<string> {
  const beginOrchestrator = new BeginFlowOrchestrator(
    orch.deps.eventLog,
    orch.registry,
  );
  const strategy = new SessionOnboardingBeginStrategy(
    {
      machine: LEGACY_MACHINE,
      principal_id: principal,
      bearer_token: `tok-${principal}`,
      request_id: requestId,
      config: CONFIG,
      deps: { request_client: okFetch() },
    },
    orch.deps.eventLog,
    () => {},
  );
  await beginOrchestrator.begin(strategy);
  return FlowId.toKey(FlowId.of(LEGACY_MACHINE, principal));
}

describe("LEAF-2 legacy-alias send path (R1 characterization)", () => {
  let orch: FlowOrchestrator;
  afterEach(async () => {
    await orch.dispose();
  });

  it("keys the actor map by the legacy prefix verbatim and begins in needs_org", async () => {
    orch = buildOrchestrator();
    const flowId = await beginLegacy(orch, "user-x", "R-1");

    // The flow_id key is the MINTED legacy prefix, NOT canonicalized.
    expect(flowId).toBe("login-and-org-setup:user-x");

    const proj = await orch.getProjection(flowId);
    expect(proj.ok).toBe(true);
    if (proj.ok) expect(proj.value.state).toBe("needs_org");
  });

  it("resolves a legacy-prefixed flow to the session-onboarding strategy and emits org_created", async () => {
    orch = buildOrchestrator();
    const flowId = await beginLegacy(orch, "user-x", "R-1");

    // Send the org submission to the legacy-prefixed flow, carrying the legacy
    // machine name on the wire (as the pre-refactor send path required).
    const result = await orch.send({
      machine: LEGACY_MACHINE,
      flow_id: flowId,
      type: "org_form_submitted",
      payload: { org_name: "Acme Data" },
      request_id: "R-1",
    });

    // Resolves to session-onboarding (alias canonicalized at resolve()) and
    // settles ready.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("ready");

    // The terminal org_created is emitted on the LEGACY-PREFIXED flow's log —
    // proof the legacy key resolved to the session-onboarding settle arm.
    const events = await orch.deps.eventLog.read(flowId);
    expect(events.map((e) => e.type)).toContain("org_created");
  });
});
