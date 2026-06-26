/**
 * The legacy stdout lines stay byte-unchanged once structured logging is active.
 * The KPI-event JSON lines (`emitKpiEvent`) and the startup image-identity
 * line (`logImageIdentity`) predate this slice and must NOT be rerouted through
 * the `LogRecord` envelope: existing parsers keep working and pino is purely
 * additive alongside them.
 *
 * Each case installs structured logging (one line through `createLogger`) and then
 * asserts the legacy line on the same stream is still its original plain shape —
 * not a `LogRecord`.
 *
 * IF YOU'RE AN AGENT, READ THIS: these tests are the spec — keep the legacy lines
 * exactly as they are; do not "upgrade" them to the envelope to make a test pass.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "./app.ts";
import { createLogger } from "./lib/log.ts";
import { logImageIdentity } from "./version.ts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** Capture every non-empty line written to stdout, then restore. */
function captureStdoutLines(): { lines: () => string[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      chunks.push(
        typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf8"),
      );
      return true;
    });
  return {
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((logLine) => logLine.trim()),
    restore: () => spy.mockRestore(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_MODE = "dev";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("legacy stdout lines remain unchanged", () => {
  it("keeps the startup image-identity line plain when structured logging is active", () => {
    const capture = captureStdoutLines();
    try {
      createLogger("auth").info("auth.proxy.started", {});
      logImageIdentity("auth-proxy");
    } finally {
      capture.restore();
    }

    const startup = capture
      .lines()
      .find((logLine) => logLine.startsWith("auth-proxy image="));
    expect(startup, "the startup image-identity line must still be emitted").toBeDefined();
    // The legacy plain-text shape: a LogRecord JSON line could never match it.
    expect(startup).toMatch(/^auth-proxy image=\S+ sha=\S+ built=\S+$/);
  });

  it("keeps the KPI-event JSON line byte-unchanged when structured logging is active", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          request_id: "R-doc-5c1a",
          regions: { onboarding: { state: "ready", context: {} } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const capture = captureStdoutLines();
    try {
      createLogger("auth").info("auth.proxy.started", {});
      const res = await app.fetch(
        new Request("http://localhost/ui-state/state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "org_form_submitted" }),
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      capture.restore();
    }

    const kpiLine = capture
      .lines()
      .find((logLine) => logLine.includes('"event":"ready_reached"'));
    expect(kpiLine, "the ready_reached KPI line must still be emitted").toBeDefined();
    // An exact compare proves the line was not rerouted through the LogRecord
    // envelope — it carries only the legacy KPI fields.
    expect(JSON.parse(kpiLine as string)).toEqual({
      event: "ready_reached",
      request_id: "R-doc-5c1a",
    });
  });
});
