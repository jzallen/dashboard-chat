// Unit tests for agent/lib/chat/scope.ts — DWD-3 X-Active-Scope contract.
//
// Coverage map (US-208 + IC-J002-7 + DWD-3, header-only terminal state):
//   B1 — well-formed header → ok.
//   B2 — header missing org_id → 400 with named diagnostic.
//   B3 — header missing project_id → 400 with named diagnostic.
//   B4 — header.org_id !== X-Org-Id → 403 (defense in depth).
//   B5 — malformed header (not JSON) → 400.
//   B8 — header absent → 400 (the body-fallback path no longer exists).

import { describe, expect, it } from "vitest";

import { extractActiveScope } from "./scope.ts";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://agent.local/chat", {
    method: "POST",
    headers,
  });
}

describe("extractActiveScope — header path", () => {
  it("B1: well-formed header is accepted", () => {
    const req = makeRequest({
      "x-active-scope": JSON.stringify({
        org_id: "dev-org-001",
        project_id: "p-q4",
        resource_type: "dataset",
        resource_id: "ds-1",
      }),
      "x-org-id": "dev-org-001",
    });
    const result = extractActiveScope(req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope.org_id).toBe("dev-org-001");
    expect(result.scope.project_id).toBe("p-q4");
    expect(result.scope.resource_type).toBe("dataset");
    expect(result.scope.resource_id).toBe("ds-1");
  });

  it("B2: header missing org_id → 400 with named diagnostic", () => {
    const req = makeRequest({
      "x-active-scope": JSON.stringify({ project_id: "p-q4" }),
    });
    const result = extractActiveScope(req);
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
    const result = extractActiveScope(req);
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
    const result = extractActiveScope(req);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/org_id/);
  });

  it("B5: malformed JSON header → 400", () => {
    const req = makeRequest({ "x-active-scope": "{ not json" });
    const result = extractActiveScope(req);
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
    const result = extractActiveScope(req);
    if (!result.ok) throw new Error("expected ok");
    expect(result.scope.resource_type).toBeNull();
    expect(result.scope.resource_id).toBeNull();
  });
});

describe("extractActiveScope — header is the only source (fallback retired)", () => {
  it("B8: header absent → 400, even when a body project_id would have existed", () => {
    // Post-migration terminal state: there is no body-fallback path. A legacy
    // client that omits X-Active-Scope is rejected regardless of any env flag.
    const req = makeRequest({ "x-org-id": "dev-org-001" });
    const result = extractActiveScope(req);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/missing X-Active-Scope/);
  });

  it("header absent is rejected even if SCOPE_HEADER_FALLBACK_ENABLED is set", () => {
    // The retired flag must have no effect — boot and request handling are
    // both independent of it now. Setting it does not resurrect the fallback.
    const prev = process.env.SCOPE_HEADER_FALLBACK_ENABLED;
    process.env.SCOPE_HEADER_FALLBACK_ENABLED = "true";
    try {
      const req = makeRequest({ "x-org-id": "dev-org-001" });
      const result = extractActiveScope(req);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    } finally {
      if (prev === undefined) delete process.env.SCOPE_HEADER_FALLBACK_ENABLED;
      else process.env.SCOPE_HEADER_FALLBACK_ENABLED = prev;
    }
  });
});
