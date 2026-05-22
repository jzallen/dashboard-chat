// Unit tests for the SessionOnboardingMachine — drives the state machine
// through `createActor` injecting a MOCK `fetch` as the I/O port (ADR-041).
//
// The machine takes NO constructor params: every external actor is a
// config-driven default whose network I/O runs through `deps.request_client`
// (= the `fetch` library). Tests inject a mock `fetch` (makeMockFetch) via the
// machine input `deps: { request_client: mockFetch }`, threaded into context →
// invoke input → resolver. The forced-failure path is driven by the
// `force_reissue_failures` input; the silent-reauth side-state (B5/B6) is
// driven by the `silent_reauth_outcome` input flag — "success" → ready, "fail"
// → error_recoverable, "pending" (default) → never resolves. No injection.
//
// Entry assumes an already-authenticated principal: the machine starts in
// `verifying`, auto-invokes the `workosUserInfo` re-verify actor, and forks
// `ready` ([hasOrg]) vs `needs_org` (no org) vs `session_rejected` (failure).
//
// Behavior budget:
//   B1 — retry-budget counter on error_recoverable: 4th attempt at same
//        underlying_cause_tag transitions to error_terminal.
//   B2 — correlation_id persists across retry attempts (never regenerated).
//   B3 — harness __force_failure__ drives needs_org → error_recoverable.
//   B4 — harness __expire_token__ drives ready → expired_token.
//   B5 — expired_token invokes silent reauth; success → ready.
//   B6 — silent reauth failure → error_recoverable (silent-reauth-failed).
//   B7 — verifying [hasOrg] shortcut: returning user → ready directly.
//   B8 — verifying onError → session_rejected (terminal).
//
// All tests are port-to-port at the machine driving port (the XState actor's
// public `send` / snapshot surface). No internal-class assertions.

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import { makeMockFetch, makeTestConfig } from "../../testing/test-config.ts";
import type { UnderlyingCauseTag } from "../validation.ts";
import {
  createSessionOnboardingMachine,
  type RequestClient,
} from "./machine.ts";

const CONFIG = makeTestConfig();

const MAYA_INPUT = {
  correlation_id: "R-7a4f-901c",
  principal_id: "user_maya",
  bearer_token: "tok-maya",
  existing_org_names: [],
  config: CONFIG,
};

const MAYA_PROFILE = {
  email: "maya.chen@acme-data.example",
  display_name: "Maya Chen",
};

/** Mock fetch that re-verifies any bearer OK and creates/reissues orgs OK. */
function okFetch(): RequestClient {
  return makeMockFetch({
    profile: { email: MAYA_PROFILE.email, name: MAYA_PROFILE.display_name },
  });
}

/**
 * Build the machine input with a mock `fetch` injected as the I/O port. Extra
 * input fields (existing_org_id, force_reissue_failures) merge over MAYA_INPUT.
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
  timeoutMs = 1000,
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
  it("a returning user with a seeded existing_org_id reaches ready directly", async () => {
    const machine = createSessionOnboardingMachine();
    // existing_org_id is pre-seeded into context at machine creation (sourced
    // from the verified X-Org-Id header), so the hasOrg guard sees it BEFORE
    // the re-verify invoke settles. Org NAME is not in the header → null.
    const actor = createActor(machine, {
      input: inputWith(okFetch(), { existing_org_id: "org-1" }),
    });
    actor.start();
    await waitFor(actor, (s) => s.value === "ready");
    expect(actor.getSnapshot().value).toBe("ready");
    expect(actor.getSnapshot().context.org).toEqual({
      id: "org-1",
      name: null,
    });
    expect(actor.getSnapshot().context.user.email).toBe(MAYA_PROFILE.email);
  });

  it("a new user with no existing_org_id reaches needs_org with identity populated", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(okFetch()) });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    expect(actor.getSnapshot().value).toBe("needs_org");
    expect(actor.getSnapshot().context.user.display_name).toBe("Maya Chen");
    expect(actor.getSnapshot().context.org.id).toBeNull();
  });

  it("treats an empty-string existing_org_id as no org (new user → needs_org)", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, {
      input: inputWith(okFetch(), { existing_org_id: "" }),
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
    // FIX D3: assert the EXACT classified cause. `classifyFailure` maps a
    // "workos userinfo failed: 401" message (no kind, no tag, no keyword
    // match for missing-email/cookie/reissue) to the default "transient".
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("transient");
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
    expect(actor.getSnapshot().context.correlation_id).toBe(
      MAYA_INPUT.correlation_id,
    );
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

describe("harness expire_token event drives into expired_token (B4)", () => {
  it("transitions from ready to expired_token", async () => {
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, { input: inputWith(okFetch()) });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(actor, (s) => s.value === "ready");
    actor.send({ type: "__expire_token__" });
    await waitFor(actor, (s) => s.value === "expired_token");
    expect(actor.getSnapshot().value).toBe("expired_token");
  });
});

describe("closed-union underlying_cause_tag (compile-time)", () => {
  it("only assigns members of the closed UnderlyingCauseTag union", () => {
    const all: UnderlyingCauseTag[] = [
      "transient",
      "cookie-blocked",
      "partial-setup",
      "workos-profile-corrupt",
      "silent-reauth-failed",
    ];
    expect(all).toHaveLength(5);
    const _exhaustive: Exclude<
      UnderlyingCauseTag,
      | "transient"
      | "cookie-blocked"
      | "partial-setup"
      | "workos-profile-corrupt"
      | "silent-reauth-failed"
    > = undefined as never;
    void _exhaustive;
  });
});

describe("expired_token invokes silent reauth (B5)", () => {
  it("returns to ready when silent reauth succeeds", async () => {
    // silentReauth is now config/input-driven like every other actor — drive
    // the success path via the `silent_reauth_outcome` input flag (no injection).
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, {
      input: inputWith(okFetch(), { silent_reauth_outcome: "success" }),
    });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(actor, (s) => s.value === "ready");
    actor.send({ type: "__expire_token__" });
    await waitFor(actor, (s) => s.value === "expired_token");
    await waitFor(actor, (s) => s.value === "ready");
    expect(actor.getSnapshot().value).toBe("ready");
  });
});

describe("expired_token routes failed silent reauth to error_recoverable (B6)", () => {
  it("tags the failure as silent-reauth-failed", async () => {
    // Drive the failure path via the input flag — the resolver throws
    // `silent-reauth-failed`, the onError arm tags it.
    const machine = createSessionOnboardingMachine();
    const actor = createActor(machine, {
      input: inputWith(okFetch(), { silent_reauth_outcome: "fail" }),
    });
    actor.start();
    await waitFor(actor, (s) => s.value === "needs_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(actor, (s) => s.value === "ready");
    actor.send({ type: "__expire_token__" });
    await waitFor(actor, (s) => s.value === "expired_token");
    await waitFor(actor, (s) => s.value === "error_recoverable");
    expect(actor.getSnapshot().value).toBe("error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe(
      "silent-reauth-failed",
    );
  });
});
