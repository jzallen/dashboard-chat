export type {
  EnvironmentTier,
  GatePolicy,
  KnobCanonicalName,
  KnobManifestEntry,
  KnobTransport,
  OwningService,
} from "./manifest.schema";
export {
  CANONICAL_NAME_REGEX,
  EnvironmentTierSchema,
  GateMatrixSchema,
  GatePolicySchema,
  KnobTransportSchema,
  ManifestEntrySchema,
  ManifestSchema,
  OwningServiceSchema,
} from "./manifest.schema";
export { manifest, MANIFEST_PATH } from "./manifest";
export { KNOB } from "./knob";
export {
  assertKnown,
  detectUnknownSignals,
  findManifestEntry,
  shouldInject,
  UnknownKnobError,
} from "./registry";
export type { InjectionContext } from "./registry";
export {
  evalGate,
  getCachedVerdict,
  parseBool,
  probe,
  readFlag,
  readTier,
} from "./gate";
export type {
  EnvSource,
  GateFlag,
  GateReason,
  GateState,
  GateTier,
  GateVerdict,
} from "./gate";
export {
  emitFiredEvent,
  emitGateEvent,
  emitRejectedEvent,
  emitUnknownEvent,
} from "./audit";
export type {
  AuditEvent,
  FailureSimulationConfigDeprecatedEvent,
  FailureSimulationFiredEvent,
  FailureSimulationGateEvent,
  FailureSimulationRejectedEvent,
  FailureSimulationUnknownEvent,
} from "./audit";
