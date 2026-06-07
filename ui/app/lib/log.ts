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
 * Readable console output is the default. Two startup-read localStorage knobs:
 *   - `ui:log`      = debug | info | warn | error  (verbosity; default info)
 *   - `ui:log.json` = "1"  → emit one-line ECS JSON per event (parse/ship)
 */
import { createConsola, LogLevels,type LogObject } from "consola";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** The ECS/OTel-flavoured record every event maps to (the JSON-sink shape). */
export interface LogRecord {
  "@timestamp": string;
  "log.level": LogLevel;
  "event.module": string;
  "event.action": string;
  attributes?: Record<string, unknown>;
}

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

function configuredLevel(): number {
  const v = readSetting("ui:log") as LogLevel | null;
  return v && v in LEVEL_VALUE ? LEVEL_VALUE[v] : LogLevels.info;
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

/** Opt-in reporter: one-line ECS JSON per event, via the matching console method. */
const ecsJsonReporter = {
  log(obj: LogObject): void {
    const record = toEcsRecord(obj);
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

export interface Logger {
  debug(action: string, attributes?: Record<string, unknown>): void;
  info(action: string, attributes?: Record<string, unknown>): void;
  warn(action: string, attributes?: Record<string, unknown>): void;
  error(action: string, attributes?: Record<string, unknown>): void;
}

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
