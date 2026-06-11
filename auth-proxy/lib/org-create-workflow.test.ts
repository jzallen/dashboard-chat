/**
 * Unit tests — `runOrgCreateInterception` (CDO-S5, ADR-048 §1/§3/§5 + ADR-050 §b/§c).
 *
 * Source under test: `auth-proxy/lib/org-create-workflow.ts`
 *
 * The request-side org-create interception POLICY for AUTH_MODE=workos. This is
 * the SSOT for the pre-check → provision → forward → compensate sequence; it is
 * pure of Hono internals (every collaborator is injected) so the whole matrix is
 * fault-injection-testable without standing up the proxy.
 *
 * Sequence (ADR-048 §3, A+B layered failure strategy):
 *   1. PRE-CHECK org-name availability via the backend (same identity + corr id).
 *      A 409-class answer (name taken) → synthesize the backend's JSON:API 409
 *      and make ZERO WorkOS calls (no orphaned IdP org).
 *   2. PROVISION the WorkOS org, then the org-membership (1 retry on membership;
 *      it is idempotent). Either failing → 502 org_provisioning_failed; a
 *      membership failure after retry → best-effort compensation delete.
 *   3. FORWARD to the backend with X-Org-Id = the new org id. Relay the backend
 *      status verbatim.
 *   4. COMPENSATE: backend non-201 after WorkOS success → best-effort delete
 *      (1 retry). Compensation failure → emit `workos.org_compensate.fail` with
 *      the orphan id, still relay the backend status (client-indistinguishable).
 *
 * Emits `org_create.intercepted` (ADR-048 §5) on every interception.
 */

import { describe, expect, it, vi } from "vitest";

import { runOrgCreateInterception } from "./org-create-workflow.ts";

const BASE_INPUT = {
  name: "Acme",
  userId: "wos-user-1",
  identityHeaders: new Headers({ "X-User-Id": "wos-user-1" }),
  correlationId: "corr-1",
};

/** A backend availability response: 200 means available, 409 means taken. */
function availabilityResponse(status: number, body: unknown = { available: status !== 409 }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function backendCreateResponse(status: number, body: unknown = { id: "org-new", name: "Acme" }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface CapturedEvent {
  event: string;
  [key: string]: unknown;
}

function makeDeps(overrides: Partial<{
  checkAvailability: () => Promise<Response>;
  provisionOrg: (name: string) => Promise<{ id: string }>;
  provisionMembership: (userId: string, orgId: string) => Promise<void>;
  deprovisionOrg: (orgId: string) => Promise<void>;
  forwardToBackend: (provisionedOrgId: string) => Promise<Response>;
  emit: (event: CapturedEvent) => void;
}> = {}) {
  const events: CapturedEvent[] = [];
  const deps = {
    checkAvailability:
      overrides.checkAvailability ?? vi.fn(async () => availabilityResponse(200)),
    provisionOrg:
      overrides.provisionOrg ?? vi.fn(async () => ({ id: "wos-org-1" })),
    provisionMembership:
      overrides.provisionMembership ?? vi.fn(async () => {}),
    deprovisionOrg: overrides.deprovisionOrg ?? vi.fn(async () => {}),
    forwardToBackend:
      overrides.forwardToBackend ?? vi.fn(async () => backendCreateResponse(201)),
    emit: overrides.emit ?? vi.fn((e: CapturedEvent) => events.push(e)),
  };
  return { deps, events };
}

describe("runOrgCreateInterception — happy path", () => {
  it("pre-checks, provisions org+membership, forwards with the WorkOS org id, relays 201", async () => {
    const { deps } = makeDeps();

    const res = await runOrgCreateInterception({ ...BASE_INPUT, deps });

    expect(res.status).toBe(201);
    // Provisioned the org then the membership with the verified user id.
    expect(deps.provisionOrg).toHaveBeenCalledWith("Acme");
    expect(deps.provisionMembership).toHaveBeenCalledWith("wos-user-1", "wos-org-1");
    // Forwarded carrying the freshly-created WorkOS org id.
    expect(deps.forwardToBackend).toHaveBeenCalledWith("wos-org-1");
    // No compensation on success.
    expect(deps.deprovisionOrg).not.toHaveBeenCalled();
  });

  it("emits org_create.intercepted carrying the correlation id", async () => {
    const { deps, events } = makeDeps();

    await runOrgCreateInterception({ ...BASE_INPUT, deps });

    const intercepted = events.find((e) => e.event === "org_create.intercepted");
    expect(intercepted).toBeDefined();
    expect(intercepted!.request_id).toBe("corr-1");
  });
});

describe("runOrgCreateInterception — pre-check 409 (name taken)", () => {
  it("synthesizes a JSON:API 409 and makes ZERO WorkOS calls (no orphaned IdP org)", async () => {
    const { deps } = makeDeps({
      checkAvailability: vi.fn(async () =>
        availabilityResponse(409, { errors: [{ status: "409", title: "Organization name is taken" }] }),
      ),
    });

    const res = await runOrgCreateInterception({ ...BASE_INPUT, deps });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { errors: { status: string }[] };
    expect(body.errors[0].status).toBe("409");
    // The whole point: a taken name never touches WorkOS.
    expect(deps.provisionOrg).not.toHaveBeenCalled();
    expect(deps.provisionMembership).not.toHaveBeenCalled();
    expect(deps.deprovisionOrg).not.toHaveBeenCalled();
    expect(deps.forwardToBackend).not.toHaveBeenCalled();
  });
});

describe("runOrgCreateInterception — WorkOS egress failure", () => {
  it("synthesizes 502 org_provisioning_failed when the org create fails (no compensation, nothing was created)", async () => {
    const { deps } = makeDeps({
      provisionOrg: vi.fn(async () => {
        throw new Error("service_error");
      }),
    });

    const res = await runOrgCreateInterception({ ...BASE_INPUT, deps });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors[0].code).toBe("org_provisioning_failed");
    // The org create never succeeded, so there is nothing to compensate.
    expect(deps.deprovisionOrg).not.toHaveBeenCalled();
    expect(deps.forwardToBackend).not.toHaveBeenCalled();
  });

  it("retries membership ONCE, then on a second failure compensates (delete) and returns 502", async () => {
    const provisionMembership = vi.fn<(userId: string, orgId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("service_error"))
      .mockRejectedValueOnce(new Error("service_error"));
    const { deps } = makeDeps({ provisionMembership });

    const res = await runOrgCreateInterception({ ...BASE_INPUT, deps });

    expect(res.status).toBe(502);
    expect(provisionMembership).toHaveBeenCalledTimes(2);
    // The created org is orphaned without a membership → best-effort delete.
    expect(deps.deprovisionOrg).toHaveBeenCalledWith("wos-org-1");
    expect(deps.forwardToBackend).not.toHaveBeenCalled();
  });

  it("a membership that succeeds on the retry proceeds to forward (1 retry is enough)", async () => {
    const provisionMembership = vi.fn<(userId: string, orgId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("service_error"))
      .mockResolvedValueOnce(undefined);
    const { deps } = makeDeps({ provisionMembership });

    const res = await runOrgCreateInterception({ ...BASE_INPUT, deps });

    expect(res.status).toBe(201);
    expect(provisionMembership).toHaveBeenCalledTimes(2);
    expect(deps.forwardToBackend).toHaveBeenCalledWith("wos-org-1");
    expect(deps.deprovisionOrg).not.toHaveBeenCalled();
  });
});

describe("runOrgCreateInterception — backend persist failure (compensation)", () => {
  it("backend non-201 after WorkOS success → compensates (delete) and relays the backend status verbatim", async () => {
    const { deps } = makeDeps({
      forwardToBackend: vi.fn(async () => backendCreateResponse(500, { error: "boom" })),
    });

    const res = await runOrgCreateInterception({ ...BASE_INPUT, deps });

    expect(res.status).toBe(500);
    expect(deps.deprovisionOrg).toHaveBeenCalledWith("wos-org-1");
  });

  it("compensation delete is retried ONCE before giving up", async () => {
    const deprovisionOrg = vi.fn<(orgId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("service_error"))
      .mockResolvedValueOnce(undefined);
    const { deps } = makeDeps({
      forwardToBackend: vi.fn(async () => backendCreateResponse(422, { error: "bad" })),
      deprovisionOrg,
    });

    const res = await runOrgCreateInterception({ ...BASE_INPUT, deps });

    expect(res.status).toBe(422);
    expect(deprovisionOrg).toHaveBeenCalledTimes(2);
  });

  it("compensation delete failing twice → emits workos.org_compensate.fail with the orphan id and STILL relays the backend status", async () => {
    const deprovisionOrg = vi.fn<(orgId: string) => Promise<void>>()
      .mockRejectedValue(new Error("service_error"));
    const { deps, events } = makeDeps({
      forwardToBackend: vi.fn(async () => backendCreateResponse(503, { error: "down" })),
      deprovisionOrg,
    });

    const res = await runOrgCreateInterception({ ...BASE_INPUT, deps });

    // The client is told the backend status — compensated/uncompensated is
    // indistinguishable from the client's side (ADR-050 §c).
    expect(res.status).toBe(503);
    const alert = events.find((e) => e.event === "workos.org_compensate.fail");
    expect(alert).toBeDefined();
    expect(alert!.orphan_org_id).toBe("wos-org-1");
    expect(deprovisionOrg).toHaveBeenCalledTimes(2);
  });
});
