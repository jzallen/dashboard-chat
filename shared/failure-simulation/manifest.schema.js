import { z } from "zod";

// Verb-noun kebab-case canonical name. Pattern intentionally requires at least
// two characters so single-letter names cannot slip through.
const CANONICAL_NAME_REGEX = /^[a-z][a-z0-9-]*[a-z0-9]$/;

const KnobTransportSchema = z.enum(["header", "event", "body-field"]);
const OwningServiceSchema = z.enum(["ui-state", "agent"]);
const EnvironmentTierSchema = z.enum(["dev", "ci", "staging", "production"]);
const GatePolicySchema = z.enum(["permit", "deny"]);

const GateMatrixSchema = z.object({
  dev: GatePolicySchema,
  ci: GatePolicySchema,
  staging: GatePolicySchema,
  production: GatePolicySchema,
});

// Zod schema for KnobManifestEntry per ADR-038. Required-field discipline:
//   - `rationale` non-empty (US-CONSOL-5 Scenario 2 / CA-2)
//   - `contractTestAlternativeConsidered` present, boolean (US-CONSOL-5 Scenario 3 / CA-2)
//   - `name` matches kebab-case regex
//   - `gate` carries all four tier keys
//   - `eventDistinguisher` (optional, event-transport only): kebab suffix
//     stripped from the canonical at wire-render time per ADR-038.
export const ManifestEntrySchema = z
  .object({
    name: z.string().regex(CANONICAL_NAME_REGEX),
    transport: KnobTransportSchema,
    target: z.string().min(1),
    owningService: OwningServiceSchema,
    eventDistinguisher: z.string().min(1).optional(),
    gate: GateMatrixSchema,
    rationale: z.string().min(1),
    contractTestAlternativeConsidered: z.boolean(),
  })
  .strict();

export const ManifestSchema = z.array(ManifestEntrySchema);

export {
  CANONICAL_NAME_REGEX,
  EnvironmentTierSchema,
  GateMatrixSchema,
  GatePolicySchema,
  KnobTransportSchema,
  OwningServiceSchema,
};
