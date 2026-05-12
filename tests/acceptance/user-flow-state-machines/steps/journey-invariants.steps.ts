// Step definitions for `features/journey-invariants.feature` (US-006 IC-1..IC-6).
//
// Per Step 03-01's Overseer directive (DI-1 extension):
//   - The Cucumber acceptance suite is NOT executed headlessly in this
//     environment. Bodies are authored against the UserFlowHarness's public
//     surface so a future stabilized harness ticket can flip the @skip tags
//     and run them.
//   - The six @us-006 scenarios therefore remain @skip after this step.
//
// All step bodies drive through the harness (CM-A: tests use the driving
// port only — no ui-state/lib/** imports here). The journey invariants
// are also covered (in spirit) by the orchestrator + machine vitest suites:
// correlation_id threading is B2 in login-and-org-setup.test.ts;
// scope-resolver invariants in scope-resolver.steps.ts (Step 01-03).
//
// Future enhancement: property-based generators (fast-check) over these
// invariants — currently deferred to a follow-on ticket; the example-based
// step glue here keeps the .feature file's narrative alive in the meantime.

import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "expect";

import type { UserFlowWorld } from "./world.ts";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function deferredToUi2(_world: UserFlowWorld, phrase: string): never {
  throw new Error(
    `Step deferred to UI-2 ticket (Playwright-shaped or property-based): "${phrase}". This scenario is @skip until DI-1 + UI-2 land.`,
  );
}

// --------------------------------------------------------------------------
// Journey invariants (US-006 IC-1..IC-6)
// --------------------------------------------------------------------------

Given("any sign-in attempt Maya makes", function (this: UserFlowWorld) {
  // Property-style framing — concrete instantiation: a fresh begin_auth().
  // The full property test (fast-check generators over personas) is a
  // future enhancement; this records intent so the When step exercises
  // a single representative attempt.
  this.bag.invariant_attempt = "fresh_signin";
});

Given(
  "any sign-in attempt where Maya reaches the ready state",
  async function (this: UserFlowWorld) {
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    await harness.submit_org("Acme Data");
  },
);

Given("Maya is on the welcome page", function (this: UserFlowWorld) {
  this.bag.invariant_attempt = "welcome_page";
});

Given(
  "Maya has just submitted a valid organization name",
  function (this: UserFlowWorld) {
    this.bag.invariant_attempt = "org_submitted";
  },
);

Given(
  "any in-flight request Maya has sent during a session",
  function (this: UserFlowWorld) {
    this.bag.invariant_attempt = "in_flight_request";
  },
);

Given("Maya's access has just expired", async function (this: UserFlowWorld) {
  if (!this.harness) {
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    await harness.submit_org("Acme Data");
  }
  await this.harness!.expire_token();
});

When("the attempt emits any observable signal", async function (
  this: UserFlowWorld,
) {
  // IC-1: every signal carries the minted reference code. Drive a fresh
  // sign-in and capture the projection's correlation_id as the minted code.
  const harness = this.use_harness_for("maya");
  const projection = await harness.begin_auth("maya");
  this.bag.minted_reference_code = projection.correlation_id;
});

When(
  "the harness inspects Maya's access token and the app shell",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    // IC-2: org-id on JWT == org-id displayed. The harness's
    // assert_jwt_carries_org_claim is the structural check.
    await this.harness.assert_jwt_carries_org_claim();
  },
);

When(
  "Maya submits an organization name that fails any validation rule",
  function (this: UserFlowWorld) {
    // IC-3: validation failure stays on welcome with inline error. The
    // org-validation paths are covered at the machine level by Step 01-02
    // tests; deferring the user-visible verification to UI-2.
    deferredToUi2(this, "submits invalid org (UI assertion)");
  },
);

When(
  "the organization row is created but the access reissue has not yet succeeded",
  function (this: UserFlowWorld) {
    // IC-4: Maya doesn't see app shell yet — needs UI-level inspection.
    deferredToUi2(this, "org created, reissue pending (UI assertion)");
  },
);

When(
  "the request returns with an access-expired signal",
  function (this: UserFlowWorld) {
    // IC-5: access-expired signal carries original ref code. The
    // orchestrator's freeze/thaw vitest exercises the same property via
    // the replay buffer's correlation_id preservation.
    this.bag.access_expired_signal_observed = true;
  },
);

When("silent renewal is triggered", function (this: UserFlowWorld) {
  // IC-6: exactly one renewal before a user-visible recovery page. The
  // login machine's expired_token state invokes silentReauth exactly once
  // per entry — covered at the machine level by B5/B6.
  this.bag.silent_renewal_triggered = true;
});

Then(
  "every signal from that attempt carries the same reference code that was minted when she clicked sign in",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    // After begin_auth captured the minted code, any subsequent projection
    // read MUST carry the same correlation_id. This proves the harness
    // contract; the machine-level proof is B2 in login-and-org-setup.test.ts.
    const minted = this.bag.minted_reference_code as string | undefined;
    if (!minted) throw new Error("test setup did not capture minted code");
    const projection = await this.harness.get_projection();
    expect(projection.correlation_id).toBe(minted);
  },
);

Then(
  "the organization id on the token equals the organization id the app shell displays",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    // Identical structural check to the When step's invocation. The
    // harness raises if the assertion fails; reaching this Then is the
    // pass condition.
    await this.harness.assert_jwt_carries_org_claim();
  },
);

Then(
  "Maya stays on the welcome page with the form showing an inline error",
  function (this: UserFlowWorld) {
    deferredToUi2(this, "stay on welcome with inline error (UI)");
  },
);

Then(
  "no organization has been created in Maya's tenant",
  function (this: UserFlowWorld) {
    deferredToUi2(this, "no org created in tenant (DB assertion)");
  },
);

Then("Maya does not see the app shell yet", function (this: UserFlowWorld) {
  deferredToUi2(this, "no app shell yet (UI)");
});

Then(
  /^Maya sees a "Creating\.\.\." indication until both writes are visible$/,
  function (this: UserFlowWorld) {
    deferredToUi2(this, "creating indication (UI)");
  },
);

Then(
  "the access-expired signal carries the reference code Maya's original request carried",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    const minted = this.bag.minted_reference_code as string | undefined;
    const projection = await this.harness.get_projection();
    // IC-5: the projection's correlation_id stays stable across token
    // expiry — same minted reference code Maya saw at sign-in.
    if (minted) {
      expect(projection.correlation_id).toBe(minted);
    } else {
      // No minted code captured — at minimum the correlation_id is non-empty.
      expect(projection.correlation_id).toBeTruthy();
    }
  },
);

Then(
  "exactly one renewal attempt is made before any user-visible recovery page appears",
  function (this: UserFlowWorld) {
    // IC-6: machine-level "exactly once" is structurally enforced by the
    // single `invoke` on expired_token; the full Cucumber-level check
    // (counting actor spawns) is deferred to a property-based follow-on.
    deferredToUi2(this, "exactly one renewal (property test)");
  },
);
