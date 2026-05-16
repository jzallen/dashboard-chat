// FlowOrchestrator — root supervisor for per-flow XState actors.
//
// Per ADR-028 §"Decision outcome", the orchestrator owns the actor tree.
// Step 01-01 (walking skeleton) wired the begin-flow + send-event +
// read-projection slice. Step 03-01 added the cross-machine FREEZE/THAW
// broadcast and the bounded replay buffer.
//
// Each flow is keyed by `flow_id = "<machine-name>:<principal_id>"` per
// ADR-030 §SD3 for multi-tenant safety.
//
// ADR-028 invariants enforced here:
//   1. One root orchestrator actor per process (this class).
//   2. No machine imports another machine — siblings only signal via
//      `this.actors.get(flow_id).send(...)` FROM the orchestrator.
//   3. Replay buffer is a property of the orchestrator (this class), not
//      any individual machine.
//   4. Actor identity = (flow_id, principal_id).

import { type AnyActorRef, type AnyStateMachine,createActor } from "xstate";

import type { ResourceType } from "./active-scope.ts";
import {
  createForcedFailureOrgAndReissueActor,
  createLoginAndOrgSetupMachine,
  type CreateOrgAndReissueInput,
  type LoginMachineDeps,
} from "./machines/login-and-org-setup/index.ts";
import {
  createProjectContextMachine,
  type ProjectContextMachineDeps,
} from "./machines/project-context/index.ts";
import {
  createSessionChatMachine,
  type SessionChatMachineDeps,
} from "./machines/session-chat/index.ts";
import {
  harvestSettledFreezeState,
  harvestSettledLoginState,
  harvestSettledProjectContextState,
  harvestSettledSessionChatState,
} from "./orchestrator-harvester.ts";
import type { FlowEventLog } from "./persistence/redis.ts";
import type { FlowEvent, FlowProjection } from "./projection.ts";
import { buildProjection } from "./projection.ts";

/**
 * Wire-protocol machine name preserved through MR-1.5 per the SRP amendment's
 * "all MR-1 acceptance tests pass with zero modification" gate (DWD-13 + the
 * MR-1.5 REC-2 decision). The source-tree splits to `project-context.ts` +
 * `session-chat.ts` (DESIGN §2A/§2B), but the HTTP URL path and Redis
 * event-log key prefix remain `project-and-chat-session-management` so the
 * existing acceptance harness (`tests/acceptance/.../driver.py` +
 * `J002Harness` at `tests/acceptance/user-flow-state-machines/harness/`)
 * continues to drive the project-context half without modification. MR-2's
 * crafter may opt to introduce the DESIGN-§1 `/ui-state/flow/project-context/*`
 * URL family alongside this name once new acceptance scenarios require it.
 */
const PROJECT_CONTEXT_WIRE_NAME = "project-and-chat-session-management";
const SESSION_CHAT_WIRE_NAME = "session-chat";

/** The two J-002 machine wire names. US-210 / MR-6: only these flows get
 *  the freeze-lifecycle emission arms (`*_frozen` / `*_thawed` /
 *  `replay_abandoned` / `stale_intent_dropped_after_thaw`). The login
 *  origin flow and any non-J-002 flow are skipped — they have no `freeze`
 *  side-state and no projection consumer for these events. */
const J002_MACHINES = new Set([
  PROJECT_CONTEXT_WIRE_NAME,
  SESSION_CHAT_WIRE_NAME,
]);

/** Derive the machine wire name from a `<machine>:<principal>` flow_id.
 *  Principal ids never contain `:`, so the head segment is the machine. */
function machineOfFlow(flow_id: string): string {
  return flow_id.split(":")[0] ?? "";
}

export interface OrchestratorDeps {
  eventLog: FlowEventLog;
  loginMachineDeps: LoginMachineDeps;
  /**
   * Deps for the J-002 project-context machine (DWD-13 §2A; previously named
   * `projectFlowMachineDeps` against the unsplit `project-and-chat-session-management`
   * machine). Optional so legacy J-001-only deployments can construct the
   * orchestrator without wiring J-002 (the `auth_ready` hook becomes a no-op
   * when this is absent).
   */
  projectContextMachineDeps?: ProjectContextMachineDeps;
  /**
   * Deps for the J-002 session-chat machine (DWD-13 §2B). Optional and
   * EMPTY in MR-1.5 — the session-chat stub declares no invoke actors yet
   * (MR-2 adds `loadSessionList`, `resumeSession`, …). When absent, the
   * `project_ready` broadcast hook becomes a no-op so MR-1 deployments keep
   * working untouched.
   */
  sessionChatMachineDeps?: SessionChatMachineDeps;
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

/**
 * Strategy table replacing today's hardcoded `if (input.machine !== ...)`
 * conditional per DWD-8. Each entry is a factory that, given the
 * orchestrator's deps + a begin-flow input, returns a constructed machine.
 *
 * Adding a future flow is one new factory + one new entry — no `if/else`.
 */
type MachineFactory = (
  deps: OrchestratorDeps,
  input: { correlation_id: string; principal_id: string; existing_org_names?: string[] },
) => AnyStateMachine;

const MACHINE_REGISTRY: Record<string, MachineFactory> = {
  "login-and-org-setup": (deps, _input) =>
    createLoginAndOrgSetupMachine(deps.loginMachineDeps),
  // The wire name is preserved (REC-2 / DWD-13 MR-1.5 — see PROJECT_CONTEXT_WIRE_NAME
  // comment above). The internal factory is the new `createProjectContextMachine`
  // from `./machines/project-context.ts`.
  [PROJECT_CONTEXT_WIRE_NAME]: (deps, _input) => {
    if (!deps.projectContextMachineDeps) {
      throw new Error(
        "projectContextMachineDeps required to construct the project-context machine",
      );
    }
    return createProjectContextMachine(deps.projectContextMachineDeps);
  },
  // Session-chat (DWD-13 §2B). MR-1.5 stub — `waiting_for_project` initial
  // state only. Spawned exclusively via the orchestrator's `project_ready`
  // broadcast hook (project-context → `project_selected` entry); direct
  // `/begin` HTTP posts route here through `beginIfNotStarted` but the
  // resulting actor remains in `waiting_for_project` until the orchestrator
  // forwards a `project_ready` event with the resolved project_id.
  [SESSION_CHAT_WIRE_NAME]: (deps, _input) =>
    createSessionChatMachine(deps.sessionChatMachineDeps ?? {}),
};

export interface BeginFlowInput {
  machine: string;
  principal_id: string;
  persona_email: string;
  persona_display_name: string;
  correlation_id: string;
  /** Optional seed for the duplicate-org-name fixture path (slice-1). */
  existing_org_names?: string[];
  /**
   * Failure-simulation knob: pre-load the machine with N forced failures of
   * the createOrgAndReissue actor (the (N+1)-th call succeeds). Implements
   * the `@jwt_reissue_failed_after_org_create` slice-1 scenarios. Has no
   * effect in production builds — the orchestrator only reads it when
   * NWAVE_HARNESS_KNOBS=true is set in the environment (legacy flag, honored
   * during the one-release overlap per ADR-035).
   */
  force_reissue_failures?: number;
}

export interface SendEventInput {
  machine: string;
  flow_id: string;
  type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
}

/** Per ADR-028: replay buffer is bounded to 5 seconds and 16 events. */
export const FREEZE_WINDOW_MS = 5_000;
export const REPLAY_BUFFER_CAP = 16;

interface FrozenFlowState {
  /** Timestamp (Date.now()) when this flow was frozen. */
  frozenAt: number;
  /** Origin flow that triggered the freeze — the broadcaster. */
  origin: string;
  /** Queued events waiting for thaw. Bounded to REPLAY_BUFFER_CAP. */
  queued: SendEventInput[];
}

export class FlowOrchestrator {
  private readonly actors = new Map<string, AnyActorRef>();
  /** Per-flow freeze state. Absent key = flow is not frozen. */
  private readonly frozen = new Map<string, FrozenFlowState>();
  /** Per-flow abandonment state. Set when the replay buffer overflows or
   *  the 5-second freeze window elapses with events still queued. */
  private readonly abandoned = new Set<string>();
  /** Per-flow prior state, used to detect transitions out of expired_token
   *  so the orchestrator can broadcast THAW once silent reauth settles. */
  private readonly priorState = new Map<string, string>();

  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * Begin a flow. Creates the actor, persists the sign_in_clicked event,
   * waits for the authenticating actor's onDone (workos userinfo), and
   * returns the projection.
   *
   * Machine selection is via the MachineRegistry strategy table (DWD-8)
   * — `login-and-org-setup` follows the legacy WorkOS+org-create path
   * below; other machines (J-002+) plug in via the registry and are
   * begun via `beginIfNotStarted` from the auth_ready broadcast hook.
   */
  async begin(input: BeginFlowInput): Promise<FlowProjection> {
    if (!MACHINE_REGISTRY[input.machine]) {
      throw new Error(`Unknown machine: ${input.machine}`);
    }

    // J-002 and other machines are spawned via beginIfNotStarted (called by
    // the auth_ready broadcast hook) — direct `begin` posts for those would
    // bypass the cross-machine entry contract. Allow them only when the
    // existing flow is already started (idempotent no-op).
    if (input.machine !== "login-and-org-setup") {
      return this.beginIfNotStarted({
        machine: input.machine,
        principal_id: input.principal_id,
        correlation_id: input.correlation_id,
      });
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
    this.resetFlowTracking(flow_id);

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
    const preEmitEvents = await this.deps.eventLog.read(flow_id);
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
      const cause = preEmitCtx.underlying_cause_tag ?? "transient";
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

  /**
   * Idempotently spawn a flow's actor if not already running.
   *
   * Per DWD-6 + DWD-13: the orchestrator owns cross-machine entry. Sibling
   * machines never import each other — entry flows through this method
   * called from the orchestrator's transition watcher. Two broadcast hooks
   * call this:
   *   - `auth_ready` (login → project-context) — passes `org_id` +
   *     `user.first_name`; this method forwards a `auth_ready` event to the
   *     spawned actor so the project-context machine's resolveInitialScope
   *     invoke fires with a populated org_id.
   *   - `project_ready` (project-context → session-chat) — passes `org_id`
   *     + `project_id` + `project_name` + `deeplink_session_id` (the
   *     URL-level wish forwarded by project-context post audit §5 / MR-D)
   *     and the `intent_resource_*` slots (forward-compat — no longer
   *     stored on either machine's ctx; routed through the projection by
   *     the deep_link_opened reducer); this method forwards a
   *     `project_ready` event to the spawned session-chat actor so it can
   *     transition out of `waiting_for_project` (MR-2+) and consume any
   *     forwarded deep-link target per DESIGN §3.4.
   */
  async beginIfNotStarted(input: {
    machine: string;
    principal_id: string;
    correlation_id: string;
    // `auth_ready` payload (project-context dispatch):
    org_id?: string;
    user_first_name?: string;
    // `project_ready` payload (session-chat dispatch — DWD-13 §3.2.B):
    project_id?: string;
    project_name?: string;
    deeplink_session_id?: string | null;
    intent_resource_id?: string | null;
    intent_resource_type?: ResourceType | null;
    /** When true, stop+respawn the actor and reset its event log. Used by
     *  HTTP `/begin` direct posts (broadcast-hook calls leave this false so
     *  cross-machine entry is idempotent). */
    force_restart?: boolean;
  }): Promise<FlowProjection> {
    const factory = MACHINE_REGISTRY[input.machine];
    if (!factory) {
      throw new Error(`Unknown machine: ${input.machine}`);
    }
    const flow_id = `${input.machine}:${input.principal_id}`;

    // Which broadcast hook is this — auth_ready (project-context) or
    // project_ready (session-chat)? Inspect machine + payload to dispatch
    // the right event shape on (re-)spawn.
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
      // Already spawned. Idempotency: re-forward the appropriate event so
      // the existing actor observes the latest payload (the machine ignores
      // events it has already absorbed; session-chat re-applies its
      // `project_ready` guard, project-context's `auth_ready` is a no-op
      // after the resolveInitialScope invoke has fired).
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
          // Emit the spawn-style events to the session-chat flow log so the
          // projection reflects the re-broadcast. Required when the actor
          // already existed in memory but its Redis log was wiped (e.g.,
          // /begin with force_restart) — without this the projection would
          // appear stuck in `anonymous`.
          if (input.machine === SESSION_CHAT_WIRE_NAME) {
            await this.emitSessionChatSpawnEvents(
              flow_id,
              actor,
              input.correlation_id,
              {
                org_id: input.org_id,
                project_id: input.project_id,
                project_name: input.project_name,
              },
            );
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

    const machine = factory(this.deps, {
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

    // Forward the appropriate spawn-time event to the machine.
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

    // Wait for any invoke-driven transient state to settle (e.g.,
    // resolveInitialScope on project-context). session-chat's MR-1.5 stub
    // has no transient state, so this returns immediately.
    try {
      await waitForSettledState(actor);
    } catch {
      // Defensive — the projection-builder will reflect whatever state
      // the actor is in even if the wait timed out.
    }

    // The terminal-event-emission below shapes each machine's flow event log.
    // project-context's events drive the wire-protocol J-002 projection.
    // session-chat's events drive its own per-machine projection (separate
    // Redis stream key `ui-state:session-chat:<principal>:events`).
    if (input.machine === SESSION_CHAT_WIRE_NAME) {
      await this.emitSessionChatSpawnEvents(
        flow_id,
        actor,
        input.correlation_id,
        input,
      );
      return this.projectionFor(
        flow_id,
        input.principal_id,
        input.correlation_id,
      );
    }
    if (input.machine !== PROJECT_CONTEXT_WIRE_NAME) {
      return this.projectionFor(
        flow_id,
        input.principal_id,
        input.correlation_id,
      );
    }

    // Persist a project_context_resolution_started + terminal-for-now event so the
    // projection-builder can reconstruct state from the event log alone.
    //
    // ADR-030 LEAF-B: ctx is rebound to the live projection's context (built
    // from the flow event log) per ADR-030 §"Decision outcome" — the
    // projection is the only legal read source for the emission path.
    //
    // Risk noted for reviewer: this is the FIRST write to the
    // project-context flow's log, so the projection has not yet observed
    // any events and ctx fields that the orchestrator wrote into the
    // log via spawn-input (org_id, user.first_name) read empty here.
    // The existing `?? input.*` fallbacks cover those.  Fields that
    // come from `resolveInitialScope`'s actor output (project,
    // most_recent_session_per_project, last_used_degraded_project_ids,
    // underlying_cause_tag) currently live only in the machine's
    // settled context — they will read null/empty via the projection
    // until LEAF-C+ work lands an upstream event that captures
    // `resolveInitialScope`'s `event.output`.  Mirrors the LEAF-A
    // session-list trade-off.
    const stateValue = actor.getSnapshot().value as string;
    const projectionEvents = await this.deps.eventLog.read(flow_id);
    const projection = buildProjection(flow_id, projectionEvents);
    const ctx = projection.context as {
      org: { id: string | null; name: string | null };
      user: { first_name: string | null };
      project: { id: string | null; name: string | null };
      underlying_cause_tag: string | null;
      most_recent_session_per_project: Record<string, string>;
      last_used_resolution_degraded:
        | { failed_project_ids: string[]; partial_result: boolean }
        | null;
      // URL-level deep-link wish — projection field renamed in MR-D
      // (audit §5 / §7 Tier-1 #2).
      deeplink_session_id: string | null;
      // resource_* still live on the projection (fed by deep_link_opened
      // event payload). Per MR-D they no longer touch project-context's
      // ctx; the projection is the only place they live.
      intent_resource_id: string | null;
      intent_resource_type: ResourceType | null;
    };

    // D-MR5-01 — the begin/`resolveInitialScope` settle has the SAME
    // D-MR4-06 problem #2 as the switch path: the resolved `project` (and
    // the cross_tenant / project_not_found / no_projects cause) lands on
    // the machine context AFTER the snapshot flips and BEFORE the first
    // FlowEvent captures it, so the projection read above sees
    // `project: { id: null }`. D-MR4-06 fixed this for
    // `switching_project_intent` only and explicitly deferred the begin
    // counterpart to "LEAF-C+". Without it here `project_selected` is
    // emitted with a null project, `active_scope.project_id` stays null,
    // and `maybeFireProjectReady` short-circuits (`!projectId`) so
    // session-chat NEVER spawns — which blocks the entire US-205 resume /
    // US-209 dataset-switch chain (session-chat can't reach
    // session_active). Harvest from the designated snapshot-read boundary
    // (the project-context counterpart already added by D-MR4-06), exactly
    // as the switch-settle path does, so the begin emission carries the
    // real resolved project.
    const beginHarvest = harvestSettledProjectContextState(actor);
    const settledProject = beginHarvest.project.id
      ? beginHarvest.project
      : ctx.project;
    const settledCause =
      beginHarvest.underlying_cause_tag ?? ctx.underlying_cause_tag;
    // D-MR5-01: org_id has the same first-write-null problem as project.
    // Without harvesting it, `maybeFireProjectReady` short-circuits on
    // `!orgId` and session-chat never spawns.
    const settledOrgId =
      beginHarvest.org_id ?? ctx.org.id ?? input.org_id ?? "";

    // Initial event — marks the J-002 actor as started for projection consumers.
    await this.deps.eventLog.append(flow_id, {
      ts: new Date().toISOString(),
      type: "project_context_resolution_started",
      payload: {
        org_id: settledOrgId,
        user: {
          first_name: ctx.user.first_name ?? input.user_first_name ?? null,
        },
        correlation_id: input.correlation_id,
      },
      correlation_id: input.correlation_id,
    });

    // OQ-J002-5: when resolveInitialScope's invoke captured one or more 5xx
    // failures on list_sessions, emit the degraded event so projection
    // consumers can surface a banner / metric. Emitted BEFORE the terminal
    // event so the projection reducer sees them in causal order.
    const degradedIds =
      ctx.last_used_resolution_degraded?.failed_project_ids ?? [];
    if (degradedIds.length > 0) {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "last_used_resolution_degraded",
        payload: {
          failed_project_ids: degradedIds,
          partial_result: true,
        },
        correlation_id: input.correlation_id,
      });
    }

    // Terminal-for-now event reflecting settle.
    if (stateValue === "no_projects") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "no_projects_displayed",
        payload: {
          org_id: settledOrgId,
          user: {
            first_name: ctx.user.first_name ?? input.user_first_name ?? null,
          },
        },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "project_selected") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "project_selected",
        payload: {
          org_id: settledOrgId,
          project: settledProject,
          most_recent_session_per_project: ctx.most_recent_session_per_project,
        },
        correlation_id: input.correlation_id,
      });

      // ---- project_ready broadcast hook (DWD-13 §3.2.B; NEW per MR-1.5) ----
      // When project-context settles in `project_selected` on initial spawn,
      // broadcast `project_ready` to session-chat (idempotent spawn). The
      // hook mirrors the existing auth_ready pattern below in `send()` —
      // see also the `send()`-side branch for the project-switch re-entry
      // path (MR-4 lifts `switching_project → project_selected`, which also
      // needs to re-broadcast).
      await this.maybeFireProjectReady(
        flow_id,
        input.principal_id,
        input.correlation_id,
        {
          org_id: settledOrgId || undefined,
          project: settledProject,
          deeplink_session_id: ctx.deeplink_session_id,
          intent_resource_id: ctx.intent_resource_id,
          intent_resource_type: ctx.intent_resource_type,
        },
      );
    } else if (stateValue === "scope_mismatch_terminal") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "scope_mismatch_displayed",
        payload: {
          org_id: settledOrgId,
          underlying_cause_tag: settledCause ?? "cross_tenant",
        },
        correlation_id: input.correlation_id,
      });
    }

    return this.projectionFor(
      flow_id,
      input.principal_id,
      input.correlation_id,
    );
  }

  /**
   * Broadcast `project_ready` to session-chat when project-context enters
   * `project_selected` — DWD-13 §3.2.B. Idempotent on the SAME project_id
   * (session-chat ignores re-emission); a DIFFERENT project_id triggers
   * session-chat's invalidation handler (MR-4 lifts the re-broadcast on
   * `switching_project → project_selected`).
   *
   * The hook is a no-op when:
   *   - `sessionChatMachineDeps` is absent (legacy J-001-only deployment).
   *   - project-context's resolved context lacks an `org_id` or a
   *     `project.id` (defensive — should be impossible in `project_selected`,
   *     but spawning session-chat with NULL project_id is wrong).
   *
   * Failures here NEVER propagate — project-context's `project_selected`
   * transition succeeds regardless. Matches the auth_ready hook's resilience
   * stance (orchestrator.ts:611-618 pre-split lineage).
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
      await this.beginIfNotStarted({
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

  /**
   * After a session-chat actor settles from spawn (or from project_ready
   * re-broadcast), examine its state and emit the projection-shaping events
   * to the session-chat flow log. Matches the project-context emission
   * pattern in `beginIfNotStarted` — events are the SSOT for projection
   * reconstruction.
   */
  private async emitSessionChatSpawnEvents(
    flow_id: string,
    actor: AnyActorRef,
    correlation_id: string,
    spawn: {
      org_id?: string;
      project_id?: string;
      project_name?: string;
    },
  ): Promise<void> {
    // ADR-030 LEAF-B: state-value is the only legal read off the actor
    // snapshot at the emission boundary; identity fields come from the
    // spawn input (the orchestrator's own contract) rather than from
    // snapshot.context, per ADR-030 §"Decision outcome".
    const stateValue = actor.getSnapshot().value as string;
    const orgId = spawn.org_id || "";
    const projectId = spawn.project_id || null;
    if (!orgId || !projectId) return;

    // Per DWD-13 §2B the session-chat flow's log carries the
    // `project_context_inherited` event as its first marker so the projection
    // reducer knows session-chat has been spawned for this principal.
    await this.deps.eventLog.append(flow_id, {
      ts: new Date().toISOString(),
      type: "project_context_inherited",
      payload: {
        org_id: orgId,
        project_id: projectId,
        project_name: spawn.project_name ?? "",
      },
      correlation_id,
    });

    await this.appendSessionChatTerminalEvents(flow_id, stateValue, correlation_id);
  }

  /**
   * Emit the terminal-for-now events that match a session-chat actor's
   * current state. Idempotent and side-effect-only — the actor's state is
   * the source of truth; the events are the projection-builder substrate.
   *
   * Called from BOTH `emitSessionChatSpawnEvents` (after spawn / project_ready
   * re-broadcast) AND the post-`send()` branch for SESSION_CHAT_WIRE_NAME so
   * session_clicked → resuming_session → session_active emits the right
   * sequence regardless of which surface drove the transition.
   */
  private async appendSessionChatTerminalEvents(
    flow_id: string,
    stateValue: string,
    correlation_id: string,
    /** Optional: the machine's state value immediately before this settle.
     *  Used to distinguish eager-create from resume on `session_active`
     *  arrival (US-206 vs US-205) so the projection log records the right
     *  event-type. */
    priorState?: string,
    /** D-MR5-01: the `resumeSession` actor's resolved `resource` (and the
     *  `dataset_not_found` cause) lands on the machine context AFTER the
     *  snapshot flips to `session_active` and BEFORE any FlowEvent
     *  captures it — the SAME D-MR4-06 problem #2 LEAF-B introduced and
     *  D-MR4-06 fixed only for the switch path. So `session_resumed`
     *  emitted from the projection-of-log read below carries
     *  resource=null / dataset_unavailable=false and US-205's resume
     *  contract (and US-209's resume precondition) fails. Callers harvest
     *  from the designated snapshot-read boundary and pass it here so the
     *  `session_resumed` payload reflects the real resumed dataset. */
    harvestedResume?: {
      session_id: string | null;
      transcript: Array<{
        id: string;
        role: string;
        content: string;
        ts: string;
      }>;
      resource: { type: string | null; id: string | null };
      underlying_cause_tag: string | null;
    } | null,
  ): Promise<void> {
    // ADR-030 LEAF-B: rebind ctx to the live projection's context built
    // from the flow event log. The projection is the only legal read
    // source for the emission path per ADR-030 §"Decision outcome".
    //
    // Risk noted for reviewer: fields populated by session-chat's invoke
    // outputs (session_list, session_id, transcript, resource,
    // pending_first_message, underlying_cause_tag) are projected only by
    // their corresponding emit events — at the moment of THIS read, the
    // about-to-be-written event has not yet landed in the log, so the
    // payload will surface the projection's prior-tick values (commonly
    // null/empty for the fresh-spawn path).  LEAF-C+ will restructure
    // `loadSessionList`, `resumeSession`, and peers to land an upstream
    // `event.output` carrier event so this read sees the resolved data.
    // Mirrors the LEAF-A session-list trade-off; tracked under
    // ADR-030 §"Migration sequencing".
    const projection = buildProjection(
      flow_id,
      await this.deps.eventLog.read(flow_id),
    );
    const ctx = projection.context as {
      project: { id: string | null; name: string | null };
      session_list: Array<{
        id: string;
        title: string | null;
        last_active_at: string;
        active_dataset_id: string | null;
      }>;
      session_list_next_cursor: string | null;
      session_list_has_more: boolean;
      session_id: string | null;
      transcript: Array<{
        id: string;
        role: "user" | "assistant" | "tool";
        content: string;
        ts: string;
      }>;
      resource: { type: ResourceType | null; id: string | null };
      // Click-captured resume target (session-chat half — projection
      // field renamed in MR-D).
      pending_resume_session_id: string | null;
      underlying_cause_tag: string | null;
      pending_first_message: string;
    };
    if (stateValue === "loading_session_list") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_list_load_started",
        payload: { project_id: ctx.project.id },
        correlation_id,
      });
      return;
    }
    if (stateValue === "session_list_loaded") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_list_load_started",
        payload: { project_id: ctx.project.id },
        correlation_id,
      });
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_list_loaded",
        payload: {
          items: ctx.session_list,
          next_cursor: ctx.session_list_next_cursor,
          has_more: ctx.session_list_has_more,
        },
        correlation_id,
      });
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_list_displayed",
        payload: {
          project_id: ctx.project.id,
          session_count: ctx.session_list.length,
        },
        correlation_id,
      });
      return;
    }
    if (stateValue === "resuming_session") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_resume_started",
        payload: {
          session_id:
            ctx.pending_resume_session_id ?? ctx.session_id ?? null,
        },
        correlation_id,
      });
      return;
    }
    if (stateValue === "session_active") {
      // US-206 vs US-205 path distinction: an eager-create landing in
      // session_active came from session_welcome (via the
      // creating_session invoke). Use the prior-state hint to emit
      // `session_active_reached` instead of `session_resumed`. Functionally
      // both events project to state=session_active; the distinct names
      // keep the event log auditable for "did this row come from a
      // resume or an eager-create?" queries.
      if (priorState === "session_welcome") {
        await this.deps.eventLog.append(flow_id, {
          ts: new Date().toISOString(),
          type: "session_active_reached",
          payload: {
            session_id: ctx.session_id,
          },
          correlation_id,
        });
        return;
      }
      // D-MR5-01: prefer the harvested settled context (the resume
      // actor's resolved resource lands on ctx after the snapshot flips —
      // the projection-of-log read here would see null). Falls back to
      // the projection read when no harvest was supplied (spawn-path call
      // sites that never resumed).
      const resumedResource = harvestedResume?.resource ?? ctx.resource;
      const resumedCause =
        harvestedResume?.underlying_cause_tag ?? ctx.underlying_cause_tag;
      const resumedSessionId = harvestedResume?.session_id ?? ctx.session_id;
      const resumedTranscript =
        harvestedResume?.transcript ?? ctx.transcript;
      // `dataset_unavailable` is TRUE only when the resume actor detected a
      // stored active_dataset_id that 404'd (graceful degradation per US-205
      // Example 3). A null active_dataset_id is the conversational-mode
      // default — NOT a degraded state. The machine signals the degraded
      // case by setting underlying_cause_tag = "dataset_not_found".
      const datasetUnavailable = resumedCause === "dataset_not_found";
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_resumed",
        payload: {
          session_id: resumedSessionId,
          transcript: resumedTranscript,
          resource_type: resumedResource.type,
          resource_id: resumedResource.id,
          dataset_unavailable: datasetUnavailable,
        },
        correlation_id,
      });
      if (datasetUnavailable) {
        await this.deps.eventLog.append(flow_id, {
          ts: new Date().toISOString(),
          type: "session_dataset_unavailable",
          payload: {},
          correlation_id,
        });
      }
      return;
    }
    if (stateValue === "session_welcome") {
      // US-206: emit `session_welcome_displayed` so the projection reducer
      // surfaces the welcome state to consumers. session_id stays null.
      // Carry pending_first_message so the projection reducer preserves the
      // composer text when re-entering from `retry_clicked` — the machine
      // already holds it in context across that transition (app-arch §6.4).
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_welcome_displayed",
        payload: {
          project_id: ctx.project.id,
          pending_first_message: ctx.pending_first_message,
        },
        correlation_id,
      });
      return;
    }
    if (stateValue === "error_recoverable") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_chat_recoverable_error",
        payload: {
          underlying_cause_tag: ctx.underlying_cause_tag ?? "transient",
          // US-206 composer-preservation: carry the welcome-state composer
          // text on the FlowEvent so the projection reducer preserves it
          // across reload (DWD-9 SSOT — projection is rebuilt from log).
          pending_first_message: ctx.pending_first_message,
        },
        correlation_id,
      });
    }
  }

  /**
   * MR-6 / US-210 — emission-completeness for the project-context THAW
   * history-target re-entry. When `last_live_state` was the invoke-driven
   * `switching_project` (US-210 scenario 2), `freeze → switching_project`
   * re-runs `switchProject` with the fresh post-re-auth JWT and settles
   * into `project_selected` / `scope_mismatch_terminal` /
   * `error_recoverable`. That settle lands on the machine context AFTER
   * the snapshot flips and BEFORE any FlowEvent captures it — the
   * D-MR4-06 class. Source the terminal payload from the designated
   * harvest boundary (mirrors the `switching_project_intent` settle path
   * in `send()`), so the projection advances to the switched project
   * instead of staying at `project_context_thawed`. Non-transient
   * `last_live_state` values restore via the `project_context_thawed`
   * reducer alone — no terminal emission needed.
   */
  private async appendProjectContextThawTerminal(
    flow_id: string,
    actor: AnyActorRef,
    settledState: string,
    correlation_id: string,
  ): Promise<void> {
    const h = harvestSettledProjectContextState(actor);
    if (settledState === "project_selected") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "project_switched",
        payload: { org_id: h.org_id ?? "", project: h.project },
        correlation_id,
      });
      // Re-broadcast project_ready so a frozen-then-thawed session-chat
      // re-binds to the switched project (idempotent on same id).
      await this.maybeFireProjectReady(
        flow_id,
        parsePrincipal(flow_id),
        correlation_id,
        { org_id: h.org_id ?? "", project: h.project },
      );
    } else if (settledState === "scope_mismatch_terminal") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "scope_mismatch_displayed",
        payload: {
          org_id: h.org_id ?? "",
          underlying_cause_tag: h.underlying_cause_tag ?? "access_revoked",
        },
        correlation_id,
      });
    } else if (settledState === "error_recoverable") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "project_context_recoverable_error",
        payload: {
          underlying_cause_tag: h.underlying_cause_tag ?? "transient",
        },
        correlation_id,
      });
    }
  }

  async send(input: SendEventInput): Promise<FlowProjection> {
    const actor = this.actors.get(input.flow_id);
    if (!actor) {
      throw new Error(`unknown flow_id: ${input.flow_id}`);
    }

    // ---- Cross-machine FREEZE handling (Step 03-01, ADR-028) -------------
    // If this flow is currently frozen (because a sibling actor entered
    // expired_token), the event is queued in the replay buffer rather than
    // dispatched to the underlying XState actor. Bounded by REPLAY_BUFFER_CAP
    // and FREEZE_WINDOW_MS — overflow or timeout triggers abandonment.
    const frozenState = this.frozen.get(input.flow_id);
    if (frozenState) {
      const elapsed = Date.now() - frozenState.frozenAt;
      if (elapsed > FREEZE_WINDOW_MS) {
        // 5-second window elapsed: abandon replay. The persisted event log
        // is still appended below so the caller's projection observes the
        // attempt, but the underlying actor stays untouched.
        this.abandoned.add(input.flow_id);
      } else {
        // Within window — queue if under cap, else abandon on overflow.
        if (frozenState.queued.length >= REPLAY_BUFFER_CAP) {
          this.abandoned.add(input.flow_id);
        } else {
          frozenState.queued.push(input);
        }
      }
      // Append the event to the persisted log so projection consumers see
      // the attempt even when it's queued/abandoned. The XState actor is
      // NOT advanced — that happens on broadcastThaw if not abandoned.
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
    // ---- End freeze handling --------------------------------------------

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

    // D-MR4-06 / IC-J002-4 — `switching_project` is an invoke-driven
    // transient state (the `switchProject` actor performs
    // GET /api/projects/:id). Emit `switching_project_started` BEFORE
    // awaiting the settle so the projection writes the atomic invalidation
    // (session_id + resource_* nulled) in the SAME tick the
    // `switching_project` state surfaces — SSE consumers see the
    // (state=switching_project, session_id=null, resource=null) tuple
    // together. The post-settle block below then emits the terminal
    // `project_switched` / `project_selected` (or `scope_mismatch_displayed`
    // / `project_context_recoverable_error`) once `switchProject` resolves;
    // because `waitForSettledState` now treats `switching_project` as
    // transient the snapshot read there observes the SETTLED state, so the
    // post-settle `switching_project` arm no longer fires for this path.
    // Without this pre-settle emission `project_switched`'s reducer (which
    // relies on `switching_project_started` having cleared session_id)
    // would leak the old session_id under the new project.
    if (
      input.machine === PROJECT_CONTEXT_WIRE_NAME &&
      input.type === "switching_project_intent" &&
      (actor.getSnapshot().value as string) === "switching_project"
    ) {
      const preSettleCtx = buildProjection(
        input.flow_id,
        await this.deps.eventLog.read(input.flow_id),
      ).context as { org: { id: string | null } };
      await this.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "switching_project_started",
        payload: {
          org_id: preSettleCtx.org.id ?? "",
          deeplink_project_id:
            (input.payload.new_project_id as string | undefined) ?? null,
        },
        correlation_id: input.correlation_id,
      });
    }

    // US-209 / MR-5 — `switching_dataset_context` is an invoke-driven
    // transient state (the `switchDatasetContext` actor performs
    // GET /api/datasets/:id + PATCH session.active_dataset_id). Mirrors the
    // D-MR4-06 `switching_project_started` pre-settle emission: emit
    // `switching_dataset_context_started` BEFORE awaiting the settle so an
    // SSE consumer observes the (state=switching_dataset_context) tick.
    // The post-settle block below then emits the terminal `dataset_attached`
    // / `dataset_access_denied` once `switchDatasetContext` resolves —
    // sourced from the harvested machine context (the resolved resource
    // lands on ctx after the snapshot flips, the D-MR4-06 problem #2).
    if (
      input.machine === SESSION_CHAT_WIRE_NAME &&
      (input.type === "dataset_resolved_by_agent" ||
        input.type === "dataset_picked_directly") &&
      (actor.getSnapshot().value as string) === "switching_dataset_context"
    ) {
      await this.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "switching_dataset_context_started",
        payload: {
          intended_resource_id:
            (input.payload.resource_id as string | undefined) ?? null,
          intended_resource_type:
            (input.payload.resource_type as string | undefined) ?? "dataset",
        },
        correlation_id: input.correlation_id,
      });
    }

    await waitForSettledState(actor);
    // If this transition lands the machine in expired_token AND silentReauth
    // is wired, wait one more cycle for it to leave again (success → ready,
    // failure → error_recoverable). Detected by checking whether deps has a
    // user-supplied silentReauth — the orchestrator's deps don't carry that
    // flag directly, so we check the snapshot's invoke status after the
    // initial settle and fall through immediately when there's no invoke.
    {
      const snap = actor.getSnapshot();
      if (
        (snap.value as string) === "expired_token" &&
        this.hasSilentReauthInvoke(snap)
      ) {
        // Re-await: silent reauth promise is in flight. Settle when the
        // machine leaves expired_token.
        await waitForLeavingState(actor, "expired_token");
      }
    }

    // After settle, observe terminal-for-now state and append projection-
    // shaping events for the event-sourced read model. The reducer in
    // `projection.ts` is the SSOT for state-derivation from events.
    //
    // ADR-030 LEAF-B: only the snapshot's state-value is read here; all
    // context reads in the emission paths below route through the live
    // projection (built from the FlowEvent log) per ADR-030 §"Decision
    // outcome".
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
      // URL-level deep-link wishes (projection field names renamed in
      // MR-D per audit §5 / §7 Tier-1 #2).
      deeplink_project_id: string | null;
      deeplink_session_id: string | null;
      // resource_* still live on the projection (fed by deep_link_opened
      // event payload). Per MR-D they no longer touch project-context's
      // ctx; the projection is the only place they live.
      intent_resource_id: string | null;
      intent_resource_type: ResourceType | null;
    };

    // ---- Cross-machine FREEZE/THAW signaling (Step 03-01, ADR-028) -------
    // When the origin flow transitions INTO expired_token, broadcast FREEZE
    // to all siblings. When it transitions OUT of expired_token (back to
    // ready after silent reauth ok, or to error_recoverable after reauth
    // failure), broadcast THAW.
    const prior = this.priorState.get(input.flow_id);
    if (stateValue === "expired_token" && prior !== "expired_token") {
      await this.broadcastFreeze(input.flow_id);
    } else if (prior === "expired_token" && stateValue === "ready") {
      // Silent re-auth succeeded → THAW: each frozen J-002 machine
      // returns to its `last_live_state` and queued intents replay FIFO.
      await this.broadcastThaw(input.flow_id, "thaw");
    } else if (prior === "expired_token" && stateValue === "error_recoverable") {
      // Silent re-auth FAILED (US-210 Example 3): the buffered intents are
      // abandoned and each frozen J-002 machine falls through
      // `freeze → error_recoverable` (cause `replay_abandoned`).
      await this.broadcastThaw(input.flow_id, "abandoned");
    }
    this.priorState.set(input.flow_id, stateValue);
    // ---- End freeze/thaw signaling --------------------------------------

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
      await this.deps.eventLog.append(input.flow_id, {
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
      const isFirstReady = prior === "creating_org" || prior === "anonymous" || !prior;
      if (isFirstReady && this.deps.projectContextMachineDeps && orgCtx.id) {
        const firstName =
          userCtx.first_name ??
          ((userCtx.display_name ?? "").split(/\s+/)[0] || null);
        try {
          await this.beginIfNotStarted({
            machine: PROJECT_CONTEXT_WIRE_NAME,
            principal_id: parsePrincipal(input.flow_id),
            correlation_id: input.correlation_id,
            org_id: orgCtx.id,
            user_first_name: firstName ?? "",
          });
        } catch (err) {
          // Defensive — project-context spawn failure must NOT break J-001's ready transition.
          this.logTransition({
            event_kind: "auth_ready_hook.failed",
            error: (err as Error).message,
            origin_flow_id: input.flow_id,
          });
        }
      }
    } else if (stateValue === "expired_token") {
      // Harness-driven (or future production-driven) transition into the
      // expired_token state. The projection reducer derives state from this
      // event so subsequent reads see expired_token without the actor.
      await this.deps.eventLog.append(input.flow_id, {
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
      await this.deps.eventLog.append(input.flow_id, {
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
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "validation_failed",
          payload: { error: projectionCtx.org_validation_error },
          correlation_id: input.correlation_id,
        });
      }
    }

    // ---- project-context terminal-for-now event appending ----------------
    // The project-context machine's events do not share J-001's state names, so
    // the existing branches above don't fire for it. Project a state-specific
    // event into the log so subsequent projection reads can reconstruct.
    // Per DWD-13 the wire name is still `project-and-chat-session-management`;
    // the source-tree splits but the wire-protocol log key + URL prefix stays.
    if (input.machine === PROJECT_CONTEXT_WIRE_NAME) {
      // ADR-030 LEAF-B: project-context emission reads now flow through
      // the projection.  `projectionCtx.org.id` mirrors the actor's
      // single-field `org_id`; the rest of the shape matches the
      // projection's reducer-populated context.
      const orgId = projectionCtx.org.id ?? "";

      // D-MR4-06 — the `switchProject` actor's resolved project (and the
      // access_revoked / project_not_found / transient cause it sets on
      // its error branches) settles on the machine context AFTER the
      // snapshot value flips and BEFORE any FlowEvent has captured it, so
      // `projectionCtx.project` / `projectionCtx.underlying_cause_tag`
      // read null/empty here (the LEAF-B trade-off documented in
      // `beginIfNotStarted`). Harvest from the designated snapshot-read
      // boundary (`orchestrator-harvester.ts`, exempt from the LEAF-D
      // rule) so the switch-settle terminal events carry the real
      // resolved values — mirrors the login `harvestSettledLoginState`
      // pre-emit pattern. Scoped to the switch path (input.type ===
      // `switching_project_intent`) so create / deep-link / re-resolve
      // emission is unchanged.
      const isSwitchSettle = input.type === "switching_project_intent";
      const switchHarvest = isSwitchSettle
        ? harvestSettledProjectContextState(actor)
        : null;
      const switchSettledProject = switchHarvest?.project ?? null;
      const switchSettledCause = switchHarvest?.underlying_cause_tag ?? null;

      // When the incoming event is `open_deep_link`, also append a
      // `deep_link_opened` projection event so the projection's context
      // carries the URL-level wish + resource_* fields (per DWD-9).
      // Post-MR-D the projection field names are `deeplink_*` (URL half)
      // + `intent_resource_*` (forward-compat slots still routed through
      // the projection — see audit §5 / §7 Tier-1 #2). The values come
      // from the projection (the open_deep_link event's payload has
      // already been folded in by buildProjection above).
      if (input.type === "open_deep_link") {
        const resolvedScope = {
          org_id: orgId,
          project_id: projectionCtx.project.id,
          resource_type: projectionCtx.intent_resource_type,
          resource_id: projectionCtx.intent_resource_id,
        };
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "deep_link_opened",
          payload: {
            scope: resolvedScope,
            project: projectionCtx.project,
            reconciled: false,
            deeplink_project_id: projectionCtx.deeplink_project_id,
            deeplink_session_id: projectionCtx.deeplink_session_id,
            intent_resource_id: projectionCtx.intent_resource_id,
            intent_resource_type: projectionCtx.intent_resource_type,
          },
          correlation_id: input.correlation_id,
        });
      }

      if (
        stateValue === "no_projects" &&
        projectionCtx.project_validation_error
      ) {
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "project_validation_failed",
          payload: { error: projectionCtx.project_validation_error },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "no_projects") {
        // Re-resolved into no_projects (e.g., after back_to_projects_clicked).
        // Emit no_projects_displayed so the projection settles correctly.
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "no_projects_displayed",
          payload: {
            org_id: orgId,
            user: { first_name: projectionCtx.user.first_name },
          },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "creating_project") {
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "project_creation_started",
          payload: {
            pending_project_name: projectionCtx.pending_project_name,
          },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "project_selected") {
        // Emit `project_selected` (not `project_created`) when this transition
        // is the result of a re-resolve (open_deep_link or back_to_projects_clicked).
        // The projection reducer handles both event types similarly; the
        // distinction is semantic for downstream consumers (a deep-link
        // resolution is not a creation).
        const isFromCreate = input.type === "create_project_submitted";
        // D-MR4-06: on the switch-settle path the resolved project lives
        // only on the harvested machine context (see switchHarvest above).
        const settledProject =
          switchSettledProject ?? projectionCtx.project;
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: isFromCreate ? "project_created" : "project_selected",
          payload: {
            org_id: orgId,
            project: settledProject,
          },
          correlation_id: input.correlation_id,
        });
        // ---- project_ready broadcast hook (DWD-13 §3.2.B; send-path) -----
        // When project-context re-enters `project_selected` from create_project_submitted
        // or from back_to_projects_clicked → resolveInitialScope → project_selected,
        // broadcast `project_ready` so session-chat spawns (or, post-MR-4, re-invalidates
        // on project switch). Idempotent on the same project_id.
        await this.maybeFireProjectReady(
          input.flow_id,
          principal_id,
          input.correlation_id,
          {
            org_id: orgId,
            project: settledProject,
            deeplink_session_id: projectionCtx.deeplink_session_id,
            intent_resource_id: projectionCtx.intent_resource_id,
            intent_resource_type: projectionCtx.intent_resource_type,
          },
        );
        // MR-4 — when the entry was a switch settle (the prior state was
        // `switching_project`), also emit a `project_switched` projection
        // event so SSE consumers can distinguish "initial select" from
        // "switch settle". The orchestrator can't read XState's prior state
        // directly; we discriminate by input.type since switching_project_intent
        // is the ONLY event that lifts switching_project → project_selected.
        if (input.type === "switching_project_intent") {
          await this.deps.eventLog.append(input.flow_id, {
            ts: new Date().toISOString(),
            type: "project_switched",
            payload: {
              org_id: orgId,
              project: settledProject,
            },
            correlation_id: input.correlation_id,
          });
        }
      } else if (stateValue === "switching_project") {
        // MR-4 / IC-J002-4 — emit `switching_project_started` atomically with
        // the state surface so SSE consumers see (state=switching_project,
        // session_id=null, resource=null) in the same projection tick.
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "switching_project_started",
          payload: {
            org_id: orgId,
            deeplink_project_id: projectionCtx.deeplink_project_id,
          },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "error_recoverable") {
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "project_context_recoverable_error",
          payload: {
            underlying_cause_tag:
              switchSettledCause ??
              projectionCtx.underlying_cause_tag ??
              "transient",
            pending_project_name: projectionCtx.pending_project_name,
          },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "scope_mismatch_terminal") {
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "scope_mismatch_displayed",
          payload: {
            org_id: orgId,
            underlying_cause_tag:
              switchSettledCause ??
              projectionCtx.underlying_cause_tag ??
              "cross_tenant",
            deeplink_project_id: projectionCtx.deeplink_project_id,
          },
          correlation_id: input.correlation_id,
        });
      }
    }

    // ---- session-chat terminal-for-now event appending (J-002 MR-2) -------
    // After session_clicked / refresh_session_list / project_ready re-broadcast
    // dispatched via this `send()`, emit the projection-shaping events to the
    // session-chat flow log.
    if (input.machine === SESSION_CHAT_WIRE_NAME) {
      const isDatasetSwitch =
        input.type === "dataset_resolved_by_agent" ||
        input.type === "dataset_picked_directly";
      // US-209 / MR-5 — the `switchDatasetContext` settle path. Mirrors the
      // D-MR4-06 project-switch settle discipline: the resolved `resource`
      // (or the `dataset_access_denied` cause) lands on the machine context
      // AFTER the snapshot flips back to `session_active`, so a projection
      // read here would see the prior-tick resource. Harvest from the
      // designated snapshot-read boundary and emit the terminal
      // `dataset_attached` / `dataset_access_denied` so the projection — the
      // SSOT the acceptance probes read — reflects the new (or preserved)
      // dataset. Keyed off `input.type` (the switch discriminator), exactly
      // as the project-context block keys off `switching_project_intent`.
      // A transient invoke failure settles in `error_recoverable`; that
      // falls through to the generic emission path
      // (`session_chat_recoverable_error`) below.
      if (isDatasetSwitch && stateValue === "session_active") {
        const harvest = harvestSettledSessionChatState(actor);
        if (harvest.underlying_cause_tag === "dataset_access_denied") {
          await this.deps.eventLog.append(input.flow_id, {
            ts: new Date().toISOString(),
            type: "dataset_access_denied",
            payload: { underlying_cause_tag: "dataset_access_denied" },
            correlation_id: input.correlation_id,
          });
        } else {
          await this.deps.eventLog.append(input.flow_id, {
            ts: new Date().toISOString(),
            type: "dataset_attached",
            payload: {
              resource_type: harvest.resource.type,
              resource_id: harvest.resource.id,
            },
            correlation_id: input.correlation_id,
          });
        }
      } else if (
        input.type === "session_clicked" &&
        stateValue === "session_list_loaded"
      ) {
        // Special-case: if the resumeSession resolved with
        // session_not_found (silent return), the machine has settled in
        // session_list_loaded. The default state-emission path covers
        // that; for session_not_found the test expects
        // underlying_cause_tag to NOT surface — we emit
        // `session_resume_not_found` so the projection reducer can blank
        // out pending_resume_session_id atomically.
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "session_resume_not_found",
          payload: {},
          correlation_id: input.correlation_id,
        });
      } else {
        await this.appendSessionChatTerminalEvents(
          input.flow_id,
          stateValue,
          input.correlation_id,
          // `prior` captured at the top of send() — the state BEFORE the
          // current event was dispatched. Used to distinguish eager-create
          // from resume on `session_active` arrival.
          prior,
          // D-MR5-01: harvest the resumed resource / cause so
          // `session_resumed` reflects the actor's settled context
          // (resolved AFTER the snapshot flipped — the projection-of-log
          // read would see null). Same boundary-discipline as the
          // dataset-switch harvest above.
          harvestSettledSessionChatState(actor),
        );
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
   * Subscribe to a flow's event stream — substrate for the SSE
   * `/projection/stream` route (DWD-9 + RD2). Delegates to the FlowEventLog
   * adapter; the noop in-memory log emits to subscribers synchronously after
   * `append()`, the Redis log uses `XREAD BLOCK` on a dedicated subscriber
   * connection.
   *
   * `blockMs` bounds the iterator — when the server closes the SSE response,
   * the iterator is exhausted (or the consumer calls `.return()`).
   */
  subscribeToFlow(
    flow_id: string,
    sinceId: string,
    blockMs?: number,
  ): AsyncIterable<FlowEvent> {
    return this.deps.eventLog.subscribe(flow_id, sinceId, blockMs);
  }

  // ------------------------------------------------------------------------
  // Cross-machine FREEZE/THAW broadcast (ADR-028, Step 03-01)
  // ------------------------------------------------------------------------

  /**
   * Broadcast a FREEZE signal to every actor in the tree EXCEPT the origin.
   * The origin is the flow whose state machine entered `expired_token` —
   * its silent re-auth invoke is in flight; sibling flows must pause until
   * the auth credential is restored. Per ADR-028, sibling actors learn of
   * the freeze via an actor-level event; the orchestrator additionally
   * tracks the freeze state at this level so `send()` can queue intent
   * events arriving at frozen actors into the bounded replay buffer.
   */
  async broadcastFreeze(originFlowId: string): Promise<void> {
    const now = Date.now();
    for (const [flow_id, actor] of this.actors.entries()) {
      if (flow_id === originFlowId) continue;
      // Mark frozen at the orchestrator level — `send()` consults this to
      // decide whether to forward or queue. Synchronous so a caller that
      // does not await still observes `isFrozen` immediately (B1/B6/B7).
      if (!this.frozen.has(flow_id)) {
        this.frozen.set(flow_id, {
          frozenAt: now,
          origin: originFlowId,
          queued: [],
        });
      }
      // Notify the actor. J-002's machines declare a top-level on.FREEZE
      // (US-210 §2.2) that transitions into their `freeze` side-state and
      // assigns `last_live_state`. The login machine has no handler — a
      // harmless no-op (ADR-028 §"No machine imports another machine").
      try {
        actor.send({ type: "FREEZE" } as never);
      } catch {
        // Defensive: a stopped actor would reject the send; ignore.
      }
      // Emission arm (ADR-030 2026-05-16 tripwire). The machine just
      // settled into `freeze` and assigned `last_live_state` on its
      // snapshot context. Without an emission here the projection — the
      // SSOT every downstream reader (FE, TS harness, acceptance probes)
      // observes — stays at the pre-freeze state forever: the exact
      // D-MR4-06 / D-MR5-01 emission-completeness failure class. Harvest
      // the settled freeze state and append the per-machine `*_frozen`
      // FlowEvent so the projection reflects `freeze`.
      const machine = machineOfFlow(flow_id);
      if (
        J002_MACHINES.has(machine) &&
        (actor.getSnapshot().value as string) === "freeze"
      ) {
        const h = harvestSettledFreezeState(actor);
        await this.deps.eventLog.append(flow_id, {
          ts: new Date().toISOString(),
          type:
            machine === SESSION_CHAT_WIRE_NAME
              ? "session_chat_frozen"
              : "project_context_frozen",
          payload: {
            last_live_state: h.last_live_state,
            // Originating user-action preserved from the freeze moment so
            // it survives into error_recoverable on the abandoned path
            // (US-210 AC — "preserved in the failure event payload for
            // re-issue"). The *_started events that normally write these
            // never fired when FREEZE pre-empted the in-flight invoke.
            pending_resume_session_id: h.pending_resume_session_id,
            pending_first_message: h.pending_first_message,
            pending_project_name: h.pending_project_name,
          },
          correlation_id: h.correlation_id,
        });
      }
    }
  }

  /**
   * Broadcast a THAW signal to every previously frozen actor. Queued intent
   * events are replayed in arrival order, unless the flow was abandoned
   * (overflow or 5s timeout) in which case the queue is dropped.
   */
  async broadcastThaw(
    originFlowId: string,
    reason: "thaw" | "abandoned" = "thaw",
  ): Promise<void> {
    // Snapshot the keys first because draining mutates the map.
    const flowIds = Array.from(this.frozen.keys());
    for (const flow_id of flowIds) {
      const state = this.frozen.get(flow_id);
      if (!state) continue;
      // Origin flows aren't normally in the frozen set (broadcastFreeze
      // skipped them), but defend against future callers.
      if (flow_id === originFlowId) continue;
      // Take the queue off before signalling, so re-entrant sends during
      // replay don't double-up.
      const drained = state.queued;
      this.frozen.delete(flow_id);
      // A flow is abandoned when the replay buffer overflowed / the 5s
      // window elapsed (lazy `send()` check) OR silent re-auth failed
      // (reason === "abandoned", US-210 Example 3 / scenario 4).
      const abandoned = this.abandoned.has(flow_id) || reason === "abandoned";
      const actor = this.actors.get(flow_id);
      const machine = machineOfFlow(flow_id);
      const isJ002 = J002_MACHINES.has(machine);

      if (abandoned) {
        // Drive the J-002 machine `freeze → error_recoverable` (cause
        // `replay_abandoned`) and drop the queue. The originating
        // user-action is preserved on the machine context
        // (pending_resume_session_id / pending_first_message /
        // pending_project_name) AND echoed in the FlowEvent payload for
        // re-issue (US-210 AC). Emission arm (ADR-030 tripwire): without
        // the two appends below the projection would never leave `freeze`.
        try {
          actor?.send({ type: "replay_abandoned" } as never);
        } catch {
          // Defensive — see broadcastFreeze.
        }
        this.abandoned.delete(flow_id);
        if (isJ002 && actor) {
          const h = harvestSettledFreezeState(actor);
          await this.deps.eventLog.append(flow_id, {
            ts: new Date().toISOString(),
            type: "replay_abandoned",
            payload: {
              last_live_state: h.last_live_state,
              // The originating user-action(s) preserved for re-issue.
              abandoned_intents: drained.map((d) => ({
                type: d.type,
                payload: d.payload,
                correlation_id: d.correlation_id,
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

      // ---- Successful THAW ------------------------------------------------
      try {
        actor?.send({ type: "THAW" } as never);
      } catch {
        // Defensive — see broadcastFreeze.
      }
      // THAW returns the machine to `last_live_state`. When that state is
      // an invoke-driven transient (resuming_session / switching_project /
      // switching_dataset_context / creating_session / loading_session_list
      // — all `reenter:true`) the invoke re-runs with the fresh post-
      // re-auth credential (US-210 Example 1 "the transcript-load fires
      // again"). Wait for it to settle so the emission below observes the
      // final state, not the transient.
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
        // Emission-completeness for the history-target re-entry — ONLY
        // when `last_live_state` was an invoke-driven transient that
        // actually re-ran on THAW (reenter:true). For a non-transient
        // freeze (e.g. session_list_loaded / project_selected — US-210
        // Example 5, IC-J002-6) the `*_thawed` reducer alone restores the
        // state; emitting a terminal here would be wrong AND, for
        // project-context, would re-broadcast project_ready and clobber a
        // freshly-thawed session-chat (no switch occurred — nothing to
        // re-announce). The replayed queued intents below carry their own
        // full emission via send().
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
          await this.appendSessionChatTerminalEvents(
            flow_id,
            settledState,
            h.correlation_id,
            h.last_live_state ?? undefined,
            harvestSettledSessionChatState(actor),
          );
        } else if (
          machine === PROJECT_CONTEXT_WIRE_NAME &&
          PC_TRANSIENTS.has(h.last_live_state ?? "")
        ) {
          await this.appendProjectContextThawTerminal(
            flow_id,
            actor,
            settledState,
            h.correlation_id,
          );
        }
      }

      // Replay queued intents in arrival order (FIFO). Each call passes
      // BACK through `send()` — `frozen` no longer carries this flow_id so
      // they dispatch normally with full emission. After each, harvest the
      // DWD-7 stale-intent counter: if the machine silent-dropped the
      // replayed intent (target no longer resolves post-THAW) emit the
      // observability-only `stale_intent_dropped_after_thaw` (no UX).
      for (const queued of drained) {
        const before = actor
          ? harvestSettledFreezeState(actor).stale_intents_dropped_count
          : 0;
        await this.send(queued);
        if (isJ002 && actor) {
          const after = harvestSettledFreezeState(actor);
          if (after.stale_intents_dropped_count > before) {
            await this.deps.eventLog.append(flow_id, {
              ts: new Date().toISOString(),
              type: "stale_intent_dropped_after_thaw",
              payload: {
                intent_type: after.last_stale_intent?.intent_type ?? queued.type,
                target_id: after.last_stale_intent?.target_id ?? "",
              },
              correlation_id: queued.correlation_id,
            });
          }
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
   * Detect whether a snapshot has an active silent-reauth invocation. We
   * read the XState v5 snapshot's `children` map — when an actor invokes
   * an actor named `silentReauth`, a child entry appears with that key.
   * If absent (or the actor was constructed without a silentReauth dep),
   * the orchestrator falls through immediately rather than blocking on a
   * never-resolving promise.
   */
  private hasSilentReauthInvoke(snapshot: unknown): boolean {
    const snap = snapshot as { children?: Record<string, unknown> } | null;
    const children = snap?.children;
    if (!children || typeof children !== "object") return false;
    return Object.keys(children).some((key) => key.startsWith("0.expired_token"));
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
    if (!MACHINE_REGISTRY[input.machine]) {
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

  /**
   * Reset ALL per-flow orchestrator tracking for a flow whose actor +
   * event log were just reset (begin / force_restart). The actor, log,
   * AND the in-memory trackers are one unit: a fresh flow must not inherit
   * the prior flow's `priorState` (used to distinguish eager-create from
   * resume on `session_active` — a stale `session_welcome` here makes a
   * replayed THAW resume emit `session_active_reached` with a null
   * session_id), nor a stale `frozen` / `abandoned` entry. This closes a
   * cross-flow contamination latent before MR-6 and surfaced by the
   * freeze/thaw replay path (the shared dev-user-001 principal reuses
   * flow_ids across scenarios).
   */
  private resetFlowTracking(flow_id: string): void {
    this.priorState.delete(flow_id);
    this.frozen.delete(flow_id);
    this.abandoned.delete(flow_id);
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
 * Mint a synthetic JWT carrying the org_id claim. The ui-state tier does
 * NOT sign tokens cryptographically — that is auth-proxy's job per ADR-016.
 * This routine composes a JWT-shaped string whose payload encodes the
 * org_id so projection consumers (FE + TS harness) can read the claim
 * without an additional API call. The "sig" segment is a stable placeholder.
 *
 * Per ADR-029 invariant 4: the projection's access_token MUST carry the
 * same org_id as the projection's org.id.
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
    // J-001: authenticating, creating_org. J-002 project-context:
    // resolving_initial_scope, creating_project, switching_project (MR-4 —
    // the `switchProject` invoke; D-MR4-06: this was previously missing, so
    // `send()` did not await the switch and the projection never settled).
    // J-002 session-chat: loading_session_list, resuming_session,
    // switching_dataset_context (MR-5 — the `switchDatasetContext` invoke;
    // GET /api/datasets/:id + PATCH session.active_dataset_id. Mirrors the
    // D-MR4-06 fix for switching_project: omitting it here would make
    // `send()` NOT await the invoke, so the projection would stay stuck at
    // switching_dataset_context and the resource_* update never settle).
    const TRANSIENT_STATES = new Set([
      "authenticating",
      "creating_org",
      "resolving_initial_scope",
      "creating_project",
      "switching_project",
      "loading_session_list",
      "resuming_session",
      "creating_session",
      "switching_dataset_context",
    ]);
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
