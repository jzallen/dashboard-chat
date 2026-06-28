// Pure unit tests for the relocated onboarding flow policy (CDO-S5; ADR-050
// §c/§e.4). The driver is a PURE module: a backend client port, a report sink,
// and a logger are injected, so the whole status→cause matrix + the
// definitive-answers-only + probe-first-convergence rules are assertable with NO
// browser, NO React, NO network.
//
// The injected client mirrors the catalog backendClient contract: non-2xx →
// throws ApiError {status, body}; 2xx → returns the unwrapped JSON:API body;
// network/timeout → throws a plain (non-ApiError) Error. The driver maps those
// outcomes to the closed-union past-tense outcome reports.
import {
  anonymousStateDocument,
  type ChatAppStateDocument,
  type ChatAppWireEvent,
} from "@dashboard-chat/ui-state-wire";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../catalog/dataSources/backendClient";
import { createOnboardingDriver, type OnboardingClient } from "./onboarding-driver";

// ───────────────────────────── test doubles ─────────────────────────────

/** A document whose onboarding + projectContext region states are scripted, so
 *  the driver can read the RESULTING region state off report()'s return value
 *  (ratification amendment 3). */
function documentWithRegionStates(
  onboardingState: string,
  projectContextState: string,
): ChatAppStateDocument {
  const doc = anonymousStateDocument();
  return {
    ...doc,
    regions: {
      ...doc.regions,
      onboarding: { ...doc.regions.onboarding, state: onboardingState },
      projectContext: {
        ...doc.regions.projectContext,
        state: projectContextState,
      },
    },
  };
}

/** A spy report sink with the StateProxy.postEvent signature. The returned
 *  document carries the resulting region states the driver logs (amendment 3);
 *  override per test to script the post-report region state. */
function makeReport(
  resulting: ChatAppStateDocument = documentWithRegionStates("ready", "awaiting_scope_report"),
) {
  const events: ChatAppWireEvent[] = [];
  const report = vi.fn(async (event: ChatAppWireEvent) => {
    events.push(event);
    return resulting;
  });
  return { report, events };
}

/** A spy logger satisfying the createLogger surface. */
function makeLog() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** Build a fake client whose get/post are programmable per call. */
function makeClient(overrides: Partial<OnboardingClient> = {}): OnboardingClient {
  return {
    get: overrides.get ?? vi.fn(async () => ({})),
    post: overrides.post ?? vi.fn(async () => ({})),
  };
}

const apiError = (status: number, body: unknown = null) =>
  new ApiError(status, body, `failed with status ${status}`);

// ───────────────────────────── org-create status→cause ─────────────────────────────

describe("reportOrgCreateResult — status → cause mapping", () => {
  it("201 JSON:API single → org_created {org:{id,name}} posted AND logged", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    // apiPost unwraps the JSON:API single → flat { id, name }.
    const client = makeClient({
      post: vi.fn(async () => ({ id: "org-7", name: "Acme" })),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.reportOrgCreateResult("Acme");

    expect(events).toEqual([
      { type: "org_created", payload: { org: { id: "org-7", name: "Acme" } } },
    ]);
    expect(client.post).toHaveBeenCalledWith("/api/orgs", { name: "Acme" });
    // audit: one entry for the posted event.
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it("409 → org_create_failed {cause:'org_name_taken', org_name}", async () => {
    const { events } = await runOrgCreate(409);
    expect(events).toEqual([
      {
        type: "org_create_failed",
        payload: { cause: "org_name_taken", org_name: "Acme" },
      },
    ]);
  });

  it.each([400, 422])("%i → org_create_failed {cause:'org_name_invalid'}", async (status) => {
    const { events } = await runOrgCreate(status);
    expect(events).toEqual([
      {
        type: "org_create_failed",
        payload: { cause: "org_name_invalid", org_name: "Acme" },
      },
    ]);
  });

  it("500 → org_create_failed {cause:'org_create_failed', org_name} — carried uniformly (D3)", async () => {
    const { events } = await runOrgCreate(500);
    expect(events).toEqual([
      {
        type: "org_create_failed",
        payload: { cause: "org_create_failed", org_name: "Acme" },
      },
    ]);
  });

  it("network/timeout (non-ApiError throw) → org_create_failed {cause:'org_create_failed', org_name} (D3)", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      post: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.reportOrgCreateResult("Acme");

    expect(events).toEqual([
      {
        type: "org_create_failed",
        payload: { cause: "org_create_failed", org_name: "Acme" },
      },
    ]);
  });

  it("401 → NO report (auth gate); returns an auth-gate signal", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      post: vi.fn(async () => {
        throw apiError(401);
      }),
    });
    const driver = createOnboardingDriver({ client, report, log });

    const outcome = await driver.reportOrgCreateResult("Acme");

    expect(events).toEqual([]);
    expect(report).not.toHaveBeenCalled();
    expect(outcome).toEqual({ authGate: true });
  });

  /** Drive an org-create whose POST throws an ApiError of `status`. */
  async function runOrgCreate(status: number) {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      post: vi.fn(async () => {
        throw apiError(status);
      }),
    });
    const driver = createOnboardingDriver({ client, report, log });
    await driver.reportOrgCreateResult("Acme");
    return { events, log };
  }
});

// ───────────────────────────── org probe (definitive-answers-only) ─────────────────────────────

describe("probeOrg — definitive-answers-only", () => {
  it("200 → org_found {org:{id,name}} posted AND logged", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      get: vi.fn(async () => ({ id: "org-1", name: "Globex" })),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.probeOrg();

    expect(events).toEqual([
      { type: "org_found", payload: { org: { id: "org-1", name: "Globex" } } },
    ]);
    expect(client.get).toHaveBeenCalledWith("/api/orgs/me");
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it("404 → org_not_found {} posted", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      get: vi.fn(async () => {
        throw apiError(404);
      }),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.probeOrg();

    expect(events).toEqual([{ type: "org_not_found", payload: {} }]);
  });

  it.each([500, 503])("%i transport error → NO report (document stays awaiting)", async (status) => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      get: vi.fn(async () => {
        throw apiError(status);
      }),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.probeOrg();

    expect(events).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("network error → NO report (transport, not definitive)", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      get: vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.probeOrg();

    expect(events).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("401 → NO report (auth gate); returns the auth-gate signal", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      get: vi.fn(async () => {
        throw apiError(401);
      }),
    });
    const driver = createOnboardingDriver({ client, report, log });

    const outcome = await driver.probeOrg();

    expect(events).toEqual([]);
    expect(report).not.toHaveBeenCalled();
    expect(outcome).toEqual({ authGate: true });
  });
});

// ───────────────────────────── default project (Phase D) ─────────────────────────────

describe("createDefaultProject — automatic 'My First Project'", () => {
  it("201 → project_created {project:{id,name}} (no user input)", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      post: vi.fn(async () => ({ id: "proj-1", name: "My First Project" })),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.createDefaultProject();

    expect(client.post).toHaveBeenCalledWith("/api/projects", {
      name: "My First Project",
    });
    expect(events).toEqual([
      {
        type: "project_created",
        payload: { project: { id: "proj-1", name: "My First Project" } },
      },
    ]);
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it("401 → NO report (auth gate)", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      post: vi.fn(async () => {
        throw apiError(401);
      }),
    });
    const driver = createOnboardingDriver({ client, report, log });

    const outcome = await driver.createDefaultProject();

    expect(events).toEqual([]);
    expect(outcome).toEqual({ authGate: true });
  });

  it("500 → project_create_failed {cause:'project_create_failed'}", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      post: vi.fn(async () => {
        throw apiError(500);
      }),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.createDefaultProject();

    expect(events).toEqual([
      { type: "project_create_failed", payload: { cause: "project_create_failed" } },
    ]);
  });
});

// ───────────────────────────── project retry (probe-first convergence) ─────────────────────────────

describe("retryProject — probe-first convergence (lost-201 dedup)", () => {
  it("re-probe returns a non-empty list → scope_resolved, NO duplicate POST", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const post = vi.fn(async () => ({ id: "proj-9", name: "My First Project" }));
    const client = makeClient({
      get: vi.fn(async () => [{ id: "proj-9", name: "My First Project" }]),
      post,
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.retryProject();

    expect(client.get).toHaveBeenCalledWith("/api/projects");
    // The lost-201 was actually persisted — converge WITHOUT a duplicate POST.
    expect(post).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "scope_resolved",
        payload: { project: { id: "proj-9", name: "My First Project" } },
      },
    ]);
  });

  it("re-probe returns an empty list → re-POST → project_created", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const post = vi.fn(async () => ({ id: "proj-10", name: "My First Project" }));
    const client = makeClient({
      get: vi.fn(async () => []),
      post,
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.retryProject();

    expect(post).toHaveBeenCalledWith("/api/projects", { name: "My First Project" });
    expect(events).toEqual([
      {
        type: "project_created",
        payload: { project: { id: "proj-10", name: "My First Project" } },
      },
    ]);
  });
});

// ───────────────────────────── initial-scope resolution ─────────────────────────────

describe("resolveInitialScope — ported resolveInitialScopeFn", () => {
  it("a resolvable project → scope_resolved {project}", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      get: vi.fn(async () => [{ id: "proj-2", name: "Existing" }]),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.resolveInitialScope();

    expect(client.get).toHaveBeenCalledWith("/api/projects");
    expect(events).toEqual([
      {
        type: "scope_resolved",
        payload: { project: { id: "proj-2", name: "Existing" } },
      },
    ]);
  });

  it("empty list → no_projects_found {}", async () => {
    const { report, events } = makeReport();
    const log = makeLog();
    const client = makeClient({
      get: vi.fn(async () => []),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.resolveInitialScope();

    expect(events).toEqual([{ type: "no_projects_found", payload: {} }]);
  });
});

// ───────────────────────────── audit trail (amendment 3) ─────────────────────────────

describe("console-log audit trail — one log entry per posted event", () => {
  it("logs the posted event + the RESULTING onboarding region state from report()'s document", async () => {
    // The server settles the onboarding region to `ready` after org_created.
    const { report } = makeReport(
      documentWithRegionStates("ready", "awaiting_scope_report"),
    );
    const log = makeLog();
    const client = makeClient({
      post: vi.fn(async () => ({ id: "org-7", name: "Acme" })),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.reportOrgCreateResult("Acme");

    // The audit carries the posted event type + the RESULTING region state
    // (read from report()'s returned document), AND the region name.
    expect(log.info).toHaveBeenCalledTimes(1);
    const [action, attributes] = log.info.mock.calls[0];
    expect(action).toContain("org_created");
    expect(attributes).toMatchObject({
      event: "org_created",
      region: "onboarding",
      region_state: "ready",
    });
  });

  it("logs the RESULTING projectContext region state for a projectContext-region event", async () => {
    // A project_created event settles the projectContext region to project_selected.
    const { report } = makeReport(
      documentWithRegionStates("ready", "project_selected"),
    );
    const log = makeLog();
    const client = makeClient({
      post: vi.fn(async () => ({ id: "proj-1", name: "My First Project" })),
    });
    const driver = createOnboardingDriver({ client, report, log });

    await driver.createDefaultProject();

    const [action, attributes] = log.info.mock.calls[0];
    expect(action).toContain("project_created");
    expect(attributes).toMatchObject({
      event: "project_created",
      region: "projectContext",
      region_state: "project_selected",
    });
  });
});
