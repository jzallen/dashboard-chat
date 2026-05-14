import type {
  GateFlag,
  GateReason,
  GateState,
  GateTier,
  GateVerdict,
} from "./gate";
import type { KnobManifestEntry, KnobTransport, OwningService } from "./manifest.schema";

/**
 * Shared envelope fields per ADR-037 §"Envelope (every event)". `event.name`
 * is the discriminator across the AuditEvent union; per-event variants narrow
 * it to a literal string.
 */
interface AuditEnvelope {
  readonly "event.name": string;
  readonly "service.name": string;
  readonly timestamp: string;
  readonly "environment.tier": GateTier;
  readonly correlation_id?: string;
}

/**
 * Composition-root probe event — exactly one per process per ADR-035.
 * Mutually-exclusive `event.name` discriminators (`enabled` vs `disabled`)
 * keep the typescript narrowing honest at call sites.
 */
export interface FailureSimulationGateEvent extends AuditEnvelope {
  readonly "event.name":
    | "failure-simulation.gate.enabled"
    | "failure-simulation.gate.disabled";
  readonly "gate.tier": GateTier;
  readonly "gate.flag": GateFlag;
  readonly "gate.reason": GateReason;
  readonly inspection_probes_registered: boolean;
  readonly "manifest.knob_count": number;
}

/**
 * Per-request fired event — verdict permits AND a manifest-registered knob
 * was carried in the request context.
 */
export interface FailureSimulationFiredEvent extends AuditEnvelope {
  readonly "event.name": "failure-simulation.fired";
  readonly "knob.name": string;
  readonly "knob.transport": KnobTransport;
  readonly "knob.value"?: string;
  readonly "target.port": string;
  readonly "owning.service": OwningService;
}

/**
 * Per-request rejected event — verdict denies AND a manifest-registered knob
 * was carried in the request context. The `reason` field surfaces which gate
 * condition denied (`environment_tier_denies` vs `flag_denies`).
 */
export interface FailureSimulationRejectedEvent extends AuditEnvelope {
  readonly "event.name": "failure-simulation.rejected";
  readonly "knob.name": string;
  readonly "knob.transport": KnobTransport;
  readonly reason: GateReason;
  readonly "gate.tier": GateTier;
  readonly "gate.flag": GateFlag;
}

/**
 * Per-request unknown-signal event — the request carried a header/event/body
 * field matching the failure-simulation wire pattern but the name is not in
 * the manifest. Surfaces typos and drift to Devon via `manifest.path`.
 */
export interface FailureSimulationUnknownEvent extends AuditEnvelope {
  readonly "event.name": "failure-simulation.unknown";
  readonly "knob.name.raw": string;
  readonly "knob.transport": KnobTransport;
  readonly "manifest.path": string;
}

/**
 * Companion deprecation event — emitted at startup when a legacy env var
 * (e.g. `NWAVE_HARNESS_KNOBS`) is honored. Fires alongside the gate verdict
 * event and is "loud": repeats at every startup until the env var is fully
 * removed (a future cleanup MR per ADR-038 phase 3). The `env.detected_value`
 * field surfaces the actual env-var content so a misconfigured `=false`
 * value is visible without re-shelling.
 */
export interface FailureSimulationConfigDeprecatedEvent extends AuditEnvelope {
  readonly "event.name": "failure-simulation.config.deprecated";
  readonly "env.legacy": string;
  readonly "env.replacement": string;
  readonly "env.detected_value": string;
  readonly "removal.target_release": string;
}

/**
 * Discriminated union of every audit-event variant per ADR-037. Use a
 * `switch (event["event.name"]) { ... }` to narrow.
 */
export type AuditEvent =
  | FailureSimulationGateEvent
  | FailureSimulationFiredEvent
  | FailureSimulationRejectedEvent
  | FailureSimulationUnknownEvent
  | FailureSimulationConfigDeprecatedEvent;

export function emitGateEvent(args: {
  readonly verdict: GateVerdict;
  readonly serviceName: OwningService;
}): void;

export function emitFiredEvent(args: {
  readonly entry: KnobManifestEntry;
  readonly value?: string | undefined;
  readonly serviceName: OwningService | undefined;
  readonly correlationId: string | undefined;
  readonly verdict: GateVerdict;
}): void;

export function emitRejectedEvent(args: {
  readonly entry: KnobManifestEntry;
  readonly serviceName: OwningService | undefined;
  readonly correlationId: string | undefined;
  readonly verdict: GateVerdict;
}): void;

export function emitUnknownEvent(args: {
  readonly rawName: string;
  readonly transport: KnobTransport;
  readonly serviceName: OwningService | undefined;
  readonly correlationId: string | undefined;
}): void;

export function emitConfigDeprecatedEvent(args: {
  readonly serviceName: OwningService;
  readonly verdict: GateVerdict;
  readonly detectedValue: string;
  readonly targetRelease: string;
}): void;
