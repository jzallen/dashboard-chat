// Public API for @dashboard-chat/shared-failure-simulation.
//
// MR-1 surface per docs/feature/failure-simulation-consolidation/distill/roadmap.json:
//   - manifest (typed array; ADR-038 schema)
//   - ManifestEntrySchema, ManifestSchema (Zod)
//   - KNOB (typed const accessor)
//   - assertKnown (CI-lint helper for the drift check)
//   - shouldInject (MR-1 inert stub → MR-2 wires the gate + audit)
//   - detectUnknownSignals (MR-1)
//   - probe, evalGate, parseBool, readTier, readFlag (MR-1)
//   - UnknownKnobError
//
// MR-2 surface additions per
// docs/feature/failure-simulation-consolidation/distill/roadmap.json::MR-2:
//   - getCachedVerdict — composition-root probe's cache reader
//   - emitGateEvent, emitFiredEvent, emitRejectedEvent — ADR-037 emitters
//
// MR-3 ships the full audit envelope on `unknown` + the
// `failure-simulation.config.deprecated` event (KU-1 chooses the semver target).

export { manifest, MANIFEST_PATH } from "./manifest.js";
export {
  ManifestEntrySchema,
  ManifestSchema,
  CANONICAL_NAME_REGEX,
  EnvironmentTierSchema,
  GateMatrixSchema,
  GatePolicySchema,
  KnobTransportSchema,
  LegacyAliasSchema,
  OwningServiceSchema,
} from "./manifest.schema.js";
export { KNOB } from "./knob.js";
export {
  assertKnown,
  detectUnknownSignals,
  findManifestEntry,
  shouldInject,
  UnknownKnobError,
} from "./registry.js";
export {
  evalGate,
  getCachedVerdict,
  parseBool,
  probe,
  readFlag,
  readTier,
} from "./gate.js";
export {
  emitFiredEvent,
  emitGateEvent,
  emitRejectedEvent,
} from "./audit.js";
