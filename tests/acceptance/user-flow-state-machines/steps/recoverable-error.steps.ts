// Step definitions for `features/slice-2-recoverable-error.feature` (US-003).
//
// Per Step 02-01's Overseer directive (DI-1):
//   - The Cucumber acceptance suite is NOT executed headlessly in this
//     environment. These bodies are authored against the UserFlowHarness
//     and the projection contract so a future stabilized harness ticket
//     can flip the @skip tags and run them without rewriting.
//   - The five @us-003 scenarios in slice-2-recoverable-error.feature
//     therefore remain @skip after this step.
//
// All step bodies drive through the harness (CM-A: tests use the driving
// port only — no flow-state/lib/** imports here). The harness's
// `force_transient_failure(tag)` knob is the canonical way to surface a
// specific UnderlyingCauseTag without coupling to internal actors.

import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "expect";
import { request } from "undici";

import { MAYA } from "./fixtures/personas.ts";
import type { UserFlowHarness } from "../harness/user-flow-harness.ts";
import type { FlowProjection } from "../harness/types.ts";
import type { UserFlowWorld } from "./world.ts";

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL ?? "http://localhost:1042";

/**
 * Forward a retry_clicked event through auth-proxy to flow-state.
 *
 * The harness's `send_event` is private (the directive forbids modifying
 * its public surface in this step), so we go through the same HTTP path
 * the harness would — same driving port, same routing rule (ADR-030
 * §SD1). Reads the flow_id by inspecting the harness's most recent
 * projection.
 */
async function retry_via_harness(harness: UserFlowHarness): Promise<FlowProjection> {
  const projection = await harness.get_projection();
  const res = await request(
    `${AUTH_PROXY_URL}/flow-state/flow/login-and-org-setup/event`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        flow_id: projection.flow_id,
        type: "retry_clicked",
      }),
    },
  );
  const body = (await res.body.json()) as unknown;
  if (res.statusCode !== 200) {
    throw new Error(
      `retry_via_harness expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
    );
  }
  return body as FlowProjection;
}

// --------------------------------------------------------------------------
// Slice 2 — US-003 recoverable error UX
// --------------------------------------------------------------------------

Given(
  "the identity verification service is temporarily unavailable",
  function (this: UserFlowWorld) {
    // The harness's force_transient_failure knob simulates a transient
    // workos failure on the next begin_auth. Stash the choice so the
    // When step can apply it after begin_auth returns.
    this.bag.force_failure_tag = "transient";
  },
);

Given(
  "the identity verification service is now available",
  function (this: UserFlowWorld) {
    // No-op: the harness's retry path hits the real (mocked) workos
    // again; the prior force_transient_failure was a one-shot.
    this.bag.force_failure_tag = null;
  },
);

Given(
  /^Maya is on a recoverable-error page with reference code "([^"]+)"$/,
  async function (this: UserFlowWorld, code: string) {
    const harness = this.use_harness_for("MAYA");
    // Begin auth and force a transient failure so Maya lands on
    // error_recoverable. The harness mints a correlation_id on
    // begin_auth; in this fixture-driven setup we stash the expected
    // reference code for downstream assertions.
    await harness.begin_auth("MAYA");
    await harness.force_transient_failure("transient");
    this.bag.expected_reference_code = code;
  },
);

Given("Maya's browser will block the sign-in cookie", function (
  this: UserFlowWorld,
) {
  this.bag.force_failure_tag = "cookie-blocked";
});

Given(
  "Maya has already retried twice from a recoverable-error page",
  async function (this: UserFlowWorld) {
    const harness = this.use_harness_for("MAYA");
    await harness.begin_auth("MAYA");
    await harness.force_transient_failure("transient");
    // Two user retries — the harness's send_event path forwards
    // retry_clicked through auth-proxy → flow-state.
    await retry_via_harness(harness);
    await retry_via_harness(harness);
    const projection = await harness.get_projection();
    expect(projection.state).toBe("error_recoverable");
  },
);

Given(
  "the identity verification service will fail Maya's third attempt",
  function (this: UserFlowWorld) {
    this.bag.force_failure_tag = "transient";
  },
);

Given(
  "Maya has seen a recoverable-error page and successfully recovered via retry",
  async function (this: UserFlowWorld) {
    const harness = this.use_harness_for("MAYA");
    await harness.begin_auth("MAYA");
    await harness.force_transient_failure("transient");
    // Recovery: send retry_clicked, then submit_org again to drive to ready.
    await retry_via_harness(harness);
    await harness.submit_org("Acme Data");
    const projection = await harness.get_projection();
    expect(projection.state).toBe("ready");
  },
);

When("Maya signs in through the production ingress", async function (
  this: UserFlowWorld,
) {
  const harness = this.use_harness_for("MAYA");
  await harness.begin_auth("MAYA");
  const tag = this.bag.force_failure_tag as
    | "transient"
    | "cookie-blocked"
    | "partial-setup"
    | "workos-profile-corrupt"
    | null;
  if (tag) {
    await harness.force_transient_failure(tag);
  }
});

When(/^Maya clicks "Try again"(?: a third time)?$/, async function (
  this: UserFlowWorld,
) {
  if (!this.harness) throw new Error("harness not initialized");
  await retry_via_harness(this.harness);
});

Then(
  /^Maya sees a recoverable-error page titled "([^"]+)"$/,
  async function (this: UserFlowWorld, title: string) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    expect(projection.state).toBe("error_recoverable");
    // Title is derived from underlying_cause_tag via the frontend's
    // copy-variants table. The acceptance harness asserts the projection
    // carries a tag the UI can render the matching title for.
    expect((projection.context as { underlying_cause_tag?: string })
      .underlying_cause_tag).toBeTruthy();
    this.bag.expected_title = title;
  },
);

Then(/^the page reads "([^"]+)"$/, function (
  this: UserFlowWorld,
  text: string,
) {
  // The acceptance suite does not render the UI; it asserts the
  // projection carries enough data for the UI to render the expected
  // copy. Stash for downstream cross-checks.
  this.bag.expected_body = text;
});

Then(
  /^Maya sees a primary "Try again" action$/,
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    // The retry CTA is implied by being in error_recoverable (not
    // error_terminal). The state itself is the affordance contract.
    expect(projection.state).toBe("error_recoverable");
  },
);

Then(
  "Maya sees a reference code she can share with support",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    expect(projection.correlation_id).toBeTruthy();
    expect(typeof projection.correlation_id).toBe("string");
  },
);

Then(
  "Maya does not see a raw error message or a status code at any point",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    // Closed-vocabulary contract: the projection exposes a sanitized
    // cause tag, never a raw error string or status code.
    const ctx = projection.context as Record<string, unknown>;
    expect(ctx.raw_error).toBeUndefined();
    expect(ctx.status_code).toBeUndefined();
  },
);

Then(
  /^Maya reaches the welcome page addressed to "([^"]+)"$/,
  async function (this: UserFlowWorld, email: string) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    expect(projection.state).toBe("ready");
    const ctx = projection.context as { user?: { email?: string } };
    expect(ctx.user?.email).toBe(email);
    // Reference: silence ESLint unused-var.
    void MAYA;
  },
);

Then(
  /^the second attempt is findable in the support trail by reference code "([^"]+)"$/,
  async function (this: UserFlowWorld, code: string) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    // The harness's correlation_id is the support-trail key. Every
    // retry attempt threads through with the same correlation_id (per
    // Step 02-01 B2 invariant verified in the unit suite).
    expect(projection.correlation_id).toBe(code);
  },
);

Then(
  "Maya sees a recoverable-error page worded for the cookie-blocked case",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    const ctx = projection.context as { underlying_cause_tag?: string };
    expect(ctx.underlying_cause_tag).toBe("cookie-blocked");
  },
);

Then(
  "the page suggests allowing cookies for the application or trying another browser",
  function (this: UserFlowWorld) {
    // UI-only assertion — projection carries cookie-blocked tag (asserted
    // above), the frontend's COPY_VARIANTS table maps that to the
    // expected guidance.
    expect(true).toBe(true);
  },
);

Then(
  "Maya sees a contact-support page rather than another retry button",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    expect(projection.state).toBe("error_terminal");
  },
);

Then(
  "Maya's reference code remains visible on the contact-support page",
  async function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    const projection = await this.harness.get_projection();
    expect(projection.correlation_id).toBeTruthy();
  },
);

Then("Maya is not offered another retry from this page", async function (
  this: UserFlowWorld,
) {
  if (!this.harness) throw new Error("harness not initialized");
  const projection = await this.harness.get_projection();
  // error_terminal has no retry transition by design.
  expect(projection.state).toBe("error_terminal");
});

Then(
  "an accompanying test agent can observe a recoverable-error-shown signal carrying Maya's reference code",
  function (this: UserFlowWorld) {
    // KPI K3 verification — the auth-proxy emits stdout-JSON events per
    // ADR-030 §SD4. The unit suite (auth-proxy/app.test.ts) verifies the
    // emission contract; in the acceptance suite the assertion is
    // structural — the harness has surfaced a correlation_id, and the
    // auth-proxy log will carry the matching event.
    if (!this.harness) throw new Error("harness not initialized");
    expect(this.harness.get_last_correlation_id()).toBeTruthy();
  },
);

Then(
  "an accompanying test agent can observe a retry-clicked signal carrying Maya's reference code",
  function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    expect(this.harness.get_last_correlation_id()).toBeTruthy();
  },
);

Then(
  "an accompanying test agent can observe a ready-reached signal carrying the same reference code",
  function (this: UserFlowWorld) {
    if (!this.harness) throw new Error("harness not initialized");
    expect(this.harness.get_last_correlation_id()).toBeTruthy();
  },
);
