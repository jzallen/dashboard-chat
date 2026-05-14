// Gate evaluation per ADR-035. MR-1 ships the minimum surface the
// MR-1 scenarios import (`probe`) plus pure-function helpers. The full
// composition-root wiring and verdict-cache + startup-emission semantics land
// in MR-2; the audit envelope lands in MR-3.

const VALID_TIERS = ["dev", "ci", "staging", "production"];

export function readTier(raw) {
  if (raw == null || raw.trim() === "") return "unset";
  const normalized = raw.trim().toLowerCase();
  if (VALID_TIERS.includes(normalized)) return normalized;
  return "unknown";
}

export function parseBool(raw) {
  if (raw == null) return "unset";
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "true") return "true";
  return "false";
}

export function readFlag(env) {
  const primary = env?.FAILURE_SIMULATION_ENABLED;
  if (primary != null && primary !== "") {
    return parseBool(primary);
  }
  const legacy = env?.NWAVE_HARNESS_KNOBS;
  if (legacy != null && legacy !== "") {
    return parseBool(legacy);
  }
  return "unset";
}

export function evalGate(env) {
  const tier = readTier(env?.ENVIRONMENT);
  const flag = readFlag(env);

  if (tier === "production" || tier === "staging" || tier === "unset" || tier === "unknown") {
    return { state: "disabled", reason: "environment_tier_denies", tier, flag };
  }
  if (flag !== "true") {
    return { state: "disabled", reason: "flag_denies", tier, flag };
  }
  return { state: "enabled", reason: "both_permit", tier, flag };
}

/**
 * Composition-root probe. MR-1 stub: evaluates the gate and returns the
 * verdict. Startup-event emission and verdict caching land in MR-2 per the
 * roadmap. The function exists at MR-1 so consumers that wire `probe(env, 'svc')`
 * at startup are stable across the migration.
 */
export function probe(env, serviceName) {
  if (typeof serviceName !== "string" || serviceName === "") {
    throw new TypeError("probe(env, serviceName): serviceName is required");
  }
  return evalGate(env ?? {});
}
