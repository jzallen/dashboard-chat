// Gate evaluation + composition-root probe per ADR-035.
//
// Surface stratification:
//   MR-1 — pure-function helpers (readTier, parseBool, readFlag, evalGate) +
//          probe() returning the verdict. Inert: no caching, no emission.
//   MR-2 — verdict cache + startup gate event emission. shouldInject reads
//          the cached verdict (registry.js handles fired/rejected emission).
//   MR-3 — full audit envelope on fired/rejected/unknown + correlation-id
//          propagation through the actor input boundary (ADR-028 + ADR-037).
//   MR-5 — `failure-simulation.config.deprecated` event emission when legacy
//          NWAVE_HARNESS_KNOBS is present (KU-1 chooses the semver target).

import { emitGateEvent } from "./audit.js";

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

// ─────────────────────────── Verdict cache (MR-2) ───────────────────────────
//
// Module-scoped cache populated by probe(). shouldInject (in registry.js)
// reads the cache rather than re-parsing process.env per request. CA-4
// asserts the cache is stable across env mutations within one process —
// the `firstResult === secondResult` invariant after probe() runs.
//
// Default verdict for the not-yet-probed state is fail-closed: production-
// restrictive. Production code calls probe() at the composition root before
// any route is bound, so the default is never observed in normal flow; it
// exists so a misordered import in a test harness fails closed rather than
// open.

const FAIL_CLOSED_VERDICT = Object.freeze({
  state: "disabled",
  reason: "environment_tier_denies",
  tier: "unset",
  flag: "unset",
});

let _cachedVerdict = null;

export function getCachedVerdict() {
  return _cachedVerdict ?? FAIL_CLOSED_VERDICT;
}

/**
 * Composition-root probe per ADR-035 + ADR-036.
 *
 * - Evaluates the gate against `env` (defaults to `{}` for safety).
 * - Caches the verdict for `shouldInject` (and any other per-request reader).
 * - Emits one `failure-simulation.gate.enabled` / `.gate.disabled` event with
 *   the ADR-037 envelope (service.name, timestamp, environment.tier, gate.*,
 *   inspection_probes_registered, manifest.knob_count).
 *
 * Component-design.md documents that production code calls `probe()` exactly
 * once at startup; a second call from a test scenario re-evaluates the gate,
 * re-caches, and emits a fresh event. That deliberate choice keeps `probe()`
 * test-driveable without a private reset helper.
 */
export function probe(env, serviceName) {
  if (typeof serviceName !== "string" || serviceName === "") {
    throw new TypeError("probe(env, serviceName): serviceName is required");
  }
  const verdict = evalGate(env ?? {});
  _cachedVerdict = verdict;
  emitGateEvent({ verdict, serviceName });
  return verdict;
}
