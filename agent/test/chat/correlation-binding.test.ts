/**
 * agent ambient correlation binding: a request bound by `correlationMiddleware`
 * carries one shared `correlation_id` on every log line the agent's logger
 * emits — including a line emitted from a streamed continuation that runs after
 * the handler returned (the SSE shape, per the DC-134 Spike PROMOTE finding).
 */

import { runWithCorrelationId } from "@dashboard-chat/correlation-id";
import { correlationMiddleware } from "@dashboard-chat/correlation-id/hono";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../../lib/log";

const log = createLogger("agent.test");

function captureStdout() {
  const lines: Array<Record<string, unknown>> = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    String(chunk)
      .split("\n")
      .filter((l) => l.trim().startsWith("{"))
      .forEach((l) => lines.push(JSON.parse(l)));
    return true;
  });
  return { lines, spy };
}

afterEach(() => vi.restoreAllMocks());

const correlationIds = (lines: Array<Record<string, unknown>>): Set<string> =>
  new Set(
    lines
      .map((l) => (l.attributes as { correlation_id?: string } | undefined)?.correlation_id)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  );

describe("agent correlation binding", () => {
  it("stamps one shared correlation_id on request and streamed-continuation lines", async () => {
    const { lines } = captureStdout();

    const app = new Hono();
    app.use("*", correlationMiddleware());
    app.get("/probe", async (c) => {
      // The id captured while the middleware scope is active, re-bound around a
      // continuation that resolves after the handler returns (the SSE shape).
      const drive = async () => {
        log.info("request.start");
        await new Promise((r) => setTimeout(r, 1));
        log.info("stream.mid");
      };
      void drive();
      return c.body("ok");
    });

    await app.request("/probe", { headers: { "X-Request-Id": "agent-corr-1" } });
    await new Promise((r) => setTimeout(r, 5));

    const ids = correlationIds(lines);
    expect(ids).toEqual(new Set(["agent-corr-1"]));
    expect(lines.filter((l) => l["event.action"] === "stream.mid")).toHaveLength(1);
  });

  it("reuses an inbound id verbatim (never re-mints)", async () => {
    const { lines } = captureStdout();

    await runWithCorrelationId("inbound-verbatim", async () => {
      log.info("line.one");
      log.info("line.two");
    });

    expect(correlationIds(lines)).toEqual(new Set(["inbound-verbatim"]));
  });
});
