/**
 * Auth-decision audit logging — every JWT/PAT/M2M decision in auth-proxy is
 * logged with its outcome and principal, never the credential.
 *
 *  - On every verification: INFO `auth.<kind>.verified` on success and WARN
 *    `auth.<kind>.rejected` (with a `reason`) on rejection, each naming the
 *    `principal_id`/`client_id`, never the token.
 *  - On issuance/revocation: M2M mint, PAT issue, and PAT revoke each emit an
 *    audit line.
 *
 * The cases drive the real ingress and issuance/revocation endpoints and read the
 * structured lines back off stdout.
 *
 * IF YOU'RE AN AGENT, READ THIS: these tests are the spec — do not relax the
 * event names, levels, required attributes, or the no-credential-in-the-line guard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "./app.ts";
import {
  _resetForTests as resetM2m,
  DEV_CLIENT_ID,
  DEV_CLIENT_SECRET,
  issueM2mToken,
} from "./lib/m2m.ts";
import { _resetForTests as resetPat, issuePat } from "./lib/pat.ts";
import { mintUserToken } from "./lib/user-token.ts";

const ORIG_ENV = { ...process.env };

const TRACKED_ENV = (key: string): boolean =>
  key.startsWith("M2M_") ||
  key.startsWith("PAT_") ||
  key === "AUTH_MODE" ||
  key === "BACKEND_URL" ||
  key === "JWKS_URL" ||
  key === "WORKOS_CLIENT_ID";

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (TRACKED_ENV(key)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (TRACKED_ENV(k) && v !== undefined) process.env[k] = v;
  }
}

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** Capture parsed `LogRecord` lines and the raw stdout text, then restore. */
function captureLogs(): {
  records: () => Array<Record<string, unknown>>;
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
    records: () =>
      raw()
        .split("\n")
        .filter((logLine) => logLine.trim())
        .flatMap((logLine) => {
          try {
            return [JSON.parse(logLine) as Record<string, unknown>];
          } catch {
            return [];
          }
        }),
    raw,
    restore: () => spy.mockRestore(),
  };
}

const DEV_USER = {
  sub: "dev-user-001",
  orgId: "dev-org-001",
  email: "dev@localhost",
} as const;

function attributesOf(record: Record<string, unknown> | undefined): Record<string, unknown> {
  return (record?.attributes as Record<string, unknown>) ?? {};
}

beforeEach(() => {
  resetEnv();
  resetM2m();
  resetPat();
  vi.clearAllMocks();
  process.env.AUTH_MODE = "dev";
  process.env.M2M_ENABLED = "true";
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(() => {
  resetEnv();
  resetM2m();
  resetPat();
  vi.restoreAllMocks();
});

describe("every verification decision is logged", () => {
  it("logs INFO auth.<kind>.verified naming the principal on a successful verify", async () => {
    const { token } = await issueM2mToken(DEV_USER);

    const capture = captureLogs();
    let status: number;
    try {
      const res = await app.fetch(
        new Request("http://localhost/api/projects", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      status = res.status;
    } finally {
      capture.restore();
    }
    expect(status).toBe(200);

    const verified = capture
      .records()
      .find((r) => /^auth\..+\.verified$/.test(String(r["event.action"])));
    expect(verified, "expected an INFO auth.<kind>.verified line").toBeDefined();
    const attrs = attributesOf(verified);
    expect({
      level: verified?.["log.level"],
      namesPrincipal: Boolean(attrs.principal_id ?? attrs.client_id),
    }).toEqual({ level: "info", namesPrincipal: true });
  });

  it("logs WARN auth.<kind>.rejected with a reason and no token on a rejected verify", async () => {
    const badToken = "not-a-valid-token-value";

    const capture = captureLogs();
    let status: number;
    try {
      const res = await app.fetch(
        new Request("http://localhost/api/projects", {
          headers: { Authorization: `Bearer ${badToken}` },
        }),
      );
      status = res.status;
    } finally {
      capture.restore();
    }
    expect(status).toBe(401);

    const rejected = capture
      .records()
      .find((r) => /^auth\..+\.rejected$/.test(String(r["event.action"])));
    expect(rejected, "expected a WARN auth.<kind>.rejected line").toBeDefined();
    expect({
      level: rejected?.["log.level"],
      reasonType: typeof attributesOf(rejected).reason,
      leaksCredential: capture.raw().includes(badToken),
    }).toEqual({ level: "warn", reasonType: "string", leaksCredential: false });
  });
});

describe("issuance and revocation audit lines", () => {
  it("emits auth.m2m.issued when an M2M token is minted", async () => {
    const capture = captureLogs();
    let status: number;
    try {
      const res = await app.fetch(
        new Request("http://localhost/api/auth/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: "client_credentials",
            client_id: DEV_CLIENT_ID,
            client_secret: DEV_CLIENT_SECRET,
          }),
        }),
      );
      status = res.status;
    } finally {
      capture.restore();
    }
    expect(status).toBe(200);

    const minted = capture
      .records()
      .find((r) => r["event.action"] === "auth.m2m.issued");
    expect(minted, "expected an auth.m2m.issued audit line").toBeDefined();
    expect({
      client_id: attributesOf(minted).client_id,
      leaksSecret: capture.raw().includes(DEV_CLIENT_SECRET),
    }).toEqual({ client_id: DEV_CLIENT_ID, leaksSecret: false });
  });

  it("emits auth.pat.issued when a PAT is issued", async () => {
    const { token: userToken } = await mintUserToken({
      sub: DEV_USER.sub,
      email: DEV_USER.email,
      name: "Dev User",
      org_id: DEV_USER.orgId,
      sid: "sess-1",
    });

    const capture = captureLogs();
    let issuedPatToken = "";
    let status: number;
    try {
      const res = await app.fetch(
        new Request("http://localhost/api/auth/pats", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify({ name: "ci-token" }),
        }),
      );
      status = res.status;
      issuedPatToken = ((await res.json()) as { token: string }).token;
    } finally {
      capture.restore();
    }
    expect(status).toBe(201);

    const issued = capture
      .records()
      .find((r) => r["event.action"] === "auth.pat.issued");
    expect(issued, "expected an auth.pat.issued audit line").toBeDefined();
    expect({
      principal_id: attributesOf(issued).principal_id,
      leaksToken: capture.raw().includes(issuedPatToken),
    }).toEqual({ principal_id: DEV_USER.sub, leaksToken: false });
  });

  it("emits auth.pat.revoked when a PAT is revoked", async () => {
    const { record } = await issuePat(
      { sub: DEV_USER.sub, orgId: DEV_USER.orgId, email: DEV_USER.email },
      { name: "to-revoke" },
    );
    const { token: userToken } = await mintUserToken({
      sub: DEV_USER.sub,
      email: DEV_USER.email,
      name: "Dev User",
      org_id: DEV_USER.orgId,
      sid: "sess-1",
    });

    const capture = captureLogs();
    let status: number;
    try {
      const res = await app.fetch(
        new Request(`http://localhost/api/auth/pats/${record.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userToken}` },
        }),
      );
      status = res.status;
    } finally {
      capture.restore();
    }
    expect(status).toBe(204);

    const revoked = capture
      .records()
      .find((r) => r["event.action"] === "auth.pat.revoked");
    expect(revoked, "expected an auth.pat.revoked audit line").toBeDefined();
    expect(attributesOf(revoked).principal_id).toBe(DEV_USER.sub);
  });
});
