/**
 * Test plan — `DevUserAuthProvider`
 *
 * Source under test: `auth-proxy/lib/user-auth/dev.ts`
 *
 * The dev-mode user-auth provider. Mints user tokens from env vars
 * (`DEV_USER_ID`, `DEV_USER_EMAIL`, `DEV_USER_NAME`, `DEV_ORG_ID`) with no
 * network call to WorkOS — the whole reason this provider exists is to keep
 * dev cycles fast and off WorkOS's audit log (per the user's framing during
 * design discussion). Port of the behavior at `backend/app/auth/dev_provider.py`
 * (which is deleted in Stage 3b).
 *
 * Fixture identity per CLAUDE.md:
 * - Default token: `dev-token-static`
 * - Default user: `dev-user-001`
 * - Default org: `dev-org-001`
 *
 * All 9 rows of the original test plan are landed. The describe blocks
 * below pin the implemented behaviour; the git log carries the row-by-row
 * narrative.
 *
 * **Notes for the agent:**
 * - This file does NOT exercise the HTTP layer — that's `auth-proxy/user-token-issuance.test.ts`. Test the provider class directly.
 * - Inject a session-store double (in-memory) when constructing the provider. Don't write the JSONL file from this test file.
 * - Env-reset pattern: copy from `m2m.test.ts:23-25`. Reset `DEV_USER_*` and `AUTH_MODE` between tests.
 */

import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetKeypairForTests } from "../keypair.ts";
import type {
  SessionLookup,
  SessionPayload,
  SessionUserClaims,
} from "../session-store.ts";
import { createDevProvider, DevUserAuthProvider } from "./dev.ts";

const FIXTURE_IDENTITY: SessionUserClaims = {
  sub: "dev-user-001",
  email: "dev@localhost",
  name: "Dev User",
  org_id: "dev-org-001",
};

interface InMemorySessionStore {
  set(sid: string, payload: SessionPayload): void;
  get(sid: string): SessionPayload | null;
  getStatus(sid: string): SessionLookup;
  delete(sid: string): boolean;
  _all(): Map<string, SessionPayload>;
}

function createInMemorySessionStore(): InMemorySessionStore {
  const map = new Map<string, SessionPayload>();
  return {
    set(sid, payload) {
      map.set(sid, payload);
    },
    get(sid) {
      const entry = map.get(sid);
      if (!entry) return null;
      if (entry.expires_at < Math.floor(Date.now() / 1000)) {
        map.delete(sid);
        return null;
      }
      return entry;
    },
    getStatus(sid) {
      const entry = map.get(sid);
      if (!entry) return { status: "missing" };
      if (entry.expires_at < Math.floor(Date.now() / 1000)) {
        map.delete(sid);
        return { status: "expired" };
      }
      return { status: "valid", payload: entry };
    },
    delete(sid) {
      return map.delete(sid);
    },
    _all() {
      return new Map(map);
    },
  };
}

const ORIG_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith("DEV_USER_") ||
      key === "DEV_ORG_ID" ||
      key === "AUTH_MODE" ||
      key === "AUTH_PROXY_KEYPAIR_PATH"
    ) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (
      k.startsWith("DEV_USER_") ||
      k === "DEV_ORG_ID" ||
      k === "AUTH_MODE" ||
      k === "AUTH_PROXY_KEYPAIR_PATH"
    ) {
      if (v !== undefined) process.env[k] = v;
    }
  }
}

beforeEach(() => {
  resetEnv();
  _resetKeypairForTests();
});

afterEach(() => {
  resetEnv();
  _resetKeypairForTests();
});

const NOW_SEC = 1_700_000_000;

async function withFrozenTime<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_SEC * 1000);
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

describe("DevUserAuthProvider", () => {
  describe("handleCallback", () => {
    it("mints a user-token JWT for the standard dev auth code", async () => {
      const provider = new DevUserAuthProvider({
        sessionStore: createInMemorySessionStore(),
        config: {
          authMode: "dev",
          userIdentity: FIXTURE_IDENTITY,
        },
      });

      const result = await provider.handleCallback({
        code: "dev-auth-code",
        state: "any",
      });

      expect(result).toEqual({
        accessToken: expect.any(String),
        sid: expect.any(String),
        expiresIn: expect.any(Number),
      });
      expect(result.accessToken.split(".")).toHaveLength(3);
      expect(decodeProtectedHeader(result.accessToken).kid).toBe(
        "auth-proxy:user:1",
      );
    });

    it("rejects auth codes other than the dev fixture", async () => {
      const sessionStore = createInMemorySessionStore();
      const provider = new DevUserAuthProvider({
        sessionStore,
        config: {
          authMode: "dev",
          userIdentity: FIXTURE_IDENTITY,
        },
      });

      await expect(
        provider.handleCallback({ code: "not-the-dev-code", state: "any" }),
      ).rejects.toThrow("invalid_code");
      expect(sessionStore._all().size).toBe(0);
    });

    it("refuses to mint when AUTH_MODE is not dev", async () => {
      const sessionStore = createInMemorySessionStore();
      const provider = new DevUserAuthProvider({
        sessionStore,
        config: {
          authMode: "workos",
          userIdentity: FIXTURE_IDENTITY,
        },
      });

      await expect(
        provider.handleCallback({ code: "dev-auth-code", state: "any" }),
      ).rejects.toThrow("dev_provider_inactive");
      expect(sessionStore._all().size).toBe(0);
    });
  });

  describe("identity resolution via createDevProvider", () => {
    it("uses DEV_USER_* / DEV_ORG_ID env vars when present", async () => {
      process.env.AUTH_MODE = "dev";
      process.env.DEV_USER_ID = "alice-007";
      process.env.DEV_USER_EMAIL = "alice@dev";
      process.env.DEV_USER_NAME = "Alice";
      process.env.DEV_ORG_ID = "org-alice";

      const provider = createDevProvider({
        sessionStore: createInMemorySessionStore(),
      });
      const { accessToken } = await provider.handleCallback({
        code: "dev-auth-code",
        state: "any",
      });

      const { sub, email, name, org_id } = decodeJwt(accessToken);
      expect({ sub, email, name, org_id }).toEqual({
        sub: "alice-007",
        email: "alice@dev",
        name: "Alice",
        org_id: "org-alice",
      });
    });

    it("falls back to the CLAUDE.md fixture identity when no DEV_* env vars are set", async () => {
      process.env.AUTH_MODE = "dev";

      const provider = createDevProvider({
        sessionStore: createInMemorySessionStore(),
      });
      const { accessToken } = await provider.handleCallback({
        code: "dev-auth-code",
        state: "any",
      });

      const { sub, email, name, org_id } = decodeJwt(accessToken);
      expect({ sub, email, name, org_id }).toEqual({
        sub: "dev-user-001",
        email: "dev@localhost",
        name: "Dev User",
        org_id: "dev-org-001",
      });
    });
  });

  describe("refresh", () => {
    it("rotates the stored refresh credential on each call", async () => {
      const sessionStore = createInMemorySessionStore();
      const provider = new DevUserAuthProvider({
        sessionStore,
        config: { authMode: "dev", userIdentity: FIXTURE_IDENTITY },
      });

      const { sid } = await provider.handleCallback({
        code: "dev-auth-code",
        state: "any",
      });
      const initial = sessionStore.get(sid)!.workos_refresh_token;

      await provider.refresh(sid);
      const afterFirst = sessionStore.get(sid)!.workos_refresh_token;

      await provider.refresh(sid);
      const afterSecond = sessionStore.get(sid)!.workos_refresh_token;

      expect(afterFirst).not.toBe(initial);
      expect(afterSecond).not.toBe(afterFirst);
    });

    it("updates the session-store entry with the post-refresh state", async () => {
      await withFrozenTime(async () => {
        const sessionStore = createInMemorySessionStore();
        const provider = new DevUserAuthProvider({
          sessionStore,
          config: { authMode: "dev", userIdentity: FIXTURE_IDENTITY },
        });

        const { sid } = await provider.handleCallback({
          code: "dev-auth-code",
          state: "any",
        });
        const { expiresIn } = await provider.refresh(sid);

        expect(sessionStore.get(sid)).toEqual({
          workos_refresh_token: expect.stringMatching(/^dev-refresh-token-/),
          expires_at: NOW_SEC + expiresIn,
          user_claims: FIXTURE_IDENTITY,
        });
      });
    });
  });

  describe("logout", () => {
    it("deletes the session-store entry for the sid", async () => {
      const sessionStore = createInMemorySessionStore();
      const provider = new DevUserAuthProvider({
        sessionStore,
        config: { authMode: "dev", userIdentity: FIXTURE_IDENTITY },
      });

      const { sid } = await provider.handleCallback({
        code: "dev-auth-code",
        state: "any",
      });
      expect(sessionStore.get(sid)).not.toBeNull();

      await provider.logout(sid);

      expect(sessionStore.get(sid)).toBeNull();
    });

    it("is a no-op on an unknown sid and on a second call", async () => {
      const sessionStore = createInMemorySessionStore();
      const provider = new DevUserAuthProvider({
        sessionStore,
        config: { authMode: "dev", userIdentity: FIXTURE_IDENTITY },
      });

      await expect(provider.logout("never-existed")).resolves.toBeUndefined();

      const { sid } = await provider.handleCallback({
        code: "dev-auth-code",
        state: "any",
      });
      await provider.logout(sid);
      await expect(provider.logout(sid)).resolves.toBeUndefined();
      expect(sessionStore.get(sid)).toBeNull();
    });
  });
});
