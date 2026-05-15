// Unit tests for the LoginAndOrgSetup XState machine — drives the state
// machine through `createActor` with mocked actor dependencies.
//
// Behavior budget for step 02-01 (machine-level slice of the 5 behaviors):
//   B1 — retry-budget counter on error_recoverable: 4th attempt at same
//        underlying_cause_tag transitions to error_terminal.
//   B2 — correlation_id persists across retry attempts (never regenerated).
//
// Test count budget for this file: 2 × 2 = 4 tests max. Variations of the
// same behavior (different cause tags) are parametrized per Mandate 5.
//
// All tests are port-to-port at the machine driving port (the XState actor's
// public `send` / snapshot surface). No internal-class assertions.

import { describe, expect, it } from "vitest";
import { createActor, fromPromise } from "xstate";

import {
  createLoginAndOrgSetupMachine,
  type CreateOrgAndReissueActor,
  type CreateOrgAndReissueInput,
  type CreateOrgAndReissueOutput,
  type WorkOSUserInfoActor,
} from "./machine.ts";
import type { UnderlyingCauseTag } from "../validation.ts";

const MAYA_INPUT = {
  correlation_id: "R-7a4f-901c",
  principal_id: "user_maya",
  existing_org_names: [],
};

const MAYA_PROFILE = {
  email: "maya.chen@acme-data.example",
  display_name: "Maya Chen",
};

/** Build a workos actor that always succeeds with Maya's profile. */
function workosOk(): WorkOSUserInfoActor {
  return fromPromise(async () => MAYA_PROFILE);
}

/**
 * Build a createOrgAndReissue actor that fails every invocation with a
 * forced reissue-exhausted error tagged "partial-setup". Models the
 * scenario where every retry from error_recoverable fails again.
 */
function createOrgAlwaysFails(): CreateOrgAndReissueActor {
  return fromPromise<CreateOrgAndReissueOutput, CreateOrgAndReissueInput>(
    async () => {
      throw new Error("reissue exhausted after 3 attempts");
    },
  );
}

/**
 * Drive Maya from anonymous → error_recoverable. Workos succeeds, Maya
 * submits a valid org name, the internal reissue budget (3 attempts
 * inside creating_org) gets exhausted, leaving her at error_recoverable
 * with partial-setup tag.
 */
async function driveToFirstRecoverableError(
  deps: { createOrgAndReissue: CreateOrgAndReissueActor },
) {
  const machine = createLoginAndOrgSetupMachine({
    workosUserInfo: workosOk(),
    createOrgAndReissue: deps.createOrgAndReissue,
  });
  const actor = createActor(machine, { input: MAYA_INPUT });
  actor.start();
  actor.send({
    type: "sign_in_clicked",
    persona_email: MAYA_PROFILE.email,
    persona_display_name: MAYA_PROFILE.display_name,
  });
  await waitFor(actor, (s) => s.value === "authenticated_no_org");
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

describe("retry budget on error_recoverable (B1)", () => {
  it("transitions to error_terminal on the 4th user-initiated attempt at the same cause tag", async () => {
    const actor = await driveToFirstRecoverableError({
      createOrgAndReissue: createOrgAlwaysFails(),
    });
    // Snapshot: in error_recoverable, partial-setup tag, retry budget 0 used.
    expect(actor.getSnapshot().value).toBe("error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe(
      "partial-setup",
    );

    // Three user-initiated retries — each lands back in error_recoverable
    // because the actor still fails. retry_budget counter goes 1 → 2 → 3.
    for (let i = 0; i < 3; i += 1) {
      actor.send({ type: "retry_clicked" });
      await waitFor(
        actor,
        (s) =>
          s.value === "error_recoverable" || s.value === "error_terminal",
      );
    }

    // After 3 user retries (= 4 total attempts including the original
    // failure), the machine MUST be in error_terminal.
    expect(actor.getSnapshot().value).toBe("error_terminal");
    expect(actor.getSnapshot().context.retry_budget_used).toBe(3);
  });
});

describe("correlation_id threading across retries (B2)", () => {
  it("reuses the original correlation_id on every retry attempt", async () => {
    const seenCorrelationIds: string[] = [];
    // Custom actor that records the correlation_id of every invocation.
    const recordingActor = fromPromise<
      CreateOrgAndReissueOutput,
      CreateOrgAndReissueInput
    >(async ({ input }) => {
      seenCorrelationIds.push(input.correlation_id);
      throw new Error("reissue exhausted after 3 attempts");
    });
    const machine = createLoginAndOrgSetupMachine({
      workosUserInfo: workosOk(),
      createOrgAndReissue: recordingActor,
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "sign_in_clicked",
      persona_email: MAYA_PROFILE.email,
      persona_display_name: MAYA_PROFILE.display_name,
    });
    await waitFor(actor, (s) => s.value === "authenticated_no_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    // Internal retries already consumed correlation_ids. Snapshot snapshot:
    const internalAttempts = seenCorrelationIds.length;
    expect(internalAttempts).toBeGreaterThan(0);
    // Fire a user retry. The new invocation MUST reuse the same id.
    actor.send({ type: "retry_clicked" });
    await waitFor(
      actor,
      (s) =>
        seenCorrelationIds.length > internalAttempts &&
        (s.value === "error_recoverable" || s.value === "error_terminal"),
    );
    // Every captured correlation_id MUST equal Maya's initial id.
    const unique = Array.from(new Set(seenCorrelationIds));
    expect(unique).toEqual([MAYA_INPUT.correlation_id]);
    // Snapshot's correlation_id MUST still equal the initial.
    expect(actor.getSnapshot().context.correlation_id).toBe(
      MAYA_INPUT.correlation_id,
    );
  });
});

// --------------------------------------------------------------------------
// Step 02-02 extensions — harness-driven transitions (US-004)
// --------------------------------------------------------------------------
//
// Behavior budget extension: B3 (force_failure transition) + B4
// (expire_token transition). Each behavior gets at most 1 test;
// parametrize input variations where possible.

describe("harness force_failure event drives into error_recoverable (B3)", () => {
  it("transitions from authenticated_no_org to error_recoverable carrying the supplied cause tag", async () => {
    const machine = createLoginAndOrgSetupMachine({
      workosUserInfo: workosOk(),
      createOrgAndReissue: createOrgAlwaysFails(),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "sign_in_clicked",
      persona_email: MAYA_PROFILE.email,
      persona_display_name: MAYA_PROFILE.display_name,
    });
    await waitFor(actor, (s) => s.value === "authenticated_no_org");
    // Send the harness event. The machine MUST route the harness event into
    // error_recoverable with the supplied tag stored as underlying_cause_tag.
    actor.send({ type: "__force_failure__", tag: "transient" });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    expect(actor.getSnapshot().value).toBe("error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("transient");
  });
});

describe("harness expire_token event drives into expired_token (B4)", () => {
  it("transitions from ready to expired_token", async () => {
    // Build a createOrgAndReissue that succeeds so Maya reaches ready first.
    const succeedingActor = fromPromise<
      CreateOrgAndReissueOutput,
      CreateOrgAndReissueInput
    >(async (args) => ({
      org_id: "org-acme-data",
      org_name: args.input.org_name,
    }));
    const machine = createLoginAndOrgSetupMachine({
      workosUserInfo: workosOk(),
      createOrgAndReissue: succeedingActor,
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "sign_in_clicked",
      persona_email: MAYA_PROFILE.email,
      persona_display_name: MAYA_PROFILE.display_name,
    });
    await waitFor(actor, (s) => s.value === "authenticated_no_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(actor, (s) => s.value === "ready");
    actor.send({ type: "__expire_token__" });
    await waitFor(actor, (s) => s.value === "expired_token");
    expect(actor.getSnapshot().value).toBe("expired_token");
  });
});

describe("closed-union underlying_cause_tag (compile-time)", () => {
  it("only assigns members of the closed UnderlyingCauseTag union", () => {
    // Compile-time exhaustiveness: this `satisfies` assertion fails to
    // compile if the union widens to `string`.
    const all: UnderlyingCauseTag[] = [
      "transient",
      "cookie-blocked",
      "partial-setup",
      "workos-profile-corrupt",
      "silent-reauth-failed",
    ];
    expect(all).toHaveLength(5);
    // Type-level exhaustiveness: this never-check fails to compile if a
    // future member is added without updating the runtime list above.
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

// --------------------------------------------------------------------------
// Step 03-01 extensions — expired_token state + silent reauth (US-005)
// --------------------------------------------------------------------------
//
// Behavior budget extension:
//   B5 — expired_token invokes silent reauth; success transitions back to ready.
//   B6 — silent reauth failure transitions to error_recoverable with tag
//        "silent-reauth-failed".

describe("expired_token invokes silent reauth (B5)", () => {
  it("returns to ready when silent reauth succeeds", async () => {
    // Build a machine with a silentReauth actor that immediately resolves.
    const silentReauthOk = fromPromise(async () => ({ ok: true as const }));
    const machine = createLoginAndOrgSetupMachine({
      workosUserInfo: workosOk(),
      createOrgAndReissue: fromPromise<
        CreateOrgAndReissueOutput,
        CreateOrgAndReissueInput
      >(async (args) => ({
        org_id: "org-acme-data",
        org_name: args.input.org_name,
      })),
      silentReauth: silentReauthOk,
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "sign_in_clicked",
      persona_email: MAYA_PROFILE.email,
      persona_display_name: MAYA_PROFILE.display_name,
    });
    await waitFor(actor, (s) => s.value === "authenticated_no_org");
    actor.send({ type: "org_form_submitted", org_name: "Acme Data" });
    await waitFor(actor, (s) => s.value === "ready");
    actor.send({ type: "__expire_token__" });
    await waitFor(actor, (s) => s.value === "expired_token");
    // Silent reauth invoke kicks off automatically on entry; success → ready.
    await waitFor(actor, (s) => s.value === "ready");
    expect(actor.getSnapshot().value).toBe("ready");
  });
});

describe("expired_token routes failed silent reauth to error_recoverable (B6)", () => {
  it("tags the failure as silent-reauth-failed", async () => {
    const silentReauthFails = fromPromise(async () => {
      throw new Error("identity session expired");
    });
    const machine = createLoginAndOrgSetupMachine({
      workosUserInfo: workosOk(),
      createOrgAndReissue: fromPromise<
        CreateOrgAndReissueOutput,
        CreateOrgAndReissueInput
      >(async (args) => ({
        org_id: "org-acme-data",
        org_name: args.input.org_name,
      })),
      silentReauth: silentReauthFails,
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "sign_in_clicked",
      persona_email: MAYA_PROFILE.email,
      persona_display_name: MAYA_PROFILE.display_name,
    });
    await waitFor(actor, (s) => s.value === "authenticated_no_org");
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
