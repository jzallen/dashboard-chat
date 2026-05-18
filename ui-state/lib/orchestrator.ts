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
  type CreateOrgAndReissueInput,
  type LoginMachineDeps,
} from "./machines/login-and-org-setup/index.ts";
import { loginOrgSetupStrategy } from "./machines/login-and-org-setup/strategy.ts";
import {
  type ProjectContextMachineDeps,
} from "./machines/project-context/index.ts";
import { projectContextStrategy } from "./machines/project-context/strategy.ts";
import {
  type SessionChatMachineDeps,
} from "./machines/session-chat/index.ts";
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
 * Canonical machine-name (ADR-039) — the FlowStrategy registry key used by
 * the D5 migration alias map. (`login-and-org-setup`'s + `session-chat`'s
 * canonical-name consts now live with their carved strategies at
 * machines/<machine>/strategy.ts — LEAF-3 N2 / N12; the project-context
 * alias still references this one.)
 */
const PROJECT_CONTEXT_MACHINE = "project-context";

/**
 * ADR-040 §D2 / LEAF-3 — the capability surface the generic pump offers a
 * `FlowStrategy`. The pump RETAINS actor-system ownership & spawn lifecycle
 * (ADR-040 §D2 / leaf-3-plan §3 stays-central): a strategy never owns the
 * actor map — it asks the pump to recycle/track actors and to resolve the
 * projection. `deps` is the same `OrchestratorDeps` the pump holds. This is
 * the seam through which the carved login `beginDirect` / `settle` bodies
 * reach pump-central machinery without the strategy importing the pump.
 */
export interface PumpContext {
  readonly deps: OrchestratorDeps;
  /** Stop+forget any existing actor for this flow (begin re-click reset:
   *  the persisted event log is the SoT, the actor is a process cache). */
  recycleActor(flow_id: string): void;
  /** Register a freshly created+started actor under its flow_id. */
  trackActor(flow_id: string, actor: AnyActorRef): void;
  /** Reset per-flow tracking (priorState/frozen/abandoned) — one unit with
   *  the actor+log reset. */
  resetFlowTracking(flow_id: string): void;
  logTransition(record: Record<string, unknown>): void;
  projectionFor(
    flow_id: string,
    principal_id: string,
    correlation_id: string,
  ): Promise<FlowProjection>;
}

/**
 * Pump-computed inputs handed to `FlowStrategy.settle` so the strategy never
 * reads `actor.getSnapshot().context` directly (ADR-030 LEAF-D / AMB-1: the
 * sanctioned snapshot boundary is the `harvestSettled*` family, which the
 * strategy calls itself; the settled state-VALUE and the live projection
 * context are pump-read and passed in).
 */
export interface SettleContext {
  /** Settled state-value (pump-read; never the strategy reading .context). */
  readonly stateValue: string;
  /** Prior tracked state for this flow at entry to the settle block —
   *  drives silent-reauth-recovery + first-ready detection. */
  readonly prior: string | undefined;
  /** Live projection context (built from the FlowEvent log by the pump). */
  readonly projectionCtx: {
    org_validation_error: { kind: string; message: string } | null;
  } & Record<string, unknown>;
}

/**
 * What the pump must do CENTRALLY after a strategy's `settle` returns.
 * Cross-machine hook FIRING stays central (ADR-040 §D2 / leaf-3-plan §3 +
 * §4A/§4B): the login `ready` settle emits its own FlowEvent inside
 * `settle`, but the `auth_ready` → spawn-project-context dispatch is
 * cross-machine and is fired by the pump after `settle` returns the
 * `authReady` signal. Symmetrically (leaf-3-plan §4B MR-L3b/N8), the
 * project-context `project_selected` settle emits its own FlowEvents
 * inside `settle`, but the `project_ready` → spawn-session-chat dispatch
 * (`maybeFireProjectReady`) stays pump-fired AFTER `settle` returns the
 * `projectReady` signal. Each strategy's cross-machine signal is an
 * independent optional field on this shared outcome (login → `authReady`,
 * project-context → `projectReady`); the port `settle` SIGNATURE is
 * unchanged (it still returns `Promise<SettleOutcome>`).
 */
export interface SettleOutcome {
  /** Non-null exactly when the login machine reached `ready` for the first
   *  time with a resolved org — the pump then fires
   *  `beginIfNotStarted(PROJECT_CONTEXT…)` (cross-machine dispatch). */
  authReady?: { org_id: string; user_first_name: string } | null;
  /** Non-null exactly when project-context settled in `project_selected`
   *  on a `send()` path — the pump then fires `maybeFireProjectReady`
   *  (cross-machine dispatch to session-chat). Carries the exact
   *  pre-carve `maybeFireProjectReady` 4th-arg shape. */
  projectReady?: {
    org_id?: string;
    project?: { id: string | null; name: string | null };
    deeplink_session_id?: string | null;
    intent_resource_id?: string | null;
    intent_resource_type?: ResourceType | null;
  } | null;
}

/**
 * ADR-040 §D1/§D5 — the `FlowStrategy` port. The orchestrator dispatch fork
 * resolves a machine to its strategy through the registry instead of a
 * hardcoded `if (input.machine === "…")` conditional table (the legacy
 * machine-factory record per DWD-8, now retired). LEAF-1 carved the
 * machine-RESOLUTION fork onto `machineName`/`beginsDirectly`/`buildMachine`.
 *
 * LEAF-3 (N0/N1, AMB-2 RATIFIED 2026-05-18) GROWS the port with the typed
 * begin/event/settle members below. They are OPTIONAL through the LEAF-3
 * migration: only the machine carved by the current MR implements them
 * (MR-L3a = login). The pump still inlines the project-context/session-chat
 * branches until MR-L3b/MR-L3c carve them (leaf-3-plan §7 scope-fence). The
 * member NAMES + signatures are design-locked here (N0); MR-L3b/c only fill
 * in `ProjectContextStrategy`/`SessionChatStrategy` impls.
 */
export interface FlowStrategy {
  /** Canonical machine-name (ADR-039) — the registry key. Never a flow-id
   *  (`<machine-name>:<principal_id>` per ADR-030 §6 is an instance id,
   *  explicitly rejected as the dispatch key — ADR-040 D5). */
  readonly machineName: string;
  /** Begin-semantics discriminator (ADR-040 D2). `login-and-org-setup` runs
   *  the direct WorkOS begin body (`beginDirect`); the J-002 machines are
   *  spawned via the cross-machine broadcast hook (`beginIfNotStarted`). */
  readonly beginsDirectly: boolean;
  /** Machine definition (ADR-040 D2): construct the XState machine for this
   *  flow from the orchestrator deps. */
  buildMachine(
    deps: OrchestratorDeps,
    input: { correlation_id: string; principal_id: string; existing_org_names?: string[] },
  ): AnyStateMachine;

  // ── ADR-040 §D2 LEAF-3 carved members (port grown N1; design-locked N0).
  //    Optional through the migration — see interface doc. ──

  /** Direct begin body (ADR-040 §D2 begin-semantics). Carved for login in
   *  MR-L3a/N2: the pump calls this when `beginsDirectly`. */
  beginDirect?(pump: PumpContext, input: BeginFlowInput): Promise<FlowProjection>;
  /** Pre-settle event→transition emission (ADR-040 §D2 event→transition).
   *  Login has none (no-op); project/session carved MR-L3b/c. */
  applyEvent?(
    pump: PumpContext,
    actor: AnyActorRef,
    input: SendEventInput,
  ): Promise<void>;
  /** Post-settle terminal emission (ADR-040 §D2 settle = the typed emit
   *  obligation). Carved for login in MR-L3a/N3. Returns the central
   *  cross-machine hook signal (firing stays in the pump). */
  settle?(
    pump: PumpContext,
    actor: AnyActorRef,
    input: SendEventInput,
    ctx: SettleContext,
  ): Promise<SettleOutcome>;
  /** Spawn-time terminal emission (`beginIfNotStarted`). Login is never
   *  spawned (it is the only `beginsDirectly` machine) → no-op (MR-L3a/N4).
   *  project/session carved MR-L3b/c. */
  settleSpawn?(
    pump: PumpContext,
    actor: AnyActorRef,
    input: { machine: string; principal_id: string; correlation_id: string },
  ): Promise<void>;
  /** Per-frozen-flow FREEZE emission tail (the broadcast LOOP stays central
   *  per ADR-040 §D2 / AMB-3). Login has no FREEZE handler → no-op
   *  (MR-L3a/N4). */
  settleFreeze?(
    pump: PumpContext,
    actor: AnyActorRef,
    flow_id: string,
  ): Promise<void>;
  /** Per-frozen-flow THAW emission tail (broadcast LOOP stays central).
   *  Login has no FREEZE handler → no-op (MR-L3a/N4). */
  settleThaw?(
    pump: PumpContext,
    actor: AnyActorRef,
    flow_id: string,
    kind: "thaw" | "abandoned",
  ): Promise<void>;
  /** Deep-link re-resolve emission (`appendDeepLinkEvents`). Login has none
   *  → no-op (MR-L3a/N4); project carved MR-L3b. */
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

/** Thrown on a registry miss. The HTTP edge maps this to a clean 404
 *  (ADR-040 Consequences: "unknown-machine becomes a clean 404, no
 *  conditional fall-through"). The message is preserved verbatim from the
 *  legacy `throw new Error("Unknown machine: …")` so non-HTTP callers see
 *  no behavior delta. */
export class UnknownMachineError extends Error {
  constructor(public readonly machine: string) {
    super(`Unknown machine: ${machine}`);
    this.name = "UnknownMachineError";
  }
}

/**
 * Registry-level migration-safe alias map (ADR-040 §D5): a legacy wire
 * segment is canonicalized to its machine-name before lookup so the J-002
 * acceptance suite (which drives the legacy feature-slug) stays
 * byte-behavior-identical through the migration. The registry KEY stays
 * canonical (D5); this is purely name canonicalization. The HTTP-routing
 * `app.route` alias mounts are a separate, later concern (LEAF-2).
 */
const MACHINE_NAME_ALIASES: Readonly<Record<string, string>> = {
  [PROJECT_CONTEXT_WIRE_NAME]: PROJECT_CONTEXT_MACHINE,
};

/**
 * ADR-040 §D1/§D5 — the explicit static `FlowStrategy` registry, keyed by
 * canonical machine-name. Adding a future flow is one new strategy
 * registration — no `if/else`. `get` is the strict canonical-key lookup
 * (flow-id / unknown / legacy-slug all miss); `resolve` is the dispatch
 * entry that additionally applies the D5 migration alias and throws
 * `UnknownMachineError` on a miss.
 */
class FlowStrategyRegistry {
  private readonly strategies = new Map<string, FlowStrategy>();

  register(strategy: FlowStrategy): void {
    this.strategies.set(strategy.machineName, strategy);
  }

  /** Strict canonical-key lookup. flow-id / unknown / legacy-slug -> undefined. */
  get(machineName: string): FlowStrategy | undefined {
    return this.strategies.get(machineName);
  }

  canonicalNames(): string[] {
    return [...this.strategies.keys()];
  }

  /** Dispatch entry: canonicalize via the D5 alias map, then look up.
   *  Throws `UnknownMachineError` on a miss (no conditional fall-through). */
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

// ADR-040 LEAF-3 MR-L3a/N2: the login strategy is now the carved
// `loginOrgSetupStrategy` impl (co-located at machines/login-and-org-setup/
// strategy.ts per AMB-2). It owns `machineName`/`beginsDirectly`/
// `buildMachine` AND the carved `beginDirect` body. Registration is
// unchanged in semantics — same canonical key, same beginsDirectly.
FLOW_STRATEGY_REGISTRY.register(loginOrgSetupStrategy);

// ADR-040 LEAF-3 MR-L3b/N6: the project-context strategy is now the carved
// `projectContextStrategy` impl (co-located at machines/project-context/
// strategy.ts per AMB-2). It owns `machineName`/`beginsDirectly`/
// `buildMachine` AND the carved `settleSpawn` body (N6); N7–N10 carve the
// remaining members. Registration is unchanged in semantics — same
// canonical key, same beginsDirectly, same buildMachine guard.
FLOW_STRATEGY_REGISTRY.register(projectContextStrategy);

// ADR-040 LEAF-3 MR-L3c/N12: the session-chat strategy is now the carved
// `sessionChatStrategy` impl (co-located at machines/session-chat/
// strategy.ts per AMB-2). It owns `machineName`/`beginsDirectly`/
// `buildMachine` AND the carved `settleSpawn` body (N12); N13–N15 carve
// the remaining members (`applyEvent`/`settle`/`settleFreeze`/
// `settleThaw`). Registration is unchanged in semantics — same canonical
// key (`session-chat`), same `beginsDirectly: false`, same buildMachine
// (`createSessionChatMachine(deps.sessionChatMachineDeps ?? {})`).
// Session-chat (DWD-13 §2B) is spawned exclusively via the orchestrator's
// `project_ready` broadcast hook (project-context → `project_selected`
// entry); direct `/begin` HTTP posts route here through
// `beginIfNotStarted` but the resulting actor remains in
// `waiting_for_project` until the orchestrator forwards a `project_ready`
// event with the resolved project_id.
FLOW_STRATEGY_REGISTRY.register(sessionChatStrategy);

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
  /** Queued events waiting for thaw. Bounded to REPLAY_BUFFER_CAP. Each
   *  carries a process-global monotonic `seq` so THAW can replay across
   *  ALL frozen flows in true arrival order (DD-4 / scenario 3+6: the
   *  switching_project intent on project-context and the session_clicked
   *  on session-chat are queued on SEPARATE per-flow buffers but must
   *  replay in the order Maya actually clicked). */
  queued: Array<{ input: SendEventInput; seq: number }>;
}

export class FlowOrchestrator implements PumpContext {
  private readonly actors = new Map<string, AnyActorRef>();
  /** Per-flow freeze state. Absent key = flow is not frozen. */
  private readonly frozen = new Map<string, FrozenFlowState>();
  /** Per-flow abandonment state. Set when the replay buffer overflows or
   *  the 5-second freeze window elapses with events still queued. */
  private readonly abandoned = new Set<string>();
  /** Per-flow prior state, used to detect transitions out of expired_token
   *  so the orchestrator can broadcast THAW once silent reauth settles. */
  private readonly priorState = new Map<string, string>();
  /** Process-global monotonic counter stamped on every intent queued
   *  during a freeze window — the cross-flow FIFO key for THAW replay. */
  private replaySeq = 0;

  constructor(readonly deps: OrchestratorDeps) {}

  // ── PumpContext seam (ADR-040 §D2 / leaf-3-plan §3) ──────────────────
  // The pump RETAINS actor-system ownership & spawn lifecycle: carved
  // strategies never touch the actor map directly — they ask the pump to
  // recycle/track actors. These are the exact lifecycle ops the inlined
  // `begin` body performed, behavior-identical.

  /** Stop+forget any existing actor for this flow (begin re-click reset). */
  recycleActor(flow_id: string): void {
    const existing = this.actors.get(flow_id);
    if (existing) {
      existing.stop();
      this.actors.delete(flow_id);
    }
  }

  /** Register a freshly created+started actor under its flow_id. */
  trackActor(flow_id: string, actor: AnyActorRef): void {
    this.actors.set(flow_id, actor);
  }

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
    const strategy = FLOW_STRATEGY_REGISTRY.resolve(input.machine);

    // J-002 and other machines are spawned via beginIfNotStarted (called by
    // the auth_ready broadcast hook) — direct `begin` posts for those would
    // bypass the cross-machine entry contract. Allow them only when the
    // existing flow is already started (idempotent no-op).
    if (!strategy.beginsDirectly) {
      return this.beginIfNotStarted({
        machine: input.machine,
        principal_id: input.principal_id,
        correlation_id: input.correlation_id,
      });
    }

    // ADR-040 LEAF-3 MR-L3a/N2: the direct WorkOS+org-create begin body is
    // CARVED into LoginOrgSetupStrategy.beginDirect (machines/login-and-org-
    // setup/strategy.ts). The pump retains actor-system ownership & spawn
    // lifecycle (§3 stays-central) and is reached by the strategy through
    // the PumpContext seam (`this`). Behavior-neutral: same FlowEvents,
    // same order. `beginDirect` is present whenever `beginsDirectly` (login
    // is the only direct machine); the guard is defensive — unreachable for
    // the registered login strategy.
    if (!strategy.beginDirect) {
      throw new Error(
        `strategy '${strategy.machineName}' is beginsDirectly but has no beginDirect impl`,
      );
    }
    return strategy.beginDirect(this, input);
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
    const strategy = FLOW_STRATEGY_REGISTRY.resolve(input.machine);
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
          //
          // ADR-040 LEAF-3 MR-L3c/N12: the session-chat spawn emission
          // (formerly the private `emitSessionChatSpawnEvents`) is CARVED
          // into sessionChatStrategy.settleSpawn. `isProjectReadyDispatch`
          // ⟹ `input.machine === SESSION_CHAT_WIRE_NAME` by its own
          // definition (the cross-machine spawn ROUTING stays pump-central
          // — leaf-3-plan §3 / §4C), so the imported strategy ref IS the
          // resolved strategy here; called exactly where the pre-carve
          // `emitSessionChatSpawnEvents` ran. settleSpawn sources the
          // `project_context_inherited` org/project from the sanctioned
          // harvester (byte-identical to the pre-carve `spawn.*` input on
          // the spawn path — see strategy.ts). Behavior-neutral.
          if (sessionChatStrategy.settleSpawn) {
            await sessionChatStrategy.settleSpawn(this, actor, {
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
    // ADR-040 LEAF-3 MR-L3c/N12: the session-chat spawn terminal-emission
    // arm (formerly the private `emitSessionChatSpawnEvents`:
    // `project_context_inherited` + `appendSessionChatTerminalEvents` +
    // `harvestSettledSessionChatState`) is CARVED into
    // sessionChatStrategy.settleSpawn (machines/session-chat/strategy.ts).
    // The pump RETAINS actor-system ownership/spawn lifecycle AND the
    // cross-machine `project_ready` → session-chat spawn ROUTING
    // (leaf-3-plan §3 / §4C stays-central): session-chat is the spawn-chain
    // TERMINAL — it fires NO onward hook (unlike project-context's
    // `project_ready`), so the pump only calls `settleSpawn` and returns.
    // settleSpawn sources the org/project identity from the sanctioned
    // harvester (byte-identical to the pre-carve `spawn.*` input on the
    // spawn path — see strategy.ts). Behavior-neutral: same FlowEvents,
    // same order; `settle→emit` STILL writes the Redis event-log. The
    // residual `machine ===` dispatch wrapper here is retired in N17 (the
    // residual-pump-cleanup node — mirrors MR-L3b/N6 leaving the pump
    // structure for N17, §7 scope-fence).
    if (input.machine === SESSION_CHAT_WIRE_NAME) {
      if (sessionChatStrategy.settleSpawn) {
        await sessionChatStrategy.settleSpawn(this, actor, {
          machine: input.machine,
          principal_id: input.principal_id,
          correlation_id: input.correlation_id,
        });
      }
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

    // ADR-040 LEAF-3 MR-L3b/N6: the project-context spawn terminal-emission
    // arm (`project_context_resolution_started` / `last_used_resolution_degraded`
    // / `no_projects_displayed` / `project_selected` / `scope_mismatch_displayed`
    // + `harvestSettledProjectContextState`) is CARVED into
    // projectContextStrategy.settleSpawn (machines/project-context/strategy.ts).
    // The pump RETAINS actor-system ownership/spawn lifecycle AND the
    // cross-machine `project_ready` hook FIRING (leaf-3-plan §3 stays-central):
    // `maybeFireProjectReady` is dispatched HERE (cross-machine, to
    // session-chat), mirroring the `auth_ready` hook in `send()`. Because the
    // port-locked `settleSpawn` signature is `Promise<void>`, the pump
    // reproduces the pre-emission hook params byte-for-byte from the SAME
    // settled actor + projection-of-log the carved emission reads (pure,
    // idempotent reads — behavior-neutral). Behavior-neutral: same FlowEvents,
    // same order; `settle→emit` STILL writes the Redis event-log.
    if (!projectContextStrategy.settleSpawn) {
      throw new Error("projectContextStrategy.settleSpawn missing (LEAF-3 N6)");
    }

    // Pre-emission projection-of-log + settled harvest — the cross-machine
    // spawn HOOK plumbing (§3). Identical expressions to the carved emission
    // so the fired `project_ready` payload is byte-for-byte the pre-carve
    // value (the project_selected arm read these BEFORE appending).
    const spawnStateValue = actor.getSnapshot().value as string;
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

    await projectContextStrategy.settleSpawn(this, actor, {
      machine: input.machine,
      principal_id: input.principal_id,
      correlation_id: input.correlation_id,
    });

    // ---- project_ready broadcast hook (DWD-13 §3.2.B; stays pump-central) --
    // When project-context settled in `project_selected` on initial spawn,
    // broadcast `project_ready` to session-chat (idempotent spawn). Fired
    // AFTER the carved settleSpawn emission, exactly as the pre-carve
    // project_selected arm did (emit project_selected, then fire the hook).
    if (spawnStateValue === "project_selected") {
      await this.maybeFireProjectReady(
        flow_id,
        input.principal_id,
        input.correlation_id,
        {
          org_id: spawnSettledOrgId || undefined,
          project: spawnSettledProject,
          deeplink_session_id: spawnProjCtx.deeplink_session_id,
          intent_resource_id: spawnProjCtx.intent_resource_id,
          intent_resource_type: spawnProjCtx.intent_resource_type,
        },
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

  // ADR-040 LEAF-3 MR-L3c/N12: the private `emitSessionChatSpawnEvents`
  // (session-chat spawn terminal-emission) is CARVED into
  // sessionChatStrategy.settleSpawn (machines/session-chat/strategy.ts).
  // Both pre-carve call sites in `beginIfNotStarted` (the idempotency
  // re-broadcast path + the fresh-spawn path) now dispatch
  // `sessionChatStrategy.settleSpawn`; this private is dead and retired
  // with the node that killed its callers (mirrors MR-L3b retiring the
  // carved project-context privates). Behavior-neutral.

  // ADR-040 LEAF-3 MR-L3c/N15: the private `appendSessionChatTerminalEvents`
  // (session-chat terminal-for-now emission) is CARVED into
  // sessionChatStrategy (a module-private helper of
  // machines/session-chat/strategy.ts, called by settleSpawn / settle /
  // settleThaw). Its last orchestrator call site (the broadcastThaw
  // history-target re-entry tail) now dispatches
  // sessionChatStrategy.settleThaw; this private is dead and retired
  // with the node that killed its last caller (mirrors MR-L3b retiring
  // the carved project-context privates). Behavior-neutral.

  // ADR-040 LEAF-3 MR-L3b/N10: the project-context THAW history-target
  // re-entry terminal (formerly the private `appendProjectContextThawTerminal`
  // — MR-6 / US-210 project_switched / scope_mismatch_displayed /
  // project_context_recoverable_error) is CARVED into
  // projectContextStrategy.settleThaw. The pump's broadcastThaw LOOP stays
  // central (AMB-3) and calls strategy.settleThaw per frozen flow; the
  // cross-machine project_ready re-broadcast (maybeFireProjectReady) stays
  // pump-fired AFTER it returns (§3 / §4B). Behavior-neutral.

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
          frozenState.queued.push({ input, seq: this.replaySeq++ });
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
    // ADR-040 LEAF-3 MR-L3b/N7: the project-context pre-settle
    // `switching_project_started` emission is CARVED into
    // projectContextStrategy.applyEvent. Called UNCONDITIONALLY here (the
    // imported strategy ref, mirroring the MR-L3a loginOrgSetupStrategy
    // precedent) at the SAME pre-settle point; the triple guard
    // (machine/type/state) is preserved inside the strategy so non-project
    // / non-switch events fall through as a no-op exactly as before. The
    // session-chat `switching_dataset_context_started` pre-settle stays
    // inlined below (N13 / MR-L3c, §7 scope-fence).
    if (!projectContextStrategy.applyEvent) {
      throw new Error("projectContextStrategy.applyEvent missing (LEAF-3 N7)");
    }
    await projectContextStrategy.applyEvent(this, actor, input);

    // ADR-040 LEAF-3 MR-L3c/N13: the session-chat pre-settle
    // `switching_dataset_context_started` emission (US-209 / MR-5) is
    // CARVED into sessionChatStrategy.applyEvent, called at the SAME
    // pre-settle point (after the project-context applyEvent, BEFORE
    // `waitForSettledState`); the triple guard is preserved INSIDE the
    // strategy so non-switch session-chat events fall through as a no-op
    // exactly as before.
    //
    // The carved call is kept inside the `machine === SESSION_CHAT_WIRE_NAME`
    // wrapper (mirroring N12's settleSpawn wrapper, retired in N17): the
    // pre-carve inline `if (machine===session && …)` ran ZERO awaits for
    // non-session flows, and `index.test.ts`'s SSE projection-stream test
    // is timing-coupled — an extra unconditional `applyEvent` await between
    // the `org_form_submitted` log append and the login settle splits the
    // SSE subscriber's 2nd frame BEFORE the `ready` projection, regressing
    // vitest. The N7 `projectContextStrategy.applyEvent` is the SOLE
    // unconditional pre-settle await the test budget absorbs; this wrapper
    // adds none for login/project. N17's residual-pump cleanup collapses
    // BOTH the N7 unconditional call AND this wrapper into a single
    // `FLOW_STRATEGY_REGISTRY.resolve(input.machine).applyEvent` dispatch
    // (exactly one await = baseline timing → still vitest Δ=0).
    // Behavior-neutral: same FlowEvent, same payload, same pre-settle
    // point, same await count for the fragile login/project paths.
    if (input.machine === SESSION_CHAT_WIRE_NAME) {
      if (!sessionChatStrategy.applyEvent) {
        throw new Error("sessionChatStrategy.applyEvent missing (LEAF-3 N13)");
      }
      await sessionChatStrategy.applyEvent(this, actor, input);
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

    // ADR-040 LEAF-3 MR-L3a/N3: the per-machine login terminal-emission
    // chain (ready / expired_token / error_recoverable /
    // authenticated_no_org) is CARVED into loginOrgSetupStrategy.settle.
    // Called UNCONDITIONALLY here (the imported strategy ref, NOT
    // resolve(input.machine)) so the pre-carve chained-if semantics are
    // byte-preserved: the chain was not fully machine-gated — a non-login
    // flow that settles `error_recoverable` still falls through the shared
    // arm exactly as before (project/session carve = MR-L3b/c, §7
    // scope-fence). The pump retains the cross-machine `auth_ready` spawn
    // hook FIRING (leaf-3-plan §3): settle returns the signal; the pump
    // fires beginIfNotStarted(PROJECT_CONTEXT…) AFTER settle returns. The
    // `&& projectContextMachineDeps` half of the original guard is the
    // pump's; `&&` is order-independent so the combined guard is identical.
    if (!loginOrgSetupStrategy.settle) {
      throw new Error("loginOrgSetupStrategy.settle missing (LEAF-3 N3)");
    }
    const loginSettleOutcome = await loginOrgSetupStrategy.settle(
      this,
      actor,
      input,
      { stateValue, prior, projectionCtx },
    );
    if (
      loginSettleOutcome.authReady &&
      this.deps.projectContextMachineDeps
    ) {
      try {
        await this.beginIfNotStarted({
          machine: PROJECT_CONTEXT_WIRE_NAME,
          principal_id: parsePrincipal(input.flow_id),
          correlation_id: input.correlation_id,
          org_id: loginSettleOutcome.authReady.org_id,
          user_first_name: loginSettleOutcome.authReady.user_first_name,
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

    // ---- project-context terminal-for-now event appending ----------------
    // ADR-040 LEAF-3 MR-L3b/N8: the project-context post-settle terminal
    // emission (the big block: deep_link_opened; no_projects+validation /
    // no_projects / creating_project / project_selected (create vs
    // re-resolve) / switching_project / error_recoverable / scope_mismatch
    // arms + project_switched + harvestSettledProjectContextState) is
    // CARVED into projectContextStrategy.settle. Called UNCONDITIONALLY
    // here (the imported strategy ref, mirroring the MR-L3a
    // loginOrgSetupStrategy precedent) AFTER the login settle + auth_ready
    // hook; the original `if (input.machine === PROJECT_CONTEXT_WIRE_NAME)`
    // guard is preserved INSIDE the strategy so the pre-carve send() chain
    // (login arms — NOT machine-gated — then the machine-gated project
    // block) is byte-preserved. The cross-machine `project_ready` hook
    // FIRING via `maybeFireProjectReady` stays pump-central (leaf-3-plan
    // §3 / §4B): `settle` returns the `projectReady` signal; the pump
    // fires it AFTER (exactly the login `authReady` precedent — the
    // pre-carve project_selected order [project_selected,
    // maybeFireProjectReady, project_switched] becomes [project_selected,
    // project_switched (in settle), maybeFireProjectReady (here)] which is
    // behavior-neutral: disjoint Redis streams, explicit hook params
    // computed pre-append). The session-chat terminal emission below stays
    // inlined (N12-N15 / MR-L3c, §7 scope-fence).
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
    // ---- session-chat terminal-for-now event appending (J-002 MR-2) -------
    // ADR-040 LEAF-3 MR-L3c/N14: the session-chat post-settle terminal
    // emission (the `dataset_attached` / `dataset_access_denied`
    // dataset-switch arm + the `session_clicked` →
    // `session_resume_not_found` special-case + the default
    // `appendSessionChatTerminalEvents` path) is CARVED into
    // sessionChatStrategy.settle. Called AFTER the login settle +
    // auth_ready hook + project-context settle + project_ready hook; the
    // original `if (input.machine === SESSION_CHAT_WIRE_NAME)` guard is
    // preserved INSIDE the strategy (non-session flows return an empty
    // `SettleOutcome`), so the pre-carve send() chain — login arms (NOT
    // machine-gated) → project block (machine-gated) → session block
    // (machine-gated) — is byte-preserved. session-chat is the spawn-chain
    // TERMINAL — it fires NO onward cross-machine hook, so the
    // `SettleOutcome` is always empty (nothing for the pump to fire).
    //
    // The carved call is kept inside the `machine === SESSION_CHAT_WIRE_NAME`
    // wrapper (mirroring N12/N13, retired in N17): the pre-carve inline
    // block ran ZERO awaits for non-session flows, and `index.test.ts`'s
    // SSE projection-stream test is timing-coupled (see N13). N17's
    // residual-pump cleanup converts the login/project/session settle
    // chain to its final generic form. Behavior-neutral: same FlowEvents,
    // same payloads, same order, same await count for the fragile
    // login/project paths.
    if (input.machine === SESSION_CHAT_WIRE_NAME) {
      if (!sessionChatStrategy.settle) {
        throw new Error("sessionChatStrategy.settle missing (LEAF-3 N14)");
      }
      await sessionChatStrategy.settle(this, actor, input, {
        stateValue,
        prior,
        projectionCtx,
      });
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
      // ADR-040 LEAF-3 MR-L3b/N10 + MR-L3c/N15 + AMB-3: the FREEZE
      // broadcast LOOP stays central (this method) per §3 / ADR-040 §D2
      // (the cross-machine broadcaster is the pump's; it cannot belong to
      // one strategy). The per-machine `*_frozen` emission tail is carved
      // to each strategy's `settleFreeze`. The pump pre-gates
      // `J002 && state==="freeze"` (loop bookkeeping — AMB-3) and now
      // dispatches via the resolved strategy (project-context →
      // projectContextStrategy.settleFreeze [MR-L3b/N10]; session-chat →
      // sessionChatStrategy.settleFreeze [the carved `session_chat_frozen`
      // tail, MR-L3c/N15]) — zero per-machine `machine === …` dispatch
      // branch. `FLOW_STRATEGY_REGISTRY.resolve` applies the D5 alias so
      // the project-context wire name resolves correctly.
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
   * Broadcast a THAW signal to every previously frozen actor. Queued intent
   * events are replayed in arrival order, unless the flow was abandoned
   * (overflow or 5s timeout) in which case the queue is dropped.
   */
  async broadcastThaw(
    originFlowId: string,
    reason: "thaw" | "abandoned" = "thaw",
  ): Promise<void> {
    // ── Pass 1: unfreeze + THAW every flow (or abandon it), collecting
    // each flow's drained queue. Replay is deferred to pass 2 so it runs
    // GLOBALLY in true arrival order across flows — DD-4: the
    // switching_project intent (project-context) must replay before the
    // session_clicked (session-chat) even though they sit on separate
    // per-flow buffers, AND every flow must be UNFROZEN first so the
    // project_ready the switch re-broadcasts reaches a live (not frozen,
    // event-dropping) session-chat actor.
    const allDrained: Array<{
      input: SendEventInput;
      seq: number;
      flow_id: string;
    }> = [];
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
          // ADR-040 LEAF-3 MR-L3c/N15 + AMB-3: the THAW broadcast LOOP
          // stays central (this method); the session-chat history-target
          // re-entry terminal (formerly the inline
          // `appendSessionChatTerminalEvents` thaw tail) is carved to
          // sessionChatStrategy.settleThaw. The pump pre-gates
          // `machine === SESSION_CHAT_WIRE_NAME && SC_TRANSIENTS.has` —
          // machine-generic loop bookkeeping retained per §3 / AMB-3
          // (the broadcastThaw loop's own per-flow transient-set gate;
          // NOT a begin/event/settle dispatch branch — the exact
          // project-context settleThaw precedent below). settleThaw
          // re-derives `settledState` / `h` idempotently (byte-identical
          // to the pump's). session-chat is the spawn-chain TERMINAL — it
          // fires NO onward cross-machine re-broadcast (unlike
          // project-context's `project_ready`).
          if (sessionChatStrategy.settleThaw) {
            await sessionChatStrategy.settleThaw(
              this,
              actor,
              flow_id,
              "thaw",
            );
          }
        } else if (
          machine === PROJECT_CONTEXT_WIRE_NAME &&
          PC_TRANSIENTS.has(h.last_live_state ?? "")
        ) {
          // ADR-040 LEAF-3 MR-L3b/N10 + AMB-3: the THAW broadcast LOOP
          // stays central (this method); the project-context
          // history-target re-entry terminal (formerly
          // appendProjectContextThawTerminal) moves to the strategy. The
          // cross-machine `project_ready` re-broadcast via
          // maybeFireProjectReady stays pump-fired AFTER settleThaw
          // returns (leaf-3-plan §3 / §4B) — it was the LAST statement of
          // the project_selected arm, so the order is byte-preserved; the
          // params are re-derived byte-identically (idempotent harvest).
          if (projectContextStrategy.settleThaw) {
            await projectContextStrategy.settleThaw(
              this,
              actor,
              flow_id,
              "thaw",
            );
          }
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

    // ── Pass 2: replay ALL drained intents in true cross-flow arrival
    // order (the `seq` stamped at queue time). Each goes BACK through
    // `send()` — `frozen` no longer carries any of these flow_ids so they
    // dispatch normally with full emission, and a switching_project
    // replay's project_ready re-broadcast now reaches an unfrozen
    // session-chat (DD-4). After each, harvest the DWD-7 stale-intent
    // counter on the intent's OWN flow actor: if the machine silent-
    // dropped it (target no longer resolves post-THAW) emit the
    // observability-only `stale_intent_dropped_after_thaw` (no UX).
    allDrained.sort((a, b) => a.seq - b.seq);
    for (const { input, flow_id } of allDrained) {
      const actor = this.actors.get(flow_id);
      const isJ002 = J002_MACHINES.has(machineOfFlow(flow_id));
      const before =
        isJ002 && actor
          ? harvestSettledFreezeState(actor).stale_intents_dropped_count
          : 0;
      await this.send(input);
      if (isJ002 && actor) {
        const after = harvestSettledFreezeState(actor);
        const isDatasetPick =
          input.type === "dataset_resolved_by_agent" ||
          input.type === "dataset_picked_directly";
        // DWD-7 / DD-4 (Praxis F-4): a REPLAYED dataset pick that fails
        // ScopeResolver invariant 4 (deleted / cross-tenant) is
        // silent-dropped with stale_intent_dropped_after_thaw — distinct
        // from the interactive US-209 dataset_access_denied gutter hint
        // (that path is NOT a THAW replay so never reaches here). The
        // machine's onDone arm already preserved the prior resource
        // (intent N) and stayed in session_active (no
        // scope_mismatch_terminal); the replay-staleness is recognised
        // HERE at replay time per DWD-7's "filter applied at replay".
        const datasetStale =
          isDatasetPick &&
          harvestSettledSessionChatState(actor).underlying_cause_tag ===
            "dataset_access_denied";
        if (after.stale_intents_dropped_count > before || datasetStale) {
          await this.deps.eventLog.append(flow_id, {
            ts: new Date().toISOString(),
            type: "stale_intent_dropped_after_thaw",
            payload: {
              intent_type:
                after.last_stale_intent?.intent_type ?? input.type,
              target_id:
                after.last_stale_intent?.target_id ??
                (datasetStale
                  ? (input.payload.resource_id as string | undefined) ?? ""
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
    // ADR-040 LEAF-3 MR-L3b/N9: the deep-link event-append loop is CARVED
    // into projectContextStrategy.applyDeepLink (deep-link is a
    // project-context concern; §4B). The pump RETAINS the LEAF-1
    // registry-resolve VALIDATION (UnknownMachineError → clean 404) and
    // the FE projection-read (parsePrincipal + projectionFor) — both stay
    // central (§3). applyDeepLink is called UNCONDITIONALLY (the imported
    // strategy ref, mirroring the MR-L3a loginOrgSetupStrategy precedent);
    // the pre-carve loop had no machine guard so the carved one has none
    // either → byte-identical for every machine.
    FLOW_STRATEGY_REGISTRY.resolve(input.machine);
    if (!projectContextStrategy.applyDeepLink) {
      throw new Error("projectContextStrategy.applyDeepLink missing (LEAF-3 N9)");
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
