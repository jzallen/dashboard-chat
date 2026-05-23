// Unit tests for the SessionOnboardingMachine — drives the state machine
// through `createActor` injecting a MOCK `fetch` as the I/O port (ADR-041).
//
// The machine takes NO constructor params: every external actor is a
// config-driven default whose network I/O runs through `deps.request_client`
// (= the `fetch` library). Tests inject a mock `fetch` (makeMockFetch) via the
// machine input `deps: { request_client: mockFetch }`, threaded into context →
// invoke input → resolver. The forced-failure path is driven by the
// `force_reissue_failures` input.
//
// Entry assumes an already-authenticated principal: the machine starts in
// `verifying`, auto-invokes the `loadSession` resolver (WorkOS re-verify +
// backend /api/orgs/me org lookup), and forks `ready` ([hasOrg]) vs `needs_org`
// (no org) vs `session_rejected` (failure).
//
// Behavior budget:
//   B1 — retry-budget counter on error_recoverable: 4th attempt at same
//        underlying_cause_tag transitions to error_terminal.
//   B2 — correlation_id persists across retry attempts (never regenerated).
//   B3 — harness __force_failure__ drives needs_org → error_recoverable.
//   B4 — new-user happy path: creating_org → ready (org + identity populated).
//   B5 — invalid org-name submission self-loops in needs_org with inline error.
//   B6 — workos-profile-corrupt cause tag surfaced at machine level.
//   B7 — verifying [hasOrg] shortcut: returning user → ready directly.
//   B8 — verifying onError → session_rejected (terminal).
//   B9 — creating_org → needs_org on globally-duplicate org name (409).
//
// All tests are port-to-port at the machine driving port (the XState actor's
// public `send` / snapshot surface). No internal-class assertions.

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import { makeMockFetch, makeTestConfig } from "../../testing/test-config.ts";
import { createSessionOnboardingMachine } from "./machine.ts";
import type { RequestClient } from "./setup/actors.ts";
import type { UnderlyingCauseTag } from "./setup/domain.ts";

const CONFIG = makeTestConfig();

const MAYA_INPUT = {
  correlation_id: "R-7a4f-901c",
  principal_id: "user_maya",
  bearer_token: "tok-maya",
  config: CONFIG,
};

const MAYA_PROFILE = {
  email: "maya.chen@acme-data.example",
  display_name: "Maya Chen",
};

/** Mock fetch for a NEW user — re-verify OK, backend /api/orgs/me 404 (no org),
 *  create/reissue OK. */
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
 * input fields (e.g. force_reissue_failures) merge over MAYA_INPUT.
 */
function inputWith(
  requestClient: RequestClient,
  extra: Record<string, unknown> = {},
) {
  return { ...MAYA_INPUT, deps: { request_client: requestClient }, ...extra };
}

/**
 * Drive Maya from verifying → error_recoverable. Re-verify succeeds (no org),
 * Maya submits a valid org name, the internal reissue budget (3 attempts) is
 * exhausted via a high `force_reissue_failures`, leaving her at
 * error_recoverable with the partial-setup tag.
 */
async function driveToFirstRecoverableError(requestClient: RequestClient) {
  const machine = createSessionOnboardingMachine();
  const actor = createActor(machine, {
    input: inputWith(requestClient, { force_reissue_failures: 99 }),
  });
  actor.start();
  await waitFor(actor, (s) => s.value === "needs_org");
  actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
  await waitFor(actor, (snapshot) => snapshot.value === "error_recoverable");
  return actor;
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

describe("verifying [hasOrg] shortcut (B7)", () => {
  it("a returning user (backend reports an org) reaches ready directly with the org id + name", async () => {
    const machine = createSessionOnboardingMachine();
    // The org is loaded from the backend (/api/orgs/me, the org SSOT) during
    // verifying; the hasOrg guard reads it off the done-event output. The name
    // comes from the backend (not a header claim), so it is populated.
    const actor = createActor(machine, { input: inputWith(returningFetch()) });
    actor.start();
    await waitFor(actor, (s) => s.value === "ready");
    expect(actor.getSnapshot().value).toBe("ready");
    expect(actor.getSnapshot().context.org).toEqual({
      id: "org-1",
      name: "Acme Data",
    });
    expect(actor.getSnapshot().context.user.email).toBe(MAYA_PROFILE.email);
  });

  it("a new user (backend reports no org, 404) reaches needs_org with identity populated", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(okFetch()) });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    expect(actor.getSnapshot().value).toBe("needs_org");
    expect(actor.getSnapshot().context.user.display_name).toBe("Maya Chen");
    expect(actor.getSnapshot().context.org.id).toBeNull();
  });

  it("treats a backend org response with a blank id as no org (new user → needs_org)", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, {
      input: inputWith(returningFetch({ id: "", name: "" })),
    });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    expect(actor.getSnapshot().value).toBe("needs_org");
    expect(actor.getSnapshot().context.org.id).toBeNull();
  });
});

describe("verifying onError → session_rejected (B8)", () => {
  it("rejects the session when re-verification fails", async () => {
    // The mock answers 401 for Maya's bearer → getWorkOSUserInfo throws.
    const rejectingFetch = makeMockFetch({ badToken: MAYA_INPUT.bearer_token });
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(rejectingFetch) });
    actor.start();
    await waitFor(actor, (s) => s.value === "session_rejected");
    expect(actor.getSnapshot().value).toBe("session_rejected");
    // No user state advances on the rejection path.
    expect(actor.getSnapshot().context.user.email).toBeNull();
    // FIX D3: assert the EXACT cause. The boundary throws an UNTAGGED Error
    // ("workos userinfo failed: 401"), so `causeOf` defaults it to "transient"
    // (only "workos profile missing email" is tagged workos-profile-corrupt at
    // the seam — see setup/actors.ts).
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("transient");
  });
});

describe("new-user happy path: creating_org → ready (B4)", () => {
  it("reaches ready with org + identity populated after valid org submission", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(okFetch()) });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(actor, (s) => s.value === "ready");
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("ready");
    expect(snap.context.org).toEqual({ id: "org-1", name: "Acme Data" });
    expect(snap.context.user.email).toBe(MAYA_PROFILE.email);
  });
});

describe("invalid org-name submission self-loops in needs_org with inline error (B5)", () => {
  it.each([
    ["", "empty"],
    ["A", "too_short"],
  ] as const)(
    "keeps the machine in needs_org and sets org_validation_error.kind=%s when name=%s",
    async (orgName, expectedKind) => {
      const machine = createSessionOnboardingMachine();
      const actor = createActor(machine, { input: inputWith(okFetch()) });
      actor.start();
      await waitFor(actor, (s) => s.value === "needs_org");
      actor.send({ type: "org_form_submitted", org_name: orgName });
      await waitFor(actor, (s) => s.context.org_validation_error !== null);
      const snap = actor.getSnapshot();
      expect(snap.value).toBe("needs_org");
      expect(snap.context.org_validation_error?.kind).toBe(expectedKind);
    },
  );
});

describe("workos-profile-corrupt cause tag surfaced at machine level (B6)", () => {
  it("lands in session_rejected with underlying_cause_tag=workos-profile-corrupt when the WorkOS profile has no email", async () => {
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

describe("creating_org → needs_org on a globally-duplicate org name (B9)", () => {
  it("routes a backend name-collision (409) to needs_org with the inline duplicate error", async () => {
    // New user (no org → needs_org); the backend POST /api/orgs answers 409
    // (the name is globally taken). The org-create actor throws name_taken →
    // creating_org's onError routes to needs_org with the duplicate error —
    // NOT error_recoverable, and the reissue budget is untouched.
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
    expect(actor.getSnapshot().value).toBe("needs_org");
    expect(actor.getSnapshot().context.org_validation_error?.kind).toBe(
      "duplicate",
    );
    // It is an inline-name error, not a transient/partial failure.
    expect(actor.getSnapshot().context.underlying_cause_tag).toBeNull();
    expect(actor.getSnapshot().context.reissue_attempts_count).toBe(0);
  });
});

describe("retry budget on error_recoverable (B1)", () => {
  it("transitions to error_terminal on the 4th user-initiated attempt at the same cause tag", async () => {
    const actor = await driveToFirstRecoverableError(okFetch());
    expect(actor.getSnapshot().value).toBe("error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe(
      "partial-setup",
    );

    for (let i = 0; i < 3; i += 1) {
      actor.send({ type: "retry_clicked" });
      await waitFor(
        actor,
        (s) =>
          s.value === "error_recoverable" || s.value === "error_terminal",
      );
    }

    expect(actor.getSnapshot().value).toBe("error_terminal");
    expect(actor.getSnapshot().context.retry_budget_used_count).toBe(3);
  });
});

describe("correlation_id threading across retries (B2)", () => {
  it("reuses the original correlation_id on every retry attempt", async () => {
    // Observe the correlation_id the resolver threads upstream: createOrgFn
    // sends it as the `x-correlation-id` header on POST /api/orgs. Every
    // internal create attempt (each failing via force_reissue_failures) and
    // every user retry must carry the SAME original correlation_id.
    const seenCorrelationIds: string[] = [];
    const recordingFetch = makeRecordingFetch(seenCorrelationIds);
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, {
      input: inputWith(recordingFetch, { force_reissue_failures: 99 }),
    });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    const internalAttempts = seenCorrelationIds.length;
    expect(internalAttempts).toBeGreaterThan(0);
    actor.send({ type: "retry_clicked" });
    await waitFor(
      actor,
      (s) =>
        seenCorrelationIds.length > internalAttempts &&
        (s.value === "error_recoverable" || s.value === "error_terminal"),
    );
    const unique = Array.from(new Set(seenCorrelationIds));
    expect(unique).toEqual([MAYA_INPUT.correlation_id]);
  });
});

/**
 * A mock fetch that records the `x-correlation-id` header from every POST
 * /api/orgs call into `sink`, then delegates the response shaping to the
 * standard ok mock. Org-create always succeeds; the reissue forced-failure is
 * driven by the machine's force_reissue_failures input.
 */
function makeRecordingFetch(sink: string[]): RequestClient {
  const base = okFetch();
  const impl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/orgs") && (init?.method ?? "GET") === "POST") {
      const headers = init?.headers as Record<string, string> | undefined;
      const cid = headers?.["x-correlation-id"] ?? "";
      sink.push(cid);
    }
    return base(input, init);
  };
  return impl as unknown as RequestClient;
}

describe("harness force_failure event drives into error_recoverable (B3)", () => {
  it("transitions from needs_org to error_recoverable carrying the supplied cause tag", async () => {
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
    | "silent-reauth-failed"
  >
>;
