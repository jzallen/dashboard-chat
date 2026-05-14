// TypeScript source-of-truth for the failure-simulation manifest.
//
// This file is the typed companion to `manifest.js`. The `as KnobCanonicalName`
// casts make each canonical name a branded value at compile time. The
// acceptance driver parses this file with a regex to enumerate canonical names
// without booting node (see `tests/acceptance/failure-simulation-consolidation/driver.py`).
//
// Drift between this file and `manifest.js` is caught by the lint check at
// `scripts/drift-check.mjs` (US-CONSOL-5 / CA-1).

import type { KnobCanonicalName, KnobManifestEntry } from "./manifest.schema";

export const manifest: ReadonlyArray<KnobManifestEntry> = [
  {
    name: "force-create-project-failure" as KnobCanonicalName,
    transport: "header",
    target: "createProject",
    owningService: "ui-state",
    gate: { dev: "permit", ci: "permit", staging: "deny", production: "deny" },
    rationale:
      "US-201 deterministic 5xx on create-project to validate empty-state " +
      "fallback under partial-failure",
    contractTestAlternativeConsidered: false,
  },
  {
    name: "force-list-sessions-failure" as KnobCanonicalName,
    transport: "header",
    target: "listSessions",
    owningService: "ui-state",
    gate: { dev: "permit", ci: "permit", staging: "deny", production: "deny" },
    rationale:
      "US-203 deterministic 5xx on list-sessions to validate project-detail " +
      "graceful degradation",
    contractTestAlternativeConsidered: false,
  },
  {
    name: "force-create-session-failure" as KnobCanonicalName,
    transport: "header",
    target: "createSession",
    owningService: "ui-state",
    gate: { dev: "permit", ci: "permit", staging: "deny", production: "deny" },
    rationale:
      "US-206 eager new-session lifecycle error case — deterministic 5xx on " +
      "create-session for the lazy-create flow",
    contractTestAlternativeConsidered: false,
  },
  {
    name: "force-reissue-failures" as KnobCanonicalName,
    transport: "body-field",
    target: "chatBegin",
    owningService: "agent",
    gate: { dev: "permit", ci: "permit", staging: "deny", production: "deny" },
    rationale:
      "US-204 agent reissue-on-failure path — body field drives a count of " +
      "synthetic upstream failures the agent must recover from",
    contractTestAlternativeConsidered: false,
    legacyAlias: {
      transportValue: "harness_force_reissue_failures",
      removalCommit: "phase-2",
    },
  },
  {
    name: "force-failure-tag" as KnobCanonicalName,
    transport: "event",
    target: "loginAndOrgSetup.authenticating",
    owningService: "ui-state",
    eventDistinguisher: "authenticating",
    gate: { dev: "permit", ci: "permit", staging: "deny", production: "deny" },
    rationale:
      "US-202 login/org-setup machine — synthetic auth failure event used by " +
      "the authenticating state to exercise retry/back-off transitions",
    contractTestAlternativeConsidered: false,
  },
  {
    name: "expire-token" as KnobCanonicalName,
    transport: "event",
    target: "loginAndOrgSetup.authenticated",
    owningService: "ui-state",
    gate: { dev: "permit", ci: "permit", staging: "deny", production: "deny" },
    rationale:
      "US-205 token-expiry re-auth flow — synthetic expiry event the " +
      "authenticated state consumes to drive the re-auth transition",
    contractTestAlternativeConsidered: false,
  },
];

export const MANIFEST_PATH = "shared/failure-simulation/manifest.ts";
