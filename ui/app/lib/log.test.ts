import { LogLevels,type LogObject } from "consola";
import { describe, expect, it } from "vitest";

import { createLogger, toEcsRecord } from "./log";

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
