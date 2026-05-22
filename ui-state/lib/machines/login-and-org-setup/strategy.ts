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
  BeginStrategy,
  FlowStrategy,
  PumpContext,
  SendEventInput,
  SettleContext,
  SettleOutcome,
} from "../../orchestrator.ts";
import { harvestSettledLoginState } from "../../orchestrator-harvester.ts";
import type { FlowEventLog } from "../../persistence/redis.ts";
import type { FlowEvent } from "../../projection.ts";
import { buildProjection } from "../../projection.ts";
import { waitForSettledState } from "../../wait-for-settled-state.ts";
import {
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
  buildMachine: () => {
    // Login is begun via LoginBeginStrategy (constructed in the router), not
    // spawned through the generic buildMachine path — nothing spawns login.
    throw new Error(
      "login-and-org-setup is begun via LoginBeginStrategy; buildMachine is never invoked",
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

  // ── ADR-040 §D2 LEAF-3 MR-L3a/N4 — login non-participation members ───
  // login-and-org-setup is the ONLY `beginsDirectly` machine: nothing
  // spawns it (no inbound cross-machine entry), it has no FREEZE handler
  // (ADR-028 — FREEZE/THAW is a J-002 project/session concern; the login
  // origin flow only FIRES the expired_token broadcast, it is never
  // itself frozen), no pre-settle event→transition emission, and no
  // deep-link re-resolve. These members complete the design-locked port
  // shape (N0) on the carved strategy and are intentional no-ops. The
  // pump's FREEZE/THAW broadcast LOOP stays central (leaf-3-plan §3) and
  // iterates only J-002 flows, so it never calls these for login; they
  // exist for port-completeness + MR-L3b/c symmetry. Behavior-neutral.

  async settleSpawn(
    _pump: PumpContext,
    _actor: AnyActorRef,
    _input: { machine: string; principal_id: string; correlation_id: string },
  ): Promise<void> {
    // No-op: login is never spawned (it is the only beginsDirectly machine).
  },

  async settleFreeze(
    _pump: PumpContext,
    _actor: AnyActorRef,
    _flow_id: string,
  ): Promise<void> {
    // No-op: login has no FREEZE handler (ADR-028) — it is never frozen.
  },

  async settleThaw(
    _pump: PumpContext,
    _actor: AnyActorRef,
    _flow_id: string,
    _kind: "thaw" | "abandoned",
  ): Promise<void> {
    // No-op: login has no FREEZE/THAW participation (ADR-028).
  },

  async applyEvent(
    _pump: PumpContext,
    _actor: AnyActorRef,
    _input: SendEventInput,
  ): Promise<void> {
    // No-op: login has no pre-settle event→transition emission (the
    // switching_* pre-settle arms are project/session only).
  },

  async applyDeepLink(
    _pump: PumpContext,
    _input: {
      machine: string;
      flow_id: string;
      correlation_id: string;
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    },
  ): Promise<void> {
    // No-op: login has no deep-link re-resolve (project-context only).
  },
};

/**
 * The fields the terminal-emission path reads off the login flow's projection
 * (the read model folded from the FlowEvent log). `FlowProjection.context` is
 * `Record<string, unknown>`, so this narrows it to the slice that becomes the
 * `auth_callback_resolved` / `auth_failed` payloads: the resolved WorkOS
 * profile and the failure cause tag.
 */
type LoginProjectionContext = {
  user: { email: string | null; display_name: string | null };
  underlying_cause_tag: string | null;
};

/**
 * Per-request begin command for the login flow (ADR-040 §D2 begin-semantics).
 * Constructed by the login router: builds its actor up front from the machine
 * deps, then `Orchestrator.begin` tracks the actor (enter), calls `begin()`
 * (this body), and returns the projection (exit). This object owns the actor,
 * its transitions, and its event-log writes; it never reaches into the
 * orchestrator — `eventLog` + `logTransition` are injected directly.
 *
 * Behavior-neutral carve from the former `loginOrgSetupStrategy.beginDirect`:
 * same FlowEvents, same order, same `waitForSettledState`/projection reads.
 */
export class LoginBeginStrategy implements BeginStrategy {
  readonly flow_id: string;
  readonly actor: AnyActorRef;
  readonly correlationId: string;
  private readonly input: BeginFlowInput;
  private readonly eventLog: FlowEventLog;
  private readonly logTransition: (record: Record<string, unknown>) => void;

  constructor(
    input: BeginFlowInput,
    deps: LoginMachineDeps,
    eventLog: FlowEventLog,
    logTransition: (record: Record<string, unknown>) => void,
  ) {
    this.input = input;
    this.eventLog = eventLog;
    this.logTransition = logTransition;
    this.flow_id = `${input.machine}:${input.principal_id}`;
    this.correlationId = input.correlation_id;
    const machine = createLoginAndOrgSetupMachine(deps);
    this.actor = createActor(machine, {
      input: {
        correlation_id: input.correlation_id,
        principal_id: input.principal_id,
        existing_org_names: input.existing_org_names,
      },
    });
  }

  /**
   * Run the login begin sequence: reset the persisted event log (a re-click is
   * a fresh auth attempt, so a stale terminal state must not replay), start the
   * actor, append + dispatch `sign_in_clicked`, wait for the `authenticating`
   * invoke to settle, then append the terminal event (`auth_callback_resolved`
   * or `auth_failed`) whose payload is read from the projection — the only
   * legal read source for the emission path (ADR-030).
   *
   * TODO(ADR-030): append an upstream FlowEvent carrying the resolved WorkOS
   * profile / cause to the log before this emission read, so the projection
   * observes it and the placeholder fallback can be removed. Today the log
   * holds only `sign_in_clicked` here, so those values still live in the actor
   * snapshot and terminal payloads may carry placeholders.
   */
  async begin(): Promise<void> {
    const { input, flow_id, actor } = this;
    const start = Date.now();

    await this.eventLog.reset(flow_id);

    actor.start();
    this.logTransition({
      flow_id,
      from_state: null,
      to_state: "anonymous",
      correlation_id: input.correlation_id,
      principal_id: input.principal_id,
      duration_ms: 0,
    });

    const signInEvent: FlowEvent = {
      ts: new Date().toISOString(),
      type: "sign_in_clicked",
      payload: {
        persona_email: input.persona_email,
        persona_display_name: input.persona_display_name,
      },
      correlation_id: input.correlation_id,
    };
    await this.eventLog.append(flow_id, signInEvent);

    actor.send({
      type: "sign_in_clicked",
      persona_email: input.persona_email,
      persona_display_name: input.persona_display_name,
    });

    await waitForSettledState(actor);

    const stateValue = actor.getSnapshot().value as string;

    const projectionContext = buildProjection(
      flow_id,
      await this.eventLog.read(flow_id),
    ).context as LoginProjectionContext;

    if (stateValue === "authenticated_no_org") {
      const user = projectionContext.user;
      const resolvedEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: "auth_callback_resolved",
        payload: { user },
        correlation_id: input.correlation_id,
      };
      await this.eventLog.append(flow_id, resolvedEvent);
      this.logTransition({
        flow_id,
        from_state: "authenticating",
        to_state: "authenticated_no_org",
        correlation_id: input.correlation_id,
        principal_id: input.principal_id,
        duration_ms: Date.now() - start,
      });
    } else if (stateValue === "error_recoverable") {
      const cause = projectionContext.underlying_cause_tag ?? "transient";
      const failedEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: "auth_failed",
        payload: { underlying_cause_tag: cause },
        correlation_id: input.correlation_id,
      };
      await this.eventLog.append(flow_id, failedEvent);
    }
  }
}
