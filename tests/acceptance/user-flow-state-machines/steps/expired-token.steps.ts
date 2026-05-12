// Step definitions for `features/slice-3-expired-token-freeze.feature`
// (US-005). Cross-machine FREEZE + bounded replay buffer.
//
// Per Step 03-01's Overseer directive (DI-1 extension):
//   - The Cucumber acceptance suite is NOT executed headlessly in this
//     environment. These bodies are authored against the UserFlowHarness's
//     public surface so a future stabilized harness ticket can flip the
//     @skip tags and run them without rewriting.
//   - The seven @us-005 scenarios therefore remain @skip after this step.
//
// All step bodies drive through the harness (CM-A: tests use the driving
// port only — no ui-state/lib/** imports here). Vitest-level coverage of
// the same surface lives in:
//   - ui-state/lib/orchestrator.test.ts (FREEZE/THAW + replay buffer)
//   - ui-state/lib/machines/login-and-org-setup.test.ts (silent reauth)
//   - auth-proxy/app.test.ts (silent_reauth_ok / silent_reauth_failed KPIs)
//   - ui-presentation/app/routes/expired-token-banner.test.tsx (banner UX)
//
// Bodies that would require Playwright (banner focus management, browser
// visibility) remain as deferred stubs marked "deferred to UI-2 ticket".

import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "expect";

import type { UserFlowWorld } from "./world.ts";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function deferredToUi2(_world: UserFlowWorld, phrase: string): never {
  throw new Error(
    `Step deferred to UI-2 ticket (Playwright-shaped): "${phrase}". This scenario is @skip until DI-1 + UI-2 land.`,
  );
}

// --------------------------------------------------------------------------
// Slice 3 — expired token freeze + replay (US-005)
// --------------------------------------------------------------------------

Given(
  /^Maya is signed in and her organization "([^"]+)" is set up$/,
  async function (this: UserFlowWorld, orgName: string) {
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    await harness.submit_org(orgName);
  },
);

Given(
  /^Maya has just sent the chat question "([^"]+)"$/,
  function (this: UserFlowWorld, question: string) {
    // Stash the in-flight question on the bag; the harness composition with
    // the chat agent lives in a future step. The slice-3 vitest tests
    // exercise the orchestrator's replay buffer directly.
    this.bag.in_flight_question = question;
  },
);

Given(
  /^Maya has just sent the chat question with reference code "([^"]+)"$/,
  function (this: UserFlowWorld, code: string) {
    this.bag.in_flight_question = "question with ref code";
    this.bag.in_flight_reference_code = code;
  },
);

Given("Maya's access will expire before the answer can stream", function (
  this: UserFlowWorld,
) {
  // No-op preparation: the When step drives the actual expiry via the
  // __harness_expire_token__ event. This Given just records intent so the
  // narrative reads cleanly in the .feature.
  this.bag.expiry_planned = true;
});

Given(
  "the identity session itself has expired so silent renewal will fail",
  function (this: UserFlowWorld) {
    // Future: the harness ticket adds force_silent_reauth_failure(); for
    // now record intent. The ui-state machine wires the failure path via
    // a silentReauth actor that rejects with "identity session expired".
    this.bag.silent_reauth_will_fail = true;
  },
);

Given("Maya has a chat question and a dataset preview in flight", function (
  this: UserFlowWorld,
) {
  this.bag.in_flight_count = 2;
});

Given("Maya's access will expire before either responds", function (
  this: UserFlowWorld,
) {
  this.bag.expiry_planned = true;
});

Given(
  "Maya is mid-flow with both chat and a transform preview open",
  function (this: UserFlowWorld) {
    this.bag.in_flight_count = 2;
    this.bag.transform_preview_open = true;
  },
);

Given("Maya has sent a chat question", function (this: UserFlowWorld) {
  this.bag.in_flight_question = "generic chat question";
});

Given(
  /^Maya's access renewal will take (\d+) seconds$/,
  function (this: UserFlowWorld, secs: string) {
    // Records the planned renewal latency. The orchestrator-level vitest
    // proves the 5s replay-buffer timeout drops events that arrive after
    // the window; the Cucumber scenario will exercise the same path
    // end-to-end once DI-1 lifts.
    this.bag.renewal_latency_seconds = Number.parseInt(secs, 10);
  },
);

When("Maya's access expires mid-question", async function (
  this: UserFlowWorld,
) {
  if (!this.harness) throw new Error("harness not initialized");
  await this.harness.expire_token();
});

When("Maya's access expires", async function (this: UserFlowWorld) {
  if (!this.harness) throw new Error("harness not initialized");
  await this.harness.expire_token();
});

When(
  "the ui-state service is restarted while Maya is mid-session",
  function (this: UserFlowWorld) {
    // Rehydration scenario — requires docker-compose orchestration of the
    // ui-state container restart. Deferred to UI-2 ticket; the
    // Redis-backed event log is exercised by ui-state/index.test.ts.
    deferredToUi2(this, "ui-state restart mid-session");
  },
);

Then(
  /^within 100 milliseconds Maya sees a non-blocking "Refreshing your session\.\.\." banner$/,
  function (this: UserFlowWorld) {
    // Banner UX requires DOM inspection — Playwright-shaped. The vitest
    // unit test for the ExpiredTokenBanner component covers the same
    // contract: role="status", aria-live="polite", text.
    deferredToUi2(this, "refreshing session banner (Playwright)");
  },
);

Then("Maya's chat question replays without Maya re-typing it", function (
  this: UserFlowWorld,
) {
  // End-to-end chat replay requires the chat agent + UI composition. The
  // orchestrator-level vitest (B3) proves the replay buffer mechanism.
  deferredToUi2(this, "chat question replays (E2E)");
});

Then(
  "the streaming answer reaches Maya as if her access had not expired",
  function (this: UserFlowWorld) {
    deferredToUi2(this, "streaming answer reaches Maya (E2E)");
  },
);

Then("the banner clears once the answer begins streaming", function (
  this: UserFlowWorld,
) {
  deferredToUi2(this, "banner clears (Playwright)");
});

Then(
  "Maya sees a recoverable-error page worded for the sign-in-again case",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    // The ui-state machine routes silent reauth failure into
    // error_recoverable with tag "silent-reauth-failed". The recoverable-
    // error page is keyed off that tag; UX is exercised in
    // recoverable-error.test.tsx via a parametrized variant suite.
    expect(projection.state).toBe("error_recoverable");
    const ctx = projection.context as { underlying_cause_tag?: string };
    expect(ctx.underlying_cause_tag).toBe("silent-reauth-failed");
  },
);

Then(
  /^the reference code on the recoverable-error page is "([^"]+)"$/,
  async function (this: UserFlowWorld, code: string) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    expect(projection.correlation_id).toBe(code);
  },
);

Then(
  "the reference code is the one from Maya's original question, not a new one from the renewal attempt",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    const original = this.bag.in_flight_reference_code as string | undefined;
    if (!original) {
      throw new Error("test setup did not record original reference code");
    }
    expect(projection.correlation_id).toBe(original);
  },
);

Then("both Maya's requests pause together", function (this: UserFlowWorld) {
  // Concurrent-request pause is a property of the orchestrator's FREEZE
  // broadcast. The vitest B1 covers the underlying mechanism; the full
  // E2E composition is deferred to UI-2.
  deferredToUi2(this, "both requests pause (E2E composition)");
});

Then("exactly one access renewal is performed", function (this: UserFlowWorld) {
  // Single renewal invariant — orchestrator only invokes silentReauth
  // once per expired_token entry. Exercised at the machine level by B5.
  deferredToUi2(this, "exactly one renewal (E2E composition)");
});

Then("both Maya's responses reach her after renewal completes", function (
  this: UserFlowWorld,
) {
  deferredToUi2(this, "both responses reach Maya (E2E)");
});

Then(
  /^Maya's "Apply transform" button is paused with a "Refreshing your session\.\.\." indicator$/,
  function (this: UserFlowWorld) {
    deferredToUi2(this, "apply transform paused (Playwright)");
  },
);

Then("Maya's transform is not duplicated when her access renews", function (
  this: UserFlowWorld,
) {
  deferredToUi2(this, "transform not duplicated (E2E)");
});

Then(
  /^after renewal Maya's "Apply transform" button is responsive again$/,
  function (this: UserFlowWorld) {
    deferredToUi2(this, "apply transform responsive after (Playwright)");
  },
);

Then("Maya's chat question is not replayed automatically", function (
  this: UserFlowWorld,
) {
  // The replay-buffer-overflow / 5s-window scenarios are covered at the
  // vitest level by B3/B4/B5 in orchestrator.test.ts. The user-visible
  // behavior is deferred to UI-2.
  deferredToUi2(this, "no auto-replay on overflow (E2E)");
});

Then(
  "Maya's original question is preserved as a draft in the chat composer",
  function (this: UserFlowWorld) {
    deferredToUi2(this, "original question preserved as draft (Playwright)");
  },
);

Then(
  /^within 60 seconds Maya can continue without re-signing-in$/,
  function (this: UserFlowWorld) {
    deferredToUi2(this, "Maya continues within 60s (E2E restart)");
  },
);

Then(
  /^Maya's active organization remains "([^"]+)"$/,
  function (this: UserFlowWorld, _orgName: string) {
    deferredToUi2(this, "active org unchanged after restart (E2E)");
  },
);
