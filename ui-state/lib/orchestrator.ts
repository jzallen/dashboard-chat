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
} from "./machines/login-and-org-setup.ts";
import {
  createProjectContextMachine,
  type ProjectContextMachineDeps,
} from "./machines/project-context.ts";
import {
  createSessionChatMachine,
  type SessionChatMachineDeps,
} from "./machines/session-chat.ts";
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

export interface OrchestratorDeps {
  eventLog: FlowEventLog;
  loginMachineDeps: LoginMachineDeps;
  /**
   * Deps for the J-002 project-context machine (DWD-13 §2A; previously named
   * `projectFlowMachineDeps` against the unsplit `project-and-chat-session-management`
   * machine). Optional so legacy J-001-only deployments can construct the
   * orchestrator without wiring J-002 (the `j001_ready` hook becomes a no-op
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

/** Narrow snapshot context shape consumed by session-chat event emitters. */
interface SessionChatSnapshotContext {
  org_id?: string;
  project_id?: string | null;
  project_name?: string | null;
  session_list?: Array<{
    id: string;
    title: string | null;
    last_active_at: string;
    active_dataset_id: string | null;
  }>;
  session_list_next_cursor?: string | null;
  session_list_has_more?: boolean;
  session_id?: string | null;
  transcript?: Array<{
    id: string;
    role: "user" | "assistant" | "tool";
    content: string;
    ts: string;
  }>;
  resource?: { type: ResourceType | null; id: string | null };
  intent_session_id?: string | null;
  intent_resource_id?: string | null;
  intent_resource_type?: ResourceType | null;
  underlying_cause_tag?: string | null;
  /** US-206 composer-state preservation context field; read by the
   *  error_recoverable emission so the FlowEvent log carries the
   *  retained composer text. */
  pending_first_message?: string;
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
   * begun via `beginIfNotStarted` from the j001_ready broadcast hook.
   */
  async begin(input: BeginFlowInput): Promise<FlowProjection> {
    if (!MACHINE_REGISTRY[input.machine]) {
      throw new Error(`Unknown machine: ${input.machine}`);
    }

    // J-002 and other machines are spawned via beginIfNotStarted (called by
    // the j001_ready broadcast hook) — direct `begin` posts for those would
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

  /**
   * Idempotently spawn a flow's actor if not already running.
   *
   * Per DWD-6 + DWD-13: the orchestrator owns cross-machine entry. Sibling
   * machines never import each other — entry flows through this method
   * called from the orchestrator's transition watcher. Two broadcast hooks
   * call this:
   *   - `j001_ready` (login → project-context) — passes `org_id` +
   *     `user_first_name`; this method forwards a `j001_ready` event to the
   *     spawned actor so the project-context machine's resolveInitialScope
   *     invoke fires with a populated org_id.
   *   - `project_ready` (project-context → session-chat) — passes `org_id`
   *     + `project_id` + `project_name` + intent_* deep-link fields; this
   *     method forwards a `project_ready` event to the spawned session-chat
   *     actor so it can transition out of `waiting_for_project` (MR-2+) and
   *     consume any forwarded deep-link intents per DESIGN §3.4.
   */
  async beginIfNotStarted(input: {
    machine: string;
    principal_id: string;
    correlation_id: string;
    // `j001_ready` payload (project-context dispatch):
    org_id?: string;
    user_first_name?: string;
    // `project_ready` payload (session-chat dispatch — DWD-13 §3.2.B):
    project_id?: string;
    project_name?: string;
    intent_session_id?: string | null;
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

    // Which broadcast hook is this — j001_ready (project-context) or
    // project_ready (session-chat)? Inspect machine + payload to dispatch
    // the right event shape on (re-)spawn.
    const isProjectReadyDispatch =
      input.machine === SESSION_CHAT_WIRE_NAME &&
      typeof input.project_id === "string";
    const isJ001ReadyDispatch =
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
    }

    if (this.actors.has(flow_id)) {
      // Already spawned. Idempotency: re-forward the appropriate event so
      // the existing actor observes the latest payload (the machine ignores
      // events it has already absorbed; session-chat re-applies its
      // `project_ready` guard, project-context's `j001_ready` is a no-op
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
            intent_session_id: input.intent_session_id ?? null,
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
        } else if (isJ001ReadyDispatch && actor) {
          actor.send({
            type: "j001_ready",
            org_id: input.org_id!,
            user_first_name: input.user_first_name!,
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
        user_first_name: input.user_first_name,
        project_id: input.project_id,
        project_name: input.project_name,
        intent_session_id: input.intent_session_id,
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
          intent_session_id: input.intent_session_id ?? null,
          intent_resource_id: input.intent_resource_id ?? null,
          intent_resource_type: input.intent_resource_type ?? null,
        } as never);
      } catch {
        // Defensive.
      }
    } else if (isJ001ReadyDispatch) {
      try {
        actor.send({
          type: "j001_ready",
          org_id: input.org_id!,
          user_first_name: input.user_first_name!,
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

    // Persist a j002_resolution_started + terminal-for-now event so the
    // projection-builder can reconstruct state from the event log alone.
    const snapshot = actor.getSnapshot();
    const stateValue = snapshot.value as string;
    const ctx = snapshot.context as {
      org_id?: string;
      user_first_name?: string | null;
      project?: { id: string | null; name: string | null };
      underlying_cause_tag?: string | null;
      pending_project_name?: string;
      project_validation_error?: { kind: string; message: string } | null;
      most_recent_session_per_project?: Record<string, string>;
      last_used_degraded_project_ids?: string[];
    };

    // Initial event — marks the J-002 actor as started for projection consumers.
    await this.deps.eventLog.append(flow_id, {
      ts: new Date().toISOString(),
      type: "j002_resolution_started",
      payload: {
        org_id: ctx.org_id ?? input.org_id ?? "",
        user_first_name: ctx.user_first_name ?? input.user_first_name ?? null,
        correlation_id: input.correlation_id,
      },
      correlation_id: input.correlation_id,
    });

    // OQ-J002-5: when resolveInitialScope's invoke captured one or more 5xx
    // failures on list_sessions, emit the degraded event so projection
    // consumers can surface a banner / metric. Emitted BEFORE the terminal
    // event so the projection reducer sees them in causal order.
    const degradedIds = ctx.last_used_degraded_project_ids ?? [];
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
    if (stateValue === "no_projects_empty_state") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "no_projects_displayed",
        payload: {
          org_id: ctx.org_id ?? input.org_id ?? "",
          user_first_name: ctx.user_first_name ?? input.user_first_name ?? null,
        },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "project_selected") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "project_selected",
        payload: {
          org_id: ctx.org_id ?? input.org_id ?? "",
          project: ctx.project,
          most_recent_session_per_project:
            ctx.most_recent_session_per_project ?? {},
        },
        correlation_id: input.correlation_id,
      });

      // ---- project_ready broadcast hook (DWD-13 §3.2.B; NEW per MR-1.5) ----
      // When project-context settles in `project_selected` on initial spawn,
      // broadcast `project_ready` to session-chat (idempotent spawn). The
      // hook mirrors the existing j001_ready pattern below in `send()` —
      // see also the `send()`-side branch for the project-switch re-entry
      // path (MR-4 lifts `switching_project → project_selected`, which also
      // needs to re-broadcast).
      await this.maybeFireProjectReady(
        flow_id,
        input.principal_id,
        input.correlation_id,
        ctx,
      );
    } else if (stateValue === "scope_mismatch_terminal") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "scope_mismatch_displayed",
        payload: {
          org_id: ctx.org_id ?? input.org_id ?? "",
          underlying_cause_tag: ctx.underlying_cause_tag ?? "cross_tenant",
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
   * transition succeeds regardless. Matches the j001_ready hook's resilience
   * stance (orchestrator.ts:611-618 pre-split lineage).
   */
  private async maybeFireProjectReady(
    originFlowId: string,
    principal_id: string,
    correlation_id: string,
    ctx: {
      org_id?: string;
      project?: { id: string | null; name: string | null };
      intent_session_id?: string | null;
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
        intent_session_id: ctx.intent_session_id ?? null,
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
    const snapshot = actor.getSnapshot();
    const stateValue = snapshot.value as string;
    const ctx = snapshot.context as SessionChatSnapshotContext;
    const orgId = ctx.org_id || spawn.org_id || "";
    const projectId = ctx.project_id || spawn.project_id || null;
    if (!orgId || !projectId) return;

    // Per DWD-13 §2B the session-chat flow's log carries the
    // `session_chat_project_ready` event as its first marker so the projection
    // reducer knows session-chat has been spawned for this principal.
    await this.deps.eventLog.append(flow_id, {
      ts: new Date().toISOString(),
      type: "session_chat_project_ready",
      payload: {
        org_id: orgId,
        project_id: projectId,
        project_name: ctx.project_name ?? spawn.project_name ?? "",
      },
      correlation_id,
    });

    await this.appendSessionChatTerminalEvents(flow_id, stateValue, ctx, correlation_id);
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
    ctx: SessionChatSnapshotContext,
    correlation_id: string,
    /** Optional: the machine's state value immediately before this settle.
     *  Used to distinguish eager-create from resume on `session_active`
     *  arrival (US-206 vs US-205) so the projection log records the right
     *  event-type. */
    priorState?: string,
  ): Promise<void> {
    if (stateValue === "loading_session_list") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_list_load_started",
        payload: { project_id: ctx.project_id ?? null },
        correlation_id,
      });
      return;
    }
    if (stateValue === "session_list_visible") {
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_list_load_started",
        payload: { project_id: ctx.project_id ?? null },
        correlation_id,
      });
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_list_loaded",
        payload: {
          items: ctx.session_list ?? [],
          next_cursor: ctx.session_list_next_cursor ?? null,
          has_more: ctx.session_list_has_more ?? false,
        },
        correlation_id,
      });
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_list_displayed",
        payload: {
          project_id: ctx.project_id ?? null,
          session_count: (ctx.session_list ?? []).length,
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
          session_id: ctx.intent_session_id ?? ctx.session_id ?? null,
        },
        correlation_id,
      });
      return;
    }
    if (stateValue === "session_active") {
      // US-206 vs US-205 path distinction: an eager-create landing in
      // session_active came from session_active_no_messages (via the
      // creating_session_eagerly invoke). Use the prior-state hint to emit
      // `session_active_reached` instead of `session_resumed`. Functionally
      // both events project to state=session_active; the distinct names
      // keep the event log auditable for "did this row come from a
      // resume or an eager-create?" queries.
      if (priorState === "session_active_no_messages") {
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
      // `dataset_unavailable` is TRUE only when the resume actor detected a
      // stored active_dataset_id that 404'd (graceful degradation per US-205
      // Example 3). A null active_dataset_id is the conversational-mode
      // default — NOT a degraded state. The machine signals the degraded
      // case by setting underlying_cause_tag = "dataset_not_found".
      const datasetUnavailable =
        ctx.underlying_cause_tag === "dataset_not_found";
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_resumed",
        payload: {
          session_id: ctx.session_id,
          transcript: ctx.transcript ?? [],
          resource_type: ctx.resource?.type ?? null,
          resource_id: ctx.resource?.id ?? null,
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
    if (stateValue === "session_active_no_messages") {
      // US-206: emit `session_welcome_displayed` so the projection reducer
      // surfaces the welcome state to consumers. session_id stays null.
      // Carry pending_first_message so the projection reducer preserves the
      // composer text when re-entering from `retry_clicked` — the machine
      // already holds it in context across that transition (app-arch §6.4).
      await this.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "session_welcome_displayed",
        payload: {
          project_id: ctx.project_id ?? null,
          pending_first_message: ctx.pending_first_message ?? "",
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
          pending_first_message: ctx.pending_first_message ?? "",
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
    const snapshot = actor.getSnapshot();
    const stateValue = snapshot.value as string;
    const principal_id = parsePrincipal(input.flow_id);

    // ---- Cross-machine FREEZE/THAW signaling (Step 03-01, ADR-028) -------
    // When the origin flow transitions INTO expired_token, broadcast FREEZE
    // to all siblings. When it transitions OUT of expired_token (back to
    // ready after silent reauth ok, or to error_recoverable after reauth
    // failure), broadcast THAW.
    const prior = this.priorState.get(input.flow_id);
    if (stateValue === "expired_token" && prior !== "expired_token") {
      this.broadcastFreeze(input.flow_id);
    } else if (
      prior === "expired_token" &&
      (stateValue === "ready" || stateValue === "error_recoverable")
    ) {
      await this.broadcastThaw(input.flow_id);
    }
    this.priorState.set(input.flow_id, stateValue);
    // ---- End freeze/thaw signaling --------------------------------------

    if (stateValue === "ready" && input.machine === "login-and-org-setup") {
      const orgCtx = (snapshot.context as { org: { id: string | null; name: string | null } }).org;
      const userCtx = (snapshot.context as { user: { email: string | null; display_name: string | null } }).user;
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

      // ---- j001_ready broadcast hook (DWD-6 + DWD-13 RD1) ----------------
      // When J-001 transitions creating_org → ready (NOT the
      // expired_token → ready recovery path), broadcast to project-context
      // so it spawns + receives the inherited org_id + user_first_name. This
      // mechanically retires the "second source of truth" risk Praxis F-5
      // named (the org_id flows J-001 → orchestrator → project-context
      // directly, never via a separate fetch). The project-context spawn's
      // post-settle `project_selected` branch fires the NEW `project_ready`
      // hook (DWD-13 §3.2.B) that spawns session-chat in turn.
      const isFirstReady = prior === "creating_org" || prior === "anonymous" || !prior;
      if (isFirstReady && this.deps.projectContextMachineDeps && orgCtx.id) {
        const firstName = (userCtx.display_name ?? "").split(/\s+/)[0] || null;
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
            event_kind: "j001_ready_hook.failed",
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

    // ---- project-context terminal-for-now event appending ----------------
    // The project-context machine's events do not share J-001's state names, so
    // the existing branches above don't fire for it. Project a state-specific
    // event into the log so subsequent projection reads can reconstruct.
    // Per DWD-13 the wire name is still `project-and-chat-session-management`;
    // the source-tree splits but the wire-protocol log key + URL prefix stays.
    if (input.machine === PROJECT_CONTEXT_WIRE_NAME) {
      const projectContext = snapshot.context as {
        org_id?: string;
        user_first_name?: string | null;
        project?: { id: string | null; name: string | null };
        underlying_cause_tag?: string | null;
        pending_project_name?: string;
        project_validation_error?: { kind: string; message: string } | null;
        intent_project_id?: string | null;
        intent_session_id?: string | null;
        intent_resource_id?: string | null;
        intent_resource_type?: ResourceType | null;
      };

      // When the incoming event is `open_deep_link`, also append a
      // `deep_link_opened` projection event so the projection's context
      // carries the intent_* fields (per DWD-9). The projection reducer
      // reads intent_* from this event.
      if (input.type === "open_deep_link") {
        const resolvedScope = {
          org_id: projectContext.org_id ?? "",
          project_id: projectContext.project?.id ?? null,
          resource_type: projectContext.intent_resource_type ?? null,
          resource_id: projectContext.intent_resource_id ?? null,
        };
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "deep_link_opened",
          payload: {
            scope: resolvedScope,
            project: projectContext.project ?? null,
            reconciled: false,
            intent_project_id: projectContext.intent_project_id ?? null,
            intent_session_id: projectContext.intent_session_id ?? null,
            intent_resource_id: projectContext.intent_resource_id ?? null,
            intent_resource_type: projectContext.intent_resource_type ?? null,
          },
          correlation_id: input.correlation_id,
        });
      }

      if (stateValue === "no_projects_empty_state" && projectContext.project_validation_error) {
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "project_validation_failed",
          payload: { error: projectContext.project_validation_error },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "no_projects_empty_state") {
        // Re-resolved into no_projects (e.g., after back_to_projects_clicked).
        // Emit no_projects_displayed so the projection settles correctly.
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "no_projects_displayed",
          payload: {
            org_id: projectContext.org_id ?? "",
            user_first_name: projectContext.user_first_name ?? null,
          },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "creating_project") {
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "project_creation_started",
          payload: { pending_project_name: projectContext.pending_project_name ?? "" },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "project_selected") {
        // Emit `project_selected` (not `project_created`) when this transition
        // is the result of a re-resolve (open_deep_link or back_to_projects_clicked).
        // The projection reducer handles both event types similarly; the
        // distinction is semantic for downstream consumers (a deep-link
        // resolution is not a creation).
        const isFromCreate = input.type === "create_project_submitted";
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: isFromCreate ? "project_created" : "project_selected",
          payload: {
            org_id: projectContext.org_id ?? "",
            project: projectContext.project,
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
          projectContext,
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
              org_id: projectContext.org_id ?? "",
              project: projectContext.project,
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
            org_id: projectContext.org_id ?? "",
            intent_project_id: projectContext.intent_project_id ?? null,
          },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "error_recoverable") {
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "j002_recoverable_error",
          payload: {
            underlying_cause_tag: projectContext.underlying_cause_tag ?? "transient",
            pending_project_name: projectContext.pending_project_name ?? "",
          },
          correlation_id: input.correlation_id,
        });
      } else if (stateValue === "scope_mismatch_terminal") {
        await this.deps.eventLog.append(input.flow_id, {
          ts: new Date().toISOString(),
          type: "scope_mismatch_displayed",
          payload: {
            org_id: projectContext.org_id ?? "",
            underlying_cause_tag: projectContext.underlying_cause_tag ?? "cross_tenant",
            intent_project_id: projectContext.intent_project_id ?? null,
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
      const sessionChatCtx = snapshot.context as SessionChatSnapshotContext;
      // Special-case: if the resumeSession resolved with session_not_found
      // (silent return), the machine has settled in session_list_visible.
      // The default state-emission path covers that; no special event needed.
      // For session_not_found the test expects underlying_cause_tag to NOT
      // surface — we emit `session_resume_not_found` so the projection
      // reducer can blank out intent_session_id atomically.
      if (
        input.type === "session_clicked" &&
        stateValue === "session_list_visible"
      ) {
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
          sessionChatCtx,
          input.correlation_id,
          // `prior` captured at the top of send() — the state BEFORE the
          // current event was dispatched. Used to distinguish eager-create
          // from resume on `session_active` arrival.
          prior,
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
  broadcastFreeze(originFlowId: string): void {
    const now = Date.now();
    for (const [flow_id, actor] of this.actors.entries()) {
      if (flow_id === originFlowId) continue;
      // Mark frozen at the orchestrator level — `send()` consults this to
      // decide whether to forward or queue.
      if (!this.frozen.has(flow_id)) {
        this.frozen.set(flow_id, {
          frozenAt: now,
          origin: originFlowId,
          queued: [],
        });
      }
      // Also notify the actor — machines may extend behavior on FREEZE in
      // a later step (e.g. pause polling). Today this is a no-op for the
      // login machine, which is intentional — ADR-028 §"No machine imports
      // another machine" keeps the signal flowing via the orchestrator.
      try {
        actor.send({ type: "FREEZE" } as never);
      } catch {
        // Defensive: a stopped actor would reject the send; ignore.
      }
    }
  }

  /**
   * Broadcast a THAW signal to every previously frozen actor. Queued intent
   * events are replayed in arrival order, unless the flow was abandoned
   * (overflow or 5s timeout) in which case the queue is dropped.
   */
  async broadcastThaw(originFlowId: string): Promise<void> {
    // Snapshot the keys first because draining mutates the map.
    const flowIds = Array.from(this.frozen.keys());
    for (const flow_id of flowIds) {
      const state = this.frozen.get(flow_id);
      if (!state) continue;
      // Origin flows aren't normally in the frozen set (broadcastFreeze
      // skipped them), but defend against future callers.
      if (flow_id === originFlowId) continue;
      // Take the queue off before signalling, so re-entrant sends during
      // replay don't double-up. If abandoned, drop the queue silently.
      const drained = state.queued;
      this.frozen.delete(flow_id);
      const abandoned = this.abandoned.has(flow_id);
      try {
        const actor = this.actors.get(flow_id);
        if (actor) {
          actor.send({ type: "THAW" } as never);
        }
      } catch {
        // Defensive — see broadcastFreeze.
      }
      if (abandoned) {
        // Drop the queue and clear the abandonment flag — the flow is now
        // thawed but no replay happens. The persisted event log carries
        // the original attempts so the projection still tells the story.
        this.abandoned.delete(flow_id);
        continue;
      }
      // Replay queued intents in arrival order. Each call passes BACK
      // through `send()` — since `frozen` no longer carries this flow_id,
      // the events are dispatched to the underlying actor normally.
      for (const queued of drained) {
         
        await this.send(queued);
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
    // resolving_initial_scope, creating_project. J-002 session-chat:
    // loading_session_list, resuming_session. Future MRs add
    // switching_project, switching_dataset_context.
    const TRANSIENT_STATES = new Set([
      "authenticating",
      "creating_org",
      "resolving_initial_scope",
      "creating_project",
      "loading_session_list",
      "resuming_session",
      "creating_session_eagerly",
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
