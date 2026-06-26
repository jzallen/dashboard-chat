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
 *
 * The emit path and the redaction serializer are not implemented yet: a logger
 * method and the serializer hook both throw, so no line is emitted until the pino
 * backend is wired behind these signatures.
 */

import {
  type Logger,
  type RedactionConfig,
  redactionKeys,
} from "@dashboard-chat/shared-logging";
import pino from "pino";

const NOT_IMPLEMENTED = "not implemented";

/**
 * Shared pino root. Per-channel loggers are children scoped to `event.module`;
 * the `formatters.log` hook is the single seam every line passes through, so
 * redaction is applied in exactly one place for this transport. Lines are
 * written to `process.stdout` so they interleave with — and never disturb — the
 * existing KPI-event and startup image-identity lines on the same stream.
 */
const base = pino(
  {
    formatters: {
      log: (object: Record<string, unknown>) => redactionSerializer(object),
    },
  },
  process.stdout,
);

/**
 * The redaction serializer seam: pino's per-line hook that scrubs sensitive
 * attributes through the shared ruleset before serialization. The single point
 * at which `@dashboard-chat/shared-logging`'s `redact()` is applied to this
 * transport's output.
 */
export function redactionSerializer(
  attributes: Record<string, unknown>,
  _config: RedactionConfig = redactionKeys,
): Record<string, unknown> {
  void attributes;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Build a channel-scoped {@link Logger}. The `channel` becomes `event.module`;
 * each method takes a dotted `action` (`event.action`) and an optional
 * structured `attributes` bag, emitting one `LogRecord` JSON line through the
 * redacting pino backend.
 */
export function createLogger(channel: string): Logger {
  const _channelLogger = base.child({ "event.module": channel });
  const notImplemented = (): never => {
    throw new Error(NOT_IMPLEMENTED);
  };
  return {
    debug: notImplemented,
    info: notImplemented,
    warn: notImplemented,
    error: notImplemented,
  };
}
