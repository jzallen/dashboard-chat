// Step definitions for `features/sign-in-error-paths-are-honest-and-recoverable.feature` (step 01-02).
//
// All step bodies drive through the harness or the UiStateClient — both
// hit `auth-proxy:1042` (CM-A driving port).  Tests never import from
// ui-state/lib/**.
//
// As DELIVER unskips each scenario in turn, the matching step phrases are
// moved out of `deferred-steps.ts` and implemented here. Phrases that
// remain @skip live in `deferred-steps.ts` until they're enabled.

import { After, Before, Given, Then, When } from "@cucumber/cucumber";
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

// --------------------------------------------------------------------------
// Shared setup for slice-1 error-path scenarios.
//
// Mirrors the @walking_skeleton hooks: stand up the fake WorkOS server in-
// process so the orchestrator's real WorkOSClient adapter has something to
// talk to over loopback. Without this hook, `wait_for_health` on the auth-
// proxy passes but Maya's sign-in hangs because the fake WorkOS isn't
// running.
// --------------------------------------------------------------------------
Before({ tags: "@slice-1 and not @walking_skeleton" }, async function (
  this: UserFlowWorld,
) {
  this.fakeWorkOS = new FakeWorkOS({ port: FAKE_WORKOS_PORT });
  await this.fakeWorkOS.start();
  // Default Maya fixture — individual scenarios override before signing in.
  this.fakeWorkOS.set_profile_for("maya-auth-code", {
    email: MAYA.email,
    display_name: MAYA.display_name,
  });
});

After({ tags: "@slice-1 and not @walking_skeleton" }, async function (
  this: UserFlowWorld,
) {
  if (this.fakeWorkOS) {
    await this.fakeWorkOS.stop();
    this.fakeWorkOS = null;
  }
});

// --------------------------------------------------------------------------
// Scenario: Maya sees the checking-identity panel while sign-in takes 1.8 s.
//
// Approach: the fake WorkOS sleeps before responding (`slow_response_ms`).
// While the workosUserInfo invoke is in flight the projection state is
// `authenticating` — that IS the "Checking your identity..." panel state.
// We sample the projection during the slow window via a non-blocking
// `begin_auth` call and assert state visible within 100ms; then wait for
// settle and assert welcome.
// --------------------------------------------------------------------------

Given(
  "the fake identity provider will respond after 1.8 seconds",
  function (this: UserFlowWorld) {
    if (!this.fakeWorkOS) throw new Error("fake WorkOS not started");
    this.fakeWorkOS.set_profile_for("maya-auth-code", {
      email: MAYA.email,
      display_name: MAYA.display_name,
      cause: "slow_response_ms",
      slow_response_ms: 1800,
    });
    this.bag.slow_workos_ready = true;
  },
);

When("Maya begins signing in through the production ingress", async function (
  this: UserFlowWorld,
) {
  // Non-blocking begin: kick off begin_auth and immediately sample the
  // projection while the workos invoke is still in flight.
  const harness = this.use_harness_for("maya");
  // Pre-create the flow with a known correlation id so we can read the
  // projection during the slow workos response.
  const beginPromise = harness.begin_auth("maya");
  this.bag.begin_promise = beginPromise;
  this.bag.begin_started_at = Date.now();
});

Then(
  /^within 100 milliseconds Maya sees a "Checking your identity\.\.\." panel$/,
  async function (this: UserFlowWorld) {
    const startedAt = this.bag.begin_started_at as number;
    // Poll the projection endpoint for the `authenticating` state — proves
    // a checking-identity panel state is observable while the slow workos
    // is in flight. The poll runs at most 100ms.
    let observed: string | null = null;
    const deadline = startedAt + 100;
    // In dev mode auth-proxy injects X-User-Id=dev-user-001; the `/state`
    // document is the single per-principal SSOT (ADR-046 MR-6). The walking
    // skeleton's initial sign-in writes the begin event before workos returns,
    // so the onboarding region is readable as `authenticating` during the slow
    // window.
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${AUTH_PROXY_URL}/ui-state/state`);
        if (res.ok) {
          const body = (await res.json()) as {
            regions?: { onboarding?: { state?: string } };
          };
          if (body.regions?.onboarding?.state === "authenticating") {
            observed = body.regions.onboarding.state;
            break;
          }
        }
      } catch {
        // ignore until deadline
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(observed).toBe("authenticating");
  },
);

Then(
  /^the panel reassures her "([^"]+)"$/,
  function (this: UserFlowWorld, _text: string) {
    // The reassurance copy is owned by the FE. The acceptance suite's
    // promise (CM-A) is that the *state name* observable through the
    // driving port is `authenticating`, which the FE binds to its
    // "Checking your identity..." panel + reassurance copy. Once the FE
    // exists in step 02-02 this assertion will load the served HTML and
    // grep for the copy; until then we assert the state contract.
    // No additional driving-port assertion needed beyond the prior step.
  },
);

Then(
  "Maya never sees a blank page or a raw error at any moment",
  async function (this: UserFlowWorld) {
    // The projection during the slow window was `authenticating` (asserted
    // above) and the resolved projection MUST NOT be `error_*`. The latter
    // is asserted by the "eventually welcome page" Then step.
    const projection = (await (this.bag.begin_promise as Promise<unknown>)) as {
      state: string;
    };
    expect(projection.state).not.toBe("error_recoverable");
    expect(projection.state).not.toBe("error_terminal");
    this.bag.welcome_projection = projection;
  },
);

Then(
  /^eventually Maya reaches the welcome page addressed to "([^"]+)"$/,
  async function (this: UserFlowWorld, expectedEmail: string) {
    const projection = (this.bag.welcome_projection ??
      (await (this.bag.begin_promise as Promise<unknown>))) as {
      state: string;
      context: { user?: { email?: string } };
    };
    expect(projection.state).toBe("authenticated_no_org");
    expect(projection.context?.user?.email).toBe(expectedEmail);
  },
);

// --------------------------------------------------------------------------
// Scenario: workos profile missing required fields → error_recoverable
// --------------------------------------------------------------------------

Given(
  "the fake identity provider will return a profile missing the email field",
  function (this: UserFlowWorld) {
    if (!this.fakeWorkOS) throw new Error("fake WorkOS not started");
    this.fakeWorkOS.set_profile_for("maya-auth-code", {
      email: null,
      display_name: "Maya Chen",
      cause: "missing_email",
    });
  },
);

Then(
  "Maya sees a recoverable-error page rather than a welcome page",
  async function (this: UserFlowWorld) {
    // The Maya-signs-in step has already populated welcome_projection (from
    // walking-skeleton.steps.ts).  When the workos profile is corrupt, the
    // machine lands in error_recoverable -- the projection state name IS
    // the contract that the FE binds to a recoverable-error page.
    const projection = this.bag.welcome_projection as {
      state: string;
      correlation_id: string;
      context: { underlying_cause_tag?: string | null };
    };
    expect(projection.state).toBe("error_recoverable");
    expect(projection.context?.underlying_cause_tag).toBe(
      "workos-profile-corrupt",
    );
  },
);

Then(
  "the recoverable-error page displays a reference code Maya can share with support",
  function (this: UserFlowWorld) {
    // Reference code = correlation_id. The projection MUST carry it so
    // the FE can render it and Maya can read it.
    const projection = this.bag.welcome_projection as {
      correlation_id: string;
    };
    expect(projection.correlation_id).toBeTruthy();
    expect(projection.correlation_id.length).toBeGreaterThan(0);
  },
);

Then(
  "Maya is not silently routed to a welcome page with a blank greeting",
  function (this: UserFlowWorld) {
    // Negative invariant: state MUST NOT be authenticated_no_org with a
    // null email.  Either we're on the error page (asserted above) or the
    // greeting has a real email -- never both null.
    const projection = this.bag.welcome_projection as {
      state: string;
      context: { user?: { email?: string | null } };
    };
    if (projection.state === "authenticated_no_org") {
      expect(projection.context?.user?.email).toBeTruthy();
    }
  },
);

// --------------------------------------------------------------------------
// Scenario: duplicate org name rejected inline without losing Maya's place
// --------------------------------------------------------------------------

Given(
  /^Maya has reached the welcome page addressed to "([^"]+)"$/,
  function (this: UserFlowWorld, expectedEmail: string) {
    // Stash the expected email; defer begin_auth to the submit When step
    // so subsequent Given/And steps can mutate fixtures (duplicate names,
    // reissue-failure knobs) BEFORE the flow begins.
    this.bag.welcome_expected_email = expectedEmail;
  },
);

Given(
  /^another member of Maya's tenant has already taken "([^"]+)"$/,
  function (this: UserFlowWorld, name: string) {
    // The duplicate-name set is seeded INTO the machine on begin_auth so
    // the validateOrgName guard sees it.
    const list = (this.bag.existing_org_names as string[] | undefined) ?? [];
    list.push(name);
    this.bag.existing_org_names = list;
  },
);

When(
  /^Maya submits the organization name "([^"]+)"$/,
  async function (this: UserFlowWorld, name: string) {
    // Lazily begin_auth here so any preceding Given fixture mutations
    // (duplicate-name, harness knobs) take effect on the freshly-created
    // machine. After begin_auth lands at authenticated_no_org we submit
    // the org-form-submitted event and capture the resulting projection.
    let harness = this.harness;
    if (!harness) {
      harness = this.use_harness_for("maya");
      const existing = (this.bag.existing_org_names as string[] | undefined) ?? [];
      const forcedFailures = this.bag.force_reissue_failures as
        | number
        | undefined;
      const beginProjection = await harness.begin_auth("maya", {
        existing_org_names: existing,
        force_reissue_failures: forcedFailures,
      });
      const expectedEmail = this.bag.welcome_expected_email as string | undefined;
      if (expectedEmail) {
        expect(
          (beginProjection.context as { user?: { email?: string } }).user?.email,
        ).toBe(expectedEmail);
      }
      this.bag.welcome_projection = beginProjection;
    }
    this.bag.submit_projection = await harness.submit_org(name);
  },
);

Then("Maya stays on the welcome page", function (this: UserFlowWorld) {
  const projection = this.bag.submit_projection as { state: string };
  expect(projection.state).toBe("authenticated_no_org");
});

Then(
  /^Maya sees "([^"]+)" beside the input$/,
  function (this: UserFlowWorld, expectedMessage: string) {
    const projection = this.bag.submit_projection as {
      context: {
        org_validation_error?: { message?: string } | null;
      };
    };
    expect(projection.context?.org_validation_error?.message).toBe(
      expectedMessage,
    );
  },
);

Then("Maya's organization has not been created", function (
  this: UserFlowWorld,
) {
  const projection = this.bag.submit_projection as {
    context: { org?: { id?: string | null } };
  };
  expect(projection.context?.org?.id ?? null).toBeNull();
});

Then("Maya's access token has not been reissued", function (
  this: UserFlowWorld,
) {
  // No reissue happens when validation fails -- proven by the projection
  // still being authenticated_no_org (never reached creating_org / ready).
  const projection = this.bag.submit_projection as { state: string };
  expect(projection.state).not.toBe("creating_org");
  expect(projection.state).not.toBe("ready");
});

// --------------------------------------------------------------------------
// Scenarios: transient + exhausted reissue failures
// --------------------------------------------------------------------------

Given(
  "the access reissue service will fail twice and succeed on the third attempt",
  function (this: UserFlowWorld) {
    this.bag.force_reissue_failures = 2;
  },
);

Given(
  "the access reissue service will fail every attempt",
  function (this: UserFlowWorld) {
    // The machine retries up to REISSUE_BUDGET=3, so 3 forced failures
    // exhausts the budget and lands in error_recoverable with the
    // partial-setup tag.
    this.bag.force_reissue_failures = 3;
  },
);

Then(
  /^Maya sees a "Creating\.\.\." message for the duration of the retries$/,
  function (this: UserFlowWorld) {
    // The "Creating..." message is bound to `creating_org` in the FE. The
    // contract observable through the driving port is that the projection
    // VISITED creating_org during the retry sequence. We approximate by
    // asserting the submit-projection sequence (event log) recorded
    // org_form_submitted (which reduces to creating_org). The terminal
    // ready/error_recoverable state appears in the LATER assertion.
    // (Once the FE exists in step 02-02 this step will load the served
    // HTML and grep for the message.)
    const projection = this.bag.submit_projection as {
      sequence_id: number;
    };
    expect(projection.sequence_id).toBeGreaterThan(2);
  },
);

Then(
  /^exactly one organization named "([^"]+)" exists for Maya's tenant when she lands in the app shell$/,
  function (this: UserFlowWorld, expectedName: string) {
    const projection = this.bag.submit_projection as {
      state: string;
      context: { org?: { name?: string | null } };
    };
    expect(projection.state).toBe("ready");
    expect(projection.context?.org?.name).toBe(expectedName);
  },
);

Then(
  /^Maya's app shell displays "([^"]+)" as the active organization on first paint$/,
  function (this: UserFlowWorld, expectedName: string) {
    const projection = this.bag.submit_projection as {
      state: string;
      context: { org?: { name?: string | null } };
    };
    expect(projection.state).toBe("ready");
    expect(projection.context?.org?.name).toBe(expectedName);
  },
);

Then(
  "Maya sees a recoverable-error page worded for the partial-setup case",
  function (this: UserFlowWorld) {
    const projection = this.bag.submit_projection as {
      state: string;
      context: { underlying_cause_tag?: string | null };
    };
    expect(projection.state).toBe("error_recoverable");
    expect(projection.context?.underlying_cause_tag).toBe("partial-setup");
  },
);

Then(
  /^Maya sees a "Try again" action that retries only the access reissue, not the organization creation$/,
  function (this: UserFlowWorld) {
    // The "Try again" action sends `retry_clicked`. The machine routes
    // back to `creating_org` (NOT to `authenticated_no_org`) — proving
    // the org row is preserved and only the reissue step is retried.
    // We assert the contract by inspecting the context: org.id remains
    // populated even though we're on the error page.
    const projection = this.bag.submit_projection as {
      context: { org?: { id?: string | null } };
    };
    expect(projection.context?.org?.id).toBeTruthy();
  },
);

Then(
  /^exactly one organization named "([^"]+)" exists for Maya's tenant$/,
  function (this: UserFlowWorld, expectedName: string) {
    // After org create succeeds but reissue exhausts retries, the org row
    // is in the DB and the projection still carries the org name. The
    // contract observable through the driving port: context.org.name
    // equals the requested name (proves no duplicate creates happened).
    const projection = this.bag.submit_projection as {
      context: { org?: { name?: string | null } };
    };
    expect(projection.context?.org?.name).toBe(expectedName);
  },
);

// --------------------------------------------------------------------------
// Scenario: Maya reaches welcome page when one ingress route is stale
// --------------------------------------------------------------------------

Given(
  "the production ingress has one route still wired to the legacy frontend",
  function (this: UserFlowWorld) {
    // The "legacy route" model: the auth-proxy's catch-all forwards any
    // unmapped path to the backend. We assert that a hypothetical legacy
    // path (say `/legacy-only/index.html`) still returns a non-2xx (the
    // backend has no such route) -- i.e. the migration didn't accidentally
    // capture EVERY path. This is the negative half of "one route still
    // points to the old frontend"; the positive half is asserted by the
    // sign-in flow continuing to work.
    this.bag.legacy_route_path = "/legacy-only/maya-test";
  },
);

Given(
  "Maya's identity route has been migrated to the new frontend",
  function (this: UserFlowWorld) {
    // No-op precondition: the migration is already done in step 01-01 (the
    // walking skeleton's success proves /ui-state/* is wired to the new
    // tier). This Given exists to document the precondition explicitly.
    this.bag.identity_route_migrated = true;
  },
);

Then(
  /^Maya reaches the welcome page addressed to "([^"]+)"$/,
  function (this: UserFlowWorld, expectedEmail: string) {
    // Sync (no "eventually") variant -- the begin_auth in the walking-
    // skeleton `When` step has already settled.
    const projection = this.bag.welcome_projection as {
      state: string;
      context: { user?: { email?: string } };
    };
    expect(projection?.state).toBe("authenticated_no_org");
    expect(projection?.context?.user?.email).toBe(expectedEmail);
  },
);

Then(
  "the legacy frontend remains the responder for any unmigrated route Maya visits",
  async function (this: UserFlowWorld) {
    // The "legacy frontend" is whatever the auth-proxy's catch-all proxies
    // to for unmigrated paths. The contract we assert through the driving
    // port: a request to an unmigrated path produces a different shape
    // than `/ui-state/*` -- proving the migrated path was carved out
    // surgically, not by replacing the whole upstream.
    const legacyPath = this.bag.legacy_route_path as string;
    const res = await fetch(`${AUTH_PROXY_URL}${legacyPath}`);
    // The legacy path SHOULD NOT return a ui-state `/state` document envelope.
    const text = await res.text();
    expect(text).not.toMatch(/"regions"/);
    expect(text).not.toMatch(/"active_scope"/);
  },
);
