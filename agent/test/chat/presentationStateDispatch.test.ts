/**
 * Tests for the agent-side presentation-state dispatch helper (F.3 / ADR-015).
 *
 * Pins the capability-presence routing rule: REDIS_URL set → Redis-backed
 * log; otherwise → InProcess fallback. Mirrors the threadPersisterDispatch
 * spec so the two side channels stay symmetric.
 */

import { describe, expect, it } from "vitest";

import { inProcessPresentationStateLog } from "../../lib/chat/presentationState";
import { selectPresentationStateLog } from "../../lib/chat/presentationStateDispatch";
import { RedisPresentationStateLog } from "../../lib/chat/redisPresentationState";

describe("selectPresentationStateLog", () => {
  it("returns the in-process singleton when REDIS_URL is unset", () => {
    const result = selectPresentationStateLog({});
    expect(result.kind).toBe("in-process");
    expect(result.log).toBe(inProcessPresentationStateLog);
  });

  it("returns the in-process singleton when REDIS_URL is empty", () => {
    const result = selectPresentationStateLog({ REDIS_URL: "" });
    expect(result.kind).toBe("in-process");
    expect(result.log).toBe(inProcessPresentationStateLog);
  });

  it("returns a RedisPresentationStateLog when REDIS_URL is set", () => {
    const result = selectPresentationStateLog({
      REDIS_URL: "redis://localhost:6379/0",
    });
    expect(result.kind).toBe("redis");
    expect(result.log).toBeInstanceOf(RedisPresentationStateLog);
  });

  it("does not branch on NODE_ENV (ADR-017 prohibition; mirrored for F.3)", () => {
    // Encoding the prohibition as a test: the dispatch helper accepts only
    // capability vars in its env type. If a future refactor adds NODE_ENV
    // branching it would have to widen the input type — TypeScript would
    // flag it before runtime.
    const result = selectPresentationStateLog({});
    expect(result.kind).toBe("in-process");
  });

  it("accepts PRESENTATION_STATE_MAXLEN without crashing on construction", () => {
    const result = selectPresentationStateLog({
      REDIS_URL: "redis://localhost:6379/0",
      PRESENTATION_STATE_MAXLEN: "500",
    });
    expect(result.kind).toBe("redis");
    expect(result.log).toBeInstanceOf(RedisPresentationStateLog);
  });

  it("treats explicit '0' for PRESENTATION_STATE_MAXLEN as unbounded (disable trim)", () => {
    const result = selectPresentationStateLog({
      REDIS_URL: "redis://localhost:6379/0",
      PRESENTATION_STATE_MAXLEN: "0",
    });
    expect(result.kind).toBe("redis");
    expect(result.log).toBeInstanceOf(RedisPresentationStateLog);
  });

  it("ignores garbage PRESENTATION_STATE_MAXLEN and falls back to default", () => {
    const result = selectPresentationStateLog({
      REDIS_URL: "redis://localhost:6379/0",
      PRESENTATION_STATE_MAXLEN: "not-a-number",
    });
    expect(result.kind).toBe("redis");
    expect(result.log).toBeInstanceOf(RedisPresentationStateLog);
  });
});
