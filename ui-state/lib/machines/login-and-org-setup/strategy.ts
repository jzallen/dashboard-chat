// LoginOrgSetupStrategy — the `login-and-org-setup` FlowStrategy impl.
//
// ADR-040 §D1/§D2 LEAF-3, MR-L3a. Co-located with the machine it owns
// (leaf-3-plan §2 AMB-2 RATIFIED: strategies live at
// `ui-state/lib/machines/<machine>/strategy.ts`). ADR-028 "no machine
// imports another machine" is preserved — this strategy imports only its
// OWN machine module; the pump remains the sole cross-machine mediator and
// is reached through the `PumpContext` seam (never an actor-map / snapshot
// import). Snapshot reads go exclusively through the sanctioned
// `harvestSettled*` boundary (AMB-1) — `beginDirect` reads only the
// settled state-VALUE + the live projection, never `snapshot.context`.
//
// LEAF-3 is BEHAVIOR-NEUTRAL: `settle→emit` STILL appends to the
// Redis-Streams FlowEventLog (the read-port swap is LEAF-5, out of scope).

import { type AnyActorRef, createActor } from "xstate";

import type {
  BeginFlowInput,
  FlowStrategy,
  PumpContext,
  SendEventInput,
  SettleContext,
  SettleOutcome,
} from "../../orchestrator.ts";
import { harvestSettledLoginState } from "../../orchestrator-harvester.ts";
import type { FlowEvent, FlowProjection } from "../../projection.ts";
import { buildProjection } from "../../projection.ts";
import { waitForSettledState } from "../../wait-for-settled-state.ts";
import {
  createForcedFailureOrgAndReissueActor,
  createLoginAndOrgSetupMachine,
  type LoginMachineDeps,
} from "./index.ts";

/**
 * Canonical machine-name (ADR-039) — the FlowStrategy registry key. The
 * literal is the single canonical name shared with the orchestrator's
 * `LOGIN_AND_ORG_SETUP_MACHINE`.
 */
const LOGIN_AND_ORG_SETUP_MACHINE = "login-and-org-setup";

/**
 * Mint a synthetic JWT carrying the org_id claim. The ui-state tier does
 * NOT sign tokens cryptographically — that is auth-proxy's job per ADR-016.
 * This routine composes a JWT-shaped string whose payload encodes the
 * org_id so projection consumers (FE + TS harness) can read the claim
 * without an additional API call. The "sig" segment is a stable placeholder.
 *
 * Per ADR-029 invariant 4: the projection's access_token MUST carry the
 * same org_id as the projection's org.id.
 *
 * Relocated verbatim from orchestrator.ts in LEAF-3 MR-L3a/N3 — it has a
 * single use site (the login `ready` settle), so it is login-domain and
 * belongs with the carved strategy (orchestrator.ts no longer references
 * it). Behavior-neutral.
 */
function mintAccessTokenForReady(org_id: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ org_id })).toString(
    "base64url",
  );
  return `${header}.${payload}.ui-state-mint`;
}

export const loginOrgSetupStrategy: FlowStrategy = {
  machineName: LOGIN_AND_ORG_SETUP_MACHINE,
  beginsDirectly: true,
  buildMachine: (deps) => createLoginAndOrgSetupMachine(deps.loginMachineDeps),

  /**
   * Direct WorkOS + org-create begin body (ADR-040 §D2 begin-semantics).
   * Carved verbatim from `FlowOrchestrator.begin` (the `beginsDirectly`
   * arm) in MR-L3a/N2 — behavior-neutral: same FlowEvents, same order,
   * same `waitForSettledState`/projection reads. The pump retains
   * actor-system ownership; this body reaches it through `pump`.
   */
  async beginDirect(
    pump: PumpContext,
    input: BeginFlowInput,
  ): Promise<FlowProjection> {
    const flow_id = `${input.machine}:${input.principal_id}`;
    const start = Date.now();

    // Re-clicking sign-in is the entry to a NEW auth attempt — reset the
    // prior actor (if any) and event log so we don't replay a stale flow.
    // The persisted event log is the source of truth; the actor is a
    // process-local cache. Without this reset, a second sign-in inherits
    // the previous attempt's terminal state and never re-enters
    // `authenticating`.
    pump.recycleActor(flow_id);
    await pump.deps.eventLog.reset(flow_id);
    pump.resetFlowTracking(flow_id);

    // Failure-simulation knob: wrap createOrgAndReissue with a failure-
    // injecting counter for slice-1 scenarios that exercise the retry
    // budget. The knob is gated by NWAVE_HARNESS_KNOBS (legacy env-var,
    // honored during the one-release overlap per ADR-035) so production
    // builds ignore the field even if a caller tries to set it.
    const failureSimulationEnabled = process.env.NWAVE_HARNESS_KNOBS === "true";
    const forceFailures = failureSimulationEnabled
      ? input.force_reissue_failures ?? 0
      : 0;
    const machineDeps: LoginMachineDeps =
      forceFailures > 0
        ? {
            ...pump.deps.loginMachineDeps,
            createOrgAndReissue: createForcedFailureOrgAndReissueActor(
              pump.deps.createOrgFn ??
                (async () => {
                  throw new Error("no real createOrgFn wired");
                }),
              pump.deps.reissueOrgJwtFn ??
                (async () => {
                  throw new Error("no real reissueOrgJwtFn wired");
                }),
              forceFailures,
            ),
          }
        : pump.deps.loginMachineDeps;

    const machine = createLoginAndOrgSetupMachine(machineDeps);
    const actor = createActor(machine, {
      input: {
        correlation_id: input.correlation_id,
        principal_id: input.principal_id,
        existing_org_names: input.existing_org_names,
      },
    });
    pump.trackActor(flow_id, actor);
    actor.start();
    pump.logTransition({
      flow_id,
      from_state: null,
      to_state: "anonymous",
      correlation_id: input.correlation_id,
      principal_id: input.principal_id,
      duration_ms: 0,
    });

    // Append sign_in_clicked event to the log and dispatch it.
    const signInEvent: FlowEvent = {
      ts: new Date().toISOString(),
      type: "sign_in_clicked",
      payload: {
        persona_email: input.persona_email,
        persona_display_name: input.persona_display_name,
      },
      correlation_id: input.correlation_id,
    };
    await pump.deps.eventLog.append(flow_id, signInEvent);

    actor.send({
      type: "sign_in_clicked",
      persona_email: input.persona_email,
      persona_display_name: input.persona_display_name,
    });

    // Wait for the authenticating invoke to resolve.
    await waitForSettledState(actor);

    const stateValue = actor.getSnapshot().value as string;

    // ADR-030 LEAF-B: read user / underlying_cause_tag from the live
    // projection (built from the FlowEvent log) rather than from the
    // machine snapshot context, per ADR-030 §"Decision outcome" — the
    // projection is the only legal read source for the emission path.
    //
    // Risk noted for reviewer: at this code point the projection has only
    // observed `sign_in_clicked`, so `context.user` is still the empty
    // initial shape and `context.underlying_cause_tag` is null. The
    // workos-profile / cause-classification harvest currently lives in
    // the actor's settled context and is not yet a FlowEvent-derivable
    // value. LEAF-C+ work (see ADR-030 §"Migration sequencing") will land
    // an upstream event that captures the workos invoke output so this
    // read site sees the resolved profile; until then `auth_callback_resolved`
    // / `auth_failed` may carry placeholder values. Mirrors the LEAF-A
    // session-list trade-off (`appendSessionChatTerminalEvents`).
    const preEmitEvents = await pump.deps.eventLog.read(flow_id);
    const preEmitProjection = buildProjection(flow_id, preEmitEvents);
    const preEmitCtx = preEmitProjection.context as {
      user: { email: string | null; display_name: string | null };
      underlying_cause_tag: string | null;
    };

    // On successful auth, append auth_callback_resolved so the projection
    // matches the wire contract from the event log even without a snapshot.
    if (stateValue === "authenticated_no_org") {
      const user = preEmitCtx.user;
      const resolvedEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: "auth_callback_resolved",
        payload: { user },
        correlation_id: input.correlation_id,
      };
      await pump.deps.eventLog.append(flow_id, resolvedEvent);
      pump.logTransition({
        flow_id,
        from_state: "authenticating",
        to_state: "authenticated_no_org",
        correlation_id: input.correlation_id,
        principal_id: input.principal_id,
        duration_ms: Date.now() - start,
      });
    } else if (stateValue === "error_recoverable") {
      const cause = preEmitCtx.underlying_cause_tag ?? "transient";
      const failedEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: "auth_failed",
        payload: { underlying_cause_tag: cause },
        correlation_id: input.correlation_id,
      };
      await pump.deps.eventLog.append(flow_id, failedEvent);
    }

    return pump.projectionFor(
      flow_id,
      input.principal_id,
      input.correlation_id,
    );
  },

  /**
   * Post-settle terminal emission (ADR-040 §D2 settle = the typed emit
   * obligation). Carved verbatim from the `send` login arm in MR-L3a/N3
   * (the chained `ready`/`expired_token`/`error_recoverable`/
   * `authenticated_no_org` if/else-if). BEHAVIOR-NEUTRAL — same FlowEvents,
   * same payloads, same order; `settle→emit` STILL appends to the
   * Redis-Streams event-log (LEAF-5 swap is out of scope).
   *
   * The pump calls this UNCONDITIONALLY for every flow at the pre-carve
   * call site (the chained-if was NOT fully machine-gated: a non-login
   * flow that settles `error_recoverable` falls through the shared
   * `error_recoverable` arm exactly as before — preserved until MR-L3b/c
   * carve project/session per the §7 scope-fence).
   *
   * The `auth_ready` cross-machine spawn hook FIRING stays CENTRAL
   * (leaf-3-plan §3 + §4A): instead of calling `beginIfNotStarted` here,
   * `settle` returns the `authReady` signal and the pump fires it AFTER
   * `settle` returns. The original guard `isFirstReady &&
   * projectContextMachineDeps && orgCtx.id` is split: the login-domain
   * half (`isFirstReady && orgCtx.id`) decides the signal here; the
   * cross-machine-wiring half (`&& projectContextMachineDeps`) is the
   * pump's — `&&` is order-independent so the combined condition is
   * byte-identical.
   */
  async settle(
    pump: PumpContext,
    actor: AnyActorRef,
    input: SendEventInput,
    ctx: SettleContext,
  ): Promise<SettleOutcome> {
    const { stateValue, prior, projectionCtx } = ctx;

    if (stateValue === "ready" && input.machine === "login-and-org-setup") {
      // The projection does not yet have org/user — they are set on the
      // machine snapshot by the createOrgAndReissue actor's onDone, and
      // the `org_created_and_jwt_reissued` event we are about to emit is
      // what populates them in the projection. Source the values from
      // the dedicated harvester (`orchestrator-harvester.ts`), which is
      // the LEAF-D rule's designated snapshot-read boundary.
      const harvested = harvestSettledLoginState(actor);
      const orgCtx = harvested.org;
      const userCtx = harvested.user;
      // Mint a synthetic JWT carrying the org_id claim. Per ADR-029
      // invariant 4 the projection MUST expose the access_token so the FE
      // (and the TS harness via assert_jwt_carries_org_claim) can verify
      // the claim matches the projection's org. The signature is
      // intentionally a fixed placeholder — auth-proxy is the SSOT for
      // real signature verification; the ui-state tier exposes the
      // composed token shape for projection consumers.
      const access_token = mintAccessTokenForReady(orgCtx.id ?? "");
      // If this ready transition came FROM expired_token, mark the event
      // payload so auth-proxy can emit silent_reauth_ok. The projection
      // reducer surfaces the flag in context for the FE banner to read.
      const silentReauthRecovery = prior === "expired_token";
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "org_created_and_jwt_reissued",
        payload: {
          org: orgCtx,
          access_token,
          ...(silentReauthRecovery ? { silent_reauth_ok: true } : {}),
        },
        correlation_id: input.correlation_id,
      });

      // ---- auth_ready broadcast hook (DWD-6 + DWD-13 RD1) ----------------
      // When J-001 transitions creating_org → ready (NOT the
      // expired_token → ready recovery path), broadcast to project-context
      // so it spawns + receives the inherited org_id + user.first_name. This
      // mechanically retires the "second source of truth" risk Praxis F-5
      // named (the org_id flows J-001 → orchestrator → project-context
      // directly, never via a separate fetch). The project-context spawn's
      // post-settle `project_selected` branch fires the NEW `project_ready`
      // hook (DWD-13 §3.2.B) that spawns session-chat in turn.
      //
      // FIRING stays central — return the signal; the pump calls
      // beginIfNotStarted(PROJECT_CONTEXT…) after settle returns.
      const isFirstReady =
        prior === "creating_org" || prior === "anonymous" || !prior;
      if (isFirstReady && orgCtx.id) {
        const firstName =
          userCtx.first_name ??
          ((userCtx.display_name ?? "").split(/\s+/)[0] || null);
        return {
          authReady: { org_id: orgCtx.id, user_first_name: firstName ?? "" },
        };
      }
      return { authReady: null };
    } else if (stateValue === "expired_token") {
      // Harness-driven (or future production-driven) transition into the
      // expired_token state. The projection reducer derives state from this
      // event so subsequent reads see expired_token without the actor.
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "token_expired",
        payload: {},
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "error_recoverable") {
      // The projection does not yet have underlying_cause_tag — it is
      // set on the machine by the __force_failure__ handler or by
      // classifyFailure on a transient onError, and the
      // `reissue_failed_partial` event we are about to emit is what
      // populates it in the projection. Source the values from the
      // dedicated harvester (`orchestrator-harvester.ts`), which is the
      // LEAF-D rule's designated snapshot-read boundary.
      const harvested = harvestSettledLoginState(actor);
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "reissue_failed_partial",
        payload: {
          underlying_cause_tag:
            harvested.underlying_cause_tag ?? "partial-setup",
          org: harvested.org,
        },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "authenticated_no_org") {
      // org_form_submitted with an invalid name → stay in
      // authenticated_no_org but attach the validation error to context.
      if (projectionCtx.org_validation_error) {
        await pump.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "validation_failed",
          payload: { error: projectionCtx.org_validation_error },
          correlation_id: input.correlation_id,
        });
      }
    }

    return { authReady: null };
  },
};
