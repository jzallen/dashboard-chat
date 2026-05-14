import type { GateFlag, GateReason, GateState, GateTier, GateVerdict } from "./gate";
import type { KnobManifestEntry, OwningService } from "./manifest.schema";

interface AuditEnvelope {
  readonly "event.name": string;
  readonly "service.name": string;
  readonly timestamp: string;
  readonly "environment.tier": GateTier;
  readonly correlation_id?: string;
}

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

export interface FailureSimulationFiredEvent extends AuditEnvelope {
  readonly "event.name": "failure-simulation.fired";
  readonly "knob.name": string;
  readonly "knob.transport": "header" | "event" | "body-field";
  readonly "knob.value"?: string;
  readonly "target.port": string;
  readonly "owning.service": OwningService;
}

export interface FailureSimulationRejectedEvent extends AuditEnvelope {
  readonly "event.name": "failure-simulation.rejected";
  readonly "knob.name": string;
  readonly "knob.transport": "header" | "event" | "body-field";
  readonly reason: GateReason;
  readonly "gate.tier": GateTier;
  readonly "gate.flag": GateFlag;
}

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
