/**
 * Redaction ruleset — one source of truth, two transports (ADR-053 §2).
 *
 * The sensitive-key ruleset and the pure helpers that apply it live here once.
 * Both emit backends consume them: the pino serializer (auth-proxy / agent /
 * ui-state) and the consola `ecsJsonReporter` (`ui/`) each call `redact()`
 * before serializing a line. A key is added to `redactionKeys` here and nowhere
 * else, so it is structurally impossible to protect one surface but not another.
 *
 * The helpers are pure: no I/O, no library coupling, and allocation-light so
 * they can run on every emitted line, including the server hot paths.
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

/** Single source of truth for sensitive keys (ADR-053 §2). */
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

/** Recurse into nested objects and arrays; pass primitives through untouched. */
function redactValue(value: unknown, config: RedactionConfig): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, config));
  }
  if (value !== null && typeof value === "object") {
    return redact(value as Record<string, unknown>, config);
  }
  return value;
}

/**
 * Return a copy of `attributes` with every sensitive value masked under
 * `config`. A sensitive key's value is replaced wholesale with `config.mask`;
 * non-sensitive values are recursed into so a credential nested under an
 * ordinary key is still caught. Non-sensitive primitives pass through unchanged.
 */
export function redact(
  attributes: Record<string, unknown>,
  config: RedactionConfig = redactionKeys,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = isSensitiveKey(key, config)
      ? maskValue(key, value, config)
      : redactValue(value, config);
  }
  return out;
}
