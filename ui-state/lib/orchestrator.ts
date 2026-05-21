/**
 * FlowOrchestrator — root supervisor for per-flow XState actors.
 *
 * Owns the actor map, the replay buffer, and all cross-machine signaling
 * (FREEZE/THAW broadcast, auth_ready/project_ready spawn hooks). Sibling
 * machines never import each other — they signal each other only through
 * this class.
 *
 * Flow identity is `<machine-name>:<principal_id>`. Principal ids never
 * contain `:`, so the head segment is the machine name.
 *
 * Replay buffer is bounded (`FREEZE_WINDOW_MS`, `REPLAY_BUFFER_CAP`):
 * overflow or timeout marks the flow abandoned, and THAW then drives
 * `freeze → error_recoverable` instead of replaying. Replay order is
 * FIFO ACROSS flows, not within one — every queued intent carries a
 * process-global `seq` so pass-2 of THAW sorts and replays them in true
 * arrival order even when siblings buffer to separate per-flow queues.
 *
 * Design rationale lives in the ADRs (not at the call sites):
 *   - ADR-028  Orchestrator-owned actor tree; siblings signal only via this class.
 *   - ADR-029  Deep-link scope resolution at the HTTP edge.
 *   - ADR-030  Multi-tenant flow_id keying; sanctioned snapshot boundary
 *              (the `harvestSettled*` family — never read `actor.getSnapshot().context` directly).
 *   - ADR-035  Failure-simulation gate composition (NWAVE_HARNESS_KNOBS).
 *   - ADR-039  Canonical machine-name conventions; registry keys.
 *   - ADR-040  FlowStrategy port + explicit registry + legacy-wire-name
 *              alias map; pump/strategy seam (PumpContext, SettleContext,
 *              SettleOutcome). The pump retains actor-system ownership,
 *              spawn lifecycle, and all cross-machine hook firing; the
 *              strategy owns per-machine begin/event/settle bodies.
 */

import { type AnyActorRef, type AnyStateMachine, createActor } from "xstate";

import type { ResourceType } from "./active-scope.ts";
import { err,ok, type Result } from "./flow-result.ts";
import { loginOrgSetupStrategy } from "./machines/login-and-org-setup/strategy.ts";
import { type ProjectContextMachineDeps } from "./machines/project-context/index.ts";
import { projectContextStrategy } from "./machines/project-context/strategy.ts";
import { type SessionChatMachineDeps } from "./machines/session-chat/index.ts";
import { sessionChatStrategy } from "./machines/session-chat/strategy.ts";
import {
  harvestSettledFreezeState,
  harvestSettledProjectContextState,
  harvestSettledSessionChatState,
} from "./orchestrator-harvester.ts";
import type { FlowEventLog } from "./persistence/redis.ts";
import type { FlowEvent, FlowProjection } from "./projection.ts";
import { buildProjection } from "./projection.ts";
import { waitForSettledState } from "./wait-for-settled-state.ts";

/**
 * Wire-protocol machine name preserved for back-compat: the HTTP URL path
 * and Redis event-log key prefix remain `project-and-chat-session-management`
 * so the existing acceptance harness drives the project-context half without
 * modification, even though the source-tree split into `project-context` +
 * `session-chat`.
 */
const PROJECT_CONTEXT_WIRE_NAME = "project-and-chat-session-management";
const SESSION_CHAT_WIRE_NAME = "session-chat";

/** Only J-002 flows emit freeze-lifecycle events (`*_frozen` / `*_thawed` /
 *  `replay_abandoned` / `stale_intent_dropped_after_thaw`). The login flow
 *  has no `freeze` side-state. */
const J002_MACHINES = new Set([
  PROJECT_CONTEXT_WIRE_NAME,
  SESSION_CHAT_WIRE_NAME,
]);

function machineOfFlow(flow_id: string): string {
  return flow_id.split(":")[0] ?? "";
}

export interface OrchestratorDeps {
  eventLog: FlowEventLog;
  /** Optional — when absent, the `auth_ready` spawn hook becomes a no-op
   *  (legacy J-001-only deployments). */
  projectContextMachineDeps?: ProjectContextMachineDeps;
  /** Optional — when absent, the `project_ready` spawn hook becomes a no-op. */
  sessionChatMachineDeps?: SessionChatMachineDeps;
  log?: (record: Record<string, unknown>) => void;
}

// Login deps (the machine impls + the org-create/reissue concretions the
// forced-failure wrapper needs) deliberately do NOT live here. Login is the
// only `beginsDirectly` machine, so its driver — the login router — supplies
// them per begin via `BeginFlowInput.deps`. The J-002 deps above stay because
// the orchestrator originates those flows itself (the auth_ready/project_ready
// spawn hooks), so it must hold their construction inputs.

/** Canonical machine-name used as the FlowStrategy registry key and the
 *  alias-map target for the legacy wire name. */
const PROJECT_CONTEXT_MACHINE = "project-context";

/**
 * Pump/strategy seam — the capability surface a `FlowStrategy` may use
 * without importing the orchestrator. The pump retains actor-system
 * ownership and spawn lifecycle; the strategy asks the pump to
 * recycle/track actors and to resolve the projection.
 */
export interface PumpContext {
  readonly deps: OrchestratorDeps;
  /** Stop+forget any existing actor for this flow. The persisted event log
   *  is the source of truth; the in-process actor is just a cache. */
  recycleActor(flow_id: string): void;
  trackActor(flow_id: string, actor: AnyActorRef): void;
  /** Reset priorState/frozen/abandoned tracking — one unit with the
   *  actor+log reset to prevent cross-flow contamination on flow_id reuse. */
  resetFlowTracking(flow_id: string): void;
  logTransition(record: Record<string, unknown>): void;
  projectionFor(
    flow_id: string,
    principal_id: string,
    correlation_id: string,
  ): Promise<FlowProjection>;
}

/**
 * Pump-computed inputs handed to `FlowStrategy.settle`. The strategy never
 * reads `actor.getSnapshot().context` directly — context goes through the
 * `harvestSettled*` family or the live projection (passed here).
 */
export interface SettleContext {
  readonly stateValue: string;
  /** Prior tracked state at entry to the settle block — drives
   *  silent-reauth-recovery + first-ready detection. */
  readonly prior: string | undefined;
  readonly projectionCtx: {
    org_validation_error: { kind: string; message: string } | null;
  } & Record<string, unknown>;
}

/**
 * Cross-machine spawn signals returned by `settle`. The pump fires the
 * dispatch (a strategy never imports another machine); each field is
 * independent.
 */
export interface SettleOutcome {
  /** Set when login reached `ready` for the first time with a resolved org —
   *  the pump then spawns project-context via `beginIfNotStarted`. */
  authReady?: { org_id: string; user_first_name: string } | null;
  /** Set when project-context settled in `project_selected` on a `send()`
   *  path — the pump then fires `maybeFireProjectReady` toward session-chat. */
  projectReady?: {
    org_id?: string;
    project?: { id: string | null; name: string | null };
    deeplink_session_id?: string | null;
    intent_resource_id?: string | null;
    intent_resource_type?: ResourceType | null;
  } | null;
}

/**
 * The per-machine strategy port. The orchestrator resolves a wire name to a
 * `FlowStrategy` via the registry and dispatches through these members
 * instead of a `switch (input.machine)` table.
 *
 * Most members are optional and machine-exclusive: only the matching
 * strategy does anything on a given dispatch; siblings act as no-ops. The
 * pump retains all cross-machine hook firing — `settle` returns a signal
 * via `SettleOutcome`, the pump fires the downstream spawn.
 */
export interface FlowStrategy {
  /** Canonical machine-name — the registry key. Never a flow-id. */
  readonly machineName: string;
  buildMachine(
    deps: OrchestratorDeps,
    input: {
      correlation_id: string;
      principal_id: string;
      existing_org_names?: string[];
    },
  ): AnyStateMachine;

  /** Pre-settle event→transition emission (currently project-context only). */
  applyEvent?(
    pump: PumpContext,
    actor: AnyActorRef,
    input: SendEventInput,
  ): Promise<void>;
  /** Post-settle terminal emission. Returns any cross-machine hook signal
   *  (the pump fires the downstream dispatch). */
  settle?(
    pump: PumpContext,
    actor: AnyActorRef,
    input: SendEventInput,
    ctx: SettleContext,
  ): Promise<SettleOutcome>;
  /** Spawn-time terminal emission (called from `beginIfNotStarted`). */
  settleSpawn?(
    pump: PumpContext,
    actor: AnyActorRef,
    input: { machine: string; principal_id: string; correlation_id: string },
  ): Promise<void>;
  /** Per-frozen-flow FREEZE emission tail; the broadcast loop stays central. */
  settleFreeze?(
    pump: PumpContext,
    actor: AnyActorRef,
    flow_id: string,
  ): Promise<void>;
  /** Per-frozen-flow THAW emission tail; the broadcast loop stays central. */
  settleThaw?(
    pump: PumpContext,
    actor: AnyActorRef,
    flow_id: string,
    kind: "thaw" | "abandoned",
  ): Promise<void>;
  /** Deep-link re-resolve emission. */
  applyDeepLink?(
    pump: PumpContext,
    input: {
      machine: string;
      flow_id: string;
      correlation_id: string;
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    },
  ): Promise<void>;
}

/** Thrown on a registry miss. The HTTP edge maps this to a clean 404. */
export class UnknownMachineError extends Error {
  constructor(public readonly machine: string) {
    super(`Unknown machine: ${machine}`);
    this.name = "UnknownMachineError";
  }
}

/** Boundary translator: `*Core` bodies throw; the public facades funnel
 *  every exception through here so external callers get a Result. */
function toFlowError(e: unknown): Result<never> {
  if (e instanceof UnknownMachineError) {
    return err({ kind: "unknown_machine", machine: e.machine });
  }
  return err({ kind: "dispatch_error", message: (e as Error).message });
}

/**
 * Migration alias map: a legacy wire segment is canonicalized to its
 * machine-name before lookup so the J-002 acceptance suite (which drives
 * the legacy feature-slug) stays byte-behavior-identical. Registry KEYS
 * stay canonical; this is purely input canonicalization.
 */
const MACHINE_NAME_ALIASES: Readonly<Record<string, string>> = {
  [PROJECT_CONTEXT_WIRE_NAME]: PROJECT_CONTEXT_MACHINE,
};

/**
 * Explicit static FlowStrategy registry, keyed by canonical machine-name.
 * Adding a future flow is one new strategy registration — no `if/else`.
 * `get` is a strict canonical-key lookup; `resolve` additionally applies
 * the alias map and throws `UnknownMachineError` on a miss.
 */
class FlowStrategyRegistry {
  private readonly strategies = new Map<string, FlowStrategy>();

  register(strategy: FlowStrategy): void {
    this.strategies.set(strategy.machineName, strategy);
  }

  get(machineName: string): FlowStrategy | undefined {
    return this.strategies.get(machineName);
  }

  canonicalNames(): string[] {
    return [...this.strategies.keys()];
  }

  resolve(wireName: string): FlowStrategy {
    const canonical = MACHINE_NAME_ALIASES[wireName] ?? wireName;
    const strategy = this.strategies.get(canonical);
    if (!strategy) {
      throw new UnknownMachineError(wireName);
    }
    return strategy;
  }
}

export const FLOW_STRATEGY_REGISTRY = new FlowStrategyRegistry();

FLOW_STRATEGY_REGISTRY.register(loginOrgSetupStrategy);
FLOW_STRATEGY_REGISTRY.register(projectContextStrategy);
// Session-chat is normally spawned via the `project_ready` broadcast hook
// (project-context → `project_selected`). Direct `/begin` HTTP posts route
// here too, but the actor stays in `waiting_for_project` until the
// orchestrator forwards a `project_ready` event with a resolved project_id.
FLOW_STRATEGY_REGISTRY.register(sessionChatStrategy);

export interface BeginFlowInput {
  machine: string;
  principal_id: string;
  persona_email: string;
  persona_display_name: string;
  correlation_id: string;
  /** Seed for the duplicate-org-name fixture path. */
  existing_org_names?: string[];
}

/**
 * A per-request begin command. The driving router constructs one (building its
 * actor up front from the machine deps), then hands it to `begin`, which acts
 * as a context manager: it recycles + tracks the actor (enter), runs
 * `strategy.begin()` (the machine-specific drive), and returns the projection
 * (exit). The strategy owns its actor, transitions, and event-log writes; the
 * orchestrator owns actor tracking and the final projection.
 */
export interface BeginStrategy {
  readonly flow_id: string;
  readonly actor: AnyActorRef;
  readonly correlationId: string;
  begin(): Promise<void>;
}

export interface SendEventInput {
  machine: string;
  flow_id: string;
  type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
}

export const FREEZE_WINDOW_MS = 5_000;
export const REPLAY_BUFFER_CAP = 16;

interface FrozenFlowState {
  frozenAt: number;
  /** Origin flow that triggered the freeze — the broadcaster. */
  origin: string;
  /** Queued events waiting for thaw, bounded to REPLAY_BUFFER_CAP. The `seq`
   *  is process-global so THAW pass-2 can replay events across all frozen
   *  flows in true arrival order, even though they sit on separate per-flow
   *  buffers. */
  queued: Array<{ input: SendEventInput; seq: number }>;
}

export type BeginIfNotStartedInput = {
  machine: string;
  principal_id: string;
  correlation_id: string;
  // `auth_ready` payload (project-context dispatch):
  org_id?: string;
  user_first_name?: string;
  // `project_ready` payload (session-chat dispatch):
  project_id?: string;
  project_name?: string;
  deeplink_session_id?: string | null;
  intent_resource_id?: string | null;
  intent_resource_type?: ResourceType | null;
  /** When true, stop+respawn the actor and reset its event log. Set by
   *  HTTP `/begin` direct posts; broadcast-hook calls leave this false so
   *  cross-machine entry stays idempotent. */
  force_restart?: boolean;
};

export type AppendDeepLinkEventsInput = {
  machine: string;
  flow_id: string;
  correlation_id: string;
  events: Array<{ type: string; payload: Record<string, unknown> }>;
};

export class FlowOrchestrator implements PumpContext {
  private readonly actors = new Map<string, AnyActorRef>();
  /** Absent key = flow is not frozen. */
  private readonly frozen = new Map<string, FrozenFlowState>();
  /** Set when the replay buffer overflows or the 5-second freeze window
   *  elapses with events still queued. */
  private readonly abandoned = new Set<string>();
  /** Used to detect transitions out of `expired_token` so the orchestrator
   *  can broadcast THAW once silent reauth settles. */
  private readonly priorState = new Map<string, string>();
  /** Process-global monotonic counter stamped on every intent queued
   *  during a freeze window — the cross-flow FIFO key for THAW replay. */
  private replaySeq = 0;

  constructor(readonly deps: OrchestratorDeps) {}

  recycleActor(flow_id: string): void {
    const existing = this.actors.get(flow_id);
    if (existing) {
      existing.stop();
      this.actors.delete(flow_id);
    }
  }

  trackActor(flow_id: string, actor: AnyActorRef): void {
    this.actors.set(flow_id, actor);
  }

  /**
   * Begin a flow. Acts as a context manager around a per-request
   * `BeginStrategy`: open a fresh slot for the strategy's actor (enter), run
   * its machine-specific drive (body), and return the projection (exit). The
   * strategy owns its actor, transitions, and event-log writes; the
   * orchestrator owns actor tracking and the final projection.
   */
  async begin(strategy: BeginStrategy): Promise<Result<FlowProjection>> {
    try {
      // enter: clear any prior actor + tracking for this flow_id, then
      // register the strategy's freshly-built actor (the persisted event log
      // is the source of truth; the in-process actor is a cache).
      this.recycleActor(strategy.flow_id);
      this.resetFlowTracking(strategy.flow_id);
      this.trackActor(strategy.flow_id, strategy.actor);
      // body: the machine-specific begin sequence
      await strategy.begin();
      // exit: the freshly-built projection is the response
      return ok(
        await this.projectionFor(strategy.flow_id, "", strategy.correlationId),
      );
    } catch (e) {
      return toFlowError(e);
    }
  }

  /**
   * Idempotently spawn a flow's actor if not already running. Called from
   * the two cross-machine broadcast hooks:
   *
   *   - `auth_ready` (login → project-context): forwards an `auth_ready`
   *     event so project-context's `resolveInitialScope` invoke fires with
   *     a populated org_id.
   *   - `project_ready` (project-context → session-chat): forwards a
   *     `project_ready` event so session-chat can leave `waiting_for_project`
   *     and consume any forwarded deep-link target.
   */
  async beginIfNotStarted(
    input: BeginIfNotStartedInput,
  ): Promise<Result<FlowProjection>> {
    try {
      return ok(await this.beginIfNotStartedCore(input));
    } catch (e) {
      return toFlowError(e);
    }
  }

  private async beginIfNotStartedCore(
    input: BeginIfNotStartedInput,
  ): Promise<FlowProjection> {
    const strategy = FLOW_STRATEGY_REGISTRY.resolve(input.machine);
    const flow_id = `${input.machine}:${input.principal_id}`;

    const isProjectReadyDispatch =
      input.machine === SESSION_CHAT_WIRE_NAME &&
      typeof input.project_id === "string";
    const isAuthReadyDispatch =
      !isProjectReadyDispatch &&
      typeof input.org_id === "string" &&
      input.user_first_name !== undefined;

    if (input.force_restart) {
      const existing = this.actors.get(flow_id);
      if (existing) {
        existing.stop();
        this.actors.delete(flow_id);
      }
      await this.deps.eventLog.reset(flow_id);
      this.resetFlowTracking(flow_id);
    }

    if (this.actors.has(flow_id)) {
      // Already spawned. Re-forward the latest payload — the machine
      // ignores events it has already absorbed. The settleSpawn re-emission
      // covers the case where the in-memory actor survived but its event
      // log was wiped (e.g. /begin with force_restart on a sibling flow):
      // without it the projection would appear stuck in `anonymous`.
      const actor = this.actors.get(flow_id);
      try {
        if (isProjectReadyDispatch && actor) {
          actor.send({
            type: "project_ready",
            org_id: input.org_id ?? "",
            project_id: input.project_id!,
            project_name: input.project_name ?? "",
            correlation_id: input.correlation_id,
            deeplink_session_id: input.deeplink_session_id ?? null,
            intent_resource_id: input.intent_resource_id ?? null,
            intent_resource_type: input.intent_resource_type ?? null,
          } as never);
          await waitForSettledState(actor);
          if (strategy.settleSpawn) {
            await strategy.settleSpawn(this, actor, {
              machine: input.machine,
              principal_id: input.principal_id,
              correlation_id: input.correlation_id,
            });
          }
        } else if (isAuthReadyDispatch && actor) {
          actor.send({
            type: "auth_ready",
            org_id: input.org_id!,
            user: { first_name: input.user_first_name! },
          } as never);
          await waitForSettledState(actor);
        }
      } catch {
        // Defensive — never blow up on a re-emission.
      }
      return this.projectionFor(
        flow_id,
        input.principal_id,
        input.correlation_id,
      );
    }

    const machine = strategy.buildMachine(this.deps, {
      correlation_id: input.correlation_id,
      principal_id: input.principal_id,
    });
    const actor = createActor(machine, {
      input: {
        correlation_id: input.correlation_id,
        principal_id: input.principal_id,
        org_id: input.org_id,
        user:
          input.user_first_name !== undefined
            ? { first_name: input.user_first_name }
            : undefined,
        project_id: input.project_id,
        project_name: input.project_name,
        deeplink_session_id: input.deeplink_session_id,
        intent_resource_id: input.intent_resource_id,
        intent_resource_type: input.intent_resource_type,
      } as never,
    });
    this.actors.set(flow_id, actor);
    actor.start();

    // Forward the spawn-time event for whichever broadcast hook fired.
    if (isProjectReadyDispatch) {
      try {
        actor.send({
          type: "project_ready",
          org_id: input.org_id ?? "",
          project_id: input.project_id!,
          project_name: input.project_name ?? "",
          correlation_id: input.correlation_id,
          deeplink_session_id: input.deeplink_session_id ?? null,
          intent_resource_id: input.intent_resource_id ?? null,
          intent_resource_type: input.intent_resource_type ?? null,
        } as never);
      } catch {
        // Defensive.
      }
    } else if (isAuthReadyDispatch) {
      try {
        actor.send({
          type: "auth_ready",
          org_id: input.org_id!,
          user: { first_name: input.user_first_name! },
        } as never);
      } catch {
        // Defensive.
      }
    }

    try {
      await waitForSettledState(actor);
    } catch {
      // Defensive — the projection builder reflects whatever state the
      // actor is in even if the wait timed out.
    }

    // The pump fires the cross-machine `project_ready` hook AFTER the
    // strategy's settleSpawn appends. Hook params MUST be captured BEFORE
    // settleSpawn runs because they read the projection-of-log; the carved
    // emission then appends to that log. Gated by state (only
    // project-context reaches `project_selected`), not by machine.
    const spawnStateValue = actor.getSnapshot().value as string;
    let projectReadyHookParams: SettleOutcome["projectReady"] = null;
    if (spawnStateValue === "project_selected") {
      const spawnProjCtx = buildProjection(
        flow_id,
        await this.deps.eventLog.read(flow_id),
      ).context as {
        org: { id: string | null; name: string | null };
        project: { id: string | null; name: string | null };
        deeplink_session_id: string | null;
        intent_resource_id: string | null;
        intent_resource_type: ResourceType | null;
      };
      const spawnHarvest = harvestSettledProjectContextState(actor);
      const spawnSettledProject = spawnHarvest.project.id
        ? spawnHarvest.project
        : spawnProjCtx.project;
      const spawnSettledOrgId =
        spawnHarvest.org_id ?? spawnProjCtx.org.id ?? input.org_id ?? "";
      projectReadyHookParams = {
        org_id: spawnSettledOrgId || undefined,
        project: spawnSettledProject,
        deeplink_session_id: spawnProjCtx.deeplink_session_id,
        intent_resource_id: spawnProjCtx.intent_resource_id,
        intent_resource_type: spawnProjCtx.intent_resource_type,
      };
    }

    if (strategy.settleSpawn) {
      await strategy.settleSpawn(this, actor, {
        machine: input.machine,
        principal_id: input.principal_id,
        correlation_id: input.correlation_id,
      });
    }

    // project_ready broadcast hook — fired AFTER settleSpawn emits
    // project_selected. Only project-context produces these params;
    // session-chat is the spawn-chain terminal.
    if (projectReadyHookParams) {
      await this.maybeFireProjectReady(
        flow_id,
        input.principal_id,
        input.correlation_id,
        projectReadyHookParams,
      );
    }

    return this.projectionFor(
      flow_id,
      input.principal_id,
      input.correlation_id,
    );
  }

  /**
   * Broadcast `project_ready` to session-chat when project-context enters
   * `project_selected`. Idempotent on the same project_id; a different
   * project_id triggers session-chat's invalidation handler.
   *
   * No-op when `sessionChatMachineDeps` is absent or the resolved org/project
   * id is missing (defensive — spawning session-chat with a null project_id
   * is invalid).
   *
   * Failures here NEVER propagate: project-context's `project_selected`
   * transition must succeed even when the downstream spawn fails.
   */
  private async maybeFireProjectReady(
    originFlowId: string,
    principal_id: string,
    correlation_id: string,
    ctx: {
      org_id?: string;
      project?: { id: string | null; name: string | null };
      deeplink_session_id?: string | null;
      intent_resource_id?: string | null;
      intent_resource_type?: ResourceType | null;
    },
  ): Promise<void> {
    if (!this.deps.sessionChatMachineDeps) return;
    const orgId = ctx.org_id ?? "";
    const projectId = ctx.project?.id ?? null;
    if (!orgId || !projectId) return;
    try {
      await this.beginIfNotStartedCore({
        machine: SESSION_CHAT_WIRE_NAME,
        principal_id,
        correlation_id,
        org_id: orgId,
        project_id: projectId,
        project_name: ctx.project?.name ?? "",
        deeplink_session_id: ctx.deeplink_session_id ?? null,
        intent_resource_id: ctx.intent_resource_id ?? null,
        intent_resource_type: ctx.intent_resource_type ?? null,
      });
    } catch (err) {
      this.logTransition({
        event_kind: "project_ready_hook.failed",
        error: (err as Error).message,
        origin_flow_id: originFlowId,
      });
    }
  }

  async send(input: SendEventInput): Promise<Result<FlowProjection>> {
    try {
      return ok(await this.sendCore(input));
    } catch (e) {
      return toFlowError(e);
    }
  }

  private async sendCore(input: SendEventInput): Promise<FlowProjection> {
    const actor = this.actors.get(input.flow_id);
    if (!actor) {
      throw new Error(`unknown flow_id: ${input.flow_id}`);
    }

    // Cross-machine FREEZE handling: if this flow is currently frozen (a
    // sibling entered `expired_token`), queue the event in the bounded
    // replay buffer instead of dispatching to the XState actor. The
    // persisted event log is still appended so projection consumers see
    // the attempt; the actor advances only on THAW replay.
    const frozenState = this.frozen.get(input.flow_id);
    if (frozenState) {
      const elapsed = Date.now() - frozenState.frozenAt;
      if (elapsed > FREEZE_WINDOW_MS) {
        this.abandoned.add(input.flow_id);
      } else {
        if (frozenState.queued.length >= REPLAY_BUFFER_CAP) {
          this.abandoned.add(input.flow_id);
        } else {
          frozenState.queued.push({ input, seq: this.replaySeq++ });
        }
      }
      const queuedEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: input.type,
        payload: input.payload,
        correlation_id: input.correlation_id,
      };
      await this.deps.eventLog.append(input.flow_id, queuedEvent);
      const principal_id = parsePrincipal(input.flow_id);
      return this.projectionFor(
        input.flow_id,
        principal_id,
        input.correlation_id,
      );
    }

    const event: FlowEvent = {
      ts: new Date().toISOString(),
      type: input.type,
      payload: input.payload,
      correlation_id: input.correlation_id,
    };
    await this.deps.eventLog.append(input.flow_id, event);

    // XState v5 ignores unknown event types by default.
    actor.send({ type: input.type, ...input.payload } as never);

    // Pre-settle event→transition emission. `switching_project` is an
    // invoke-driven transient; emitting `switching_project_started` here
    // (BEFORE awaiting the settle) writes the atomic invalidation
    // (session_id + resource_* nulled) in the same tick the
    // `switching_project` state surfaces, so SSE consumers see the
    // (state, session_id, resource) tuple together. Without this
    // pre-settle emission `project_switched`'s reducer would leak the old
    // session_id under the new project.
    const dispatchStrategy = FLOW_STRATEGY_REGISTRY.resolve(input.machine);
    if (dispatchStrategy.applyEvent) {
      await dispatchStrategy.applyEvent(this, actor, input);
    }

    await waitForSettledState(actor);
    // If the machine just landed in `expired_token` AND a silentReauth
    // invoke is in flight, wait one more cycle for it to leave again
    // (success → ready, failure → error_recoverable). When no invoke is
    // present we fall through immediately rather than blocking on a
    // never-resolving promise.
    {
      const snap = actor.getSnapshot();
      if (
        (snap.value as string) === "expired_token" &&
        this.hasSilentReauthInvoke(snap)
      ) {
        await waitForLeavingState(actor, "expired_token");
      }
    }

    // Only the state-value is read from the snapshot here; all context
    // reads route through the live projection (the sanctioned boundary).
    const stateValue = actor.getSnapshot().value as string;
    const principal_id = parsePrincipal(input.flow_id);
    const projectionEvents = await this.deps.eventLog.read(input.flow_id);
    const projectionCtx = buildProjection(input.flow_id, projectionEvents)
      .context as {
      user: {
        email: string | null;
        display_name: string | null;
        first_name: string | null;
      };
      org: { id: string | null; name: string | null };
      project: { id: string | null; name: string | null };
      underlying_cause_tag: string | null;
      org_validation_error: { kind: string; message: string } | null;
      pending_project_name: string;
      project_validation_error: { kind: string; message: string } | null;
      deeplink_project_id: string | null;
      deeplink_session_id: string | null;
      intent_resource_id: string | null;
      intent_resource_type: ResourceType | null;
    };

    // Cross-machine FREEZE/THAW signaling driven by transitions in/out of
    // `expired_token` on the origin flow. Silent reauth success → THAW
    // replay; silent reauth failure → THAW abandoned (each frozen J-002
    // machine falls through `freeze → error_recoverable`).
    const prior = this.priorState.get(input.flow_id);
    if (stateValue === "expired_token" && prior !== "expired_token") {
      await this.broadcastFreezeCore(input.flow_id);
    } else if (prior === "expired_token" && stateValue === "ready") {
      await this.broadcastThawCore(input.flow_id, "thaw");
    } else if (
      prior === "expired_token" &&
      stateValue === "error_recoverable"
    ) {
      await this.broadcastThawCore(input.flow_id, "abandoned");
    }
    this.priorState.set(input.flow_id, stateValue);

    // Post-settle terminal-emission CHAIN. All three strategies are called
    // unconditionally in sequence — `settle` is NOT per-machine-exclusive:
    // login's `expired_token` / `error_recoverable` / `authenticated_no_org`
    // arms are state-gated, not machine-gated, so a non-login flow that
    // settles in those states still falls through the shared login arm.
    // Each strategy guards its own machine-specific arms internally, so
    // the two siblings act as no-ops for the matching machine's flow.
    // The pump retains all cross-machine hook firing (`auth_ready` after
    // login.settle returns `authReady`; `project_ready` after
    // project.settle returns `projectReady`). session-chat is the spawn-
    // chain terminal — empty `SettleOutcome`, no onward hook.

    if (!loginOrgSetupStrategy.settle) {
      throw new Error("loginOrgSetupStrategy.settle missing (LEAF-3 N3)");
    }
    const loginSettleOutcome = await loginOrgSetupStrategy.settle(
      this,
      actor,
      input,
      { stateValue, prior, projectionCtx },
    );
    if (loginSettleOutcome.authReady && this.deps.projectContextMachineDeps) {
      try {
        await this.beginIfNotStartedCore({
          machine: PROJECT_CONTEXT_WIRE_NAME,
          principal_id: parsePrincipal(input.flow_id),
          correlation_id: input.correlation_id,
          org_id: loginSettleOutcome.authReady.org_id,
          user_first_name: loginSettleOutcome.authReady.user_first_name,
        });
      } catch (err) {
        // Project-context spawn failure must NOT break login's ready
        // transition; log and swallow.
        this.logTransition({
          event_kind: "auth_ready_hook.failed",
          error: (err as Error).message,
          origin_flow_id: input.flow_id,
        });
      }
    }

    if (!projectContextStrategy.settle) {
      throw new Error("projectContextStrategy.settle missing (LEAF-3 N8)");
    }
    const projectSettleOutcome = await projectContextStrategy.settle(
      this,
      actor,
      input,
      { stateValue, prior, projectionCtx },
    );
    if (projectSettleOutcome.projectReady) {
      await this.maybeFireProjectReady(
        input.flow_id,
        principal_id,
        input.correlation_id,
        projectSettleOutcome.projectReady,
      );
    }

    if (!sessionChatStrategy.settle) {
      throw new Error("sessionChatStrategy.settle missing (LEAF-3 N17)");
    }
    await sessionChatStrategy.settle(this, actor, input, {
      stateValue,
      prior,
      projectionCtx,
    });

    return this.projectionFor(
      input.flow_id,
      principal_id,
      input.correlation_id,
    );
  }

  async getProjection(flow_id: string): Promise<Result<FlowProjection>> {
    try {
      return ok(await this.getProjectionCore(flow_id));
    } catch (e) {
      return toFlowError(e);
    }
  }

  private async getProjectionCore(flow_id: string): Promise<FlowProjection> {
    const principal_id = parsePrincipal(flow_id);
    return this.projectionFor(flow_id, principal_id, "");
  }

  /**
   * Subscribe to a flow's event stream — substrate for the SSE
   * `/projection/stream` route. Delegates to the FlowEventLog adapter
   * (in-memory emits synchronously after `append()`; Redis uses
   * `XREAD BLOCK` on a dedicated subscriber connection). `blockMs` bounds
   * the iterator so it exits when the server closes the response.
   */
  subscribeToFlow(
    flow_id: string,
    sinceId: string,
    blockMs?: number,
  ): AsyncIterable<FlowEvent> {
    return this.deps.eventLog.subscribe(flow_id, sinceId, blockMs);
  }

  /**
   * Broadcast FREEZE to every actor in the tree except the origin (which
   * is itself in `expired_token`, with silent reauth in flight). Sibling
   * actors learn of the freeze via the actor-level event; the orchestrator
   * additionally tracks the freeze here so `send()` can queue intent events
   * arriving at frozen actors into the bounded replay buffer.
   */
  async broadcastFreeze(originFlowId: string): Promise<Result<void>> {
    try {
      return ok(await this.broadcastFreezeCore(originFlowId));
    } catch (e) {
      return toFlowError(e);
    }
  }

  private async broadcastFreezeCore(originFlowId: string): Promise<void> {
    const now = Date.now();
    for (const [flow_id, actor] of this.actors.entries()) {
      if (flow_id === originFlowId) continue;
      // Mark frozen synchronously so a caller that doesn't await still
      // observes `isFrozen` immediately, and `send()` consults this when
      // deciding to forward vs. queue.
      if (!this.frozen.has(flow_id)) {
        this.frozen.set(flow_id, {
          frozenAt: now,
          origin: originFlowId,
          queued: [],
        });
      }
      try {
        actor.send({ type: "FREEZE" } as never);
      } catch {
        // Defensive: a stopped actor would reject the send.
      }
      // After the actor settles into `freeze`, emit the per-machine
      // `*_frozen` FlowEvent — without it the projection (the SSOT every
      // downstream reader observes) would stay at the pre-freeze state.
      // Only J-002 machines have a `freeze` side-state; the login machine
      // has no FREEZE handler at all.
      const machine = machineOfFlow(flow_id);
      if (
        J002_MACHINES.has(machine) &&
        (actor.getSnapshot().value as string) === "freeze"
      ) {
        const frozenStrategy = FLOW_STRATEGY_REGISTRY.resolve(machine);
        if (frozenStrategy.settleFreeze) {
          await frozenStrategy.settleFreeze(this, actor, flow_id);
        }
      }
    }
  }

  /**
   * Broadcast THAW to every previously frozen actor. Queued intent events
   * replay in arrival order unless the flow was abandoned (overflow / 5s
   * timeout / silent reauth failure), in which case the queue is dropped
   * and the J-002 machine falls through `freeze → error_recoverable`.
   */
  async broadcastThaw(
    originFlowId: string,
    reason: "thaw" | "abandoned" = "thaw",
  ): Promise<Result<void>> {
    try {
      return ok(await this.broadcastThawCore(originFlowId, reason));
    } catch (e) {
      return toFlowError(e);
    }
  }

  private async broadcastThawCore(
    originFlowId: string,
    reason: "thaw" | "abandoned" = "thaw",
  ): Promise<void> {
    // Pass 1: unfreeze + THAW every flow (or abandon it), collecting each
    // drained queue. Replay is deferred to pass 2 so it runs GLOBALLY in
    // true arrival order across flows (siblings buffered on separate
    // per-flow queues), AND every flow is unfrozen first so any
    // re-broadcast (e.g. project_ready from a replayed switch) reaches a
    // live, non-event-dropping target.
    const allDrained: Array<{
      input: SendEventInput;
      seq: number;
      flow_id: string;
    }> = [];
    // Snapshot keys first because draining mutates the map.
    const flowIds = Array.from(this.frozen.keys());
    for (const flow_id of flowIds) {
      const state = this.frozen.get(flow_id);
      if (!state) continue;
      // broadcastFreeze skipped the origin, but defend against future callers.
      if (flow_id === originFlowId) continue;
      // Take the queue off before signalling so re-entrant sends during
      // replay don't double up.
      const drained = state.queued;
      this.frozen.delete(flow_id);
      const abandoned = this.abandoned.has(flow_id) || reason === "abandoned";
      const actor = this.actors.get(flow_id);
      const machine = machineOfFlow(flow_id);
      const isJ002 = J002_MACHINES.has(machine);

      if (abandoned) {
        // Drive the J-002 machine `freeze → error_recoverable` (cause
        // `replay_abandoned`) and drop the queue. The originating user
        // action is preserved on the machine context AND echoed in the
        // FlowEvent payload for re-issue.
        try {
          actor?.send({ type: "replay_abandoned" } as never);
        } catch {
          // Defensive — stopped actor.
        }
        this.abandoned.delete(flow_id);
        if (isJ002 && actor) {
          const h = harvestSettledFreezeState(actor);
          await this.deps.eventLog.append(flow_id, {
            ts: new Date().toISOString(),
            type: "replay_abandoned",
            payload: {
              last_live_state: h.last_live_state,
              // Originating user actions preserved for re-issue.
              abandoned_intents: drained.map((d) => ({
                type: d.input.type,
                payload: d.input.payload,
                correlation_id: d.input.correlation_id,
              })),
            },
            correlation_id: h.correlation_id,
          });
          await this.deps.eventLog.append(flow_id, {
            ts: new Date().toISOString(),
            type:
              machine === SESSION_CHAT_WIRE_NAME
                ? "session_chat_recoverable_error"
                : "project_context_recoverable_error",
            payload: {
              underlying_cause_tag: "replay_abandoned",
              originating_state: h.last_live_state,
            },
            correlation_id: h.correlation_id,
          });
        }
        continue;
      }

      // Successful THAW.
      try {
        actor?.send({ type: "THAW" } as never);
      } catch {
        // Defensive — stopped actor.
      }
      // THAW returns the machine to `last_live_state`. When that state is
      // an invoke-driven transient (re-entered with `reenter:true`) the
      // invoke re-runs with the fresh post-reauth credential — wait for
      // it to settle so the emission below observes the final state, not
      // the transient.
      if (actor) {
        await waitForSettledState(actor);
      }
      if (isJ002 && actor) {
        const h = harvestSettledFreezeState(actor);
        const settledState = actor.getSnapshot().value as string;
        await this.deps.eventLog.append(flow_id, {
          ts: new Date().toISOString(),
          type:
            machine === SESSION_CHAT_WIRE_NAME
              ? "session_chat_thawed"
              : "project_context_thawed",
          payload: { last_live_state: h.last_live_state },
          correlation_id: h.correlation_id,
        });
        // Emit a history-target re-entry terminal ONLY when last_live_state
        // was an invoke-driven transient that actually re-ran on THAW. For
        // non-transient freezes (e.g. session_list_loaded / project_selected)
        // the `*_thawed` reducer alone restores the state; emitting a
        // terminal here would, for project-context, re-broadcast project_ready
        // and clobber a freshly-thawed session-chat. Replayed queued intents
        // carry their own full emission via send().
        const SC_TRANSIENTS = new Set([
          "loading_session_list",
          "resuming_session",
          "switching_dataset_context",
          "creating_session",
        ]);
        const PC_TRANSIENTS = new Set([
          "resolving_initial_scope",
          "creating_project",
          "switching_project",
        ]);
        if (
          machine === SESSION_CHAT_WIRE_NAME &&
          SC_TRANSIENTS.has(h.last_live_state ?? "")
        ) {
          if (sessionChatStrategy.settleThaw) {
            await sessionChatStrategy.settleThaw(this, actor, flow_id, "thaw");
          }
        } else if (
          machine === PROJECT_CONTEXT_WIRE_NAME &&
          PC_TRANSIENTS.has(h.last_live_state ?? "")
        ) {
          if (projectContextStrategy.settleThaw) {
            await projectContextStrategy.settleThaw(
              this,
              actor,
              flow_id,
              "thaw",
            );
          }
          // project_ready re-broadcast stays pump-fired AFTER settleThaw —
          // the cross-machine hook never moves into a strategy.
          if (settledState === "project_selected") {
            const hpc = harvestSettledProjectContextState(actor);
            await this.maybeFireProjectReady(
              flow_id,
              parsePrincipal(flow_id),
              h.correlation_id,
              { org_id: hpc.org_id ?? "", project: hpc.project },
            );
          }
        }
      }

      // Defer this flow's queue to the global pass-2 replay.
      for (const q of drained) {
        allDrained.push({ input: q.input, seq: q.seq, flow_id });
      }
    }

    // Pass 2: replay all drained intents in true cross-flow arrival order
    // (`seq` was stamped at queue time). Each goes back through `send()`;
    // `frozen` no longer contains these flow_ids so they dispatch normally
    // with full emission. After each, harvest the stale-intent counter on
    // the intent's flow actor: if the machine silent-dropped it (target
    // no longer resolves post-THAW) emit the observability-only
    // `stale_intent_dropped_after_thaw`.
    allDrained.sort((a, b) => a.seq - b.seq);
    for (const { input, flow_id } of allDrained) {
      const actor = this.actors.get(flow_id);
      const isJ002 = J002_MACHINES.has(machineOfFlow(flow_id));
      const before =
        isJ002 && actor
          ? harvestSettledFreezeState(actor).stale_intents_dropped_count
          : 0;
      await this.sendCore(input);
      if (isJ002 && actor) {
        const after = harvestSettledFreezeState(actor);
        const isDatasetPick =
          input.type === "dataset_resolved_by_agent" ||
          input.type === "dataset_picked_directly";
        // A REPLAYED dataset pick that fails ScopeResolver (deleted /
        // cross-tenant) is silent-dropped here — distinct from the
        // interactive `dataset_access_denied` gutter-hint path, which is
        // not a THAW replay. The machine's onDone arm already preserved
        // the prior resource and stayed in session_active; replay-staleness
        // is recognised here at replay time.
        const datasetStale =
          isDatasetPick &&
          harvestSettledSessionChatState(actor).underlying_cause_tag ===
            "dataset_access_denied";
        if (after.stale_intents_dropped_count > before || datasetStale) {
          await this.deps.eventLog.append(flow_id, {
            ts: new Date().toISOString(),
            type: "stale_intent_dropped_after_thaw",
            payload: {
              intent_type: after.last_stale_intent?.intent_type ?? input.type,
              target_id:
                after.last_stale_intent?.target_id ??
                (datasetStale
                  ? ((input.payload.resource_id as string | undefined) ?? "")
                  : ""),
            },
            correlation_id: input.correlation_id,
          });
        }
      }
    }
  }

  /** Query: is this flow currently frozen? */
  isFrozen(flow_id: string): boolean {
    return this.frozen.has(flow_id);
  }

  /** Query: how many events are queued in the replay buffer for this flow? */
  replayBufferSize(flow_id: string): number {
    const state = this.frozen.get(flow_id);
    return state ? state.queued.length : 0;
  }

  /** Query: was this flow abandoned (overflow or timeout)? */
  isAbandoned(flow_id: string): boolean {
    return this.abandoned.has(flow_id);
  }

  /**
   * Detect an in-flight silent-reauth invoke by inspecting the XState v5
   * snapshot's `children` map (the invoke surfaces as a child entry keyed
   * by the invoke id). When absent, the orchestrator falls through
   * immediately rather than blocking on a never-resolving promise.
   */
  private hasSilentReauthInvoke(snapshot: unknown): boolean {
    const snap = snapshot as { children?: Record<string, unknown> } | null;
    const children = snap?.children;
    if (!children || typeof children !== "object") return false;
    return Object.keys(children).some((key) =>
      key.startsWith("0.expired_token"),
    );
  }

  /**
   * Append projection-shaping events without dispatching them to the XState
   * actor. Used by the deep-link endpoint: ScopeResolver runs at the HTTP
   * edge and records the outcome as a `deep_link_opened` /
   * `scope_access_denied` event so subsequent projection reads observe the
   * resolved scope. Scope is orthogonal to the login statechart, so the
   * actor never needs to know about it.
   */
  async appendDeepLinkEvents(
    input: AppendDeepLinkEventsInput,
  ): Promise<Result<FlowProjection>> {
    try {
      return ok(await this.appendDeepLinkEventsCore(input));
    } catch (e) {
      return toFlowError(e);
    }
  }

  private async appendDeepLinkEventsCore(
    input: AppendDeepLinkEventsInput,
  ): Promise<FlowProjection> {
    // resolve() runs purely to validate the machine name — throws
    // UnknownMachineError → clean 404 at the HTTP edge.
    FLOW_STRATEGY_REGISTRY.resolve(input.machine);
    if (!projectContextStrategy.applyDeepLink) {
      throw new Error(
        "projectContextStrategy.applyDeepLink missing (LEAF-3 N9)",
      );
    }
    await projectContextStrategy.applyDeepLink(this, input);
    const principal_id = parsePrincipal(input.flow_id);
    return this.projectionFor(
      input.flow_id,
      principal_id,
      input.correlation_id,
    );
  }

  /**
   * Reset per-flow orchestrator tracking when the actor + event log are
   * reset (begin / force_restart). The actor, log, and in-memory trackers
   * are one unit: a fresh flow must not inherit the prior flow's
   * `priorState` (a stale value here makes a replayed THAW resume emit
   * the wrong terminal) nor a stale `frozen` / `abandoned` entry.
   * Required when flow_ids are reused across scenarios (e.g. shared
   * dev-user principal).
   */
  resetFlowTracking(flow_id: string): void {
    this.priorState.delete(flow_id);
    this.frozen.delete(flow_id);
    this.abandoned.delete(flow_id);
  }

  async projectionFor(
    flow_id: string,
    _principal_id: string,
    correlation_id: string,
  ): Promise<FlowProjection> {
    const events = await this.deps.eventLog.read(flow_id);
    const projection = buildProjection(flow_id, events);
    // The projection reducer is the SSOT for active_scope. The orchestrator
    // does not re-compute scope from JWT here — the resolver runs at the
    // HTTP edge (per ADR-029) and its outcome is recorded as a
    // `deep_link_opened` event for the reducer to consume.
    return {
      ...projection,
      correlation_id: correlation_id || projection.correlation_id,
    };
  }

  logTransition(record: Record<string, unknown>): void {
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
 * Wait until the actor leaves the named state. Used by the freeze/thaw
 * post-settle block to wait for `expired_token` to drain through its
 * `silentReauth` invoke (success → ready, failure → error_recoverable).
 */
function waitForLeavingState(
  actor: AnyActorRef,
  state: string,
  timeoutMs = 10000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const snap = actor.getSnapshot();
    if ((snap.value as string) !== state) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error(`waitForLeavingState(${state}): timeout`));
    }, timeoutMs);
    const sub = actor.subscribe((s) => {
      if ((s.value as string) !== state) {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve();
      }
    });
  });
}
