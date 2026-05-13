// Unit tests for agent/lib/chat/scope.ts — DWD-3 X-Active-Scope contract.
//
// Coverage map (US-208 + IC-J002-7 + DWD-3):
//   B1 — well-formed header → ok, no fallback.
//   B2 — header missing org_id → 400 with named diagnostic.
//   B3 — header missing project_id → 400 with named diagnostic.
//   B4 — header.org_id !== X-Org-Id → 403 (defense in depth).
//   B5 — malformed header (not JSON) → 400.
//   B6 — header absent + flag enabled + body.project_id → fallback ok.
//   B7 — header absent + flag enabled + body.project_id + body.contextType →
//        scope.resource_type populated.
//   B8 — header absent + flag disabled → 400 (post-sunset shape).
//   B9 — header absent + flag enabled but body missing project_id → 400.
//   S1 — assertScopeHeaderFallbackSunset: flag off → no-op (always).
//   S2 — flag on, now < sunset → no-op.
//   S3 — flag on, now > sunset → throws.

import { describe, expect, it } from "vitest";

import {
  assertScopeHeaderFallbackSunset,
  buildScopeHeaderFallbackEvent,
  extractActiveScope,
  SCOPE_HEADER_FALLBACK_SUNSET,
} from "./scope.ts";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://agent.local/chat", {
    method: "POST",
    headers,
  });
}

describe("extractActiveScope — header path", () => {
  it("B1: well-formed header is accepted without fallback", () => {
    const req = makeRequest({
      "x-active-scope": JSON.stringify({
        org_id: "dev-org-001",
        project_id: "p-q4",
        resource_type: "dataset",
        resource_id: "ds-1",
      }),
      "x-org-id": "dev-org-001",
    });
    const result = extractActiveScope(req, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope.org_id).toBe("dev-org-001");
    expect(result.scope.project_id).toBe("p-q4");
    expect(result.scope.resource_type).toBe("dataset");
    expect(result.scope.resource_id).toBe("ds-1");
    expect(result.used_body_fallback).toBe(false);
  });

  it("B2: header missing org_id → 400 with named diagnostic", () => {
    const req = makeRequest({
      "x-active-scope": JSON.stringify({ project_id: "p-q4" }),
    });
    const result = extractActiveScope(req, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/org_id/);
  });

  it("B3: header missing project_id → 400 with named diagnostic", () => {
    const req = makeRequest({
      "x-active-scope": JSON.stringify({ org_id: "dev-org-001" }),
      "x-org-id": "dev-org-001",
    });
    const result = extractActiveScope(req, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/project_id/);
  });

  it("B4: header.org_id !== X-Org-Id → 403 cross-tenant guard", () => {
    const req = makeRequest({
      "x-active-scope": JSON.stringify({
        org_id: "other-tenant-001",
        project_id: "p-q4",
      }),
      "x-org-id": "dev-org-001",
    });
    const result = extractActiveScope(req, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/org_id/);
  });

  it("B5: malformed JSON header → 400", () => {
    const req = makeRequest({ "x-active-scope": "{ not json" });
    const result = extractActiveScope(req, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/malformed/);
  });

  it("nullable resource fields normalize to null", () => {
    const req = makeRequest({
      "x-active-scope": JSON.stringify({
        org_id: "dev-org-001",
        project_id: "p-q4",
      }),
      "x-org-id": "dev-org-001",
    });
    const result = extractActiveScope(req, {});
    if (!result.ok) throw new Error("expected ok");
    expect(result.scope.resource_type).toBeNull();
    expect(result.scope.resource_id).toBeNull();
  });
});

describe("extractActiveScope — body-fallback (migration window)", () => {
  it("B6: header absent + flag enabled + body.project_id → fallback ok", () => {
    const req = makeRequest({ "x-org-id": "dev-org-001" });
    const result = extractActiveScope(
      req,
      { project_id: "p-q4" },
      { fallbackEnabled: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope.project_id).toBe("p-q4");
    expect(result.scope.org_id).toBe("dev-org-001");
    expect(result.used_body_fallback).toBe(true);
  });

  it("B7: fallback path lifts body.contextType + body.contextId into scope", () => {
    const req = makeRequest({ "x-org-id": "dev-org-001" });
    const result = extractActiveScope(
      req,
      { project_id: "p-q4", contextType: "dataset", contextId: "ds-99" },
      { fallbackEnabled: true },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.scope.resource_type).toBe("dataset");
    expect(result.scope.resource_id).toBe("ds-99");
    expect(result.used_body_fallback).toBe(true);
  });

  it("B8: header absent + flag disabled → 400 (post-sunset shape)", () => {
    const req = makeRequest({ "x-org-id": "dev-org-001" });
    const result = extractActiveScope(
      req,
      { project_id: "p-q4" },
      { fallbackEnabled: false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/missing X-Active-Scope/);
  });

  it("B9: header absent + flag enabled + body missing project_id → 400", () => {
    const req = makeRequest({ "x-org-id": "dev-org-001" });
    const result = extractActiveScope(req, {}, { fallbackEnabled: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it("fallback path with no X-Org-Id → 400 (cannot synthesize org_id)", () => {
    const req = makeRequest({});
    const result = extractActiveScope(
      req,
      { project_id: "p-q4" },
      { fallbackEnabled: true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/org_id/);
  });
});

describe("assertScopeHeaderFallbackSunset — compile-time sunset (DWD-3)", () => {
  it("S1: flag off → no-op regardless of date", () => {
    expect(() =>
      assertScopeHeaderFallbackSunset({
        flag: undefined,
        nowFn: () => new Date("2099-01-01").getTime(),
      }),
    ).not.toThrow();
    expect(() =>
      assertScopeHeaderFallbackSunset({
        flag: "false",
        nowFn: () => new Date("2099-01-01").getTime(),
      }),
    ).not.toThrow();
  });

  it("S2: flag on + now < sunset → no-op", () => {
    expect(() =>
      assertScopeHeaderFallbackSunset({
        flag: "true",
        nowFn: () => new Date("2026-05-15").getTime(),
        sunset: new Date("2026-06-25"),
      }),
    ).not.toThrow();
  });

  it("S3: flag on + now > sunset → throws with named diagnostic", () => {
    expect(() =>
      assertScopeHeaderFallbackSunset({
        flag: "true",
        nowFn: () => new Date("2026-07-01").getTime(),
        sunset: new Date("2026-06-25"),
      }),
    ).toThrow(/SCOPE_HEADER_FALLBACK_SUNSET/);
  });

  it("module-level constant is set to the agreed MR-4 date", () => {
    // Sanity check: the literal in source matches the team-calendar note.
    expect(SCOPE_HEADER_FALLBACK_SUNSET.toISOString()).toBe(
      "2026-06-25T00:00:00.000Z",
    );
  });
});

describe("buildScopeHeaderFallbackEvent", () => {
  it("captures the calling client's User-Agent", () => {
    const req = makeRequest({ "user-agent": "dashboard-legacy/0.9 (testing)" });
    const event = buildScopeHeaderFallbackEvent(req);
    expect(event.event).toBe("scope_header_fallback_used");
    expect(event.calling_client).toBe("dashboard-legacy/0.9 (testing)");
  });

  it("falls back to 'unknown' when User-Agent is absent", () => {
    const req = makeRequest({});
    const event = buildScopeHeaderFallbackEvent(req);
    expect(event.calling_client).toBe("unknown");
  });
});
