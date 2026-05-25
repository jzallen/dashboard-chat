// SessionChatStrategy — the `session-chat` FlowStrategy impl.
//
// ADR-040 §D1/§D2 LEAF-3, MR-L3c (the FINAL LEAF-3 MR). Co-located with
// the machine it owns (leaf-3-plan §2 AMB-2 RATIFIED: strategies live at
// `ui-state/lib/machines/<machine>/strategy.ts`). ADR-028 "no machine
// imports another machine" is preserved — this strategy imports only its
// OWN machine module; the pump remains the sole cross-machine mediator and
// is reached through the `PumpContext` seam (never an actor-map / snapshot
// import). Snapshot reads go exclusively through the sanctioned
// `harvestSettled*` boundary (AMB-1) — strategy bodies read only the
// settled state-VALUE + the live projection + the harvester, never raw
// `actor.getSnapshot().context`.
//
// LEAF-3 is BEHAVIOR-NEUTRAL: `settle→emit` STILL appends to the
// Redis-Streams FlowEventLog (the read-port swap is LEAF-5, out of scope).
// session-chat is the TERMINAL of the cross-machine spawn chain: it FIRES
// no onward broadcast hook (unlike project-context's `project_ready`), so
// every carved member returns `void` / an empty `SettleOutcome`. The
// `isProjectReadyDispatch` detection / `project_ready` → session-chat spawn
// ROUTING stays pump-central (leaf-3-plan §3 / §4C) — the pump resolves
// this strategy and calls `settleSpawn()`.
//
// Mirrors the MR-L3a/MR-L3b precedents
// `machines/login-and-org-setup/strategy.ts` +
// `machines/project-context/strategy.ts`.

import { type AnyActorRef } from "xstate";

import type { ResourceType } from "../../domain/active-scope.ts";
import { FlowId } from "../../flow-id.ts";
import type {
  FlowStrategy,
  PumpContext,
  SettleContext,
  SettleOutcome,
} from "../../orchestrator.ts";
import {
  harvestSettledFreezeState,
  harvestSettledSessionChatState,
} from "../../orchestrator-harvester.ts";
import { buildProjection, FlowEvent } from "../../projection.ts";
import { createSessionChatMachine } from "./index.ts";

/**
 * Canonical machine-name (ADR-039) — the FlowStrategy registry key. The
 * literal is the single canonical name shared with the orchestrator's
 * `SESSION_CHAT_MACHINE`.
 */
const SESSION_CHAT_MACHINE = "session-chat";

/**
 * Wire-protocol machine name. For session-chat the canonical machine-name
 * IS the wire segment (no DWD-13 split alias — only project-context carries
 * the legacy `project-and-chat-session-management` wire name). The carved
 * branches are gated on this verbatim from the pre-carve orchestrator
 * `send()` / `beginIfNotStarted` conditionals (behavior-neutral).
 */
const SESSION_CHAT_WIRE_NAME = "session-chat";

/**
 * Emit the terminal-for-now events that match a session-chat actor's
 * current state. Idempotent and side-effect-only — the actor's state is
 * the source of truth; the events are the projection-builder substrate.
 *
 * Carved verbatim from the orchestrator's private
 * `appendSessionChatTerminalEvents` in MR-L3c/N12 (the only change is
 * `this.deps.eventLog` → `pump.deps.eventLog` through the `PumpContext`
 * seam; the projection-of-log read + every state arm + the harvested-vs-
 * projection precedence is byte-unchanged). Called from BOTH
 * `settleSpawn` (after spawn / `project_ready` re-broadcast) AND `settle`
 * (post-`send()`) AND `settleThaw` (the THAW history-target re-entry) so
 * session_clicked → resuming_session → session_active emits the right
 * sequence regardless of which surface drove the transition.
 * BEHAVIOR-NEUTRAL — same FlowEvents, same payloads, same order;
 * `settle→emit` STILL appends to the Redis-Streams event-log.
 */
async function appendSessionChatTerminalEvents(
  pump: PumpContext,
  flow_id: string,
  stateValue: string,
  request_id: string,
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
    // RC-2: the settled session_list (loadSessionList onDone) — read off
    // the actor snapshot at the designated boundary, NOT the stale
    // projection-of-log (which has not yet observed the loaded list at
    // emission time).
    session_list?: Array<{
      id: string;
      title: string | null;
      last_active_at: string;
      active_dataset_id: string | null;
    }>;
    session_list_next_cursor?: string | null;
    session_list_has_more?: boolean;
    // RC-2 (US-206): the settled composer text — preserved on the
    // machine context across the transient-create-session retry, read
    // off the actor snapshot rather than the stale projection-of-log.
    pending_first_message?: string;
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
    await pump.deps.eventLog.read(flow_id),
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
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "session_list_load_started",
        payload: { project_id: ctx.project.id },
        request_id,
      }),
    );
    return;
  }
  if (stateValue === "session_list_loaded") {
    // RC-2: prefer the harvested settled list (read off the actor
    // snapshot at the designated boundary) over the projection-of-log
    // `ctx` — the loadSessionList onDone assign lands AFTER the snapshot
    // flips to `session_list_loaded`, so `ctx.session_list` still holds
    // the empty prior-tick value at this emission point. Without this the
    // spawn-path `session_list_loaded` event carries `items: []` and every
    // mr_2/mr_3 precondition sees an empty list (same D-MR5-01 class as
    // the `session_resumed` harvest below).
    const settledList = harvestedResume?.session_list ?? ctx.session_list;
    const settledNextCursor =
      harvestedResume?.session_list_next_cursor !== undefined
        ? harvestedResume.session_list_next_cursor
        : ctx.session_list_next_cursor;
    const settledHasMore =
      harvestedResume?.session_list_has_more !== undefined
        ? harvestedResume.session_list_has_more
        : ctx.session_list_has_more;
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "session_list_load_started",
        payload: { project_id: ctx.project.id },
        request_id,
      }),
    );
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "session_list_loaded",
        payload: {
          items: settledList,
          next_cursor: settledNextCursor,
          has_more: settledHasMore,
        },
        request_id,
      }),
    );
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "session_list_displayed",
        payload: {
          project_id: ctx.project.id,
          session_count: settledList.length,
        },
        request_id,
      }),
    );
    return;
  }
  if (stateValue === "resuming_session") {
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "session_resume_started",
        payload: {
          session_id: ctx.pending_resume_session_id ?? ctx.session_id ?? null,
        },
        request_id,
      }),
    );
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
      // RC-2 (US-206): the session_id is materialized AFTER the snapshot
      // flips to `session_active` — by the createSessionEagerly onDone
      // (eager-create) or the resumeSession onDone (existing-session
      // click that cancels the new-session intent). The projection-of-log
      // read still holds null at this emission point, so prefer the
      // harvested settled value (same boundary discipline as the
      // `session_resumed` branch below).
      await pump.deps.eventLog.append(
        flow_id,
        FlowEvent.from(FlowId.fromKey(flow_id), {
          type: "session_active_reached",
          payload: {
            session_id: harvestedResume?.session_id ?? ctx.session_id,
          },
          request_id,
        }),
      );
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
    const resumedTranscript = harvestedResume?.transcript ?? ctx.transcript;
    // `dataset_unavailable` is TRUE only when the resume actor detected a
    // stored active_dataset_id that 404'd (graceful degradation per US-205
    // Example 3). A null active_dataset_id is the conversational-mode
    // default — NOT a degraded state. The machine signals the degraded
    // case by setting underlying_cause_tag = "dataset_not_found".
    const datasetUnavailable = resumedCause === "dataset_not_found";
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "session_resumed",
        payload: {
          session_id: resumedSessionId,
          transcript: resumedTranscript,
          resource_type: resumedResource.type,
          resource_id: resumedResource.id,
          dataset_unavailable: datasetUnavailable,
        },
        request_id,
      }),
    );
    if (datasetUnavailable) {
      await pump.deps.eventLog.append(
        flow_id,
        FlowEvent.from(FlowId.fromKey(flow_id), {
          type: "session_dataset_unavailable",
          payload: {},
          request_id,
        }),
      );
    }
    return;
  }
  if (stateValue === "session_welcome") {
    // US-206: emit `session_welcome_displayed` so the projection reducer
    // surfaces the welcome state to consumers. session_id stays null.
    // Carry pending_first_message so the projection reducer preserves the
    // composer text when re-entering from `retry_clicked` — the machine
    // already holds it in context across that transition (app-arch §6.4).
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "session_welcome_displayed",
        payload: {
          project_id: ctx.project.id,
          // RC-2 (US-206): capturePendingFirstMessage assigns the composer
          // text AFTER the snapshot flips, so the projection-of-log read is
          // empty at this emission point — prefer the harvested value.
          pending_first_message:
            harvestedResume?.pending_first_message ?? ctx.pending_first_message,
        },
        request_id,
      }),
    );
    return;
  }
  if (stateValue === "error_recoverable") {
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "session_chat_recoverable_error",
        payload: {
          underlying_cause_tag:
            harvestedResume?.underlying_cause_tag ??
            ctx.underlying_cause_tag ??
            "transient",
          // US-206 composer-preservation: carry the welcome-state composer
          // text on the FlowEvent so the projection reducer preserves it
          // across reload (DWD-9 SSOT — projection is rebuilt from log).
          // RC-2: the transient-create-session failure sets the cause +
          // preserves pending_first_message AFTER the snapshot flips to
          // `error_recoverable`; the projection-of-log read is stale here,
          // so prefer the harvested settled values.
          pending_first_message:
            harvestedResume?.pending_first_message ?? ctx.pending_first_message,
        },
        request_id,
      }),
    );
  }
}

export const sessionChatStrategy: FlowStrategy = {
  machineName: SESSION_CHAT_MACHINE,
  buildMachine: (deps) =>
    createSessionChatMachine(deps.sessionChatMachineDeps ?? {}),

  /**
   * Spawn-time terminal emission (`beginIfNotStarted`). Carved verbatim
   * from the orchestrator's private `emitSessionChatSpawnEvents` +
   * the `beginIfNotStarted` session-chat spawn arm in MR-L3c/N12 (the
   * `project_context_inherited` marker + the
   * `appendSessionChatTerminalEvents` settle-emission +
   * `harvestSettledSessionChatState`). BEHAVIOR-NEUTRAL — same FlowEvents,
   * same payloads, same order; `settle→emit` STILL appends to the
   * Redis-Streams event-log (LEAF-5 swap is out of scope).
   *
   * The `isProjectReadyDispatch` detection / `project_ready` →
   * session-chat spawn ROUTING stays pump-central (leaf-3-plan §3 / §4C):
   * the pump resolves this strategy and calls `settleSpawn()`. session-chat
   * is the spawn-chain TERMINAL — it fires NO onward broadcast hook (unlike
   * project-context's `project_ready`), so this returns `Promise<void>`
   * with nothing for the pump to fire.
   *
   * Identity (`org_id`, `project_id`, `project_name`) is sourced from the
   * harvester (the sanctioned snapshot boundary, AMB-1) rather than the
   * pump's pre-carve `spawn.org_id` / `spawn.project_id` /
   * `spawn.project_name` — the port-locked input
   * `{ machine, principal_id, request_id }` does not carry them, and
   * the machine context value is byte-identical to them on every spawn
   * path (machine.ts initial-context seed `org_id: input.org_id ?? ""` /
   * `project: { id: input.project_id ?? null, … }` + the
   * `waiting_for_project` → `project_ready` assign). The exact
   * `harvestSettledProjectContextState` org_id precedent (D-MR5-01).
   */
  async settleSpawn(
    pump: PumpContext,
    actor: AnyActorRef,
    input: { machine: string; principal_id: string; request_id: string },
  ): Promise<void> {
    const flow_id = `${input.machine}:${input.principal_id}`;
    // ADR-030 LEAF-B: state-value is the only legal read off the actor
    // snapshot at the emission boundary; identity fields come from the
    // sanctioned harvester (AMB-1) rather than from snapshot.context, per
    // ADR-030 §"Decision outcome". Byte-identical to the pre-carve pump
    // `spawn.org_id` / `spawn.project_id` / `spawn.project_name` on the
    // spawn path (the machine seeds them from the same spawn-input +
    // `project_ready` event the pump forwarded).
    const stateValue = actor.getSnapshot().value as string;
    const spawnHarvest = harvestSettledSessionChatState(actor);
    const orgId = spawnHarvest.org_id || "";
    const projectId = spawnHarvest.project.id || null;
    if (!orgId || !projectId) return;

    // Per DWD-13 §2B the session-chat flow's log carries the
    // `project_context_inherited` event as its first marker so the
    // projection reducer knows session-chat has been spawned for this
    // principal.
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "project_context_inherited",
        payload: {
          org_id: orgId,
          project_id: projectId,
          project_name: spawnHarvest.project.name ?? "",
        },
        request_id: input.request_id,
      }),
    );

    // RC-2: the spawn path (project_ready → loading_session_list →
    // session_list_loaded) is where every mr_2/mr_3 precondition funnels.
    // Without harvesting the settled actor state here, the
    // `session_list_loaded` emission reads the empty prior-tick list off
    // the projection-of-log and the entire cluster fails its
    // `_wait_for_session_chat_state(session_list_loaded)` + list assertion.
    // Same boundary discipline the send-path callers already apply.
    await appendSessionChatTerminalEvents(
      pump,
      flow_id,
      stateValue,
      input.request_id,
      undefined,
      spawnHarvest,
    );
  },

  /**
   * Pre-settle event→transition emission (ADR-040 §D2 event→transition).
   * Carved verbatim from the `send()` session-chat pre-settle arm in
   * MR-L3c/N13 (the `switching_dataset_context_started` emission, US-209 /
   * MR-5). BEHAVIOR-NEUTRAL — same FlowEvent, same payload, emitted at the
   * same pre-settle point (after `actor.send(...)`, BEFORE
   * `waitForSettledState`).
   *
   * The pump calls this UNCONDITIONALLY at the pre-settle point (the
   * imported strategy ref, mirroring the MR-L3a/MR-L3b precedents); the
   * original triple guard (`input.machine === SESSION_CHAT_WIRE_NAME` &&
   * dataset-switch `input.type` && state ===
   * `switching_dataset_context`) is preserved INSIDE here, so
   * non-session-chat / non-switch events fall through as a no-op exactly
   * as before.
   */
  async applyEvent(
    pump: PumpContext,
    actor: AnyActorRef,
    event: FlowEvent,
    flow_id: string,
    machine: string,
  ): Promise<void> {
    // US-209 / MR-5 — `switching_dataset_context` is an invoke-driven
    // transient state (the `switchDatasetContext` actor performs
    // GET /api/datasets/:id + PATCH session.active_dataset_id). Mirrors the
    // D-MR4-06 `switching_project_started` pre-settle emission: emit
    // `switching_dataset_context_started` BEFORE awaiting the settle so an
    // SSE consumer observes the (state=switching_dataset_context) tick.
    // The post-settle block (`settle`) then emits the terminal
    // `dataset_attached` / `dataset_access_denied` once
    // `switchDatasetContext` resolves — sourced from the harvested machine
    // context (the resolved resource lands on ctx after the snapshot
    // flips, the D-MR4-06 problem #2).
    if (
      machine === SESSION_CHAT_WIRE_NAME &&
      (event.type === "dataset_resolved_by_agent" ||
        event.type === "dataset_picked_directly") &&
      (actor.getSnapshot().value as string) === "switching_dataset_context"
    ) {
      await pump.deps.eventLog.append(
        flow_id,
        FlowEvent.from(FlowId.fromKey(flow_id), {
          type: "switching_dataset_context_started",
          payload: {
            intended_resource_id:
              (event.payload.resource_id as string | undefined) ?? null,
            intended_resource_type:
              (event.payload.resource_type as string | undefined) ?? "dataset",
          },
          request_id: event.request_id,
        }),
      );
    }
  },

  /**
   * Post-settle terminal emission (ADR-040 §D2 settle = the typed emit
   * obligation). Carved verbatim from the `send()` session-chat block in
   * MR-L3c/N14 (the `dataset_attached` / `dataset_access_denied`
   * dataset-switch arm + the `session_clicked` → `session_resume_not_found`
   * special-case + the default `appendSessionChatTerminalEvents` path).
   * BEHAVIOR-NEUTRAL — same FlowEvents, same payloads, same order;
   * `settle→emit` STILL appends to the Redis-Streams event-log (LEAF-5
   * swap is out of scope).
   *
   * The pump calls this UNCONDITIONALLY (the imported strategy ref,
   * mirroring the MR-L3a/MR-L3b precedents) AFTER the login settle +
   * project-context settle + their cross-machine hooks; the original
   * `if (input.machine === SESSION_CHAT_WIRE_NAME)` guard is preserved
   * INSIDE here (non-session flows return an empty outcome), so the
   * pre-carve send() chain — login arms (NOT machine-gated) →
   * project-context block (machine-gated) → session-chat block
   * (machine-gated) — is byte-preserved. session-chat is the spawn-chain
   * TERMINAL — it fires NO onward cross-machine hook, so the
   * `SettleOutcome` is always empty.
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
    if (machine !== SESSION_CHAT_WIRE_NAME) {
      return {};
    }
    const isDatasetSwitch =
      event.type === "dataset_resolved_by_agent" ||
      event.type === "dataset_picked_directly";
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
        await pump.deps.eventLog.append(
          flow_id,
          FlowEvent.from(FlowId.fromKey(flow_id), {
            type: "dataset_access_denied",
            payload: { underlying_cause_tag: "dataset_access_denied" },
            request_id: event.request_id,
          }),
        );
      } else {
        await pump.deps.eventLog.append(
          flow_id,
          FlowEvent.from(FlowId.fromKey(flow_id), {
            type: "dataset_attached",
            payload: {
              resource_type: harvest.resource.type,
              resource_id: harvest.resource.id,
            },
            request_id: event.request_id,
          }),
        );
      }
    } else if (
      event.type === "session_clicked" &&
      stateValue === "session_list_loaded"
    ) {
      // Special-case: if the resumeSession resolved with
      // session_not_found (silent return), the machine has settled in
      // session_list_loaded. The default state-emission path covers
      // that; for session_not_found the test expects
      // underlying_cause_tag to NOT surface — we emit
      // `session_resume_not_found` so the projection reducer can blank
      // out pending_resume_session_id atomically.
      await pump.deps.eventLog.append(
        flow_id,
        FlowEvent.from(FlowId.fromKey(flow_id), {
          type: "session_resume_not_found",
          payload: {},
          request_id: event.request_id,
        }),
      );
    } else {
      await appendSessionChatTerminalEvents(
        pump,
        flow_id,
        stateValue,
        event.request_id,
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

    return {};
  },

  /**
   * Per-frozen-flow FREEZE emission tail (the broadcast LOOP stays central
   * per ADR-040 §D2 / AMB-3). Carved verbatim from the `broadcastFreeze`
   * `session_chat_frozen` tail in MR-L3c/N15. BEHAVIOR-NEUTRAL — same
   * FlowEvent, same payload; `settle→emit` STILL appends to the
   * Redis-Streams event-log.
   *
   * The pump's FREEZE broadcast LOOP stays central (§3 / AMB-3) and
   * pre-gates `J002 && state==="freeze"`, then resolves the strategy and
   * dispatches `settleFreeze` per frozen flow.
   * `harvestSettledFreezeState` is re-derived here (the sanctioned
   * snapshot boundary, AMB-1) — idempotent, identical to the pump's prior
   * `h`.
   */
  async settleFreeze(
    pump: PumpContext,
    actor: AnyActorRef,
    flow_id: string,
  ): Promise<void> {
    const h = harvestSettledFreezeState(actor);
    await pump.deps.eventLog.append(
      flow_id,
      FlowEvent.from(FlowId.fromKey(flow_id), {
        type: "session_chat_frozen",
        payload: {
          last_live_state: h.last_live_state,
          // Originating user-action preserved from the freeze moment so it
          // survives into error_recoverable on the abandoned path (US-210
          // AC). The *_started events that normally write these never fired
          // when FREEZE pre-empted the in-flight invoke.
          pending_resume_session_id: h.pending_resume_session_id,
          pending_first_message: h.pending_first_message,
          pending_project_name: h.pending_project_name,
        },
        request_id: h.request_id,
      }),
    );
  },

  /**
   * Per-frozen-flow THAW emission tail (broadcast LOOP stays central per
   * ADR-040 §D2 / AMB-3). Carved verbatim from the `broadcastThaw`
   * session-chat history-target re-entry tail in MR-L3c/N15 — the
   * `appendSessionChatTerminalEvents` call for the MR-6 / US-210
   * successful-thaw history-target re-entry (when the re-run invoke
   * settles). BEHAVIOR-NEUTRAL — same FlowEvents, same payloads, same
   * order; `settle→emit` STILL appends to the Redis-Streams event-log.
   *
   * Only the successful-thaw history-target re-entry (`kind === "thaw"`);
   * the abandoned path's `replay_abandoned` / `*_recoverable_error`
   * emission stays in the central broadcast loop (machine-generic loop
   * bookkeeping — the `*_thawed` / `replay_abandoned` event-name selection
   * is the pump's; cf. the project-context settleThaw precedent). The pump
   * pre-gates `machine === SESSION_CHAT_WIRE_NAME &&
   * SC_TRANSIENTS.has(last_live_state)`.
   *
   * `settledState` is read from `.value` (allowed; not `.context`);
   * `request_id` + `last_live_state` from `harvestSettledFreezeState`
   * (the sanctioned boundary) — byte-identical to the pump's prior
   * `settledState` / `h.request_id` / `h.last_live_state`
   * (idempotent). session-chat is the spawn-chain TERMINAL — it fires NO
   * onward cross-machine re-broadcast (unlike project-context's
   * `project_ready`).
   */
  async settleThaw(
    pump: PumpContext,
    actor: AnyActorRef,
    flow_id: string,
    kind: "thaw" | "abandoned",
  ): Promise<void> {
    if (kind !== "thaw") return;
    const settledState = actor.getSnapshot().value as string;
    const h = harvestSettledFreezeState(actor);
    await appendSessionChatTerminalEvents(
      pump,
      flow_id,
      settledState,
      h.request_id,
      h.last_live_state ?? undefined,
      harvestSettledSessionChatState(actor),
    );
  },
};
