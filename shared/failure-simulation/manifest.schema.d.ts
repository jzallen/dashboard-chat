import { z, type ZodType } from "zod";

/**
 * Verb-noun kebab-case canonical name. Pattern: `^[a-z][a-z0-9-]*[a-z0-9]$`.
 * Branded so a raw string cannot reach `shouldInject` without an explicit
 * cast or a lookup through the `KNOB` accessor.
 */
export type KnobCanonicalName = string & { readonly __brand: "KnobCanonicalName" };

export type KnobTransport = "header" | "event" | "body-field";
export type OwningService = "ui-state" | "agent";
export type EnvironmentTier = "dev" | "ci" | "staging" | "production";
export type GatePolicy = "permit" | "deny";

export interface KnobManifestEntry {
  readonly name: KnobCanonicalName;
  readonly transport: KnobTransport;
  readonly target: string;
  readonly owningService: OwningService;
  readonly eventDistinguisher?: string;
  readonly gate: Readonly<Record<EnvironmentTier, GatePolicy>>;
  readonly rationale: string;
  readonly contractTestAlternativeConsidered: boolean;
  /** Transitional. Present during phase 1 of US-CONSOL-4 only — see ADR-038. */
  readonly legacyAlias?: {
    readonly transportValue: string;
    readonly removalCommit: "phase-2";
  };
}

export const CANONICAL_NAME_REGEX: RegExp;
export const KnobTransportSchema: z.ZodEnum<["header", "event", "body-field"]>;
export const OwningServiceSchema: z.ZodEnum<["ui-state", "agent"]>;
export const EnvironmentTierSchema: z.ZodEnum<["dev", "ci", "staging", "production"]>;
export const GatePolicySchema: z.ZodEnum<["permit", "deny"]>;
export const GateMatrixSchema: ZodType<Readonly<Record<EnvironmentTier, GatePolicy>>>;
export const LegacyAliasSchema: ZodType<{
  transportValue: string;
  removalCommit: "phase-2";
}>;
export const ManifestEntrySchema: ZodType<KnobManifestEntry>;
export const ManifestSchema: ZodType<ReadonlyArray<KnobManifestEntry>>;
