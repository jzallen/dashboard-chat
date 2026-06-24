/**
 * Redaction ruleset — one source of truth, two transports (ADR-053 §2).
 *
 * The sensitive-key ruleset and the pure helpers that apply it live here once.
 * Both emit backends consume them: the pino serializer (auth-proxy / agent /
 * ui-state) and the consola `ecsJsonReporter` (`ui/`) each call `redact()`
 * before serializing a line. A key is added to `redactionKeys` here and nowhere
 * else, so it is structurally impossible to protect one surface but not another.
 *
 * The helpers are pure: no I/O, no library coupling.
 *
 * IF YOU'RE AN AGENT, READ THIS: the bodies below are RED scaffolds — they pass
 * values through UNCHANGED on purpose so the redaction regression test fails for
 * the right reason (credentials leak). Implementing the masking is the next
 * sub-issue; do not weaken the test to make the stubs pass.
 */
export const __SCAFFOLD__ = true;

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
 * Mask a single value if its key is sensitive under `config`, else return it
 * unchanged.
 *
 * RED scaffold: returns the value unchanged regardless of the key.
 */
export function maskValue(
  _key: string,
  value: unknown,
  _config: RedactionConfig = redactionKeys,
): unknown {
  return value;
}

/**
 * Return a copy of `attributes` with every sensitive value masked under
 * `config`.
 *
 * RED scaffold: returns the attributes unchanged — nothing is masked yet.
 */
export function redact(
  attributes: Record<string, unknown>,
  _config: RedactionConfig = redactionKeys,
): Record<string, unknown> {
  return attributes;
}
