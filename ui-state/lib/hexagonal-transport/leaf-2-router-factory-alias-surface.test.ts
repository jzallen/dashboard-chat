// LEAF-2 — makeFlowRouter(strategy) factory + per-machine app.route mounts
// + migration-safe alias map.
//
// DISTILL-authored binding contract (ADR-040 §D4, §D5, LEAF-2). DELIVER
// LEAF-2 removed the `describe.skip` and implemented the stubbed assertions
// to GREEN (Iron Rule: the spec is implemented, never weakened to pass).
//
// Behavior-neutrality: BEHAVIOR-NEUTRAL. This is a NEW contract (not a
// characterization): the parameterized `:machine` route is retired and
// replaced by per-machine `app.route` mounts; the same router instance is
// mounted at BOTH the canonical machine-name path and the legacy alias
// path so there is NO 404 window mid-migration.
//
// Binding source:
//   ADR-040 §D4 (per-machine sub-routers via makeFlowRouter(strategy);
//     mounted with app.route('/flow/<canonical-machine-name>', ...); no
//     :machine parameter),
//   ADR-040 §D5 + LEAF-2 (alias is HTTP-routing-level, NOT registry-level:
//     `const r = makeFlowRouter(projectContextStrategy);
//      app.route('/flow/project-context', r);
//      app.route('/flow/project-and-chat-session-management', r);`),
//   ADR-027 §1 (FE projection read contract — GET .../projection — MUST
//     resolve identically through the migration),
//   ADR-030 §"Decision outcome 1" (auth-proxy /ui-state/* routing table is
//     path-prefix-based and unchanged; the alias preserves the FE-facing
//     /ui-state/* path surface).
//
// In-process driving-port harness: the index.test.ts pattern —
//   const app = new Hono(); wireRoutes(app, orchestrator); app.request(...).
// Mocks only at the port boundary (eventLog via createNoopFlowEventLog).
//
// LEAF-1 boundary preserved: ADR-040 Consequences mandates an unknown
// machine is a clean 404 registry miss. After LEAF-2 the per-machine mounts
// own dispatch; a single TERMINAL `app.all('/flow/:machine/*')` guard (the
// only surviving `:machine` reference) reproduces the LEAF-1 registry-miss
// 404 byte-for-byte. ADR-040 D4 ("no :machine parameter") is about flow
// DISPATCH — that is retired; the residual guard is the registry-miss
// boundary, not a dispatch route. Both clauses hold simultaneously and the
// reconciliation is pinned below, not smuggled.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { fromPromise } from "xstate";

import { wireRoutes } from "../../index.ts";
import { FlowOrchestrator } from "../orchestrator.ts";
import { createNoopFlowEventLog } from "../persistence/redis.ts";

// The three legacy path vocabularies ADR-040 Context enumerates, paired
// with their canonical machine-name target. The project machine is the
// ONLY true alias pair (feature-slug -> canonical); session-chat and
// login-and-org-setup are simultaneously canonical AND the legacy segment,
// so they are stable across the whole migration (asserted for completeness
// — the task requires all three vocabularies pinned).
const PATH_SURFACE_CONTRACT = [
  {
    vocabulary: "feature-slug (legacy)",
    legacy: "/flow/project-and-chat-session-management",
    canonical: "/flow/project-context",
    is_true_alias_pair: true,
  },
  {
    vocabulary: "machine-name (canonical == legacy segment)",
    legacy: "/flow/session-chat",
    canonical: "/flow/session-chat",
    is_true_alias_pair: false,
  },
  {
    vocabulary: "flow-name (canonical == legacy segment)",
    legacy: "/flow/login-and-org-setup",
    canonical: "/flow/login-and-org-setup",
    is_true_alias_pair: false,
  },
] as const;

// The four driving-port verbs that MUST resolve identically on both the
// canonical and the legacy path (ADR-040 transport surface; ADR-027 §1).
// Each carries a DETERMINISTIC, dep-free request whose response is
// byte-stable regardless of machine deps (the noop event log + login-only
// deps): begin/event/open-deep-link short-circuit on input validation or a
// deterministic dispatch error; projection reads the (empty) event log and
// rebuilds a baseline FlowProjection. The contract is byte-equivalence
// across the alias pair + the no-404-window invariant — NOT that begin
// must succeed (it need not, with port mocks).
const DRIVING_PORT_VERBS = [
  "POST begin",
  "POST event",
  "POST open-deep-link",
  "GET projection",
] as const;

// A FIXED correlation id pins the only otherwise-nondeterministic field in
// the response envelope (handlers fall back to a random cryptoRandomId()
// when X-Correlation-Id is absent), so the cross-mount byte comparison is
// stable — the same deterministic-fixture discipline the LEAF-5
// equivalence gate mandates ("pin ts + correlation_id deterministically").
const IDENTITY_HEADERS = {
  "content-type": "application/json",
  "X-User-Id": "dev-user-001",
  "X-Org-Id": "dev-org-001",
  "X-User-Email": "dev@localhost",
  "X-Correlation-Id": "leaf2-alias-surface-fixed-corr",
};

// Same flow_id on BOTH mounts so the projection bodies are comparable
// (the projection echoes the query flow_id, not the mount path).
const PROBE_FLOW_ID = "alias-surface:test-principal";

const INDEX_SRC = readFileSync(
  fileURLToPath(new URL("../../index.ts", import.meta.url)),
  "utf8",
);

function buildOrchestrator(): FlowOrchestrator {
  // Login-only deps + noop event log (the LEAF-1 buildOrchestrator shape).
  // Port boundary only; no internal mocks. project-context / session-chat
  // begin therefore resolves to a DETERMINISTIC dispatch outcome — that is
  // sufficient: the contract is canonical≡legacy + no-404, not begin
  // success.
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

function freshApp(): Hono {
  const app = new Hono();
  wireRoutes(app, buildOrchestrator());
  return app;
}

/** Fire one driving-port verb against a `/flow/<segment>` mount with a
 *  deterministic, dep-free request. Returns {status, body-bytes}. */
async function callVerb(
  app: Hono,
  mount: string,
  verb: (typeof DRIVING_PORT_VERBS)[number],
): Promise<{ status: number; body: string }> {
  let res: Response;
  if (verb === "POST begin") {
    res = await app.request(`${mount}/begin`, {
      method: "POST",
      headers: IDENTITY_HEADERS,
      body: JSON.stringify({}),
    });
  } else if (verb === "POST event") {
    res = await app.request(`${mount}/event`, {
      method: "POST",
      headers: IDENTITY_HEADERS,
      body: JSON.stringify({}),
    });
  } else if (verb === "POST open-deep-link") {
    res = await app.request(`${mount}/open-deep-link`, {
      method: "POST",
      headers: IDENTITY_HEADERS,
      body: JSON.stringify({}),
    });
  } else {
    res = await app.request(
      `${mount}/projection?flow_id=${encodeURIComponent(PROBE_FLOW_ID)}`,
      { method: "GET", headers: IDENTITY_HEADERS },
    );
  }
  return { status: res.status, body: await res.text() };
}

describe("LEAF-2 path-surface alias contract", () => {
  it("retires the :machine parameter — routes are per-machine app.route mounts", () => {
    // The parameterized flow-DISPATCH routes (ADR-040 Context's
    // "machine parameterized" surface) are gone — no verb-specific
    // `/flow/:machine/<verb>` registration survives.
    for (const decl of [
      `app.post("/flow/:machine/begin"`,
      `app.post("/flow/:machine/event"`,
      `app.post("/flow/:machine/freeze"`,
      `app.post("/flow/:machine/thaw"`,
      `app.post("/flow/:machine/open-deep-link"`,
      `app.get("/flow/:machine/projection"`,
      `app.get("/flow/:machine/projection/stream"`,
    ]) {
      expect(INDEX_SRC, `retired dispatch route: ${decl}`).not.toContain(decl);
    }

    // The factory exists and is mounted per canonical machine-name AND the
    // legacy alias path (ADR-040 D5 example — the SAME router instance).
    expect(INDEX_SRC).toMatch(/function makeFlowRouter\(/);
    expect(INDEX_SRC).toContain(`app.route("/flow/login-and-org-setup"`);
    expect(INDEX_SRC).toContain(`app.route("/flow/project-context"`);
    expect(INDEX_SRC).toContain(
      `app.route("/flow/project-and-chat-session-management"`,
    );
    expect(INDEX_SRC).toContain(`app.route("/flow/session-chat"`);

    // The ONLY surviving `:machine` ROUTE REGISTRATION is the terminal
    // LEAF-1 registry-miss 404 guard (ADR-040 Consequences). It is a
    // boundary, not a dispatch route — pinned here so the D4/Consequences
    // reconciliation is explicit, not a loophole. (Doc comments may
    // describe it; the contract is about registered routes.)
    const machineRouteRegs =
      INDEX_SRC.match(
        /app\.(get|post|put|delete|patch|all|use)\("\/flow\/:machine\//g,
      ) ?? [];
    expect(machineRouteRegs).toEqual([`app.all("/flow/:machine/`]);
    expect(INDEX_SRC).toMatch(/app\.all\("\/flow\/:machine\/\*"/);

    void DRIVING_PORT_VERBS;
  });

  for (const pair of PATH_SURFACE_CONTRACT) {
    it(`canonical and legacy resolve byte-identically: ${pair.canonical} == ${pair.legacy}`, async () => {
      // 1-3. For every driving-port verb: fire the SAME deterministic
      //      request via the CANONICAL mount and via the LEGACY mount,
      //      assert status equal AND JSON.stringify byte-equivalence.
      // 4.   Assert NEITHER path returns 404 for a registered machine at
      //      ANY point (no 404 window — ADR-040 LEAF-2). The same router
      //      instance backs both mounts (ADR-040 D5: aliasing is an extra
      //      mount point, not a second registry key).
      const app = freshApp();
      for (const verb of DRIVING_PORT_VERBS) {
        const canonical = await callVerb(app, pair.canonical, verb);
        const legacy = await callVerb(app, pair.legacy, verb);

        expect(
          canonical.status,
          `${verb} status canonical(${pair.canonical}) == legacy(${pair.legacy})`,
        ).toBe(legacy.status);
        expect(
          canonical.body,
          `${verb} body byte-identical ${pair.canonical} == ${pair.legacy}`,
        ).toBe(legacy.body);

        // No 404 window: a registered machine never 404s on EITHER mount.
        expect(canonical.status, `${verb} canonical not 404`).not.toBe(404);
        expect(legacy.status, `${verb} legacy not 404`).not.toBe(404);
      }
    });
  }

  it("ADR-027 §1 FE projection read contract holds through the migration", async () => {
    // GET /flow/project-context/projection?flow_id=... and
    // GET /flow/project-and-chat-session-management/projection?flow_id=...
    // return the identical FlowProjection JSON (ADR-027 §4 wire format),
    // status 200. This is the contract the nginx/auth-proxy /ui-state/
    // proxy and the FE depend on; the alias guarantees it never breaks
    // mid-migration.
    const app = freshApp();
    const q = `/projection?flow_id=${encodeURIComponent(PROBE_FLOW_ID)}`;
    const canonical = await app.request(`/flow/project-context${q}`);
    const legacy = await app.request(
      `/flow/project-and-chat-session-management${q}`,
    );

    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);

    const canonicalJson = await canonical.json();
    const legacyJson = await legacy.json();
    expect(JSON.stringify(canonicalJson)).toBe(JSON.stringify(legacyJson));
    // The FE read contract: the projection resolves for the queried
    // flow_id (ADR-027 §1/§4 — `flow_id` is the wire-format anchor).
    expect((canonicalJson as { flow_id: string }).flow_id).toBe(
      PROBE_FLOW_ID,
    );
  });

  it("characterization: all three legacy vocabularies resolve (no 404 window)", async () => {
    // The J-002 acceptance suite drives the legacy
    // /ui-state/flow/project-and-chat-session-management/* AND
    // /ui-state/flow/session-chat/* AND /ui-state/flow/login-and-org-setup/*
    // segments (driver.py). RG-LEAF runs it per-marker; staying green IS
    // the end-to-end proof. Pinned here at the spec level: every legacy
    // vocabulary segment resolves a `begin` POST to a registered handler
    // (never a 404) — the in-process no-404-window invariant.
    const app = freshApp();
    for (const pair of PATH_SURFACE_CONTRACT) {
      const legacy = await callVerb(app, pair.legacy, "POST begin");
      const canonical = await callVerb(app, pair.canonical, "POST begin");
      expect(legacy.status, `${pair.legacy} begin not 404`).not.toBe(404);
      expect(canonical.status, `${pair.canonical} begin not 404`).not.toBe(
        404,
      );
    }

    // The LEAF-1 boundary is preserved byte-for-byte: a genuinely unknown
    // machine (not one of the three vocabularies) is still a clean
    // registry-miss 404 via the terminal guard (ADR-040 Consequences).
    const unknown = await app.request("/flow/totally-unknown-machine/begin", {
      method: "POST",
      headers: IDENTITY_HEADERS,
      body: JSON.stringify({}),
    });
    expect(unknown.status).toBe(404);
    const body = (await unknown.json()) as { error: string; machine?: string };
    expect(body.error).toBe("unknown_machine");
    expect(body.machine).toBe("totally-unknown-machine");
  });
});
