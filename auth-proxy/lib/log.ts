/**
 * auth-proxy structured-logging adapter — the pino transport behind the shared
 * `createLogger(channel)` contract.
 *
 * The cross-service envelope, the `Logger`/`LogRecord` shapes, and the redaction
 * ruleset all live once in `@dashboard-chat/shared-logging`. This module is the
 * thin Node/pino backend that maps a channel-scoped `action` + `attributes` call
 * onto the shared `LogRecord` field set (`event.module`/`event.action`/
 * `attributes`) and runs every line through the redaction seam before emit, so an
 * auth decision can be audited without the credential ever reaching a log line.
 */

import { getCorrelationId } from "@dashboard-chat/correlation-id";
import {
  type Logger,
  type LogLevel,
  redact,
  type RedactionConfig,
  redactionKeys,
  resolveLogLevel,
} from "@dashboard-chat/shared-logging";
import pino from "pino";

/**
 * Shared pino root, configured to emit exactly the cross-service `LogRecord`
 * envelope and nothing else:
 *
 *  - `base: null` drops pino's default `pid`/`hostname` bindings;
 *  - the `timestamp` hook renders `@timestamp` as an ISO-8601 UTC string in
 *    place of pino's epoch-millis `time`;
 *  - the `level` formatter renames the level field to `log.level` and emits the
 *    label (`info`/`warn`/…) rather than pino's numeric severity;
 *  - the `log` formatter is the single redaction seam — every line's merge
 *    object passes through it, so a credential carried in `attributes` is masked
 *    before serialization on EVERY line.
 *
 * Lines are written to `process.stdout` so they interleave with — and never
 * disturb — the existing KPI-event and startup image-identity lines on the same
 * stream. `LOG_LEVEL` (default `info`) controls verbosity.
 */
const base = pino(
  {
    base: null,
    level: resolveLogLevel(process.env),
    timestamp: () => `,"@timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ "log.level": label }),
      log: (object: Record<string, unknown>) => redactionSerializer(object),
    },
  },
  process.stdout,
);

/**
 * The redaction serializer seam: pino's per-line hook that scrubs sensitive
 * attributes through the shared ruleset before serialization. The single point
 * at which `@dashboard-chat/shared-logging`'s `redact()` is applied to this
 * transport's output — `redact()` recurses into the nested `attributes` bag, so
 * a credential passed under a sensitive key never reaches the wire.
 */
export function redactionSerializer(
  attributes: Record<string, unknown>,
  config: RedactionConfig = redactionKeys,
): Record<string, unknown> {
  return redact(attributes, config);
}

/**
 * Build a channel-scoped {@link Logger}. The `channel` becomes `event.module`;
 * each method takes a dotted `action` (`event.action`) and an optional
 * structured `attributes` bag, emitting one `LogRecord` JSON line through the
 * redacting pino backend.
 *
 * The correlation id bound to the current request (via `runWithCorrelationId`
 * in the ingress middleware) is read at emit time and injected as
 * `attributes.correlation_id` on every line — no signature threading. The wire
 * header is `X-Request-Id`; the log attribute is `correlation_id` (the
 * header↔attribute name split is intentional).
 */
export function createLogger(channel: string): Logger {
  const emit = (
    level: LogLevel,
    action: string,
    attributes?: Record<string, unknown>,
  ): void => {
    const correlationId = getCorrelationId();
    const merged =
      correlationId !== undefined
        ? { ...(attributes ?? {}), correlation_id: correlationId }
        : attributes;
    base[level]({
      "event.module": channel,
      "event.action": action,
      ...(merged !== undefined ? { attributes: merged } : {}),
    });
  };
  return {
    debug: (action, attributes) => emit("debug", action, attributes),
    info: (action, attributes) => emit("info", action, attributes),
    warn: (action, attributes) => emit("warn", action, attributes),
    error: (action, attributes) => emit("error", action, attributes),
  };
}
