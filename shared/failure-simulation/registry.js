import { manifest, MANIFEST_PATH } from "./manifest.js";

// Internal index for fast canonical-name lookup. Built once at module load.
const KNOB_BY_NAME = new Map(manifest.map((entry) => [entry.name, entry]));

// Legacy transport-value index for the phase-1 wire bridge per ADR-038. Used
// by `detectUnknownSignals` to recognize the transitional event/body-field
// names without flagging them as unknown. MR-5 drops the entries.
const KNOB_BY_LEGACY_ALIAS = new Map(
  manifest
    .filter((entry) => entry.legacyAlias != null)
    .map((entry) => [entry.legacyAlias.transportValue, entry]),
);

export class UnknownKnobError extends Error {
  constructor(name) {
    super(
      `Unknown failure-simulation knob ${JSON.stringify(name)} — not in manifest at ${MANIFEST_PATH}`,
    );
    this.name = "UnknownKnobError";
    this.knobName = name;
    this.manifestPath = MANIFEST_PATH;
  }
}

/**
 * Type-guard / CI-lint helper. Throws when `name` is not a registered
 * canonical knob name. Used by the manifest-vs-source drift check to fail CI
 * on an unregistered knob reference (US-CONSOL-5 Scenario 1, CA-1).
 */
export function assertKnown(name) {
  if (!KNOB_BY_NAME.has(name)) {
    throw new UnknownKnobError(name);
  }
}

/**
 * Convenience accessor: return the manifest entry for a canonical name, or
 * `undefined`. Throwing variant is `assertKnown`.
 */
export function findManifestEntry(name) {
  return KNOB_BY_NAME.get(name);
}

// ─────────────────────────── shouldInject (MR-1 stub) ───────────────────────────
//
// The MR-1 stub enforces the manifest contract — an unknown `KnobCanonicalName`
// throws `UnknownKnobError` per the MR-1 deliverable. Gate consultation and
// audit emission (`failure-simulation.fired` / `failure-simulation.rejected`)
// are deferred — the gate composition lands in MR-2 and the audit envelope
// lands in MR-3. Until those MRs land the stub returns `false` for every known
// knob so the firing path stays inert and downstream contract tests (CA-3..6,
// CA-9, US-CONSOL-2, US-CONSOL-3 #1/#2/#5) stay RED as DISTILL handed off.

/**
 * Per-request decision point. Returns true iff the knob should fire its
 * registered effect.
 *
 * MR-1 semantics:
 *   - Unknown `knobName` (not in the manifest) → throws `UnknownKnobError`.
 *   - Known `knobName` → returns `false` (the inert MR-1 stub; MR-2 wires
 *     gate consultation + cached verdict; MR-3 wires audit emission).
 */
export function shouldInject(knobName, ctx) {
  void ctx;
  const entry = KNOB_BY_NAME.get(knobName);
  if (entry == null) {
    throw new UnknownKnobError(knobName);
  }
  return false;
}

// ─────────────────────────── detectUnknownSignals (MR-1 stub) ───────────────────────────

const HEADER_PATTERN = /^x-force-[a-z0-9-]+$/;
const EVENT_PATTERN = /^__(?:force|expire)_[a-z0-9_]+__$/;
const BODY_FIELD_PATTERNS = [/^harness_force_[a-z0-9_]+$/, /^force_[a-z0-9_]+$/];

/**
 * Scan the request context for failure-simulation-shaped wire signals that
 * do not correspond to any manifest entry. Emit one
 * `failure-simulation.unknown` line on stdout per unrecognized signal.
 *
 * The full audit envelope (timestamp, service.name, etc.) lands in MR-3; MR-1
 * ships the manifest-pointer fields the unknown-detection scenarios assert
 * on (event.name, knob.name.raw, manifest.path).
 */
export function detectUnknownSignals(ctx) {
  const serviceName = ctx?.serviceName;
  const correlationId = ctx?.correlationId;

  for (const [rawName, transport] of iterateWireSignals(ctx)) {
    if (isKnownWireSignal(rawName, transport)) {
      continue;
    }
    emitUnknownEvent({
      rawName,
      transport,
      serviceName,
      correlationId,
    });
  }
}

// ─────────────────────────── internals ───────────────────────────

function* iterateWireSignals(ctx) {
  if (ctx == null) return;

  const headers = ctx.headers;
  if (headers != null) {
    for (const headerName of iterateHeaderNames(headers)) {
      const normalized = headerName.toLowerCase();
      if (HEADER_PATTERN.test(normalized)) {
        // Strip leading `x-` so the audit `knob.name.raw` matches the
        // canonical-name shape (`force-...`). The driver scenario asserts on
        // this exact form.
        yield [normalized.slice(2), "header"];
      }
    }
  }

  const event = ctx.event;
  if (event != null && typeof event.type === "string") {
    if (EVENT_PATTERN.test(event.type)) {
      yield [event.type, "event"];
    }
  }

  const body = ctx.body;
  if (body != null && typeof body === "object" && !Array.isArray(body)) {
    for (const key of Object.keys(body)) {
      if (BODY_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
        yield [key, "body-field"];
      }
    }
  }
}

function* iterateHeaderNames(headers) {
  if (typeof headers.entries === "function") {
    for (const [name] of headers.entries()) {
      yield name;
    }
    return;
  }
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (Array.isArray(pair) && typeof pair[0] === "string") yield pair[0];
    }
    return;
  }
  if (typeof headers === "object") {
    for (const key of Object.keys(headers)) yield key;
  }
}

function isKnownWireSignal(rawName, transport) {
  if (transport === "header") {
    // rawName already stripped of the `x-` prefix and lowered.
    return KNOB_BY_NAME.has(rawName);
  }
  if (transport === "event") {
    if (KNOB_BY_LEGACY_ALIAS.has(rawName)) return true;
    const canonical = rawName.replace(/^__|__$/g, "").replace(/_/g, "-");
    return KNOB_BY_NAME.has(canonical);
  }
  if (transport === "body-field") {
    if (KNOB_BY_LEGACY_ALIAS.has(rawName)) return true;
    const canonical = rawName.replace(/_/g, "-");
    return KNOB_BY_NAME.has(canonical);
  }
  return false;
}

function emitUnknownEvent({ rawName, transport, serviceName, correlationId }) {
  const event = {
    "event.name": "failure-simulation.unknown",
    "service.name": serviceName ?? "unknown",
    timestamp: new Date().toISOString(),
    "environment.tier": readEnvTier(),
    "knob.name.raw": rawName,
    "knob.transport": transport,
    "manifest.path": MANIFEST_PATH,
  };
  if (correlationId != null) {
    event.correlation_id = correlationId;
  }
  process.stdout.write(JSON.stringify(event) + "\n");
}

function readEnvTier() {
  const raw = process.env.ENVIRONMENT;
  if (raw == null || raw.trim() === "") return "unset";
  const normalized = raw.trim().toLowerCase();
  if (["dev", "ci", "staging", "production"].includes(normalized)) {
    return normalized;
  }
  return "unknown";
}
