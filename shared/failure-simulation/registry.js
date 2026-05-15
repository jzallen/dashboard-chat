import { manifest, MANIFEST_PATH } from "./manifest.js";
import { getCachedVerdict } from "./gate.js";
import { emitFiredEvent, emitRejectedEvent, emitUnknownEvent } from "./audit.js";

// Internal index for fast canonical-name lookup. Built once at module load.
const KNOB_BY_NAME = new Map(manifest.map((entry) => [entry.name, entry]));

// Wire-event-name index for `event`-transport entries. Lets
// `detectUnknownSignals` recognize wire names whose mapping back to a
// canonical name is non-trivial — entries that carry `eventDistinguisher`
// strip a kebab suffix from the canonical at render time, so the wire form
// is not bijective with the canonical via simple snake↔kebab conversion.
const KNOB_BY_WIRE_EVENT = new Map();
for (const entry of manifest) {
  if (entry.transport !== "event") continue;
  for (const wire of renderEventTypes(entry)) {
    KNOB_BY_WIRE_EVENT.set(wire, entry);
  }
}

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

// ─────────────────────────── shouldInject (MR-2) ───────────────────────────
//
// Per-request decision point. Lookup + transport-match + gate-consult +
// audit-emit. The verdict is the one cached by probe() at composition root —
// per-request env-var parsing is forbidden by CA-4 (cache stability).
//
// Ordering rules (ADR-037 §"Audit emission point and ordering"):
//   1. Unknown `knobName` (not in manifest)         → throw UnknownKnobError
//   2. No signal carried for this knob's transport → return false, emit nothing
//   3. Signal present + verdict disabled            → emit rejected, return false
//   4. Signal present + verdict enabled             → emit fired, return true

export function shouldInject(knobName, ctx) {
  const entry = KNOB_BY_NAME.get(knobName);
  if (entry == null) {
    throw new UnknownKnobError(knobName);
  }

  if (!matchTransport(entry, ctx)) {
    return false;
  }

  const verdict = getCachedVerdict();
  const serviceName = ctx?.serviceName;
  const correlationId = ctx?.correlationId;

  if (verdict.state !== "enabled") {
    emitRejectedEvent({ entry, serviceName, correlationId, verdict });
    return false;
  }

  const value = extractTransportValue(entry, ctx);
  emitFiredEvent({ entry, value, serviceName, correlationId, verdict });
  return true;
}

// ─────────────────────────── transport matching ───────────────────────────

function matchTransport(entry, ctx) {
  if (ctx == null) return false;
  if (entry.transport === "header") {
    const headerName = renderHeaderName(entry.name);
    return headersHas(ctx.headers, headerName);
  }
  if (entry.transport === "event") {
    if (ctx.event == null || typeof ctx.event.type !== "string") return false;
    return renderEventTypes(entry).includes(ctx.event.type);
  }
  if (entry.transport === "body-field") {
    if (ctx.body == null || typeof ctx.body !== "object") return false;
    return renderFieldNames(entry).some((name) => ctx.body[name] != null);
  }
  return false;
}

function extractTransportValue(entry, ctx) {
  if (entry.transport === "header") {
    return headersGet(ctx?.headers, renderHeaderName(entry.name));
  }
  if (entry.transport === "body-field") {
    for (const name of renderFieldNames(entry)) {
      const raw = ctx?.body?.[name];
      if (raw == null) continue;
      return typeof raw === "string" ? raw : JSON.stringify(raw);
    }
    return undefined;
  }
  // Event transport has no semantic value beyond the type itself.
  return undefined;
}

function renderHeaderName(canonical) {
  // force-create-session-failure → X-Force-Create-Session-Failure
  return (
    "X-" +
    canonical
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("-")
  );
}

function renderEventTypes(entry) {
  // Canonical-derived wire event: snake-case the canonical then wrap in `__`.
  // Entries with `eventDistinguisher` strip that exact kebab suffix from the
  // canonical before rendering — letting the manifest carry a self-documenting
  // canonical (e.g. `force-failure-on-auth-retry`) while the wire stays
  // idiomatic for XState consumers (e.g. `__force_failure__`).
  const baseName =
    entry.eventDistinguisher != null
      ? entry.name.replace(
          new RegExp(`-${escapeRegex(entry.eventDistinguisher)}$`),
          "",
        )
      : entry.name;
  return ["__" + baseName.replace(/-/g, "_") + "__"];
}

function renderFieldNames(entry) {
  return [entry.name.replace(/-/g, "_")];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headersHas(headers, headerName) {
  if (headers == null) return false;
  const target = headerName.toLowerCase();
  if (typeof headers.has === "function") {
    return headers.has(headerName) || headers.has(target);
  }
  if (Array.isArray(headers)) {
    return headers.some(
      (pair) =>
        Array.isArray(pair) &&
        typeof pair[0] === "string" &&
        pair[0].toLowerCase() === target,
    );
  }
  if (typeof headers === "object") {
    return Object.keys(headers).some((k) => k.toLowerCase() === target);
  }
  return false;
}

function headersGet(headers, headerName) {
  if (headers == null) return undefined;
  const target = headerName.toLowerCase();
  if (typeof headers.get === "function") {
    return headers.get(headerName) ?? headers.get(target) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const match = headers.find(
      (pair) =>
        Array.isArray(pair) &&
        typeof pair[0] === "string" &&
        pair[0].toLowerCase() === target,
    );
    return match ? match[1] : undefined;
  }
  if (typeof headers === "object") {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === target);
    return key ? headers[key] : undefined;
  }
  return undefined;
}

// ─────────────────────────── detectUnknownSignals ───────────────────────────

const HEADER_PATTERN = /^x-force-[a-z0-9-]+$/;
const EVENT_PATTERN = /^__(?:force|expire)_[a-z0-9_]+__$/;
const BODY_FIELD_PATTERNS = [/^harness_force_[a-z0-9_]+$/, /^force_[a-z0-9_]+$/];

/**
 * Scan the request context for failure-simulation-shaped wire signals that
 * do not correspond to any manifest entry. Delegates emission to
 * `audit.emitUnknownEvent` so the audit envelope is consistent across all
 * `failure-simulation.*` event types (ADR-037 §"Audit emission point").
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
    return KNOB_BY_WIRE_EVENT.has(rawName);
  }
  if (transport === "body-field") {
    return KNOB_BY_NAME.has(rawName.replace(/_/g, "-"));
  }
  return false;
}
