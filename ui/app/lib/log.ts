/**
 * Structured logging for the UI, built on consola. Each event maps to an
 * ECS/OTel-flavoured record so the console reads as an audit trail and the
 * records stay portable if ever shipped to a log sink:
 *
 *   channel (consola tag) → event.module   ("catalog", "auth", …)
 *   action (the message)  → event.action   (a stable dotted key: "write.rename.ok")
 *   timestamp             → @timestamp
 *   level                 → log.level
 *   payload               → attributes      (OTel-style structured fields)
 *
 * Readable console output is the default. Verbosity resolves from the in-browser
 * `ui:log` localStorage knob when set, otherwise the server-side `LOG_LEVEL`
 * env (SSR / Node), defaulting to INFO. Two startup-read knobs:
 *   - `ui:log`      = debug | info | warn | error  (in-browser verbosity override)
 *   - `ui:log.json` = "1"  → emit one-line ECS JSON per event (parse/ship)
 */
import {
  type Logger,
  type LogLevel,
  type LogRecord,
  redact,
  resolveLogLevel,
} from "@dashboard-chat/shared-logging";
import { createConsola, LogLevels,type LogObject } from "consola";

// The envelope contract (LogRecord / Logger / LogLevel) and the redaction
// ruleset are owned by @dashboard-chat/shared-logging. Consola is the isomorphic
// emit backend for this surface only; it conforms to the shared contract and
// runs every JSON line through the shared redact().
export type { Logger,LogLevel, LogRecord };

const LEVEL_VALUE: Record<LogLevel, number> = {
  error: LogLevels.error,
  warn: LogLevels.warn,
  info: LogLevels.info,
  debug: LogLevels.debug,
};

const CONSOLA_LEVEL_TO_NAME: Record<number, LogLevel> = {
  [LogLevels.error]: "error",
  [LogLevels.warn]: "warn",
  [LogLevels.info]: "info",
  [LogLevels.debug]: "debug",
};

/** Read a localStorage setting, tolerant of SSR / blocked storage. */
function readSetting(key: string): string | null {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the active verbosity. The in-browser `ui:log` localStorage knob wins
 * when set; otherwise honour the server-side `LOG_LEVEL` env (SSR / Node),
 * defaulting to INFO. Exported for testing.
 */
export function configuredLevel(): number {
  const stored = readSetting("ui:log") as LogLevel | null;
  if (stored && stored in LEVEL_VALUE) return LEVEL_VALUE[stored];
  const env = typeof process !== "undefined" ? process.env : undefined;
  return LEVEL_VALUE[resolveLogLevel(env)];
}

/** Project a consola LogObject onto the ECS/OTel record. Exported for testing. */
export function toEcsRecord(obj: LogObject): LogRecord {
  const action = typeof obj.args[0] === "string" ? obj.args[0] : "";
  const attributes = obj.args[1];
  const record: LogRecord = {
    "@timestamp": (obj.date instanceof Date ? obj.date : new Date()).toISOString(),
    "log.level": CONSOLA_LEVEL_TO_NAME[obj.level] ?? "info",
    "event.module": obj.tag ?? "",
    "event.action": action,
  };
  if (attributes && typeof attributes === "object") {
    record.attributes = attributes as Record<string, unknown>;
  }
  return record;
}

/**
 * Opt-in reporter: one-line ECS JSON per event, via the matching console method.
 * Every line's attributes pass through the shared `redact()` before serialization
 * so a credential carried in an attribute never reaches the console/sink — the
 * same ruleset the pino backends use. Exported for the redaction regression
 * test on the consola transport.
 */
export const ecsJsonReporter = {
  log(obj: LogObject): void {
    const record = toEcsRecord(obj);
    if (record.attributes) record.attributes = redact(record.attributes);
    const method = record["log.level"];
    // eslint-disable-next-line no-console
    (console[method] as (...a: unknown[]) => void)(JSON.stringify(record));
  },
};

const base = createConsola(
  readSetting("ui:log.json") === "1"
    ? { level: configuredLevel(), reporters: [ecsJsonReporter] }
    : { level: configuredLevel() },
);

/**
 * A channel-scoped logger. `channel` becomes the event.module; each method takes
 * a dotted `action` (event.action) and an optional structured `attributes` bag.
 */
export function createLogger(channel: string): Logger {
  const tagged = base.withTag(channel);
  const at =
    (level: LogLevel) =>
    (action: string, attributes?: Record<string, unknown>): void => {
      if (attributes === undefined) tagged[level](action);
      else tagged[level](action, attributes);
    };
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
}
