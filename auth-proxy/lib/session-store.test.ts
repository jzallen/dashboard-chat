/**
 * Tests for `auth-proxy/lib/session-store.ts`.
 *
 * The session store holds the WorkOS `refresh_token` server-side keyed by a
 * `sid` claim, so the FE never sees it. Persistence is opt-in via
 * `SESSION_STORE_PATH`: in-memory only when unset, JSONL append-only when set
 * (last-write-wins on replay, mirrors `lib/pat.ts`). Restart-survival is the
 * load-bearing property — without it, a deploy could silently lose every
 * active session.
 *
 * Payload shape: `{ workos_refresh_token: string, expires_at: number,
 * user_claims: { sub, email, name, org_id } }`.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetForTests,
  deleteSession,
  getSession,
  getSessionStatus,
  setSession,
} from "./session-store.ts";

const ORIG_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (key === "SESSION_STORE_PATH") delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (k === "SESSION_STORE_PATH" && v !== undefined) process.env[k] = v;
  }
}

beforeEach(() => {
  resetEnv();
  _resetForTests();
});

afterEach(() => {
  resetEnv();
  _resetForTests();
});

const VALID_PAYLOAD = {
  workos_refresh_token: "wos-r-abc",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user_claims: {
    sub: "user-1",
    email: "u@example.com",
    name: "U",
    org_id: "org-1",
  },
};

describe("session-store — set/get round trip", () => {
  it("get(sid) returns the same payload that set(sid, payload) stored", () => {
    setSession("sid-1", VALID_PAYLOAD);
    expect(getSession("sid-1")).toEqual(VALID_PAYLOAD);
  });

  it("get(sid) returns null for a sid that was never set", () => {
    expect(getSession("never-set")).toBeNull();
  });

  it("get(sid) returns null after delete(sid)", () => {
    setSession("sid-1", VALID_PAYLOAD);
    deleteSession("sid-1");
    expect(getSession("sid-1")).toBeNull();
  });

  it("delete(sid) on a never-set sid does not throw and leaves the store empty", () => {
    expect(() => deleteSession("never-set")).not.toThrow();
    expect(getSession("never-set")).toBeNull();
  });

  it("re-set(sid) replaces the prior payload", () => {
    const p1 = VALID_PAYLOAD;
    const p2 = {
      workos_refresh_token: "wos-r-xyz",
      expires_at: Math.floor(Date.now() / 1000) + 7200,
      user_claims: {
        sub: "user-2",
        email: "v@example.com",
        name: "V",
        org_id: "org-2",
      },
    };
    setSession("sid-1", p1);
    setSession("sid-1", p2);
    expect(getSession("sid-1")).toEqual(p2);
  });
});

describe("session-store — expired sessions", () => {
  function expiredPayload() {
    return {
      workos_refresh_token: "wos-r-secret",
      expires_at: Math.floor(Date.now() / 1000) - 60,
      user_claims: {
        sub: "user-1",
        email: "u@example.com",
        name: "U",
        org_id: "org-1",
      },
    };
  }

  it("get(sid) returns null when the session is expired", () => {
    setSession("sid-1", expiredPayload());
    expect(getSession("sid-1")).toBeNull();
  });

  it("getSessionStatus reports 'expired' without returning the refresh_token", () => {
    setSession("sid-1", expiredPayload());
    const lookup = getSessionStatus("sid-1");
    expect(lookup).toEqual({ status: "expired" });
  });
});

describe("session-store — JSONL persistence", () => {
  let dir: string;
  let storePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-store-"));
    storePath = join(dir, "sessions.jsonl");
    process.env.SESSION_STORE_PATH = storePath;
    _resetForTests();
  });

  afterEach(() => {
    delete process.env.SESSION_STORE_PATH;
    _resetForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("non-existent SESSION_STORE_PATH file: get returns null and first set creates it", () => {
    expect(existsSync(storePath)).toBe(false);
    expect(getSession("never-set")).toBeNull();
    expect(existsSync(storePath)).toBe(false);
    setSession("sid-1", VALID_PAYLOAD);
    expect(existsSync(storePath)).toBe(true);
  });

  it("malformed JSONL line is skipped while valid entries remain retrievable", () => {
    const validLine = JSON.stringify({
      op: "set",
      sid: "sid-1",
      payload: VALID_PAYLOAD,
    });
    writeFileSync(storePath, `${validLine}\n{not-json\n`, "utf8");
    expect(getSession("sid-1")).toEqual(VALID_PAYLOAD);
  });

  it("sequential sets append three parseable lines, each retrievable", () => {
    setSession("sid-1", VALID_PAYLOAD);
    setSession("sid-2", VALID_PAYLOAD);
    setSession("sid-3", VALID_PAYLOAD);

    const lines = readFileSync(storePath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(getSession("sid-1")).toEqual(VALID_PAYLOAD);
    expect(getSession("sid-2")).toEqual(VALID_PAYLOAD);
    expect(getSession("sid-3")).toEqual(VALID_PAYLOAD);
  });

  it("session survives a simulated restart when SESSION_STORE_PATH is set", () => {
    setSession("sid-1", VALID_PAYLOAD);
    _resetForTests();
    expect(getSession("sid-1")).toEqual(VALID_PAYLOAD);
  });

  it("delete tombstones survive a simulated restart", () => {
    setSession("sid-1", VALID_PAYLOAD);
    deleteSession("sid-1");
    _resetForTests();
    expect(getSession("sid-1")).toBeNull();
  });
});

describe("session-store — no persistence without SESSION_STORE_PATH", () => {
  beforeEach(() => {
    delete process.env.SESSION_STORE_PATH;
    _resetForTests();
  });

  afterEach(() => {
    _resetForTests();
  });

  it("set then simulated restart loses the entry when env is unset", () => {
    setSession("sid-1", VALID_PAYLOAD);
    expect(getSession("sid-1")).toEqual(VALID_PAYLOAD);
    _resetForTests();
    expect(getSession("sid-1")).toBeNull();
  });
});

describe("session-store — multi-replica via shared SESSION_STORE_PATH", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-store-"));
    process.env.SESSION_STORE_PATH = join(dir, "sessions.jsonl");
    _resetForTests();
  });

  afterEach(() => {
    delete process.env.SESSION_STORE_PATH;
    _resetForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("two instances sharing a path see each other's writes", () => {
    const payloadA = VALID_PAYLOAD;
    const payloadB = {
      workos_refresh_token: "wos-r-bbb",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user_claims: {
        sub: "user-b",
        email: "b@example.com",
        name: "B",
        org_id: "org-b",
      },
    };

    // Instance A writes sid-A.
    setSession("sid-A", payloadA);

    // Instance B boots fresh (in-memory cleared, store reload required)
    // and writes sid-B. The load it does before writing should make A's
    // entry visible too.
    _resetForTests();
    setSession("sid-B", payloadB);
    expect(getSession("sid-A")).toEqual(payloadA);
    expect(getSession("sid-B")).toEqual(payloadB);

    // A third instance boots and observes both.
    _resetForTests();
    expect(getSession("sid-A")).toEqual(payloadA);
    expect(getSession("sid-B")).toEqual(payloadB);
  });

  it("concurrent writes on different sids leave the JSONL parseable", async () => {
    const N = 25;
    const sids = Array.from({ length: N }, (_, i) => `sid-${i}`);

    await Promise.all(
      sids.map((sid) => Promise.resolve().then(() => setSession(sid, VALID_PAYLOAD))),
    );

    const storePath = process.env.SESSION_STORE_PATH as string;
    const lines = readFileSync(storePath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(N);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    _resetForTests();
    for (const sid of sids) {
      expect(getSession(sid)).toEqual(VALID_PAYLOAD);
    }
  });
});
