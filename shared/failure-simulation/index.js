// Public API for @dashboard-chat/shared-failure-simulation.
//
// MR-1 surface per docs/feature/failure-simulation-consolidation/distill/roadmap.json:
//   - manifest (typed array; ADR-038 schema)
//   - ManifestEntrySchema, ManifestSchema (Zod)
//   - KNOB (typed const accessor)
//   - assertKnown (CI-lint helper for the drift check)
//   - shouldInject + detectUnknownSignals
//   - probe, evalGate, parseBool, readTier, readFlag
//   - UnknownKnobError
//
// MR-2 surface additions:
//   - getCachedVerdict — composition-root probe's cache reader
//   - emitGateEvent, emitFiredEvent, emitRejectedEvent — ADR-037 gate + per-
//     request emitters
//
// MR-3 surface additions:
//   - emitUnknownEvent — consolidates the unknown-signal emitter into the
//     single audit module per ADR-037 §"Audit emission point" (previously
//     inlined in registry.js)
//   - AuditEvent type union + per-variant event types exported from audit.d.ts
//
// MR-5 will land emitConfigDeprecatedEvent + the legacy NWAVE_HARNESS_KNOBS
// migration; the FailureSimulationConfigDeprecatedEvent type is already in
// the union so future callers compile against the final shape.

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
  emitUnknownEvent,
} from "./audit.js";
