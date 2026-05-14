// Structured audit emitter for the failure-simulation surface per ADR-037.
//
// One JSON line per event on stdout. The ADR-037 envelope (event.name,
// service.name, timestamp, environment.tier, optional correlation_id) is
// dot-namespaced to align with OpenTelemetry semantic conventions; downstream
// log aggregators filter on the `failure-simulation.*` prefix.
//
// The full discriminated AuditEvent union covers six event names:
//   - failure-simulation.gate.enabled       (probe at composition root)
//   - failure-simulation.gate.disabled      (probe at composition root)
//   - failure-simulation.fired              (shouldInject — verdict permits)
//   - failure-simulation.rejected           (shouldInject — verdict denies)
//   - failure-simulation.unknown            (detectUnknownSignals — typo/drift)
//   - failure-simulation.config.deprecated  (MR-5 — emitter not landed yet;
//                                            type defined for future-compat)
//
// Composition-root `probe()` calls emitConfigDeprecatedEvent at startup when
// the legacy NWAVE_HARNESS_KNOBS env var is read (any non-empty value). The
// event fires alongside the gate verdict event and is "loud" — it repeats at
// every startup until the env var is fully removed (a future cleanup MR per
// ADR-038's phase 3).

import { getCachedVerdict } from "./gate.js";
import { manifest, MANIFEST_PATH } from "./manifest.js";

const MANIFEST_KNOB_COUNT = manifest.length;

function nowIsoTimestamp() {
  return new Date().toISOString();
}

function inspectionProbesRegistered(serviceName, verdict) {
  // ADR-037: inspection_probes_registered is true iff the agent service
  // hosts the /debug/* routes AND the gate verdict permits them. ui-state
  // owns no inspection probes — the field is always false there.
  return serviceName === "agent" && verdict.state === "enabled";
}

function write(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

/**
 * Emit one failure-simulation.gate.enabled or .gate.disabled event from the
 * composition-root probe. Called exactly once per service startup.
 */
export function emitGateEvent({ verdict, serviceName }) {
  const eventName =
    verdict.state === "enabled"
      ? "failure-simulation.gate.enabled"
      : "failure-simulation.gate.disabled";
  write({
    "event.name": eventName,
    "service.name": serviceName,
    timestamp: nowIsoTimestamp(),
    "environment.tier": verdict.tier,
    "gate.tier": verdict.tier,
    "gate.flag": verdict.flag,
    "gate.reason": verdict.reason,
    inspection_probes_registered: inspectionProbesRegistered(serviceName, verdict),
    "manifest.knob_count": MANIFEST_KNOB_COUNT,
  });
}

/**
 * Emit one failure-simulation.fired event per shouldInject() call that
 * matches a manifest entry under an enabled gate.
 */
export function emitFiredEvent({ entry, value, serviceName, correlationId, verdict }) {
  const event = {
    "event.name": "failure-simulation.fired",
    "service.name": serviceName ?? "unknown",
    timestamp: nowIsoTimestamp(),
    "environment.tier": verdict.tier,
    "knob.name": entry.name,
    "knob.transport": entry.transport,
    "target.port": entry.target,
    "owning.service": entry.owningService,
  };
  if (value !== undefined && value !== null) {
    event["knob.value"] = value;
  }
  if (correlationId != null) {
    event.correlation_id = correlationId;
  }
  write(event);
}

/**
 * Emit one failure-simulation.rejected event per shouldInject() call that
 * carries a manifest-registered signal under a disabled gate. The reason
 * field surfaces which gate condition denied (environment_tier vs flag).
 */
export function emitRejectedEvent({ entry, serviceName, correlationId, verdict }) {
  const event = {
    "event.name": "failure-simulation.rejected",
    "service.name": serviceName ?? "unknown",
    timestamp: nowIsoTimestamp(),
    "environment.tier": verdict.tier,
    "knob.name": entry.name,
    "knob.transport": entry.transport,
    reason: verdict.reason,
    "gate.tier": verdict.tier,
    "gate.flag": verdict.flag,
  };
  if (correlationId != null) {
    event.correlation_id = correlationId;
  }
  write(event);
}

/**
 * Emit one failure-simulation.config.deprecated event per probe() invocation
 * when NWAVE_HARNESS_KNOBS is set. The event names the replacement env var
 * (FAILURE_SIMULATION_ENABLED) and carries a semver-shaped
 * removal.target_release the operator can plan against. The `detected_value`
 * field surfaces the actual env-var content so a misconfigured `=false`
 * value is visible without re-shelling. Tier comes from the cached gate
 * verdict so the envelope is consistent with the gate / fired / rejected
 * events emitted in the same process.
 */
export function emitConfigDeprecatedEvent({
  serviceName,
  verdict,
  detectedValue,
  targetRelease,
}) {
  write({
    "event.name": "failure-simulation.config.deprecated",
    "service.name": serviceName,
    timestamp: nowIsoTimestamp(),
    "environment.tier": verdict.tier,
    "env.legacy": "NWAVE_HARNESS_KNOBS",
    "env.replacement": "FAILURE_SIMULATION_ENABLED",
    "env.detected_value": detectedValue,
    "removal.target_release": targetRelease,
  });
}

/**
 * Emit one failure-simulation.unknown event per request-carried signal whose
 * wire name matches the failure-simulation pattern but does not correspond to
 * any manifest entry (typo, removed knob, or drift). Called by
 * `detectUnknownSignals` once per detected signal.
 *
 * Tier is read from the cached gate verdict (per ADR-037 envelope consistency
 * with fired/rejected). Callers SHOULD invoke `probe()` before
 * `detectUnknownSignals` — the verdict cache's fail-closed default surfaces
 * misordered initialization as `environment.tier: "unset"`.
 */
export function emitUnknownEvent({ rawName, transport, serviceName, correlationId }) {
  const verdict = getCachedVerdict();
  const event = {
    "event.name": "failure-simulation.unknown",
    "service.name": serviceName ?? "unknown",
    timestamp: nowIsoTimestamp(),
    "environment.tier": verdict.tier,
    "knob.name.raw": rawName,
    "knob.transport": transport,
    "manifest.path": MANIFEST_PATH,
  };
  if (correlationId != null) {
    event.correlation_id = correlationId;
  }
  write(event);
}
