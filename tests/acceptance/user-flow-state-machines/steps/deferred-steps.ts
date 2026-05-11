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
// --------------------------------------------------------------------------

Given(
  /^Maya has organization "([^"]+)" with project "([^"]+)" already set up$/,
  function (this: UserFlowWorld, _org: string, _project: string) {
    notEnabled(this, "Maya org + project pre-set-up");
  },
);

When(
  /^Maya opens the deep link to project "([^"]+)" cold$/,
  function (this: UserFlowWorld, _project: string) {
    notEnabled(this, "deep link to project cold");
  },
);

Then(
  /^Maya sees "([^"]+)" as the active organization on first paint$/,
  function (this: UserFlowWorld, _name: string) {
    notEnabled(this, "org chip on first paint");
  },
);

Then(
  /^Maya sees "([^"]+)" as the active project on first paint$/,
  function (this: UserFlowWorld, _name: string) {
    notEnabled(this, "project chip on first paint");
  },
);

Then(
  "Maya sees the project's dashboard content on the same first paint",
  function (this: UserFlowWorld) {
    notEnabled(this, "project dashboard content first paint");
  },
);

Then(
  /^no placeholder text \("Loading\.\.\.", "Default Project", or empty\) appears anywhere on first paint$/,
  function (this: UserFlowWorld) {
    notEnabled(this, "no placeholder text");
  },
);

Given(
  /^Maya belongs to organization "([^"]+)"$/,
  function (this: UserFlowWorld, _org: string) {
    notEnabled(this, "Maya belongs to org");
  },
);

Given(
  /^another tenant owns a project with id "([^"]+)"$/,
  function (this: UserFlowWorld, _id: string) {
    notEnabled(this, "foreign project precondition");
  },
);

When("Maya opens a deep link to the foreign project", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "open foreign project deep link");
});

Then("Maya sees an access-denied page", function (this: UserFlowWorld) {
  notEnabled(this, "access denied page");
});

Then(
  /^Maya's app shell continues to show "([^"]+)" as the active organization$/,
  function (this: UserFlowWorld, _name: string) {
    notEnabled(this, "shell still shows org");
  },
);

Then(
  /^the access-denied page names "([^"]+)" as the reason$/,
  function (this: UserFlowWorld, _reason: string) {
    notEnabled(this, "access denied reason");
  },
);

Given(
  /^Maya bookmarked project "([^"]+)" when its name was "([^"]+)"$/,
  function (this: UserFlowWorld, _now: string, _then: string) {
    notEnabled(this, "stale bookmark");
  },
);

Given(
  /^the project's name was later changed to "([^"]+)"$/,
  function (this: UserFlowWorld, _newName: string) {
    notEnabled(this, "project rename");
  },
);

When("Maya opens the stale bookmark", function (this: UserFlowWorld) {
  notEnabled(this, "open stale bookmark");
});

Then(
  "a scope-reconciled signal is observable by an accompanying test agent",
  function (this: UserFlowWorld) {
    notEnabled(this, "scope reconciled signal");
  },
);

Then("Maya is not asked to pick the project again", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "no re-pick project");
});

Given(
  /^Maya has project "([^"]+)"$/,
  function (this: UserFlowWorld, _project: string) {
    notEnabled(this, "Maya has project");
  },
);

When(
  /^Maya opens a deep link that names "([^"]+)" as the resource type with no resource id$/,
  function (this: UserFlowWorld, _type: string) {
    notEnabled(this, "deep link with type only");
  },
);

Then("no resource is shown as active in the chips", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "no resource chip");
});

Then(
  "Maya is not shown an error about a malformed link",
  function (this: UserFlowWorld) {
    notEnabled(this, "no malformed link error");
  },
);

// --------------------------------------------------------------------------
// Slice 2 — recoverable error UX
// --------------------------------------------------------------------------

Given(
  "the identity verification service is temporarily unavailable",
  function (this: UserFlowWorld) {
    notEnabled(this, "identity service unavailable");
  },
);

Given(
  "the identity verification service is now available",
  function (this: UserFlowWorld) {
    notEnabled(this, "identity service recovered");
  },
);

Given(
  /^Maya is on a recoverable-error page with reference code "([^"]+)"$/,
  function (this: UserFlowWorld, _code: string) {
    notEnabled(this, "Maya on recoverable error with ref code");
  },
);

Given("Maya's browser will block the sign-in cookie", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "browser blocks cookie");
});

Given(
  "Maya has already retried twice from a recoverable-error page",
  function (this: UserFlowWorld) {
    notEnabled(this, "retried twice");
  },
);

Given(
  "the identity verification service will fail Maya's third attempt",
  function (this: UserFlowWorld) {
    notEnabled(this, "third attempt fails");
  },
);

Given(
  "Maya has seen a recoverable-error page and successfully recovered via retry",
  function (this: UserFlowWorld) {
    notEnabled(this, "Maya recovered via retry");
  },
);

When(/^Maya clicks "Try again"(?: a third time)?$/, function (
  this: UserFlowWorld,
) {
  notEnabled(this, "Maya clicks try again");
});

Then(
  /^Maya sees a recoverable-error page titled "([^"]+)"$/,
  function (this: UserFlowWorld, _title: string) {
    notEnabled(this, "recoverable error title");
  },
);

Then(/^the page reads "([^"]+)"$/, function (this: UserFlowWorld, _text: string) {
  notEnabled(this, "recoverable error body copy");
});

Then(
  /^Maya sees a primary "Try again" action$/,
  function (this: UserFlowWorld) {
    notEnabled(this, "try again action");
  },
);

Then(
  "Maya sees a reference code she can share with support",
  function (this: UserFlowWorld) {
    notEnabled(this, "reference code visible");
  },
);

Then(
  "Maya does not see a raw error message or a status code at any point",
  function (this: UserFlowWorld) {
    notEnabled(this, "no raw error/status code");
  },
);

Then(
  /^the second attempt is findable in the support trail by reference code "([^"]+)"$/,
  function (this: UserFlowWorld, _code: string) {
    notEnabled(this, "support trail by ref code");
  },
);

Then(
  "Maya sees a recoverable-error page worded for the cookie-blocked case",
  function (this: UserFlowWorld) {
    notEnabled(this, "cookie blocked copy variant");
  },
);

Then(
  "the page suggests allowing cookies for the application or trying another browser",
  function (this: UserFlowWorld) {
    notEnabled(this, "cookie-blocked suggestion copy");
  },
);

Then(
  "Maya sees a contact-support page rather than another retry button",
  function (this: UserFlowWorld) {
    notEnabled(this, "contact support page");
  },
);

Then(
  "Maya's reference code remains visible on the contact-support page",
  function (this: UserFlowWorld) {
    notEnabled(this, "ref code on contact support");
  },
);

Then("Maya is not offered another retry from this page", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "no retry on contact support");
});

Then(
  "an accompanying test agent can observe a recoverable-error-shown signal carrying Maya's reference code",
  function (this: UserFlowWorld) {
    notEnabled(this, "KPI: recoverable-error-shown");
  },
);

Then(
  "an accompanying test agent can observe a retry-clicked signal carrying Maya's reference code",
  function (this: UserFlowWorld) {
    notEnabled(this, "KPI: retry-clicked");
  },
);

Then(
  "an accompanying test agent can observe a ready-reached signal carrying the same reference code",
  function (this: UserFlowWorld) {
    notEnabled(this, "KPI: ready-reached");
  },
);

// --------------------------------------------------------------------------
// Slice 2 — harness drives transitions (US-004)
// --------------------------------------------------------------------------

When("the test harness begins Maya's sign-in", async function (
  this: UserFlowWorld,
) {
  notEnabled(this, "harness begin sign-in");
});

Then("the harness reports Maya is in the post-sign-in state", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "harness reports post-sign-in state");
});

Then(
  /^the harness reports Maya's email is "([^"]+)"$/,
  function (this: UserFlowWorld, _email: string) {
    notEnabled(this, "harness reports email");
  },
);

Given("the harness has begun Maya's sign-in", async function (
  this: UserFlowWorld,
) {
  notEnabled(this, "harness has begun sign-in");
});

When(
  /^the harness submits "([^"]+)" as Maya's organization$/,
  async function (this: UserFlowWorld, _name: string) {
    notEnabled(this, "harness submits org");
  },
);

Then("the harness reports Maya is in the ready state", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "harness reports ready");
});

Then(
  "the harness reports Maya's access token carries the organization id Maya now owns",
  function (this: UserFlowWorld) {
    notEnabled(this, "harness reports JWT carries org claim");
  },
);

Given(
  /^the harness has begun Maya's sign-in with reference code "([^"]+)"$/,
  function (this: UserFlowWorld, _code: string) {
    notEnabled(this, "harness sign-in with ref code");
  },
);

When(
  "the harness forces a transient identity-verification failure",
  async function (this: UserFlowWorld) {
    notEnabled(this, "harness forces transient failure");
  },
);

Then("the harness reports Maya is in the recoverable-error state", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "harness reports recoverable-error");
});

Then(
  /^the harness reports the displayed reference code is "([^"]+)"$/,
  function (this: UserFlowWorld, _code: string) {
    notEnabled(this, "harness reports displayed ref code");
  },
);

Given(
  /^the harness has driven Maya to the ready state with project "([^"]+)" active$/,
  function (this: UserFlowWorld, _project: string) {
    notEnabled(this, "harness drove to ready with project");
  },
);

When(
  /^a developer asserts Maya's scope matches organization "([^"]+)" and a different project "([^"]+)"$/,
  function (this: UserFlowWorld, _org: string, _project: string) {
    notEnabled(this, "developer asserts mismatched scope");
  },
);

Then(
  /^the assertion fails with output that names "([^"]+)" as the diverged dimension$/,
  function (this: UserFlowWorld, _dim: string) {
    notEnabled(this, "scope diff names dimension");
  },
);

Then(
  "the failure output names the expected and actual project on separate lines",
  function (this: UserFlowWorld) {
    notEnabled(this, "scope diff named-column format");
  },
);

Given(
  "the harness has driven Maya to the ready state without a project chosen",
  function (this: UserFlowWorld) {
    notEnabled(this, "harness drove to ready no project");
  },
);

When("a downstream chat turn is sent without an active project", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "downstream chat turn missing scope");
});

Then(
  /^the harness surfaces a test failure naming "([^"]+)"$/,
  function (this: UserFlowWorld, _msg: string) {
    notEnabled(this, "harness surfaces missing scope diagnostic");
  },
);

Then(
  "the failure points at the scope contract, not at the chat agent's internal state",
  function (this: UserFlowWorld) {
    notEnabled(this, "diagnostic points at scope contract");
  },
);

Given(
  /^the harness has driven Maya to the ready state with organization "([^"]+)"$/,
  function (this: UserFlowWorld, _org: string) {
    notEnabled(this, "harness drove to ready with org");
  },
);

When("a sibling flow harness for transforms is initialized", function (
  this: UserFlowWorld,
) {
  notEnabled(this, "sibling harness initialized");
});

Then(
  "the sibling harness sees Maya is signed in and her organization is set up",
  function (this: UserFlowWorld) {
    notEnabled(this, "sibling harness sees auth+org");
  },
);

Then(
  "no additional sign-in calls are needed in the sibling harness's setup",
  function (this: UserFlowWorld) {
    notEnabled(this, "no duplicate sign-in calls");
  },
);

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
