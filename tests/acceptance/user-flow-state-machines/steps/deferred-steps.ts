// Deferred step definitions — placeholders for all @skip scenarios.
//
// One Cucumber rule (and the skill's "one scenario enabled at a time" rule):
// every step phrase referenced in a feature file MUST resolve to a step
// definition or the suite fails at collection time. To honor BOTH rules,
// scenarios past the walking skeleton are tagged @skip (so they don't run)
// AND their step phrases resolve here to `throw new Error('not enabled')`.
//
// DELIVER's first action for each roadmap step is:
//   1. Remove the @skip tag from the relevant scenarios.
//   2. Move the matching step definitions from this file into a dedicated
//      file per slice (slice-2-recoverable-error.steps.ts, etc.).
//   3. Implement the bodies outside-in.

import { Given, Then, When } from "@cucumber/cucumber";

import type { UserFlowWorld } from "./world.ts";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function notEnabled(_world: UserFlowWorld, phrase: string): never {
  throw new Error(
    `Step not yet enabled: "${phrase}". This scenario is @skip until DELIVER unskips it per roadmap.json.`,
  );
}

// --------------------------------------------------------------------------
// Slice 1 — error paths
// --------------------------------------------------------------------------









// --------------------------------------------------------------------------
// Slice 1 — scope resolver invariants
// (Step 01-03 moved these into steps/scope-resolver.steps.ts.)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Slice 2 — recoverable error UX
// (Step 02-01 moved these into steps/recoverable-error.steps.ts.
//  Scenarios remain @skip until the Cucumber acceptance suite is
//  stabilized for headless execution — see DI-1 in
//  docs/feature/user-flow-state-machines/deliver/upstream-issues.md.)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Slice 2 — harness drives transitions (US-004)
// (Step 02-02 moved these into steps/harness-drives.steps.ts.
//  Scenarios remain @skip until the Cucumber acceptance suite is
//  stabilized for headless execution — see DI-1 in
//  docs/feature/user-flow-state-machines/deliver/upstream-issues.md.)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Slice 3 — expired token freeze + replay
// --------------------------------------------------------------------------

Given(
  /^Maya is signed in and her organization "([^"]+)" is set up$/,
  function (this: UserFlowWorld, _org: string) {
    notEnabled(this, "Maya signed in with org");
  },
);

Given(
  /^Maya has just sent the chat question "([^"]+)"$/,
  function (this: UserFlowWorld, _question: string) {
    notEnabled(this, "Maya sent chat question");
  },
);

Given(
  /^Maya has just sent the chat question with reference code "([^"]+)"$/,
  function (this: UserFlowWorld, _code: string) {
    notEnabled(this, "Maya sent chat with ref code");
  },
);

Given("Maya's access will expire before the answer can stream", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "access will expire");
});

Given(
  "the identity session itself has expired so silent renewal will fail",
  function (this: UserFlowWorld) {
    notEnabled(this, "identity session expired");
  },
);

Given("Maya has a chat question and a dataset preview in flight", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "two in-flight requests");
});

Given("Maya's access will expire before either responds", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "access will expire before either");
});

Given(
  "Maya is mid-flow with both chat and a transform preview open",
  function (this: UserFlowWorld) {
    notEnabled(this, "Maya mid-flow chat + transform");
  },
);

Given("Maya has sent a chat question", function (this: UserFlowWorld) {
  notEnabled(this, "Maya sent chat question (generic)");
});

Given(
  /^Maya's access renewal will take (\d+) seconds$/,
  function (this: UserFlowWorld, _secs: string) {
    notEnabled(this, "renewal takes N seconds");
  },
);

When("Maya's access expires mid-question", async function (
  this: UserFlowWorld,
) {
  notEnabled(this, "access expires mid-question");
});

When("Maya's access expires", async function (this: UserFlowWorld) {
  notEnabled(this, "access expires");
});

When("the flow-state service is restarted while Maya is mid-session", async function (
  this: UserFlowWorld,
) {
  notEnabled(this, "flow-state restart mid-session");
});

Then(
  /^within 100 milliseconds Maya sees a non-blocking "Refreshing your session\.\.\." banner$/,
  function (this: UserFlowWorld) {
    notEnabled(this, "refreshing session banner");
  },
);

Then("Maya's chat question replays without Maya re-typing it", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "chat question replays");
});

Then(
  "the streaming answer reaches Maya as if her access had not expired",
  function (this: UserFlowWorld) {
    notEnabled(this, "streaming answer reaches Maya");
  },
);

Then("the banner clears once the answer begins streaming", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "banner clears");
});

Then(
  "Maya sees a recoverable-error page worded for the sign-in-again case",
  function (this: UserFlowWorld) {
    notEnabled(this, "sign-in-again copy variant");
  },
);

Then(
  /^the reference code on the recoverable-error page is "([^"]+)"$/,
  function (this: UserFlowWorld, _code: string) {
    notEnabled(this, "ref code on error page");
  },
);

Then(
  "the reference code is the one from Maya's original question, not a new one from the renewal attempt",
  function (this: UserFlowWorld) {
    notEnabled(this, "ref code is original");
  },
);

Then("both Maya's requests pause together", function (this: UserFlowWorld) {
  notEnabled(this, "both requests pause");
});

Then("exactly one access renewal is performed", function (this: UserFlowWorld) {
  notEnabled(this, "exactly one renewal");
});

Then("both Maya's responses reach her after renewal completes", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "both responses reach Maya");
});

Then(
  /^Maya's "Apply transform" button is paused with a "Refreshing your session\.\.\." indicator$/,
  function (this: UserFlowWorld) {
    notEnabled(this, "apply transform paused");
  },
);

Then("Maya's transform is not duplicated when her access renews", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "transform not duplicated");
});

Then(
  /^after renewal Maya's "Apply transform" button is responsive again$/,
  function (this: UserFlowWorld) {
    notEnabled(this, "apply transform responsive after");
  },
);

Then("Maya's chat question is not replayed automatically", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "no auto-replay on overflow");
});

Then(
  "Maya's original question is preserved as a draft in the chat composer",
  function (this: UserFlowWorld) {
    notEnabled(this, "original question preserved as draft");
  },
);

Then(
  /^within 60 seconds Maya can continue without re-signing-in$/,
  function (this: UserFlowWorld) {
    notEnabled(this, "Maya continues within 60s");
  },
);

Then(
  /^Maya's active organization remains "([^"]+)"$/,
  function (this: UserFlowWorld, _name: string) {
    notEnabled(this, "active org unchanged after restart");
  },
);

// --------------------------------------------------------------------------
// Journey invariants
// --------------------------------------------------------------------------

Given("any sign-in attempt Maya makes", function (this: UserFlowWorld) {
  notEnabled(this, "any sign-in attempt (property)");
});

Given(
  "any sign-in attempt where Maya reaches the ready state",
  function (this: UserFlowWorld) {
    notEnabled(this, "any successful sign-in (property)");
  },
);

Given("Maya is on the welcome page", function (this: UserFlowWorld) {
  notEnabled(this, "Maya on welcome page (property)");
});

Given(
  "Maya has just submitted a valid organization name",
  function (this: UserFlowWorld) {
    notEnabled(this, "Maya submitted valid org");
  },
);

Given(
  "any in-flight request Maya has sent during a session",
  function (this: UserFlowWorld) {
    notEnabled(this, "any in-flight request");
  },
);

Given("Maya's access has just expired", function (this: UserFlowWorld) {
  notEnabled(this, "Maya access just expired");
});

When("the attempt emits any observable signal", function (this: UserFlowWorld) {
  notEnabled(this, "attempt emits signal");
});

When(
  "the harness inspects Maya's access token and the app shell",
  function (this: UserFlowWorld) {
    notEnabled(this, "harness inspects token + shell");
  },
);

When(
  "Maya submits an organization name that fails any validation rule",
  function (this: UserFlowWorld) {
    notEnabled(this, "Maya submits invalid org");
  },
);

When(
  "the organization row is created but the access reissue has not yet succeeded",
  function (this: UserFlowWorld) {
    notEnabled(this, "org created, reissue pending");
  },
);

When(
  "the request returns with an access-expired signal",
  function (this: UserFlowWorld) {
    notEnabled(this, "request returns access-expired");
  },
);

When("silent renewal is triggered", function (this: UserFlowWorld) {
  notEnabled(this, "silent renewal triggered");
});

Then(
  "every signal from that attempt carries the same reference code that was minted when she clicked sign in",
  function (this: UserFlowWorld) {
    notEnabled(this, "every signal carries minted ref code");
  },
);

Then(
  "the organization id on the token equals the organization id the app shell displays",
  function (this: UserFlowWorld) {
    notEnabled(this, "token org id equals shell org id");
  },
);

Then(
  "Maya stays on the welcome page with the form showing an inline error",
  function (this: UserFlowWorld) {
    notEnabled(this, "stay on welcome with inline error");
  },
);

Then(
  "no organization has been created in Maya's tenant",
  function (this: UserFlowWorld) {
    notEnabled(this, "no org created in tenant");
  },
);

Then("Maya does not see the app shell yet", function (this: UserFlowWorld) {
  notEnabled(this, "no app shell yet");
});

Then(
  /^Maya sees a "Creating\.\.\." indication until both writes are visible$/,
  function (this: UserFlowWorld) {
    notEnabled(this, "creating indication until both writes");
  },
);

Then(
  "the access-expired signal carries the reference code Maya's original request carried",
  function (this: UserFlowWorld) {
    notEnabled(this, "access-expired carries original ref code");
  },
);

Then(
  "exactly one renewal attempt is made before any user-visible recovery page appears",
  function (this: UserFlowWorld) {
    notEnabled(this, "exactly one renewal before recovery page");
  },
);
