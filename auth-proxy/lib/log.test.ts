/**
 * auth-proxy logging adapter contracts.
 *
 * Two guarantees the pino backend behind `createLogger(channel)` must honour:
 *
 *  - the shared `LogRecord` envelope: a `channel` becomes `event.module`, the
 *    dotted `action` becomes `event.action`, the method name sets `log.level`.
 *  - redaction: the per-line serializer runs every attribute bag through the
 *    shared ruleset, so a credential passed as an attribute never survives into
 *    an emitted line. This is the per-surface re-run of the redaction regression
 *    guard — proof the pino adapter wires `redact()` into its serializer seam,
 *    not merely that `redact()` works in isolation.
 *
 * IF YOU'RE AN AGENT, READ THIS: these tests are the spec — do not weaken the
 * assertions or skip them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "./log.ts";

/**
 * The ISO-8601 UTC shape `Date.prototype.toISOString()` produces
 * (`YYYY-MM-DDTHH:mm:ss.sssZ`) — the cross-surface `@timestamp` format the
 * consola surface already emits, so every transport stays byte-comparable.
 */
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Production-shaped credentials, keyed by the attribute names a caller would
 * actually use. Redaction matches on the KEY (`authorization`, `cookie`,
 * `*token*`, `*secret*`, `x-new-access-token`), so the values are obvious
 * placeholders — the guarantee under test is that whatever a sensitive key
 * carries never reaches the wire.
 */
const SENSITIVE_ATTRIBUTES = {
  authorization: "Bearer test-access-token-value",
  cookie: "auth_token=test-session-cookie; csrf=test-csrf",
  access_token: "test-personal-access-token",
  client_secret: "test-m2m-client-secret",
  "x-new-access-token": "test-reissued-access-token",
} as const;

/** Capture every line written to stdout, plus the raw text, then restore. */
function captureStdout(): {
  records: Array<Record<string, unknown>>;
  raw: () => string;
  restore: () => void;
} {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      chunks.push(
        typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf8"),
      );
      return true;
    });
  const raw = () => chunks.join("");
  return {
    get records() {
      return raw()
        .split("\n")
        .filter((logLine) => logLine.trim())
        .flatMap((logLine) => {
          try {
            return [JSON.parse(logLine) as Record<string, unknown>];
          } catch {
            return [];
          }
        });
    },
    raw,
    restore: () => spy.mockRestore(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLogger — shared LogRecord envelope", () => {
  it("maps channel and action onto event.module/event.action/log.level", () => {
    const log = createLogger("auth");
    const capture = captureStdout();
    try {
      log.warn("auth.jwt.rejected", { reason: "signature", principal_id: "u_1" });
    } finally {
      capture.restore();
    }

    const logLine = capture.records.find(
      (r) => r["event.action"] === "auth.jwt.rejected",
    );
    // Comparing the whole record (not a projection) also asserts no field leaks
    // past the envelope; `@timestamp` is a runtime value, so it is matched against
    // the ISO-8601 UTC shape rather than a literal.
    expect(logLine).toEqual({
      "@timestamp": expect.stringMatching(ISO_8601_UTC),
      "log.level": "warn",
      "event.module": "auth",
      "event.action": "auth.jwt.rejected",
      attributes: { reason: "signature", principal_id: "u_1" },
    });
  });
});

describe("createLogger — redaction", () => {
  it("never serializes a credential passed as an attribute", () => {
    const log = createLogger("auth");
    const capture = captureStdout();
    try {
      log.info("auth.m2m.verified", {
        ...SENSITIVE_ATTRIBUTES,
        principal_id: "service-account:svc-a",
      });
    } finally {
      capture.restore();
    }

    const serialized = capture.raw();
    for (const [key, value] of Object.entries(SENSITIVE_ATTRIBUTES)) {
      expect(
        serialized.includes(value),
        `value for "${key}" leaked into an emitted log line`,
      ).toBe(false);
    }
    expect(
      serialized.includes("service-account:svc-a"),
      "the non-sensitive principal id must survive redaction",
    ).toBe(true);
  });
});
