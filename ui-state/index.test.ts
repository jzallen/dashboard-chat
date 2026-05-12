// Vitest tests for the ui-state HTTP tier (Step 02-02 / US-004).
//
// Exercises the `__harness_force_failure__` and `__harness_expire_token__`
// event handler branches end-to-end against the in-process Hono app via
// `app.fetch` — no live socket, no compose stack. The tests build a fresh
// Hono app per scenario using the production `wireRoutes` helper exported
// from index.ts, so the orchestrator + eventLog are scenario-scoped.
//
// Behavior budget extension: B-knob (harness knob gated by NWAVE_HARNESS_KNOBS).
// Plus B-jwt (projection carries access_token after ready).

import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { fromPromise } from "xstate";

import { wireRoutes } from "./index.ts";
import { FlowOrchestrator } from "./lib/orchestrator.ts";
import { createNoopFlowEventLog } from "./lib/persistence/redis.ts";
import type {
  CreateOrgAndReissueActor,
  CreateOrgAndReissueInput,
  CreateOrgAndReissueOutput,
  WorkOSUserInfoActor,
} from "./lib/machines/login-and-org-setup.ts";

function buildScenario(opts: { harnessKnobsEnabled: boolean }) {
  const prev = process.env.NWAVE_HARNESS_KNOBS;
  if (opts.harnessKnobsEnabled) {
    process.env.NWAVE_HARNESS_KNOBS = "true";
  } else {
    delete process.env.NWAVE_HARNESS_KNOBS;
  }

  const eventLog = createNoopFlowEventLog();
  const workosUserInfo: WorkOSUserInfoActor = fromPromise(async () => ({
    email: "maya.chen@acme-data.example",
    display_name: "Maya Chen",
  }));
  const createOrgAndReissue: CreateOrgAndReissueActor = fromPromise<
    CreateOrgAndReissueOutput,
    CreateOrgAndReissueInput
  >(async ({ input }) => ({
    org_id: "org-acme-data",
    org_name: input.org_name,
  }));
  const orchestrator = new FlowOrchestrator({
    eventLog,
    loginMachineDeps: { workosUserInfo, createOrgAndReissue },
    log: () => undefined,
  });
  const app = new Hono();
  wireRoutes(app, orchestrator);

  return {
    app,
    orchestrator,
    restoreEnv: () => {
      if (prev === undefined) {
        delete process.env.NWAVE_HARNESS_KNOBS;
      } else {
        process.env.NWAVE_HARNESS_KNOBS = prev;
      }
    },
  };
}

let scenario: ReturnType<typeof buildScenario> | null = null;

afterEach(() => {
  if (scenario) {
    scenario.restoreEnv();
    scenario = null;
  }
});

async function beginMaya(app: Hono): Promise<{
  flow_id: string;
  correlation_id: string;
}> {
  const beginRes = await app.fetch(
    new Request("http://t/flow/login-and-org-setup/begin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        persona_email: "maya.chen@acme-data.example",
        persona_display_name: "Maya Chen",
      }),
    }),
  );
  expect(beginRes.status).toBe(200);
  const proj = (await beginRes.json()) as {
    flow_id: string;
    correlation_id: string;
    state: string;
  };
  expect(proj.state).toBe("authenticated_no_org");
  return { flow_id: proj.flow_id, correlation_id: proj.correlation_id };
}

describe("__harness_force_failure__ event handler", () => {
  it("when NWAVE_HARNESS_KNOBS=true, routes Maya into error_recoverable", async () => {
    scenario = buildScenario({ harnessKnobsEnabled: true });
    const { flow_id } = await beginMaya(scenario.app);
    const eventRes = await scenario.app.fetch(
      new Request("http://t/flow/login-and-org-setup/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id,
          type: "__harness_force_failure__",
          payload: { tag: "transient" },
        }),
      }),
    );
    expect(eventRes.status).toBe(200);
    const proj = (await eventRes.json()) as {
      state: string;
      context: { underlying_cause_tag: string };
    };
    expect(proj.state).toBe("error_recoverable");
    expect(proj.context.underlying_cause_tag).toBe("transient");
  });

  it("when NWAVE_HARNESS_KNOBS unset, rejects the event with a clear error", async () => {
    scenario = buildScenario({ harnessKnobsEnabled: false });
    const { flow_id } = await beginMaya(scenario.app);
    const eventRes = await scenario.app.fetch(
      new Request("http://t/flow/login-and-org-setup/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id,
          type: "__harness_force_failure__",
          payload: { tag: "transient" },
        }),
      }),
    );
    expect(eventRes.status).toBeGreaterThanOrEqual(400);
    const body = (await eventRes.json()) as { error?: string };
    expect(body.error).toMatch(/harness knob/i);
  });
});

describe("__harness_expire_token__ event handler", () => {
  it("when NWAVE_HARNESS_KNOBS=true, routes Maya from ready into expired_token", async () => {
    scenario = buildScenario({ harnessKnobsEnabled: true });
    const { flow_id } = await beginMaya(scenario.app);
    const submitRes = await scenario.app.fetch(
      new Request("http://t/flow/login-and-org-setup/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id,
          type: "org_form_submitted",
          payload: { org_name: "Acme Data" },
        }),
      }),
    );
    expect(submitRes.status).toBe(200);
    const ready = (await submitRes.json()) as { state: string };
    expect(ready.state).toBe("ready");

    const expireRes = await scenario.app.fetch(
      new Request("http://t/flow/login-and-org-setup/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id,
          type: "__harness_expire_token__",
          payload: {},
        }),
      }),
    );
    expect(expireRes.status).toBe(200);
    const proj = (await expireRes.json()) as { state: string };
    expect(proj.state).toBe("expired_token");
  });

  it("when NWAVE_HARNESS_KNOBS unset, rejects the event with a clear error", async () => {
    scenario = buildScenario({ harnessKnobsEnabled: false });
    const { flow_id } = await beginMaya(scenario.app);
    const expireRes = await scenario.app.fetch(
      new Request("http://t/flow/login-and-org-setup/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id,
          type: "__harness_expire_token__",
          payload: {},
        }),
      }),
    );
    expect(expireRes.status).toBeGreaterThanOrEqual(400);
    const body = (await expireRes.json()) as { error?: string };
    expect(body.error).toMatch(/harness knob/i);
  });
});

describe("projection emits access_token after ready", () => {
  it("once Maya reaches ready, projection.context.access_token decodes to a payload with her org_id claim", async () => {
    scenario = buildScenario({ harnessKnobsEnabled: true });
    const { flow_id } = await beginMaya(scenario.app);
    const submitRes = await scenario.app.fetch(
      new Request("http://t/flow/login-and-org-setup/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id,
          type: "org_form_submitted",
          payload: { org_name: "Acme Data" },
        }),
      }),
    );
    expect(submitRes.status).toBe(200);
    const proj = (await submitRes.json()) as {
      state: string;
      context: { access_token?: string; org?: { id?: string } };
    };
    expect(proj.state).toBe("ready");
    expect(proj.context.access_token).toBeTruthy();
    const parts = (proj.context.access_token ?? "").split(".");
    expect(parts.length).toBe(3);
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as { org_id?: string };
    expect(payload.org_id).toBe(proj.context.org?.id);
  });
});
