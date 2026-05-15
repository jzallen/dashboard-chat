import { ManifestSchema } from "./manifest.schema.js";

// Canonical knob list per ADR-038. The phase-1 `legacyAlias` bridge was
// removed after MR-5 — manifest entries now carry only their canonical
// (post-rename) names.
//
// SSOT pair: this file is the runtime data; `manifest.ts` is the TypeScript
// source-of-truth parsed by the acceptance driver's regex. The drift-check
// script in `scripts/drift-check.mjs` verifies the two stay in sync.
//
// `eventDistinguisher` (optional, event-transport only): the kebab-case
// suffix that `renderEventTypes` strips from the canonical name to produce
// the wire event type. Lets the manifest carry a fully self-documenting
// canonical (e.g. `force-failure-on-auth-retry`) while keeping the wire
// event idiomatic for XState consumers (e.g. `__force_failure__`).
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
  },
  {
    name: "force-failure-on-auth-retry",
    transport: "event",
    target: "loginAndOrgSetup.authenticating",
    owningService: "ui-state",
    eventDistinguisher: "on-auth-retry",
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
  },
];

// Validate at module load. An entry that fails schema validation throws here,
// which crashes the import — exactly the CA-2 contract.
export const manifest = Object.freeze(ManifestSchema.parse(RAW_ENTRIES));

// Path used in `failure-simulation.unknown` audit events as a Devon-facing
// pointer. Kept as a constant so a future relocation only touches one place.
export const MANIFEST_PATH = "shared/failure-simulation/manifest.ts";
