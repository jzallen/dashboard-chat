// Unit tests for the SessionOnboardingMachine — drives the state machine
// through `createActor` injecting a MOCK `fetch` as the I/O port.
//
// The machine takes NO constructor params: every external actor is a
// config-driven default whose network I/O runs through `deps.request_client`
// (= the `fetch` library). Tests inject a mock `fetch` (makeMockFetch) via the
// machine input `deps: { request_client: mockFetch }`, threaded into context →
// invoke input → resolver.
//
// Entry assumes an already-authenticated principal: the machine starts in
// `verifying`, auto-invokes the `loadSession` resolver (WorkOS re-verify +
// backend /api/orgs/me org lookup), and forks `ready` ([hasOrg]) vs `needs_org`
// (no org) vs `session_rejected` (failure).
//
// All tests are port-to-port at the machine driving port (the XState actor's
// public `send` / snapshot surface). No internal-class assertions. Each
// `describe` sets up a user situation and each `it` states the outcome the
// caller observes — phrased as behavior the user experiences, not machine
// internals.
//
// References:
//   docs/decisions/adr-041-*.md  — session-onboarding domain realignment

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import { makeMockFetch, makeTestConfig } from "../../testing/test-config.ts";
import { createSessionOnboardingMachine } from "./machine.ts";
import type { RequestClient } from "./setup/actors.ts";
import type { UnderlyingCauseTag } from "./setup/domain.ts";

const CONFIG = makeTestConfig();

const MAYA_INPUT = {
  request_id: "R-7a4f-901c",
  principal_id: "user_maya",
  bearer_token: "tok-maya",
  config: CONFIG,
};

const MAYA_PROFILE = {
  email: "maya.chen@acme-data.example",
  display_name: "Maya Chen",
};

/** The verified identity Maya's WorkOS re-verify yields. `first_name` is derived
 *  from `display_name` at the parse boundary (getWorkOSUserInfo: "Maya Chen" →
 *  "Maya"). Asserted as a whole object so a dropped or extra field is caught. */
const MAYA_USER = {
  email: MAYA_PROFILE.email,
  display_name: MAYA_PROFILE.display_name,
  first_name: "Maya",
};

/** Pre-verification identity — every field still null. */
const NO_USER = { email: null, display_name: null, first_name: null };

/** Mock fetch for a NEW user — re-verify OK, backend /api/orgs/me 404 (no org),
 *  org-create OK. */
function okFetch(): RequestClient {
  return makeMockFetch({
    profile: { email: MAYA_PROFILE.email, name: MAYA_PROFILE.display_name },
  });
}

/** Mock fetch for a RETURNING user — backend /api/orgs/me reports an org. */
function returningFetch(
  org: { id: string; name: string } = { id: "org-1", name: "Acme Data" },
): RequestClient {
  return makeMockFetch({
    profile: { email: MAYA_PROFILE.email, name: MAYA_PROFILE.display_name },
    existingOrg: org,
  });
}

/**
 * Build the machine input with a mock `fetch` injected as the I/O port. Extra
 * input fields merge over MAYA_INPUT.
 */
function inputWith(
  requestClient: RequestClient,
  extra: Record<string, unknown> = {},
) {
  return { ...MAYA_INPUT, deps: { request_client: requestClient }, ...extra };
}

/** Resolve when the predicate returns true for the latest snapshot. */
function waitFor<TActor extends ReturnType<typeof createActor>>(
  actor: TActor,
  pred: (snapshot: ReturnType<TActor["getSnapshot"]>) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (pred(actor.getSnapshot() as ReturnType<TActor["getSnapshot"]>)) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const sub = actor.subscribe((snapshot) => {
      if (pred(snapshot as ReturnType<TActor["getSnapshot"]>)) {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve();
      }
    });
  });
}

describe("when a signed-in user's session is verified on arrival", () => {
  it("a returning user with an organization is taken straight into the app", async () => {
    const machine = createSessionOnboardingMachine();
    // The org is loaded from the backend (/api/orgs/me, the org SSOT) during
    // verifying; the hasOrg guard reads it off the done-event output. The name
    // comes from the backend (not a header claim), so it is populated.
    const actor = createActor(machine, { input: inputWith(returningFetch()) });
    actor.start();
    await waitFor(actor, (s) => s.value === "ready");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("ready");
    expect(snap.context.org).toEqual({ id: "org-1", name: "Acme Data" });
    expect(snap.context.user).toEqual(MAYA_USER);
  });

  it("a brand-new user is asked to create their organization", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(okFetch()) });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("needs_org");
    expect(snap.context.user).toEqual(MAYA_USER);
    expect(snap.context.org).toEqual({ id: null, name: null });
  });

  it("a user whose organization comes back empty is treated as new and asked to create one", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, {
      input: inputWith(returningFetch({ id: "", name: "" })),
    });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("needs_org");
    expect(snap.context.org).toEqual({ id: null, name: null });
  });
});

describe("when a user's session can no longer be verified", () => {
  it("their session is rejected and no profile is loaded", async () => {
    // The mock answers 401 for Maya's bearer → getWorkOSUserInfo throws.
    const rejectingFetch = makeMockFetch({ badToken: MAYA_INPUT.bearer_token });
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(rejectingFetch) });
    actor.start();
    await waitFor(actor, (s) => s.value === "session_rejected");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("session_rejected");
    // No user state advances on the rejection path — the whole identity stays
    // blank (no partial population).
    expect(snap.context.user).toEqual(NO_USER);
    // Assert the EXACT cause: the boundary throws an UNTAGGED Error
    // ("workos userinfo failed: 401"), so `causeOf` defaults it to "transient"
    // (only "workos profile missing email" is tagged workos-profile-corrupt at
    // the seam — see setup/actors.ts).
    expect(snap.context.underlying_cause_tag).toBe("transient");
  });
});

describe("when a new user submits a valid organization name", () => {
  it("their organization is created and they enter the app", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(okFetch()) });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(actor, (s) => s.value === "ready");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("ready");
    expect(snap.context.org).toEqual({ id: "org-1", name: "Acme Data" });
    expect(snap.context.user).toEqual(MAYA_USER);
  });
});

describe("when a user submits an organization name that breaks the naming rules", () => {
  it.each([
    ["", "empty", "Please enter an organization name"],
    ["A", "too_short", "Organization name is too short"],
  ] as const)(
    'keeps them on the naming form, flagging "%s" as %s',
    async (orgName, expectedKind, expectedMessage) => {
      const machine = createSessionOnboardingMachine();
      const actor = createActor(machine, { input: inputWith(okFetch()) });
      actor.start();
      await waitFor(actor, (s) => s.value === "needs_org");
      actor.send({ type: "org_form_submitted", org_name: orgName });
      await waitFor(actor, (s) => s.context.org_validation_error !== null);
      const snap = actor.getSnapshot();
      expect(snap.value).toBe("needs_org");
      expect(snap.context.org_validation_error).toEqual({
        kind: expectedKind,
        message: expectedMessage,
      });
    },
  );
});

describe("when the identity provider returns a profile missing required details", () => {
  it("the session is rejected and the failure is attributed to the corrupt profile", async () => {
    const corruptFetch = makeMockFetch({
      profile: { email: "", name: "Maya Chen" },
    });
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(corruptFetch) });
    actor.start();
    await waitFor(actor, (s) => s.value === "session_rejected");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("session_rejected");
    expect(snap.context.underlying_cause_tag).toBe("workos-profile-corrupt");
  });
});

describe("when a user submits an organization name that is already taken", () => {
  it("sends them back to the naming form told the name is taken, without spending a retry", async () => {
    // New user (no org → needs_org); the backend POST /api/orgs answers 409
    // (the name is globally taken). The org-create actor throws name_taken →
    // creating_org's onError routes to needs_org with the duplicate error —
    // NOT error_recoverable.
    const nameTakenFetch = makeMockFetch({
      profile: { email: MAYA_PROFILE.email, name: MAYA_PROFILE.display_name },
      orgNameTaken: true,
    });
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(nameTakenFetch) });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(
      actor,
      (s) => s.value === "needs_org" && s.context.org_validation_error !== null,
    );
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("needs_org");
    expect(snap.context.org_validation_error).toEqual({
      kind: "duplicate",
      message: "That name is already in use in your organization",
    });
    // It is an inline-name error, not a transient/partial failure.
    expect(snap.context.underlying_cause_tag).toBeNull();
  });
});

describe("when a failure is surfaced (via the test harness)", () => {
  it("the user is moved to the recoverable error screen carrying the failure reason", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(okFetch()) });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "__force_failure__", tag: "transient" });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    expect(actor.getSnapshot().value).toBe("error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("transient");
  });
});

// Compile-time exhaustiveness guard: adding a member to UnderlyingCauseTag
// without listing it here fails `npm run build` (tsc). The old
// `Exclude<…> = undefined as never` form compiled clean and caught nothing
// (never is assignable to any type); constraining a type alias to never does
// genuinely error.
type _AssertNever<T extends never> = T;
type _AllUnderlyingCausesHandled = _AssertNever<
  Exclude<
    UnderlyingCauseTag,
    | "transient"
    | "cookie-blocked"
    | "partial-setup"
    | "workos-profile-corrupt"
  >
>;
