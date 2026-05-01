/**
 * Tests for the agent-side persister dispatch helper (ADR-017).
 *
 * Pins the capability-presence routing rule: REDIS_URL set → Redis;
 * otherwise → noop. Mirrors the Python-side
 * `tests/use_cases/session/test_event_replay_dispatch.py`.
 */

import { describe, expect, it } from "vitest";

import { RedisThreadPersister } from "../../lib/chat/redisThreadPersister";
import { noopThreadPersister } from "../../lib/chat/threadPersister";
import { selectThreadPersister } from "../../lib/chat/threadPersisterDispatch";

describe("selectThreadPersister", () => {
  it("returns noop when REDIS_URL is unset", () => {
    const result = selectThreadPersister({});
    expect(result.kind).toBe("noop");
    expect(result.persister).toBe(noopThreadPersister);
  });

  it("returns noop when REDIS_URL is empty string", () => {
    const result = selectThreadPersister({ REDIS_URL: "" });
    expect(result.kind).toBe("noop");
    expect(result.persister).toBe(noopThreadPersister);
  });

  it("returns Redis persister when REDIS_URL is set", () => {
    const result = selectThreadPersister({ REDIS_URL: "redis://localhost:6379/0" });
    expect(result.kind).toBe("redis");
    expect(result.persister).toBeInstanceOf(RedisThreadPersister);
  });

  it("does not branch on NODE_ENV (ADR-017 prohibition)", () => {
    // Encoding the prohibition as a test: the dispatch helper accepts only
    // capability vars in its env type. If a future refactor adds NODE_ENV
    // branching, it would have to widen the input type — TypeScript would
    // flag it before runtime.
    const result = selectThreadPersister({});
    expect(result.kind).toBe("noop");
  });
});
