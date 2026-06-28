/**
 * ui-state structured-logging adapter — the pino transport behind the shared
 * `createLogger(channel)` contract.
 *
 * The cross-service envelope, the `Logger`/`LogRecord` shapes, and the redaction
 * ruleset live once in `@dashboard-chat/shared-logging`; this is the thin
 * Node/pino backend that maps a channel-scoped `action` + `attributes` call onto
 * the shared `LogRecord` field set and runs every line through the redaction seam
 * before emit. The correlation id bound to the current request (via the ingress
 * `correlationMiddleware`) is read at emit time and injected as
 * `attributes.correlation_id` on every line — no signature threading.
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

/** The redaction serializer seam: scrubs sensitive attributes before emit. */
export function redactionSerializer(
  attributes: Record<string, unknown>,
  config: RedactionConfig = redactionKeys,
): Record<string, unknown> {
  return redact(attributes, config);
}

/**
 * Build a channel-scoped {@link Logger}. The `channel` becomes `event.module`;
 * each method takes a dotted `action` (`event.action`) and an optional
 * structured `attributes` bag. The bound correlation id is injected as
 * `attributes.correlation_id` on every line.
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
