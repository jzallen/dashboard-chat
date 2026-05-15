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
  /**
   * Optional, event-transport only. The kebab-case suffix that
   * `renderEventTypes` strips from the canonical name to produce the wire
   * event type — lets a self-documenting canonical (e.g.
   * `force-failure-on-auth-retry`) render to an idiomatic XState wire form
   * (e.g. `__force_failure__`). See ADR-038.
   */
  readonly eventDistinguisher?: string;
  readonly gate: Readonly<Record<EnvironmentTier, GatePolicy>>;
  readonly rationale: string;
  readonly contractTestAlternativeConsidered: boolean;
}

export const CANONICAL_NAME_REGEX: RegExp;
export const KnobTransportSchema: z.ZodEnum<["header", "event", "body-field"]>;
export const OwningServiceSchema: z.ZodEnum<["ui-state", "agent"]>;
export const EnvironmentTierSchema: z.ZodEnum<["dev", "ci", "staging", "production"]>;
export const GatePolicySchema: z.ZodEnum<["permit", "deny"]>;
export const GateMatrixSchema: ZodType<Readonly<Record<EnvironmentTier, GatePolicy>>>;
export const ManifestEntrySchema: ZodType<KnobManifestEntry>;
export const ManifestSchema: ZodType<ReadonlyArray<KnobManifestEntry>>;
