/**
 * ui-state ambient correlation binding: the extended `requestIdMiddleware` binds
 * the resolved request id into the shared store so the logger surfaces it as
 * `attributes.correlation_id`, AND keeps `c.get("requestId")` (the source of the
 * Redis `FlowEventRecord.request_id`) aligned to that same id.
 */

import { getCorrelationId } from "@dashboard-chat/correlation-id";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../log";
import { requestIdMiddleware } from "./flow-router";

const log = createLogger("ui-state.test");

function captureStdout() {
  const lines: Array<Record<string, unknown>> = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    String(chunk)
      .split("\n")
      .filter((l) => l.trim().startsWith("{"))
      .forEach((l) => lines.push(JSON.parse(l)));
    return true;
  });
  return lines;
}

afterEach(() => vi.restoreAllMocks());

const correlationIds = (lines: Array<Record<string, unknown>>): Set<string> =>
  new Set(
    lines
      .map((l) => (l.attributes as { correlation_id?: string } | undefined)?.correlation_id)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  );

describe("ui-state requestIdMiddleware — correlation binding", () => {
  it("binds the inbound id, aligns c.get('requestId'), and stamps log lines", async () => {
    const lines = captureStdout();

    const app = new Hono();
    app.use("*", requestIdMiddleware);
    app.get("/state", (c) => {
      log.info("flow.handled");
      return c.json({
        requestId: c.get("requestId"),
        bound: getCorrelationId(),
      });
    });

    const res = await app.request("/state", { headers: { "X-Request-Id": "ui-state-corr-1" } });
    const body = (await res.json()) as { requestId: string; bound: string };

    expect(body.requestId).toBe("ui-state-corr-1");
    expect(body.bound).toBe("ui-state-corr-1");
    expect(res.headers.get("X-Request-Id")).toBe("ui-state-corr-1");
    expect(correlationIds(lines)).toEqual(new Set(["ui-state-corr-1"]));
  });

  it("mints once when absent and uses the same id for log line and requestId", async () => {
    const lines = captureStdout();

    const app = new Hono();
    app.use("*", requestIdMiddleware);
    app.get("/state", (c) => {
      log.info("flow.handled");
      return c.json({ requestId: c.get("requestId"), bound: getCorrelationId() });
    });

    const res = await app.request("/state");
    const body = (await res.json()) as { requestId: string; bound: string };

    expect(body.bound).toBe(body.requestId);
    expect(correlationIds(lines)).toEqual(new Set([body.requestId]));
  });
});
