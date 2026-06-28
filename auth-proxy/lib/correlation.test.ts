import { getCorrelationId } from "@dashboard-chat/correlation-id";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { correlationMiddleware, resolveCorrelationId } from "./correlation.ts";

const headers = (entries: Record<string, string>) =>
  new Headers(entries) as { get(name: string): string | null };

describe("resolveCorrelationId — mint-once predicate", () => {
  it("reuses an inbound X-Request-Id verbatim (present → reuse)", () => {
    const { id, minted } = resolveCorrelationId(headers({ "X-Request-Id": "inbound-123" }));

    expect(id).toBe("inbound-123");
    expect(minted).toBe(false);
  });

  it("falls back to X-Correlation-Id when X-Request-Id is absent", () => {
    const { id, minted } = resolveCorrelationId(headers({ "X-Correlation-Id": "corr-xyz" }));

    expect(id).toBe("corr-xyz");
    expect(minted).toBe(false);
  });

  it("mints a fresh id when neither header is present (absent → mint)", () => {
    const { id, minted } = resolveCorrelationId(headers({}));

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(minted).toBe(true);
  });
});

describe("correlationMiddleware — binds the id for the request", () => {
  it("binds an inbound id so handlers read it from the ambient store", async () => {
    const app = new Hono();
    app.use("*", correlationMiddleware);
    app.get("/probe", (c) => c.json({ bound: getCorrelationId() }));

    const res = await app.request("/probe", {
      headers: { "X-Request-Id": "req-from-client" },
    });

    expect(await res.json()).toEqual({ bound: "req-from-client" });
  });

  it("binds a freshly-minted id when the request carries none", async () => {
    const app = new Hono();
    app.use("*", correlationMiddleware);
    app.get("/probe", (c) => c.json({ bound: getCorrelationId() }));

    const res = await app.request("/probe");
    const { bound } = (await res.json()) as { bound: string };

    expect(bound).toMatch(/^[0-9a-f-]{36}$/);
  });
});
