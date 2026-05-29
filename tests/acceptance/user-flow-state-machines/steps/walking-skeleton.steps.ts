// Step definitions for the walking skeleton scenario.
//
// All step bodies route through the harness or the UiStateClient — both
// of which hit `auth-proxy:1042` (driving port). No step opens an in-
// process backdoor.
//
// On first execution the production code is the RED scaffold from
// `ui-state/`: the four routes return 501. The walking skeleton's
// expected failure mode is therefore "expected 200, got 501" — RED for
// the right reason. DELIVER replaces the scaffold step by step per
// roadmap.json.

import { Before, After, Given, Then, When } from "@cucumber/cucumber";
import { expect } from "expect";

import { FakeWorkOS } from "./fake-workos.ts";
import { MAYA } from "./fixtures/personas.ts";
import { wait_for_health } from "./fixtures/compose.ts";
import type { UserFlowWorld } from "./world.ts";

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL ?? "http://localhost:1042";
const FAKE_WORKOS_PORT = parseInt(
  process.env.FAKE_WORKOS_PORT ?? "14299",
  10,
);

Before({ tags: "@walking_skeleton" }, async function (this: UserFlowWorld) {
  this.fakeWorkOS = new FakeWorkOS({ port: FAKE_WORKOS_PORT });
  await this.fakeWorkOS.start();
});

After({ tags: "@walking_skeleton" }, async function (this: UserFlowWorld) {
  if (this.fakeWorkOS) {
    await this.fakeWorkOS.stop();
    this.fakeWorkOS = null;
  }
});

Given(
  "a clean environment with no organization yet owned by Maya",
  async function (this: UserFlowWorld) {
    // The clean env is provided by compose bring-up + per-scenario Redis
    // namespace flush (delegated to compose helpers in real DELIVER).
    // For the scaffold phase, we just stash the assertion that Maya has
    // no org -- the ui-state tier will report her starting state on
    // begin_auth.
    this.bag.clean_env = true;
  },
);

Given(
  "the fake identity provider is configured to recognize Maya's profile",
  function (this: UserFlowWorld) {
    if (!this.fakeWorkOS) throw new Error("fake WorkOS not started");
    this.fakeWorkOS.set_profile_for("maya-auth-code", {
      email: MAYA.email,
      display_name: MAYA.display_name,
    });
    this.bag.fake_workos_ready = true;
  },
);

Given(
  "the ui-state services are healthy and reachable through the production ingress",
  async function (this: UserFlowWorld) {
    await wait_for_health(`${AUTH_PROXY_URL}/ui-state/health`);
  },
);

Given("Maya has never used Dashboard Chat before", function (this: UserFlowWorld) {
  // Preconditional state -- begin_auth will assert this on the server.
  this.bag.first_time_user = true;
});

When(
  "Maya signs in through the production ingress",
  async function (this: UserFlowWorld) {
    const harness = this.use_harness_for("maya");
    this.bag.welcome_projection = await harness.begin_auth("maya");
  },
);

Then(
  'Maya sees the welcome message addressed to {string}',
  function (this: UserFlowWorld, expectedEmail: string) {
    const projection = this.bag.welcome_projection as
      | { context: { user?: { email?: string } } }
      | undefined;
    expect(projection?.context?.user?.email).toBe(expectedEmail);
  },
);

Then(
  "Maya sees a single form asking for her organization name",
  function (this: UserFlowWorld) {
    const projection = this.bag.welcome_projection as
      | { state: string }
      | undefined;
    // The state name carries the contract that this view IS the org-name form.
    expect(projection?.state).toBe("authenticated_no_org");
  },
);

Then(
  "Maya does not see any error message at any point during sign-in",
  function (this: UserFlowWorld) {
    const projection = this.bag.welcome_projection as
      | { state: string; context: { underlying_cause_tag?: string | null } }
      | undefined;
    expect(projection?.state).not.toBe("error_recoverable");
    expect(projection?.state).not.toBe("error_terminal");
    expect(projection?.context?.underlying_cause_tag ?? null).toBeNull();
  },
);

Then(
  "Maya's session can be observed in the same place by an accompanying test agent watching her sign-in",
  async function (this: UserFlowWorld) {
    // The "accompanying test agent" reads the same projection endpoint
    // through the same driving port. This proves the SSOT promise:
    // FE and harness read from the same place.
    const harness = this.harness;
    if (!harness) throw new Error("harness not initialized");
    const watcher_projection = await harness.get_projection();
    const initial_projection = this.bag.welcome_projection as
      | { context: { user?: { email?: string } } }
      | undefined;
    // The SSOT promise: the watcher reads the SAME per-principal `/state`
    // document the harness wrote to (no `flow_id` on the wire any more —
    // identity is header-derived). Equal user context proves both observe the
    // one onboarding region.
    expect(watcher_projection.context.user).toEqual(
      initial_projection?.context.user,
    );
  },
);
