import { LogLevels,type LogObject } from "consola";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, ecsJsonReporter, toEcsRecord } from "./log";

/** A minimal consola LogObject for the mapper under test. */
function logObject(partial: Partial<LogObject>): LogObject {
  return {
    level: LogLevels.info,
    type: "info",
    tag: "",
    args: [],
    date: new Date("2026-06-07T00:00:00.000Z"),
    ...partial,
  } as LogObject;
}

describe("toEcsRecord", () => {
  it("maps tag/action/level/date to ECS fields and carries attributes", () => {
    const record = toEcsRecord(
      logObject({
        tag: "catalog",
        level: LogLevels.info,
        args: ["write.rename", { id: "d1", kind: "dataset" }],
      }),
    );

    expect(record["event.module"]).toBe("catalog");
    expect(record["event.action"]).toBe("write.rename");
    expect(record["log.level"]).toBe("info");
    expect(record["@timestamp"]).toBe("2026-06-07T00:00:00.000Z");
    expect(record.attributes).toEqual({ id: "d1", kind: "dataset" });
  });

  it("maps the warn level and omits attributes when none are passed", () => {
    const record = toEcsRecord(
      logObject({ tag: "auth", level: LogLevels.warn, args: ["login.failed"] }),
    );

    expect(record["log.level"]).toBe("warn");
    expect(record["event.module"]).toBe("auth");
    expect(record["event.action"]).toBe("login.failed");
    expect(record.attributes).toBeUndefined();
  });
});

describe("ecsJsonReporter redaction (consola transport)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The redaction regression guarantee (ADR-053 §2, US-7 AC7.2) re-run on the
   * consola transport: production-shaped credentials carried as attributes never
   * survive serialization on the JSON path, while ordinary fields are preserved.
   */
  const SENSITIVE_ATTRIBUTES = {
    authorization: "Bearer test-access-token",
    cookie: "session=test-session-value",
    access_token: "test-personal-access-token",
    client_secret: "test-m2m-client-secret",
    password: "test-password-value",
    email: "user@example.com",
  } as const;

  it("masks sensitive attributes before the line is serialized", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    ecsJsonReporter.log(
      logObject({
        tag: "auth",
        level: LogLevels.warn,
        args: ["login.denied", { ...SENSITIVE_ATTRIBUTES, user_id: "u1" }],
      }),
    );

    const line = spy.mock.calls[0]?.[0] as string;
    for (const value of Object.values(SENSITIVE_ATTRIBUTES)) {
      expect(line.includes(value)).toBe(false);
    }

    const attributes = JSON.parse(line).attributes as Record<string, unknown>;
    for (const key of Object.keys(SENSITIVE_ATTRIBUTES)) {
      expect(attributes[key]).toBe("[REDACTED]");
    }
    expect(attributes.user_id).toBe("u1");
  });
});

describe("createLogger", () => {
  it("exposes the four level methods without throwing", () => {
    const log = createLogger("test");
    expect(() => {
      log.debug("a");
      log.info("b", { x: 1 });
      log.warn("c");
      log.error("d", { err: "boom" });
    }).not.toThrow();
  });
});
