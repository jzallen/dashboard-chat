// Unit tests for the auth-proxy KPI K3 event emission on the
// /flow-state/* proxied surface. Per ADR-030 §SD4 the auth-proxy emits
// three JSON events to stdout when it observes flow-state transitions:
//
//   - auth_recoverable_error_shown  — upstream returned state=error_recoverable
//   - auth_retry_clicked            — caller forwarded a retry_clicked event
//   - ready_reached                 — upstream returned state=ready
//
// Each event carries the correlation_id from the projection envelope and
// the underlying_cause_tag where relevant.
//
// Behavior budget for this file (B4): 1 behavior × 2 = 2 tests max.
// Variations of the same behavior are parametrized.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock jose before importing app (no JWT verification needed for dev-mode
// flow-state path; AUTH_MODE defaults to "dev").
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import { app } from "./app.ts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeRequest(path: string, init: RequestInit = {}) {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

interface CapturedEvent {
  event: string;
  correlation_id?: string;
  underlying_cause_tag?: string;
}

function captureStdout(): {
  events: CapturedEvent[];
  restore: () => void;
} {
  const events: CapturedEvent[] = [];
  const real = process.stdout.write.bind(process.stdout);
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      const text = typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as CapturedEvent;
          if (typeof parsed.event === "string") {
            events.push(parsed);
          }
        } catch {
          // Not our JSON line — ignore (e.g. server startup logs).
        }
      }
      return true;
    });
  return {
    events,
    restore: () => {
      spy.mockRestore();
      void real;
    },
  };
}

describe("KPI K3 event emission on /flow-state/* (B4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_MODE = "dev";
  });

  it.each<[string, Record<string, unknown>, string, string | undefined]>([
    [
      "auth_recoverable_error_shown",
      {
        state: "error_recoverable",
        correlation_id: "R-7a4f-901c",
        context: { underlying_cause_tag: "partial-setup" },
      },
      "/flow-state/flow/login-and-org-setup/begin",
      "partial-setup",
    ],
    [
      "ready_reached",
      {
        state: "ready",
        correlation_id: "R-7a4f-901c",
        context: {},
      },
      "/flow-state/flow/login-and-org-setup/event",
      undefined,
    ],
  ])(
    "emits %s on matching upstream response",
    async (expectedEventName, upstreamBody, path, expectedTag) => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(upstreamBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const capture = captureStdout();
      try {
        const res = await makeRequest(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ persona_email: "maya@x" }),
        });
        expect(res.status).toBe(200);
      } finally {
        capture.restore();
      }

      const matching = capture.events.find(
        (e) => e.event === expectedEventName,
      );
      expect(matching).toBeDefined();
      expect(matching?.correlation_id).toBe("R-7a4f-901c");
      if (expectedTag) {
        expect(matching?.underlying_cause_tag).toBe(expectedTag);
      }
    },
  );

  // ------------------------------------------------------------------------
  // Step 03-01 — silent reauth KPI events (US-005)
  // ------------------------------------------------------------------------
  //
  // The auth-proxy observes the projection coming back from the flow-state
  // tier and emits an additional pair of KPI events for the silent-reauth
  // outcome:
  //   - state === "ready"             AND context.silent_reauth_ok === true
  //       → silent_reauth_ok
  //   - state === "error_recoverable" AND context.underlying_cause_tag
  //                                       === "silent-reauth-failed"
  //       → silent_reauth_failed
  //
  // Behavior budget extension: B5 (ok) + B6 (failed) = 2 behaviors × 2 = 4 tests max.

  it("emits silent_reauth_ok when projection returns ready with silent_reauth_ok flag", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          state: "ready",
          correlation_id: "R-chat-9b2a",
          context: { silent_reauth_ok: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const capture = captureStdout();
    try {
      const res = await makeRequest(
        "/flow-state/flow/login-and-org-setup/event",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ flow_id: "f-1", type: "THAW" }),
        },
      );
      expect(res.status).toBe(200);
    } finally {
      capture.restore();
    }
    const matching = capture.events.find((e) => e.event === "silent_reauth_ok");
    expect(matching).toBeDefined();
    expect(matching?.correlation_id).toBe("R-chat-9b2a");
  });

  it("emits silent_reauth_failed when projection returns error_recoverable with silent-reauth-failed tag", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          state: "error_recoverable",
          correlation_id: "R-chat-9b2a",
          context: { underlying_cause_tag: "silent-reauth-failed" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const capture = captureStdout();
    try {
      const res = await makeRequest(
        "/flow-state/flow/login-and-org-setup/event",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ flow_id: "f-1", type: "THAW" }),
        },
      );
      expect(res.status).toBe(200);
    } finally {
      capture.restore();
    }
    const matching = capture.events.find(
      (e) => e.event === "silent_reauth_failed",
    );
    expect(matching).toBeDefined();
    expect(matching?.correlation_id).toBe("R-chat-9b2a");
    expect(matching?.underlying_cause_tag).toBe("silent-reauth-failed");
  });

  it("emits auth_retry_clicked when caller forwards a retry_clicked event", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          state: "creating_org",
          correlation_id: "R-7a4f-901c",
          context: {},
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const capture = captureStdout();
    try {
      const res = await makeRequest(
        "/flow-state/flow/login-and-org-setup/event",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            flow_id: "f-1",
            type: "retry_clicked",
          }),
        },
      );
      expect(res.status).toBe(200);
    } finally {
      capture.restore();
    }

    const matching = capture.events.find((e) => e.event === "auth_retry_clicked");
    expect(matching).toBeDefined();
    expect(matching?.correlation_id).toBe("R-7a4f-901c");
  });
});
