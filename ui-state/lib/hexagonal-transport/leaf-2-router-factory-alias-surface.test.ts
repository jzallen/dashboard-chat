// LEAF-2 — makeFlowRouter(strategy) factory + per-machine app.route mounts
// + migration-safe alias map.
//
// DISTILL-authored binding contract (ADR-040 §D4, §D5, LEAF-2).
// DELIVER-deferred: `describe.skip` until LEAF-2 lands.
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
//   const app = new Hono(); wireRoutes(app, orchestrator); app.fetch(...).
// Mocks only at the port boundary (eventLog via createNoopFlowEventLog).

import { describe, it } from "vitest";

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
const DRIVING_PORT_VERBS = [
  "POST begin",
  "POST event",
  "POST open-deep-link",
  "GET projection",
] as const;

describe.skip("LEAF-2 path-surface alias contract — DELIVER-deferred to LEAF-2", () => {
  it("retires the :machine parameter — routes are per-machine app.route mounts", () => {
    // DELIVER LEAF-2: assert ui-state/index.ts no longer registers
    // app.<verb>("/flow/:machine/...") and instead mounts a
    // makeFlowRouter(strategy) instance per canonical machine-name.
    void DRIVING_PORT_VERBS;
  });

  for (const pair of PATH_SURFACE_CONTRACT) {
    it(`canonical and legacy resolve byte-identically: ${pair.canonical} == ${pair.legacy}`, () => {
      // DELIVER LEAF-2 binding assertion (per verb in DRIVING_PORT_VERBS):
      //   1. begin a flow via the CANONICAL path, capture {status, body}.
      //   2. begin the same flow (same persona/principal/flow_id) via the
      //      LEGACY path, capture {status, body}.
      //   3. assert byte-equivalence: status equal AND
      //      JSON.stringify(canonicalBody) === JSON.stringify(legacyBody)
      //      for begin, event, open-deep-link, and projection.
      //   4. assert NEITHER path ever returns 404 for a registered machine
      //      at ANY point in the migration (no 404 window — ADR-040 LEAF-2).
      // The same router instance backs both mounts (ADR-040 D5: aliasing
      // is an extra mount point, not a second registry key).
      void pair;
    });
  }

  it("ADR-027 §1 FE projection read contract holds through the migration", () => {
    // DELIVER LEAF-2: GET /flow/project-context/projection?flow_id=... and
    // GET /flow/project-and-chat-session-management/projection?flow_id=...
    // return the identical FlowProjection JSON (ADR-027 §4 wire format).
    // This is the contract the nginx/auth-proxy /ui-state/ proxy and the
    // FE depend on; the alias guarantees it never breaks mid-migration.
  });

  it("characterization: full mr_1..mr_6 per-marker green proves the alias path stays live", () => {
    // DELIVER LEAF-2 = RG-LEAF. The J-002 acceptance suite drives
    // /ui-state/flow/project-and-chat-session-management/* AND
    // /ui-state/flow/session-chat/* AND /ui-state/flow/login-and-org-setup/*
    // (driver.py). Its staying green per-marker IS the proof that all three
    // legacy vocabularies still resolve. ui-state vitest green.
  });
});
