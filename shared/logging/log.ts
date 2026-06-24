/**
 * Cross-service structured-logging contract (the durable seam, ADR-053 §1).
 *
 * Promoted verbatim from `ui/app/lib/log.ts` so every surface — the isomorphic
 * `ui/` (consola) and the Node services (pino) — emits the **same** ECS/OTel
 * envelope regardless of which library serializes it:
 *
 *   channel → event.module   ("catalog", "auth", …)
 *   action  → event.action   (a stable dotted key: "write.rename.ok")
 *   level   → log.level
 *   payload → attributes      (OTel-style structured fields)
 *
 * This module is library-agnostic: it declares the shapes only. Each service
 * supplies its own emit backend behind the `createLogger(channel)` contract and
 * runs every line through the shared `redact()` (see ./redaction) before emit.
 */

/** Verbosity level, shared by every surface. Default INFO when unset. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** The ECS/OTel-flavoured record every event maps to (the JSON-sink shape). */
export interface LogRecord {
  "@timestamp": string;
  "log.level": LogLevel;
  "event.module": string;
  "event.action": string;
  attributes?: Record<string, unknown>;
}

/**
 * A channel-scoped logger. The channel becomes `event.module`; each method takes
 * a dotted `action` (`event.action`) and an optional structured `attributes` bag.
 */
export interface Logger {
  debug(action: string, attributes?: Record<string, unknown>): void;
  info(action: string, attributes?: Record<string, unknown>): void;
  warn(action: string, attributes?: Record<string, unknown>): void;
  error(action: string, attributes?: Record<string, unknown>): void;
}
