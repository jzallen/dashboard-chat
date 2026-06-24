/**
 * Runtime verbosity resolution (ADR-053 D6).
 *
 * Pure mapping from a `LOG_LEVEL` environment string to a `LogLevel`, defaulting
 * to INFO when unset or unrecognized. Takes an explicit env bag rather than
 * reading process globals so it is testable in isolation and reusable by every
 * emit backend — the consola surface today, the pino adapters as later slices
 * adopt the logger.
 */
import type { LogLevel } from "./log";

/** The verbosity used when `LOG_LEVEL` is unset or invalid. */
export const DEFAULT_LOG_LEVEL: LogLevel = "info";

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * An environment bag carrying an optional `LOG_LEVEL` string. The index
 * signature lets a real `process.env` (a `Record<string, string | undefined>`)
 * be passed directly without a cast.
 */
export interface LogLevelEnv {
  LOG_LEVEL?: string;
  [key: string]: string | undefined;
}

/**
 * Resolve the configured `LogLevel` from `env.LOG_LEVEL` (case-insensitive,
 * whitespace-trimmed), falling back to {@link DEFAULT_LOG_LEVEL} when the value
 * is unset or not one of `debug | info | warn | error`.
 */
export function resolveLogLevel(env?: LogLevelEnv): LogLevel {
  const raw = env?.LOG_LEVEL?.trim().toLowerCase();
  return LOG_LEVELS.includes(raw as LogLevel)
    ? (raw as LogLevel)
    : DEFAULT_LOG_LEVEL;
}
