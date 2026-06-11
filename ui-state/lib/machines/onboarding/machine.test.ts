// Unit tests for the OnboardingMachine — drives the state machine through
// `createActor` and asserts the observable outcome (the actor's settled state +
// context) the caller sees.
//
// CLIENT-REPORTED MODEL (ADR-049/050, CDO-S1): the machine no longer probes the
// server on arrival. It starts in `awaiting_org_report` — identity seeded from
// the cold-start input (the auth-proxy-verified header, NOT a re-verify
// round-trip) — and transitions ONLY on past-tense outcome events the client
// reports (`org_found` / `org_not_found` / `org_created`). There are no invokes;
// the old loadSession/createOrg I/O retired with the report-driven realignment.
//
// All tests are port-to-port at the machine driving port (the XState actor's
// public `send` / snapshot surface). No internal-class assertions. Each `it`
// states the outcome the caller observes — phrased as behavior the user
// experiences, not machine internals.
//
// References:
//   docs/decisions/adr-049-*.md  — client-reported outcome-event model
//   docs/decisions/adr-050-*.md  — client-driven onboarding application contracts

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import { createOnboardingMachine } from "./machine.ts";
import type { UnderlyingCauseTag } from "./setup/domain.ts";

const MAYA_INPUT = {
  request_id: "R-7a4f-901c",
  principal_id: "user_maya",
  user: {
    email: "maya.chen@acme-data.example",
    display_name: null,
    first_name: null,
  },
};

const ACME_ORG = { id: "org-1", name: "Acme Data" };

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

/** Start a machine in the cold-start state with Maya's input. */
function startMaya(extra: Record<string, unknown> = {}) {
  const machine = createOnboardingMachine();
  const actor = createActor(machine, { input: { ...MAYA_INPUT, ...extra } });
  actor.start();
  return actor;
}

describe("when a signed-in user begins their session", () => {
  it("waits for the client to report whether they have an organisation, showing their seeded identity", () => {
    const actor = startMaya();
    const snap = actor.getSnapshot();
    // No server probe on arrival — the machine settles immediately, waiting for
    // the client's outcome report.
    expect(snap.value).toBe("awaiting_org_report");
    // Identity is seeded from the cold-start input (the verified header), not a
    // re-verify round-trip.
    expect(snap.context.user.email).toBe(MAYA_INPUT.user.email);
    expect(snap.context.org).toEqual({ id: null, name: null });
  });
});

describe("when the client reports the user already has an organisation", () => {
  it("takes a returning user straight into the app from the awaiting-report state", async () => {
    const actor = startMaya();
    actor.send({ type: "org_found", org: ACME_ORG });
    await waitFor(actor, (s) => s.value === "ready");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("ready");
    expect(snap.context.org).toEqual(ACME_ORG);
    // Identity is unchanged by the outcome report — only the cold-start seed
    // ever writes user.
    expect(snap.context.user.email).toBe(MAYA_INPUT.user.email);
  });
});

describe("when the client reports the user has no organisation", () => {
  it("guides a brand-new user to create their organisation", async () => {
    const actor = startMaya();
    actor.send({ type: "org_not_found" });
    await waitFor(actor, (s) => s.value === "needs_org");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("needs_org");
    expect(snap.context.org).toEqual({ id: null, name: null });
    expect(snap.context.user.email).toBe(MAYA_INPUT.user.email);
  });
});

describe("when the client reports a freshly-created organisation", () => {
  it("admits the new user into the app once their org is created", async () => {
    const actor = startMaya();
    actor.send({ type: "org_not_found" });
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "org_created", org: ACME_ORG });
    await waitFor(actor, (s) => s.value === "ready");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("ready");
    expect(snap.context.org).toEqual(ACME_ORG);
  });
});

describe("when the client reports an organisation found after first reporting none", () => {
  it("converges a user who was at organisation setup straight into the app", async () => {
    const actor = startMaya();
    actor.send({ type: "org_not_found" });
    await waitFor(actor, (s) => s.value === "needs_org");
    // Convergence: an org_found arriving at needs_org also settles ready.
    actor.send({ type: "org_found", org: ACME_ORG });
    await waitFor(actor, (s) => s.value === "ready");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("ready");
    expect(snap.context.org).toEqual(ACME_ORG);
  });
});

describe("when a failure is surfaced (via the test harness)", () => {
  it("the user is moved to the recoverable error screen carrying the failure reason", async () => {
    const actor = startMaya();
    actor.send({ type: "org_not_found" });
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "__force_failure__", tag: "transient" });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    expect(actor.getSnapshot().value).toBe("error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("transient");
  });
});

// Compile-time exhaustiveness guard: adding a member to UnderlyingCauseTag
// without listing it here fails `npm run build` (tsc).
type _AssertNever<T extends never> = T;
type _AllUnderlyingCausesHandled = _AssertNever<
  Exclude<
    UnderlyingCauseTag,
    "transient" | "cookie-blocked" | "partial-setup" | "workos-profile-corrupt"
  >
>;
