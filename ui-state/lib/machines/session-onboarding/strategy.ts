// SessionOnboardingStrategy — the `session-onboarding` FlowStrategy impl
// (ADR-040 §D1/§D2 LEAF-3; ADR-041 domain realignment).
//
// Co-located with the machine it owns. ADR-028 "no machine imports another
// machine" is preserved — this strategy imports only its OWN machine module;
// the pump remains the sole cross-machine mediator and is reached through the
// `PumpContext` seam. Snapshot reads go exclusively through the sanctioned
// `harvestSettled*` boundary (orchestrator-harvester.ts) — never
// `snapshot.context` directly.
//
// Substrate stays the event-log: `settle→emit` and `begin` STILL append to
// the FlowEventLog (the store swap is ADR-040 LEAF-5, out of scope).

import { type AnyActorRef, createActor } from "xstate";

import { FlowId } from "../../flow-id.ts";
import type {
  BeginFlowInput,
  BeginStrategy,
  FlowStrategy,
  PumpContext,
  SettleContext,
  SettleOutcome,
} from "../../orchestrator.ts";
import { harvestSettledLoginState } from "../../orchestrator-harvester.ts";
import type { FlowEventLog } from "../../persistence/redis.ts";
import { FlowEvent } from "../../projection.ts";
import { createSessionOnboardingMachine } from "./index.ts";

/**
 * Canonical machine-name (ADR-039) — the FlowStrategy registry key. The
 * literal is the single canonical name shared with the orchestrator's
 * alias map (the legacy `login-and-org-setup` wire name aliases to it).
 */
const SESSION_ONBOARDING_MACHINE = "session-onboarding";

/**
 * The legacy wire name `login-and-org-setup` resolves to this strategy via the
 * orchestrator's LEAF-2 alias map. The settle gate accepts EITHER name so a
 * `/event` post carrying the legacy machine name still emits the terminal
 * `org_created` (the alias must be byte-behavior-identical to the canonical
 * path during the migration window).
 */
const LEGACY_WIRE_NAME = "login-and-org-setup";

function isSessionOnboarding(machine: string): boolean {
  return machine === SESSION_ONBOARDING_MACHINE || machine === LEGACY_WIRE_NAME;
}

/**
 * Compose a NON-SECURITY org-claim echo (OQ-5 / ADR-016). The ui-state tier
 * does NOT sign tokens cryptographically — that is auth-proxy's job. This
 * routine composes a JWT-shaped string whose payload encodes the org_id so
 * projection consumers (FE + TS harness `assert_jwt_carries_org_claim`) can
 * read the claim without an additional API call. The `alg:none` header + the
 * fixed `ui-state-mint` "sig" segment make it self-evidently NOT a real
 * credential — nothing verifies this string as auth.
 */
function composeOrgClaimEcho(org_id: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ org_id })).toString("base64url");
  return `${header}.${payload}.ui-state-mint`;
}

export const sessionOnboardingStrategy: FlowStrategy = {
  machineName: SESSION_ONBOARDING_MACHINE,
  buildMachine: () => {
    // Session-onboarding is begun via SessionOnboardingBeginStrategy
    // (constructed in the router), not spawned through the generic
    // buildMachine path — nothing spawns it.
    throw new Error(
      "session-onboarding is begun via SessionOnboardingBeginStrategy; buildMachine is never invoked",
    );
  },

  /**
   * Post-settle terminal emission (ADR-040 §D2). On the `ready` arm the org
   * (and a non-security org-claim echo) are emitted as `org_created`; the
   * verified user is already in the projection (seeded by `session_started`
   * at begin — ADR-041 D2), so it need not be re-harvested for the user.
   *
   * The `auth_ready` cross-machine spawn hook FIRING stays CENTRAL: `settle`
   * returns the `authReady` signal and the pump fires it. The first-ready
   * predicate includes the `verifying → ready` predecessor so a RETURNING
   * user (the [hasOrg] shortcut, no creating_org) ALSO spawns project-context
   * (ratified 2026-05-22, ADR-041 D5 / wave-decisions §8 Adjustment B).
   */
  async settle(
    pump: PumpContext,
    actor: AnyActorRef,
    event: FlowEvent,
    flow_id: string,
    machine: string,
    ctx: SettleContext,
  ): Promise<SettleOutcome> {
    const { stateValue, prior } = ctx;

    if (stateValue === "ready" && isSessionOnboarding(machine)) {
      // The org is set on the machine snapshot by the createOrgAndReissue
      // actor's onDone (new user) or by assignVerifiedUser (returning user);
      // the `org_created` event we are about to emit is what populates it in
      // the projection. Source the values from the sanctioned harvester.
      const harvested = harvestSettledLoginState(actor);
      const orgCtx = harvested.org;
      const userCtx = harvested.user;
      // Non-security org-claim echo (OQ-5) so the FE / TS harness can read the
      // org_id claim. NOT a real credential — auth-proxy is the SSOT.
      const access_token = composeOrgClaimEcho(orgCtx.id ?? "");
      await pump.deps.eventLog.append(
        flow_id,
        FlowEvent.from(FlowId.fromKey(flow_id), {
          type: "org_created",
          payload: {
            org: orgCtx,
            access_token,
          },
          request_id: event.request_id,
        }),
      );

      // ---- auth_ready broadcast hook ------------------------------------
      // First `ready` via EITHER path spawns project-context (carries org_id
      // + first_name). FIRING stays central — return the signal; the pump
      // calls beginIfNotStarted(project-context) after settle returns.
      const isFirstReady =
        prior === "creating_org" || prior === "verifying" || !prior;
      if (isFirstReady && orgCtx.id) {
        const firstName =
          userCtx.first_name ??
          ((userCtx.display_name ?? "").split(/\s+/)[0] || null);
        return {
          authReady: { org_id: orgCtx.id, user_first_name: firstName ?? "" },
        };
      }
      return { authReady: null };
    } else if (stateValue === "error_recoverable") {
      // underlying_cause_tag is set on the machine by the `tagCause` action (the
      // __force_failure__ jump, or the budget-exhausted partial-setup arm); the
      // `reissue_failed_partial` event we emit is what populates it in the
      // projection. Source the values from the sanctioned harvester.
      const harvested = harvestSettledLoginState(actor);
      await pump.deps.eventLog.append(
        flow_id,
        FlowEvent.from(FlowId.fromKey(flow_id), {
          type: "reissue_failed_partial",
          payload: {
            underlying_cause_tag:
              harvested.underlying_cause_tag ?? "partial-setup",
            org: harvested.org,
          },
          request_id: event.request_id,
        }),
      );
    } else if (stateValue === "needs_org") {
      // org_form_submitted with an invalid name → stay in needs_org but
      // attach the validation error to context. The error lives only on the
      // snapshot at emission time (the projection-of-log has not captured it),
      // so source it from the sanctioned harvester.
      const harvested = harvestSettledLoginState(actor);
      if (harvested.org_validation_error) {
        await pump.deps.eventLog.append(
          flow_id,
          FlowEvent.from(FlowId.fromKey(flow_id), {
            type: "validation_failed",
            payload: { error: harvested.org_validation_error },
            request_id: event.request_id,
          }),
        );
      }
    }

    return { authReady: null };
  },

  // ── session-onboarding non-participation members (ADR-040 §D2 LEAF-3) ──
  // session-onboarding is the ONLY `beginsDirectly` machine: nothing spawns
  // it, it has no FREEZE handler (FREEZE/THAW is a J-002 concern; the origin
  // flow only FIRES the expired_token broadcast, it is never itself frozen),
  // no pre-settle event→transition emission, and no deep-link re-resolve.
  // These members complete the port shape and are intentional no-ops.

  async settleSpawn(
    _pump: PumpContext,
    _actor: AnyActorRef,
    _input: { machine: string; principal_id: string; request_id: string },
  ): Promise<void> {
    // No-op: session-onboarding is never spawned (only beginsDirectly machine).
  },

  async settleFreeze(
    _pump: PumpContext,
    _actor: AnyActorRef,
    _flow_id: string,
  ): Promise<void> {
    // No-op: session-onboarding has no FREEZE handler — it is never frozen.
  },

  async settleThaw(
    _pump: PumpContext,
    _actor: AnyActorRef,
    _flow_id: string,
    _kind: "thaw" | "abandoned",
  ): Promise<void> {
    // No-op: session-onboarding has no FREEZE/THAW participation (ADR-028).
  },

  async applyEvent(
    _pump: PumpContext,
    _actor: AnyActorRef,
    _event: FlowEvent,
    _flow_id: string,
    _machine: string,
  ): Promise<void> {
    // No-op: session-onboarding has no pre-settle event→transition emission.
  },

  async applyDeepLink(
    _pump: PumpContext,
    _input: {
      machine: string;
      flow_id: string;
      request_id: string;
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    },
  ): Promise<void> {
    // No-op: session-onboarding has no deep-link re-resolve (project-context only).
  },
};

/**
 * Per-request begin command for the session-onboarding flow (ADR-040 §D2
 * begin-semantics). Constructed by the router: builds its actor up front from
 * the machine deps, then `BeginFlowOrchestrator.begin` tracks the actor
 * (enter), calls `begin()` (this body), and returns the projection (exit).
 *
 * The begin sequence (ADR-041 D2 — the defect fix): reset the persisted log,
 * start the actor (initial state `verifying` invokes the re-verify actor with
 * the forwarded Bearer), wait for the invoke to settle, then branch on the
 * settled control-state:
 *   - `ready` / `needs_org`  → emit the SELF-CONTAINED `session_started{user,
 *     org|null}` carrying the verified user/org HARVESTED from the settled
 *     snapshot (the sanctioned boundary). The projection's `session_started`
 *     reducer folds it (state = org?.id ? ready : needs_org), so the user is
 *     populated at t=0 — closing the placeholder defect.
 *   - `session_rejected`     → emit `session_rejected{reason}`; NO
 *     session_started, no user state advances (OQ-2).
 */
export class SessionOnboardingBeginStrategy implements BeginStrategy {
  readonly flowId: FlowId;
  readonly actor: AnyActorRef;
  readonly requestId: string;
  private readonly input: BeginFlowInput;
  private readonly eventLog: FlowEventLog;
  private readonly logTransition: (record: Record<string, unknown>) => void;

  constructor(
    input: BeginFlowInput,
    eventLog: FlowEventLog,
    logTransition: (record: Record<string, unknown>) => void,
  ) {
    this.input = input;
    this.eventLog = eventLog;
    this.logTransition = logTransition;
    this.flowId = input.flowId;
    this.requestId = input.request_id;
    // Every actor is config/input-driven (no `.provide(...)`): the fetch-driven
    // actors (loadSession / createOrgAndReissue) read their I/O port from
    // input.deps.request_client (threaded into the machine input below).
    const machine = createSessionOnboardingMachine();
    this.actor = createActor(machine, {
      input: {
        request_id: input.request_id,
        principal_id: input.flowId.principal_id,
        bearer_token: input.bearer_token,
        // Env config (workosUrl + backendUrl) for the re-verify + org-create
        // resolvers, sourced from the composition root — keeps the resolvers
        // config-agnostic.
        config: input.config ?? null,
        // The I/O port (the `fetch` library) the resolvers call directly,
        // threaded the same path as config: composition root → BeginFlowInput
        // → here → machine input → context → invoke input → resolver.
        deps: input.deps ?? null,
        // Failure-simulation budget (already gated at the HTTP edge); folded
        // into getOrgAndReissue via attempt-vs-budget.
        force_reissue_failures: input.force_reissue_failures ?? null,
      },
    });
  }

  async begin(): Promise<void> {
    const { input, flowId, actor } = this;
    const flow_id = FlowId.toKey(flowId);
    const start = Date.now();

    await this.eventLog.reset(flow_id);

    actor.start();
    this.logTransition({
      flow_id,
      from_state: null,
      to_state: "verifying",
      request_id: input.request_id,
      principal_id: flowId.principal_id,
      duration_ms: 0,
    });

    await waitForVerifySettled(actor);

    const stateValue = actor.getSnapshot().value as string;

    if (stateValue === "session_rejected") {
      const harvested = harvestSettledLoginState(actor);
      const rejectedEvent = FlowEvent.from(flowId, {
        type: "session_rejected",
        payload: {
          reason: harvested.underlying_cause_tag ?? "session_rejected",
        },
        request_id: input.request_id,
      });
      await this.eventLog.append(flow_id, rejectedEvent);
      this.logTransition({
        flow_id,
        from_state: "verifying",
        to_state: "session_rejected",
        request_id: input.request_id,
        principal_id: flowId.principal_id,
        duration_ms: Date.now() - start,
      });
      return;
    }

    // ready (returning user) or needs_org (new user): emit the self-contained
    // session_started carrying the harvested verified user + org. The org was
    // loaded from the backend (`/api/orgs/me`, the org SSOT) during `verifying`
    // and assigned into the snapshot (id AND real name) — so it comes from the
    // sanctioned harvester, like the user, not a header claim. New users have no
    // org (id null) → emit null. The projection reducer replicates the [hasOrg]
    // guard (org?.id ? ready : needs_org).
    const harvested = harvestSettledLoginState(actor);
    const org = harvested.org.id
      ? { id: harvested.org.id, name: harvested.org.name }
      : null;
    const startedEvent = FlowEvent.from(flowId, {
      type: "session_started",
      payload: {
        user: {
          email: harvested.user.email,
          display_name: harvested.user.display_name,
          first_name: harvested.user.first_name,
        },
        org,
      },
      request_id: input.request_id,
    });
    await this.eventLog.append(flow_id, startedEvent);
    this.logTransition({
      flow_id,
      from_state: "verifying",
      to_state: stateValue,
      request_id: input.request_id,
      principal_id: flowId.principal_id,
      duration_ms: Date.now() - start,
    });
  }
}

/**
 * Wait until the `verifying` invoke settles into one of its terminal targets
 * (`ready`, `needs_org`, or `session_rejected`). The generic
 * `waitForSettledState` treats invoke-driven transients as settled, so a
 * dedicated predicate keeps the begin sequence honest: it observes the
 * post-invoke control-state, not the in-flight `verifying`.
 */
function waitForVerifySettled(
  actor: AnyActorRef,
  timeoutMs = 10000,
): Promise<void> {
  const isSettled = (value: string): boolean =>
    value === "ready" || value === "needs_org" || value === "session_rejected";
  return new Promise((resolve, reject) => {
    if (isSettled(actor.getSnapshot().value as string)) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error("waitForVerifySettled: timeout"));
    }, timeoutMs);
    const sub = actor.subscribe((s) => {
      if (isSettled(s.value as string)) {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve();
      }
    });
  });
}
