import { ManifestSchema } from "./manifest.schema.js";

// Canonical knob list per ADR-038. The `legacyAlias` entries bridge phase 1
// (wire-identical adapter migration) to phase 2 (vocabulary cleanup) and are
// removed atomically by MR-5. See:
//   docs/feature/failure-simulation-consolidation/design/adr-038-failure-simulation-naming-phase-plan.md
//
// SSOT pair: this file is the runtime data; `manifest.ts` is the TypeScript
// source-of-truth parsed by the acceptance driver's regex. The drift-check
// script in `scripts/drift-check.mjs` verifies the two stay in sync.
const RAW_ENTRIES = [
  {
    name: "force-create-project-failure",
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
    name: "force-list-sessions-failure",
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
    name: "force-create-session-failure",
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
    name: "force-reissue-failures",
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
    name: "force-failure-tag",
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
    name: "expire-token",
    transport: "event",
    target: "loginAndOrgSetup.authenticated",
    owningService: "ui-state",
    gate: { dev: "permit", ci: "permit", staging: "deny", production: "deny" },
    rationale:
      "US-205 token-expiry re-auth flow — synthetic expiry event the " +
      "authenticated state consumes to drive the re-auth transition",
    contractTestAlternativeConsidered: false,
    legacyAlias: {
      transportValue: "__harness_expire_token__",
      removalCommit: "phase-2",
    },
  },
];

// Validate at module load. An entry that fails schema validation throws here,
// which crashes the import — exactly the CA-2 contract.
export const manifest = Object.freeze(ManifestSchema.parse(RAW_ENTRIES));

// Path used in `failure-simulation.unknown` audit events as a Devon-facing
// pointer. Kept as a constant so a future relocation only touches one place.
export const MANIFEST_PATH = "shared/failure-simulation/manifest.ts";
