import type { EnvironmentTier, OwningService } from "./manifest.schema";

export interface EnvSource {
  readonly ENVIRONMENT?: string;
  readonly FAILURE_SIMULATION_ENABLED?: string;
  /** Legacy; honored with a deprecation event during the overlap window per ADR-035. */
  readonly NWAVE_HARNESS_KNOBS?: string;
}

export type GateState = "enabled" | "disabled";
export type GateReason = "both_permit" | "environment_tier_denies" | "flag_denies";
export type GateFlag = "true" | "false" | "unset";
export type GateTier = EnvironmentTier | "unset" | "unknown";

export interface GateVerdict {
  readonly state: GateState;
  readonly reason: GateReason;
  readonly tier: GateTier;
  readonly flag: GateFlag;
}

export function readTier(raw: string | undefined): GateTier;
export function parseBool(raw: string | undefined): GateFlag;
export function readFlag(env: EnvSource | undefined): GateFlag;
export function evalGate(env: EnvSource | undefined): GateVerdict;
export function getCachedVerdict(): GateVerdict;
export function probe(env: EnvSource | undefined, serviceName: OwningService): GateVerdict;
