/**
 * Redaction ruleset — one source of truth, two transports.
 *
 * The sensitive-key ruleset and the pure helpers that apply it live here once.
 * Both emit backends consume them: the pino serializer (auth-proxy / agent /
 * ui-state) and the consola `ecsJsonReporter` (`ui/`) each call `redact()`
 * before serializing a line. A key is added to `redactionKeys` here and nowhere
 * else, so it is structurally impossible to protect one surface but not another.
 *
 * The helpers are pure: no I/O, no library coupling, and allocation-light so
 * they can run on every emitted line, including the server hot paths.
 *
 * Scope — redaction matches on the attribute KEY, never on value content. A
 * sensitive key's value is masked wholesale; a credential embedded inside an
 * otherwise-ordinary string (a token in a `url` query, a bearer header
 * serialized into a free-text `message`) is NOT scrubbed. Value-content
 * scanning is deliberately out of scope: it would couple this hot path to
 * pattern matching with attendant ReDoS and over-redaction risk, and callers
 * are expected to pass credentials as their own attributes (which this catches)
 * rather than pre-concatenated into strings. Keep secrets in dedicated keys.
 */

/**
 * The sensitive-key ruleset. `exactKeys` match a whole attribute key
 * case-insensitively; `substringKeys` match any key that *contains* the pattern
 * (the `*token*` / `*secret*` glob semantics). A matched value is replaced with
 * `mask`.
 */
export interface RedactionConfig {
  /** Keys masked on an exact, case-insensitive match (e.g. `authorization`, `cookie`, `password`, `email`). */
  exactKeys: readonly string[];
  /** Keys masked when the attribute key contains the pattern (e.g. `token`, `secret`). */
  substringKeys: readonly string[];
  /** Replacement rendered in place of a sensitive value. */
  mask: string;
}

/** Single source of truth for sensitive keys. */
export const redactionKeys: RedactionConfig = {
  exactKeys: ["authorization", "cookie", "password", "email"],
  substringKeys: ["token", "secret"],
  mask: "[REDACTED]",
};

/**
 * Whether `key` is sensitive under `config`: an exact, case-insensitive match
 * against `exactKeys`, or a case-insensitive substring match against any
 * `substringKeys` pattern (the `*token*` / `*secret*` glob semantics).
 */
function isSensitiveKey(key: string, config: RedactionConfig): boolean {
  const lower = key.toLowerCase();
  return (
    config.exactKeys.some((k) => k.toLowerCase() === lower) ||
    config.substringKeys.some((pattern) => lower.includes(pattern.toLowerCase()))
  );
}

/**
 * Mask a single value if its key is sensitive under `config`, else return it
 * unchanged. An absent (`undefined`) value is a no-op so masking never
 * fabricates a field the caller did not set.
 */
export function maskValue(
  key: string,
  value: unknown,
  config: RedactionConfig = redactionKeys,
): unknown {
  if (value === undefined) return value;
  return isSensitiveKey(key, config) ? config.mask : value;
}

/** Rendered in place of a value that closes a reference cycle. */
const CIRCULAR = "[Circular]";

/**
 * Whether `value` is a plain object literal (prototype `Object.prototype` or
 * `null`). Class instances, `Error`, `Date`, `Map`, `Set`, `Buffer`, etc. are
 * NOT plain — recursing into them with `Object.entries` would drop their
 * prototype and non-enumerable fields, so they are passed through untouched
 * (an `Error` is handled separately to preserve its message).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Project an `Error` onto a serializable record, preserving `name`/`message`/
 * `stack` (which `Object.entries` would otherwise drop) and recursing into any
 * enumerable own properties so a credential attached to the error is still
 * masked.
 */
function redactError(
  error: Error,
  config: RedactionConfig,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if (error.stack !== undefined) out.stack = error.stack;
  for (const [key, value] of Object.entries(error)) {
    out[key] = isSensitiveKey(key, config)
      ? maskValue(key, value, config)
      : redactValue(value, config, seen);
  }
  return out;
}

/**
 * Recurse into arrays, plain objects, and `Error`s; pass every other value
 * (primitives, `Date`, `Map`, `Set`, class instances) through untouched. A
 * `seen` set tracks the current ancestor chain so a reference cycle resolves to
 * `[Circular]` instead of recursing forever and crashing the emit path.
 */
function redactValue(
  value: unknown,
  config: RedactionConfig,
  seen: WeakSet<object>,
): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    const out = value.map((item) => redactValue(item, config, seen));
    seen.delete(value);
    return out;
  }
  if (value instanceof Error) {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    const out = redactError(value, config, seen);
    seen.delete(value);
    return out;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    const out = redactRecord(value, config, seen);
    seen.delete(value);
    return out;
  }
  return value;
}

/** Mask sensitive keys and recurse the rest, threading the cycle-guard `seen`. */
function redactRecord(
  attributes: Record<string, unknown>,
  config: RedactionConfig,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = isSensitiveKey(key, config)
      ? maskValue(key, value, config)
      : redactValue(value, config, seen);
  }
  return out;
}

/**
 * Return a copy of `attributes` with every sensitive value masked under
 * `config`. A sensitive key's value is replaced wholesale with `config.mask`;
 * non-sensitive values are recursed into so a credential nested under an
 * ordinary key is still caught. Non-sensitive primitives (and non-plain objects
 * such as `Date`) pass through unchanged. A reference cycle resolves to
 * `[Circular]` rather than overflowing the stack.
 */
export function redact(
  attributes: Record<string, unknown>,
  config: RedactionConfig = redactionKeys,
): Record<string, unknown> {
  const seen = new WeakSet<object>();
  seen.add(attributes);
  return redactRecord(attributes, config, seen);
}
