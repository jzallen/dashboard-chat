// Public API for @dashboard-chat/shared-failure-simulation.
//
// MR-1 surface per docs/feature/failure-simulation-consolidation/distill/roadmap.json:
//   - manifest (typed array; ADR-038 schema)
//   - ManifestEntrySchema, ManifestSchema (Zod)
//   - KNOB (typed const accessor)
//   - assertKnown (CI-lint helper for the drift check)
//   - shouldInject, detectUnknownSignals (MR-1 stubs)
//   - probe, evalGate (MR-1 surface; full composition-root semantics in MR-2)
//   - UnknownKnobError
//
// Audit emission expands in MR-3; gate caching + composition-root startup
// event lands in MR-2.

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
export { evalGate, parseBool, probe, readFlag, readTier } from "./gate.js";
