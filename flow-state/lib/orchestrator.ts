// FlowOrchestrator — root supervisor for per-flow XState actors.
//
// Per ADR-028 §"Decision outcome", the orchestrator owns the actor tree.
// Step 01-01 (walking skeleton) wires only the begin-flow + send-event +
// read-projection slice. The cross-machine FREEZE/THAW broadcast and the
// replay buffer land in later steps.
//
// Each flow is keyed by `flow_id = "<machine-name>:<principal_id>"` per
// ADR-030 §SD3 for multi-tenant safety.

import { createActor, type AnyActorRef } from "xstate";

import {
  createForcedFailureOrgAndReissueActor,
  createLoginAndOrgSetupMachine,
  type CreateOrgAndReissueInput,
  type CreateOrgAndReissueOutput,
  type LoginMachineDeps,
} from "./machines/login-and-org-setup.ts";
import type { FlowEvent, FlowProjection } from "./projection.ts";
import { buildProjection } from "./projection.ts";
import type { FlowEventLog } from "./persistence/redis.ts";

export interface OrchestratorDeps {
  eventLog: FlowEventLog;
  loginMachineDeps: LoginMachineDeps;
  /**
   * Async function form of the org-create step. Used by the harness-knob
   * wrapper to sequence create + reissue with forced failures injected at
   * the reissue boundary. Optional — production builds may pass only
   * `loginMachineDeps`. When the knob is exercised and this is unset, the
   * wrapper falls back to a no-op that throws.
   */
  createOrgFn?: (
    input: CreateOrgAndReissueInput,
  ) => Promise<{ org_id: string; org_name: string }>;
  reissueOrgJwtFn?: (
    input: { org_id: string; correlation_id: string },
  ) => Promise<void>;
  log?: (record: Record<string, unknown>) => void;
}

export interface BeginFlowInput {
  machine: string;
  principal_id: string;
  persona_email: string;
  persona_display_name: string;
  correlation_id: string;
  /** Optional seed for the duplicate-org-name fixture path (slice-1). */
  existing_org_names?: string[];
  /**
   * Test-only harness knob: pre-load the machine with N forced failures of
   * the createOrgAndReissue actor (the (N+1)-th call succeeds). Implements
   * the `@jwt_reissue_failed_after_org_create` slice-1 scenarios. Has no
   * effect in production builds — the orchestrator only reads it when
   * NWAVE_HARNESS_KNOBS=true is set in the environment.
   */
  harness_force_reissue_failures?: number;
}

export interface SendEventInput {
  machine: string;
  flow_id: string;
  type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
}

export class FlowOrchestrator {
  private readonly actors = new Map<string, AnyActorRef>();

  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * Begin a flow. Creates the actor, persists the sign_in_clicked event,
   * waits for the authenticating actor's onDone (workos userinfo), and
   * returns the projection.
   */
  async begin(input: BeginFlowInput): Promise<FlowProjection> {
    if (input.machine !== "login-and-org-setup") {
      throw new Error(`Unknown machine: ${input.machine}`);
    }

    const flow_id = `${input.machine}:${input.principal_id}`;
    const start = Date.now();

    // Re-clicking sign-in is the entry to a NEW auth attempt — reset the
    // prior actor (if any) and event log so we don't replay a stale flow.
    // The persisted event log is the source of truth; the actor is a
    // process-local cache. Without this reset, a second sign-in inherits
    // the previous attempt's terminal state and never re-enters
    // `authenticating`.
    const existing = this.actors.get(flow_id);
    if (existing) {
      existing.stop();
      this.actors.delete(flow_id);
    }
    await this.deps.eventLog.reset(flow_id);

    // Harness knob: wrap createOrgAndReissue with a failure-injecting
    // counter for slice-1 scenarios that exercise the retry budget. The
    // knob is gated by NWAVE_HARNESS_KNOBS so production builds ignore
    // the field even if a caller tries to set it.
    const harnessKnobsEnabled = process.env.NWAVE_HARNESS_KNOBS === "true";
    const forceFailures = harnessKnobsEnabled
      ? input.harness_force_reissue_failures ?? 0
      : 0;
    const machineDeps: LoginMachineDeps =
      forceFailures > 0
        ? {
            ...this.deps.loginMachineDeps,
            createOrgAndReissue: createForcedFailureOrgAndReissueActor(
              this.deps.createOrgFn ??
                (async () => {
                  throw new Error("no real createOrgFn wired");
                }),
              this.deps.reissueOrgJwtFn ??
                (async () => {
                  throw new Error("no real reissueOrgJwtFn wired");
                }),
              forceFailures,
            ),
          }
        : this.deps.loginMachineDeps;

    const machine = createLoginAndOrgSetupMachine(machineDeps);
    const actor = createActor(machine, {
      input: {
        correlation_id: input.correlation_id,
        principal_id: input.principal_id,
        existing_org_names: input.existing_org_names,
      },
    });
    this.actors.set(flow_id, actor);
    actor.start();
    this.logTransition({
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
    await this.deps.eventLog.append(flow_id, signInEvent);

    actor.send({
      type: "sign_in_clicked",
      persona_email: input.persona_email,
      persona_display_name: input.persona_display_name,
    });

    // Wait for the authenticating invoke to resolve.
    await waitForSettledState(actor);

    const snapshot = actor.getSnapshot();
    const stateValue = snapshot.value as string;

    // On successful auth, append auth_callback_resolved so the projection
    // matches the wire contract from the event log even without a snapshot.
    if (stateValue === "authenticated_no_org") {
      const user = (snapshot.context as { user: { email: string | null; display_name: string | null } }).user;
      const resolvedEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: "auth_callback_resolved",
        payload: { user },
        correlation_id: input.correlation_id,
      };
      await this.deps.eventLog.append(flow_id, resolvedEvent);
      this.logTransition({
        flow_id,
        from_state: "authenticating",
        to_state: "authenticated_no_org",
        correlation_id: input.correlation_id,
        principal_id: input.principal_id,
        duration_ms: Date.now() - start,
      });
    } else if (stateValue === "error_recoverable") {
      const cause =
        (snapshot.context as { underlying_cause_tag: string | null })
          .underlying_cause_tag ?? "transient";
      const failedEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: "auth_failed",
        payload: { underlying_cause_tag: cause },
        correlation_id: input.correlation_id,
      };
      await this.deps.eventLog.append(flow_id, failedEvent);
    }

    return this.projectionFor(flow_id, input.principal_id, input.correlation_id);
  }

  async send(input: SendEventInput): Promise<FlowProjection> {
    const actor = this.actors.get(input.flow_id);
    if (!actor) {
      throw new Error(`unknown flow_id: ${input.flow_id}`);
    }

    const event: FlowEvent = {
      ts: new Date().toISOString(),
      type: input.type,
      payload: input.payload,
      correlation_id: input.correlation_id,
    };
    await this.deps.eventLog.append(input.flow_id, event);

    // Forward the event type to the XState actor. Unknown event types are
    // ignored by the machine (XState v5 default).
    actor.send({ type: input.type, ...input.payload } as never);
    await waitForSettledState(actor);

    // After settle, observe terminal-for-now state and append projection-
    // shaping events for the event-sourced read model. The reducer in
    // `projection.ts` is the SSOT for state-derivation from events.
    const snapshot = actor.getSnapshot();
    const stateValue = snapshot.value as string;
    const principal_id = parsePrincipal(input.flow_id);

    if (stateValue === "ready") {
      const orgCtx = (snapshot.context as { org: { id: string | null; name: string | null } }).org;
      await this.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "org_created_and_jwt_reissued",
        payload: { org: orgCtx },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "error_recoverable") {
      const ctx = snapshot.context as {
        underlying_cause_tag: string | null;
        org: { id: string | null; name: string | null };
      };
      await this.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "reissue_failed_partial",
        payload: {
          underlying_cause_tag: ctx.underlying_cause_tag ?? "partial-setup",
          org: ctx.org,
        },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "authenticated_no_org") {
      // org_form_submitted with an invalid name → stay in
      // authenticated_no_org but attach the validation error to context.
      const ctx = snapshot.context as {
        org_validation_error: { kind: string; message: string } | null;
      };
      if (ctx.org_validation_error) {
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "validation_failed",
          payload: { error: ctx.org_validation_error },
          correlation_id: input.correlation_id,
        });
      }
    }

    return this.projectionFor(
      input.flow_id,
      principal_id,
      input.correlation_id,
    );
  }

  async getProjection(flow_id: string): Promise<FlowProjection> {
    const principal_id = parsePrincipal(flow_id);
    return this.projectionFor(flow_id, principal_id, "");
  }

  /**
   * Append projection-shaping events without dispatching them to the XState
   * actor. Used by the deep-link endpoint (Step 01-03): the ScopeResolver
   * runs at the HTTP edge, and its outcome is recorded as a
   * `deep_link_opened` or `scope_access_denied` event so subsequent
   * projection reads observe the resolved scope.
   *
   * The reducer in `projection.ts` is the SSOT for state derivation; the
   * XState actor does NOT need to know about scope events because scope is
   * orthogonal to the login statechart.
   */
  async appendDeepLinkEvents(input: {
    machine: string;
    flow_id: string;
    correlation_id: string;
    events: Array<{ type: string; payload: Record<string, unknown> }>;
  }): Promise<FlowProjection> {
    if (input.machine !== "login-and-org-setup") {
      throw new Error(`Unknown machine: ${input.machine}`);
    }
    for (const ev of input.events) {
      const flowEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: ev.type,
        payload: ev.payload,
        correlation_id: input.correlation_id,
      };
      await this.deps.eventLog.append(input.flow_id, flowEvent);
    }
    const principal_id = parsePrincipal(input.flow_id);
    return this.projectionFor(
      input.flow_id,
      principal_id,
      input.correlation_id,
    );
  }

  private async projectionFor(
    flow_id: string,
    _principal_id: string,
    correlation_id: string,
  ): Promise<FlowProjection> {
    const events = await this.deps.eventLog.read(flow_id);
    const projection = buildProjection(flow_id, events);
    // The projection reducer is the SSOT for active_scope. The orchestrator
    // does not re-compute scope from JWT here — deep_link_opened events
    // carry the resolved scope, and the reducer derives an org-only scope
    // for flows that haven't opened a deep link yet. Per ADR-029 the
    // resolver is invoked at the HTTP edge (index.ts) where route params
    // and JWT claims are observable, not in the per-flow projection.
    return {
      ...projection,
      correlation_id: correlation_id || projection.correlation_id,
    };
  }

  private logTransition(record: Record<string, unknown>): void {
    const out = { event: "flow.transition", ...record };
    if (this.deps.log) {
      this.deps.log(out);
      return;
    }
    process.stdout.write(`${JSON.stringify(out)}\n`);
  }

  async dispose(): Promise<void> {
    for (const actor of this.actors.values()) {
      actor.stop();
    }
    this.actors.clear();
  }
}

function parsePrincipal(flow_id: string): string {
  const parts = flow_id.split(":");
  return parts[1] ?? "";
}


/**
 * Wait for the XState actor to leave any transient state (i.e., to settle
 * out of an `invoke`'d promise). Subscribes once, resolves on the first
 * snapshot whose value is one of the terminal-for-now states.
 *
 * For the walking skeleton: authenticating is transient; everything else is
 * settled. Later steps that introduce more invoke-driven states extend this
 * to a state-machine-aware predicate.
 */
function waitForSettledState(
  actor: AnyActorRef,
  timeoutMs = 10000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // States that contain `invoke` blocks — caller waits for them to leave.
    // `creating_org` retries internally up to REISSUE_BUDGET; we wait for
    // it to settle into `ready` or `error_recoverable`.
    const TRANSIENT_STATES = new Set(["authenticating", "creating_org"]);
    const snapshot = actor.getSnapshot();
    if (!TRANSIENT_STATES.has(snapshot.value as string)) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error("waitForSettledState: timeout"));
    }, timeoutMs);

    const sub = actor.subscribe((snap) => {
      if (!TRANSIENT_STATES.has(snap.value as string)) {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve();
      }
    });
  });
}
