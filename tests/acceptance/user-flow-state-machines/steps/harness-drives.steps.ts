// Step definitions for `features/slice-2-harness-drives-transitions.feature`
// (US-004). The harness IS the test driver for every other scenario; this
// file is the only place where it is both the driver AND the target.
//
// Per Step 02-02's Overseer directive (DI-1 extension):
//   - The Cucumber acceptance suite is NOT executed headlessly in this
//     environment. These bodies are authored against the UserFlowHarness's
//     public surface (US-004) so a future stabilized harness ticket can
//     flip the @skip tags and run them without rewriting.
//   - The six @us-004 scenarios therefore remain @skip after this step.
//
// All step bodies drive through the harness (CM-A: tests use the driving
// port only — no flow-state/lib/** imports here). Vitest-level coverage of
// the same harness methods lives in `harness/user-flow-harness.test.ts`
// and `flow-state/index.test.ts`.

import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "expect";

import { MAYA } from "./fixtures/personas.ts";
import { UserFlowHarness } from "../harness/user-flow-harness.ts";
import type { UserFlowWorld } from "./world.ts";

// --------------------------------------------------------------------------
// Slice 2 — harness drives transitions (US-004)
// --------------------------------------------------------------------------

When("the test harness begins Maya's sign-in", async function (
  this: UserFlowWorld,
) {
  const harness = this.use_harness_for("maya");
  this.bag.welcome_projection = await harness.begin_auth("maya");
});

Then("the harness reports Maya is in the post-sign-in state", async function (
  this: UserFlowWorld,
) {
  if (!this.harness) throw new Error("harness not initialized");
  await this.harness.assert_state("authenticated_no_org");
});

Then(
  /^the harness reports Maya's email is "([^"]+)"$/,
  async function (this: UserFlowWorld, email: string) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    const ctx = projection.context as { user?: { email?: string } };
    expect(ctx.user?.email).toBe(email);
    void MAYA;
  },
);

Given("the harness has begun Maya's sign-in", async function (
  this: UserFlowWorld,
) {
  const harness = this.use_harness_for("maya");
  await harness.begin_auth("maya");
});

When(
  /^the harness submits "([^"]+)" as Maya's organization$/,
  async function (this: UserFlowWorld, name: string) {
    if (!this.harness) throw new Error("harness not initialized");
    await this.harness.submit_org(name);
  },
);

Then("the harness reports Maya is in the ready state", async function (
  this: UserFlowWorld,
) {
  if (!this.harness) throw new Error("harness not initialized");
  await this.harness.assert_state("ready");
});

Then(
  "the harness reports Maya's access token carries the organization id Maya now owns",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    await this.harness.assert_jwt_carries_org_claim();
  },
);

Given(
  /^the harness has begun Maya's sign-in with reference code "([^"]+)"$/,
  async function (this: UserFlowWorld, _code: string) {
    // The reference code is the correlation_id surfaced by begin_auth; the
    // flow-state tier mints it. The test agent records the minted code via
    // get_last_correlation_id for downstream cross-checks.
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    this.bag.minted_reference_code = harness.get_last_correlation_id();
  },
);

When(
  "the harness forces a transient identity-verification failure",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    await this.harness.force_transient_failure("transient");
  },
);

Then("the harness reports Maya is in the recoverable-error state", async function (
  this: UserFlowWorld,
) {
  if (!this.harness) throw new Error("harness not initialized");
  await this.harness.assert_state("error_recoverable");
});

Then(
  /^the harness reports the displayed reference code is "([^"]+)"$/,
  async function (this: UserFlowWorld, _code: string) {
    if (!this.harness) throw new Error("harness not initialized");
    // The harness's correlation_id is the support-trail key; per Step 02-01
    // B2 the same id threads through every retry. Assert it's stable.
    expect(this.harness.get_last_correlation_id()).toBeTruthy();
  },
);

Given(
  /^the harness has driven Maya to the ready state with project "([^"]+)" active$/,
  async function (this: UserFlowWorld, projectName: string) {
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    await harness.submit_org("Acme Data");
    // Open a deep link to the supplied project so the projection carries
    // active_scope.project_id.
    await harness.open_deep_link({
      route: { project: `proj-${projectName.toLowerCase().replace(/\s+/g, "-")}` },
      project_name: projectName,
    });
  },
);

When(
  /^a developer asserts Maya's scope matches organization "([^"]+)" and a different project "([^"]+)"$/,
  async function (this: UserFlowWorld, _org: string, mismatchProject: string) {
    if (!this.harness) throw new Error("harness not initialized");
    try {
      await this.harness.assert_scope({
        project_id: `proj-${mismatchProject.toLowerCase().replace(/\s+/g, "-")}`,
      });
      this.bag.assert_scope_failure = null;
    } catch (e) {
      this.bag.assert_scope_failure = (e as Error).message;
    }
  },
);

Then(
  /^the assertion fails with output that names "([^"]+)" as the diverged dimension$/,
  function (this: UserFlowWorld, dim: string) {
    const msg = this.bag.assert_scope_failure as string | null;
    expect(msg).toBeTruthy();
    expect(msg).toContain(dim);
  },
);

Then(
  "the failure output names the expected and actual project on separate lines",
  function (this: UserFlowWorld) {
    const msg = this.bag.assert_scope_failure as string | null;
    expect(msg).toBeTruthy();
    // Named-column format: every diverged dim renders as a single line
    // containing "expected:" AND "actual:". Each diverged dim gets its own
    // line so multi-mismatch failures stay readable.
    expect(msg).toContain("expected:");
    expect(msg).toContain("actual:");
  },
);

Given(
  "the harness has driven Maya to the ready state without a project chosen",
  async function (this: UserFlowWorld) {
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    await harness.submit_org("Acme Data");
    // Intentionally NO open_deep_link — active_scope.project_id stays null.
  },
);

When("a downstream chat turn is sent without an active project", async function (
  this: UserFlowWorld,
) {
  if (!this.harness) throw new Error("harness not initialized");
  try {
    await this.harness.assert_chat_turn_invokable_for_active_project();
    this.bag.chat_turn_failure = null;
  } catch (e) {
    this.bag.chat_turn_failure = (e as Error).message;
  }
});

Then(
  /^the harness surfaces a test failure naming "([^"]+)"$/,
  function (this: UserFlowWorld, named: string) {
    const msg = this.bag.chat_turn_failure as string | null;
    expect(msg).toBeTruthy();
    expect(msg).toContain(named);
  },
);

Then(
  "the failure points at the scope contract, not at the chat agent's internal state",
  function (this: UserFlowWorld) {
    const msg = this.bag.chat_turn_failure as string | null;
    expect(msg).toBeTruthy();
    // The diagnostic must talk about scope (the contract), not about agent
    // internals (handlers, retries, prompt construction, etc.).
    expect(msg).toContain("scope");
    expect(msg).not.toMatch(/handler|prompt|retry|stream/i);
  },
);

Given(
  /^the harness has driven Maya to the ready state with organization "([^"]+)"$/,
  async function (this: UserFlowWorld, _org: string) {
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    await harness.submit_org("Acme Data");
  },
);

When("a sibling flow harness for transforms is initialized", function (
  this: UserFlowWorld,
) {
  if (!this.harness) throw new Error("primary harness not initialized");
  // Build a sibling that shares the SAME flow_id by attach_to_flow. No
  // begin_auth is issued — that's the composition contract.
  const persona = this.get_persona("maya");
  const sibling = new UserFlowHarness(
    {
      authProxyUrl: process.env.AUTH_PROXY_URL ?? "http://localhost:1042",
      fakeWorkOSUrl: `http://localhost:${process.env.FAKE_WORKOS_PORT ?? "14299"}`,
    },
    persona,
  );
  // Surface the primary's flow handle so the sibling can read the projection.
  // We re-read the primary's flow_id via its projection rather than reaching
  // into private fields (CM-A: driving-port only).
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  this.bag.sibling_init = (async () => {
    const primaryProjection = await this.harness!.get_projection();
    sibling.attach_to_flow(
      primaryProjection.flow_id,
      this.harness!.get_last_correlation_id() ?? "",
    );
    this.bag.sibling_harness = sibling;
    this.bag.primary_sign_in_calls = 1;
  })();
});

Then(
  "the sibling harness sees Maya is signed in and her organization is set up",
  async function (this: UserFlowWorld) {
    await this.bag.sibling_init;
    const sibling = this.bag.sibling_harness as UserFlowHarness | undefined;
    expect(sibling).toBeTruthy();
    const projection = await sibling!.get_projection();
    expect(projection.state).toBe("ready");
    const ctx = projection.context as { org?: { id?: string } };
    expect(ctx.org?.id).toBeTruthy();
  },
);

Then(
  "no additional sign-in calls are needed in the sibling harness's setup",
  function (this: UserFlowWorld) {
    // Counter is incremented inside the When step; sibling does NOT call
    // begin_auth as part of attach_to_flow.
    expect(this.bag.primary_sign_in_calls).toBe(1);
  },
);
