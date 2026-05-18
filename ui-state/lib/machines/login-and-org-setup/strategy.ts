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

import { createActor } from "xstate";

import type {
  BeginFlowInput,
  FlowStrategy,
  PumpContext,
} from "../../orchestrator.ts";
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
};
