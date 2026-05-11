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
  createLoginAndOrgSetupMachine,
  type LoginMachineDeps,
} from "./machines/login-and-org-setup.ts";
import type { FlowEvent, FlowProjection } from "./projection.ts";
import { buildProjection } from "./projection.ts";
import type { FlowEventLog } from "./persistence/redis.ts";
import { resolveActiveScope } from "./active-scope.ts";

export interface OrchestratorDeps {
  eventLog: FlowEventLog;
  loginMachineDeps: LoginMachineDeps;
  log?: (record: Record<string, unknown>) => void;
}

export interface BeginFlowInput {
  machine: string;
  principal_id: string;
  persona_email: string;
  persona_display_name: string;
  correlation_id: string;
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

    // Idempotent: if an actor already exists, reuse it.
    let actor = this.actors.get(flow_id);
    if (!actor) {
      const machine = createLoginAndOrgSetupMachine(this.deps.loginMachineDeps);
      actor = createActor(machine, {
        input: { correlation_id: input.correlation_id },
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
    }

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

    const principal_id = parsePrincipal(input.flow_id);
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

  private async projectionFor(
    flow_id: string,
    principal_id: string,
    correlation_id: string,
  ): Promise<FlowProjection> {
    const events = await this.deps.eventLog.read(flow_id);
    const projection = buildProjection(flow_id, events);
    const scope = resolveActiveScope(
      {},
      { sub: principal_id, org_id: null },
      {},
    );
    return {
      ...projection,
      correlation_id: correlation_id || projection.correlation_id,
      active_scope: scope.ok ? scope.scope : projection.active_scope,
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
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const TRANSIENT_STATES = new Set(["authenticating"]);
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
