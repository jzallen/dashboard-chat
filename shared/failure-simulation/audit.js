// Structured audit emitter for the failure-simulation surface per ADR-037.
//
// MR-2 ships gate.enabled / gate.disabled (probe) + fired / rejected (registry
// shouldInject). MR-3 expands the `unknown` event to the full envelope (today
// emitted in MR-1's registry stub with the same field shape) and lands the
// `config.deprecated` event when legacy NWAVE_HARNESS_KNOBS is read.
//
// Every event is one JSON line on stdout — no logger framework, no prefix.
// The ADR-037 envelope (event.name, service.name, timestamp,
// environment.tier, optional correlation_id) is dot-namespaced to align with
// OpenTelemetry semantic conventions; downstream aggregators filter on the
// `failure-simulation.*` prefix.

import { manifest } from "./manifest.js";

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
