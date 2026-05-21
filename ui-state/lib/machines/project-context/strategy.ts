// ProjectContextStrategy — the `project-context` FlowStrategy impl.
//
// ADR-040 §D1/§D2 LEAF-3, MR-L3b. Co-located with the machine it owns
// (leaf-3-plan §2 AMB-2 RATIFIED: strategies live at
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
// The cross-machine `project_ready` hook FIRING (`maybeFireProjectReady`)
// STAYS pump-central (leaf-3-plan §3 / §4B) — this strategy only performs
// the per-machine `settle→emit` obligation; the pump fires the hook AFTER.
//
// Mirrors the MR-L3a precedent `machines/login-and-org-setup/strategy.ts`.

import { type AnyActorRef } from "xstate";

import type { ResourceType } from "../../active-scope.ts";
import type {
  FlowStrategy,
  PumpContext,
  SendEventInput,
  SettleContext,
  SettleOutcome,
} from "../../orchestrator.ts";
import {
  harvestSettledFreezeState,
  harvestSettledProjectContextState,
} from "../../orchestrator-harvester.ts";
import type { FlowEvent } from "../../projection.ts";
import { buildProjection } from "../../projection.ts";
import {
  createProjectContextMachine,
} from "./index.ts";

/**
 * Canonical machine-name (ADR-039) — the FlowStrategy registry key. The
 * literal is the single canonical name shared with the orchestrator's
 * `PROJECT_CONTEXT_MACHINE`.
 */
const PROJECT_CONTEXT_MACHINE = "project-context";

/**
 * Wire-protocol machine name preserved through MR-1.5 (DWD-13 + the MR-1.5
 * REC-2 decision). The source-tree split to `project-context`, but the HTTP
 * URL path + Redis event-log key prefix remain
 * `project-and-chat-session-management`. The carved branches are gated on
 * this wire name verbatim from the pre-carve `send()` conditionals — the
 * pump dispatches `flow_id` keyed by this name (behavior-neutral).
 */
const PROJECT_CONTEXT_WIRE_NAME = "project-and-chat-session-management";

export const projectContextStrategy: FlowStrategy = {
  machineName: PROJECT_CONTEXT_MACHINE,
  buildMachine: (deps) => {
    if (!deps.projectContextMachineDeps) {
      throw new Error(
        "projectContextMachineDeps required to construct the project-context machine",
      );
    }
    return createProjectContextMachine(deps.projectContextMachineDeps);
  },

  /**
   * Spawn-time terminal emission (`beginIfNotStarted`). Carved verbatim
   * from the `beginIfNotStarted` project-context arm in MR-L3b/N6 (the
   * `!== PROJECT_CONTEXT_WIRE_NAME` guard + the `project_context_resolution_started`
   * / `last_used_resolution_degraded` / `no_projects_displayed` /
   * `project_selected` / `scope_mismatch_displayed` emission +
   * `harvestSettledProjectContextState`). BEHAVIOR-NEUTRAL — same
   * FlowEvents, same payloads, same order; `settle→emit` STILL appends to
   * the Redis-Streams event-log (LEAF-5 swap is out of scope).
   *
   * The `project_ready` cross-machine spawn hook FIRING stays CENTRAL
   * (leaf-3-plan §3 + §4B): the pump dispatches `maybeFireProjectReady`
   * AFTER this returns (it cannot be returned through the port-locked
   * `Promise<void>` signature — the pump reproduces the pre-emission hook
   * params byte-for-byte from the same settled actor + projection).
   *
   * Identity (`user.first_name`, `org_id`) is sourced from the harvester
   * (the sanctioned snapshot boundary, AMB-1) rather than the pump's
   * `input.user_first_name` / `input.org_id` — the port-locked input
   * `{ machine, principal_id, correlation_id }` does not carry them, and
   * the machine context value is byte-identical to them on every spawn
   * path (machine.ts initial-context seed + the `auth_ready` assign).
   */
  async settleSpawn(
    pump: PumpContext,
    actor: AnyActorRef,
    input: { machine: string; principal_id: string; correlation_id: string },
  ): Promise<void> {
    const flow_id = `${input.machine}:${input.principal_id}`;

    // ADR-030 LEAF-B: ctx is the live projection's context (built from the
    // flow event log) per ADR-030 §"Decision outcome" — the projection is
    // the only legal read source for the emission path.
    //
    // Risk noted for reviewer: this is the FIRST write to the
    // project-context flow's log, so the projection has not yet observed
    // any events; identity fields the orchestrator wrote into the log via
    // spawn-input (org_id, user.first_name) read empty here and are sourced
    // from the harvester instead. Fields from `resolveInitialScope`'s actor
    // output (project, most_recent_session_per_project,
    // last_used_degraded_project_ids, underlying_cause_tag) live only in the
    // machine's settled context — harvested via the sanctioned boundary
    // until LEAF-C+ lands an upstream event. Mirrors the LEAF-A trade-off.
    const stateValue = actor.getSnapshot().value as string;
    const projectionEvents = await pump.deps.eventLog.read(flow_id);
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
      deeplink_session_id: string | null;
      intent_resource_id: string | null;
      intent_resource_type: ResourceType | null;
    };

    // D-MR5-01 — the begin/`resolveInitialScope` settle has the SAME
    // D-MR4-06 problem #2 as the switch path: the resolved `project` (and
    // the cross_tenant / project_not_found / no_projects cause) lands on
    // the machine context AFTER the snapshot flips and BEFORE the first
    // FlowEvent captures it, so the projection read above sees
    // `project: { id: null }`. Harvest from the designated snapshot-read
    // boundary, exactly as the switch-settle path does, so the begin
    // emission carries the real resolved project.
    const beginHarvest = harvestSettledProjectContextState(actor);
    const settledProject = beginHarvest.project.id
      ? beginHarvest.project
      : ctx.project;
    const settledCause =
      beginHarvest.underlying_cause_tag ?? ctx.underlying_cause_tag;
    // D-MR5-01: org_id has the same first-write-null problem as project.
    // `beginHarvest.org_id` reflects the pump's `input.org_id` byte-for-byte
    // on the spawn path (machine.ts seeds `org_id: input.org_id ?? ""` and
    // the `auth_ready` assign sets it from `event.org_id`), so dropping the
    // pump-only `?? input.org_id` fallback is behavior-neutral.
    const settledOrgId =
      beginHarvest.org_id ?? ctx.org.id ?? "";
    // Identity first-name: projection-of-log (empty at first write) →
    // harvester (machine ctx, == the pump's `input.user_first_name`).
    const firstName =
      ctx.user.first_name ?? beginHarvest.user.first_name ?? null;

    // Initial event — marks the J-002 actor as started for projection consumers.
    await pump.deps.eventLog.append(flow_id, {
      ts: new Date().toISOString(),
      type: "project_context_resolution_started",
      payload: {
        org_id: settledOrgId,
        user: { first_name: firstName },
        correlation_id: input.correlation_id,
      },
      correlation_id: input.correlation_id,
    });

    // OQ-J002-5 / RC-1: the degraded set lands on the machine context
    // (resolveInitialScope onDone) AFTER the snapshot flips and BEFORE the
    // first FlowEvent — source it from the harvest boundary.
    const degradedIds = beginHarvest.last_used_degraded_project_ids ?? [];
    if (degradedIds.length > 0) {
      await pump.deps.eventLog.append(flow_id, {
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
      await pump.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "no_projects_displayed",
        payload: {
          org_id: settledOrgId,
          user: { first_name: firstName },
        },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "project_selected") {
      await pump.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "project_selected",
        payload: {
          org_id: settledOrgId,
          project: settledProject,
          // OQ-J002-5 (US-202 last-used resolution): harvested from the
          // same boundary as `settledProject`.
          most_recent_session_per_project:
            beginHarvest.most_recent_session_per_project,
        },
        correlation_id: input.correlation_id,
      });
      // The `project_ready` broadcast hook FIRING stays pump-central
      // (leaf-3-plan §3 / §4B) — the pump calls `maybeFireProjectReady`
      // AFTER this returns.
    } else if (stateValue === "scope_mismatch_terminal") {
      await pump.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "scope_mismatch_displayed",
        payload: {
          org_id: settledOrgId,
          underlying_cause_tag: settledCause ?? "cross_tenant",
        },
        correlation_id: input.correlation_id,
      });
    }
  },

  /**
   * Pre-settle event→transition emission (ADR-040 §D2 event→transition).
   * Carved verbatim from the `send()` project-context pre-settle arm in
   * MR-L3b/N7 (the `switching_project_started` emission). BEHAVIOR-NEUTRAL
   * — same FlowEvent, same payload, emitted at the same pre-settle point
   * (after `actor.send(...)`, BEFORE `waitForSettledState`).
   *
   * The pump calls this UNCONDITIONALLY at the pre-settle point (the
   * imported strategy ref, mirroring the MR-L3a `loginOrgSetupStrategy`
   * precedent); the original triple guard
   * (`input.machine === PROJECT_CONTEXT_WIRE_NAME` &&
   * `input.type === "switching_project_intent"` && state ===
   * `switching_project`) is preserved INSIDE here, so non-project / non-
   * switch events fall through as a no-op exactly as before. The
   * session-chat pre-settle (`switching_dataset_context_started`) stays
   * inlined in the pump (N13 / MR-L3c, §7 scope-fence).
   */
  async applyEvent(
    pump: PumpContext,
    actor: AnyActorRef,
    input: SendEventInput,
  ): Promise<void> {
    // D-MR4-06 / IC-J002-4 — `switching_project` is an invoke-driven
    // transient state. Emit `switching_project_started` BEFORE the settle
    // so the projection writes the atomic invalidation (session_id +
    // resource_* nulled) in the SAME tick the `switching_project` state
    // surfaces. Without this the `project_switched` reducer would leak the
    // old session_id under the new project.
    if (
      input.machine === PROJECT_CONTEXT_WIRE_NAME &&
      input.type === "switching_project_intent" &&
      (actor.getSnapshot().value as string) === "switching_project"
    ) {
      const preSettleCtx = buildProjection(
        input.flow_id,
        await pump.deps.eventLog.read(input.flow_id),
      ).context as { org: { id: string | null } };
      await pump.deps.eventLog.append(input.flow_id, {
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
  },

  /**
   * Post-settle terminal emission (ADR-040 §D2 settle = the typed emit
   * obligation). Carved verbatim from the `send()` project-context block
   * in MR-L3b/N8 (the LARGEST carve: `harvestSettledProjectContextState`;
   * `deep_link_opened`; the no_projects+validation / no_projects /
   * creating_project / project_selected (create vs re-resolve) /
   * switching_project / error_recoverable / scope_mismatch arms +
   * `project_switched`). BEHAVIOR-NEUTRAL — same FlowEvents, same
   * payloads, same order; `settle→emit` STILL appends to the
   * Redis-Streams event-log (LEAF-5 swap is out of scope).
   *
   * The pump calls this UNCONDITIONALLY (the imported strategy ref,
   * mirroring the MR-L3a `loginOrgSetupStrategy` precedent) AFTER the
   * login settle + auth_ready hook; the original
   * `if (input.machine === PROJECT_CONTEXT_WIRE_NAME)` guard is preserved
   * INSIDE here (non-project flows return an empty outcome), so the
   * pre-carve send() chain — login arms (NOT machine-gated) → project
   * block (machine-gated) — is byte-preserved.
   *
   * The `project_ready` cross-machine spawn hook FIRING via
   * `maybeFireProjectReady` stays pump-central (leaf-3-plan §3 / §4B):
   * the `project_selected` arm returns the `projectReady` signal instead
   * of calling the hook; the pump fires `maybeFireProjectReady` AFTER
   * this returns (exactly as the login `authReady` precedent). The
   * pre-carve order was [project_selected, maybeFireProjectReady,
   * project_switched]; carved it is [project_selected, project_switched
   * (here), maybeFireProjectReady (pump, after)] — behavior-neutral:
   * `project_switched` only touches project-context's log;
   * `maybeFireProjectReady` spawns session-chat from explicit params
   * (computed before either append, not re-read from the log) into a
   * disjoint Redis stream — no data dependency, both flows' final
   * projections are byte-identical regardless of the two awaits' order.
   */
  async settle(
    pump: PumpContext,
    actor: AnyActorRef,
    input: SendEventInput,
    ctx: SettleContext,
  ): Promise<SettleOutcome> {
    const { stateValue } = ctx;
    // The pump-built projection context (the SettleContext carries it so
    // the strategy never re-reads `actor.getSnapshot().context` — AMB-1).
    // `SettleContext.projectionCtx` is intentionally loose
    // (`{ org_validation_error } & Record<string, unknown>`); the pump
    // builds it from the full projection shape (orchestrator.ts send()),
    // so the via-`unknown` widening is the same narrowing the pre-carve
    // inline block did off `buildProjection(...).context`.
    const projectionCtx = ctx.projectionCtx as unknown as {
      user: { first_name: string | null };
      org: { id: string | null; name: string | null };
      project: { id: string | null; name: string | null };
      underlying_cause_tag: string | null;
      pending_project_name: string;
      project_validation_error: { kind: string; message: string } | null;
      deeplink_project_id: string | null;
      deeplink_session_id: string | null;
      intent_resource_id: string | null;
      intent_resource_type: ResourceType | null;
    };

    // ---- project-context terminal-for-now event appending ----------------
    // The project-context machine's events do not share J-001's state
    // names, so the login arms (called first by the pump, NOT
    // machine-gated) don't fire for it. Per DWD-13 the wire name is still
    // `project-and-chat-session-management`.
    if (input.machine !== PROJECT_CONTEXT_WIRE_NAME) {
      return {};
    }
    // ADR-030 LEAF-B: project-context emission reads flow through the
    // projection. `projectionCtx.org.id` mirrors the actor's single-field
    // `org_id`; the rest of the shape matches the projection's
    // reducer-populated context.
    const orgId = projectionCtx.org.id ?? "";

    // D-MR4-06 / RC-1 / RCA §6.2 step 5 — the `switchProject` /
    // re-run `resolveInitialScope` / `createProject` invoke outputs
    // (project, cause, pending_project_name, project_validation_error)
    // land on the machine context AFTER the snapshot flips and BEFORE any
    // FlowEvent captures them. Harvest from the designated snapshot-read
    // boundary (the sanctioned exception, AMB-1), scoped to the
    // switch/deep-link/create settle paths so other emission is unchanged.
    const isSettleHarvestPath =
      input.type === "switching_project_intent" ||
      input.type === "open_deep_link" ||
      input.type === "create_project_submitted";
    const switchHarvest = isSettleHarvestPath
      ? harvestSettledProjectContextState(actor)
      : null;
    const switchSettledProject = switchHarvest?.project ?? null;
    const switchSettledCause = switchHarvest?.underlying_cause_tag ?? null;

    // When the incoming event is `open_deep_link`, also append a
    // `deep_link_opened` projection event so the projection's context
    // carries the URL-level wish + resource_* fields (per DWD-9 / MR-D).
    if (input.type === "open_deep_link") {
      // RC-1: source the URL wish from the open_deep_link event payload
      // directly (no open_deep_link projection reducer); the resolved
      // project comes from the harvested settled context.
      const resolvedProject = switchSettledProject ?? projectionCtx.project;
      const dlProjectId =
        (input.payload.intent_project_id as string | undefined) ??
        projectionCtx.deeplink_project_id;
      const dlSessionId =
        (input.payload.intent_session_id as string | undefined) ??
        projectionCtx.deeplink_session_id;
      const dlResourceId =
        (input.payload.intent_resource_id as string | undefined) ??
        projectionCtx.intent_resource_id;
      const dlResourceType =
        (input.payload.intent_resource_type as ResourceType | undefined) ??
        projectionCtx.intent_resource_type;
      const resolvedScope = {
        org_id: orgId,
        project_id: resolvedProject?.id ?? null,
        resource_type: dlResourceType,
        resource_id: dlResourceId,
      };
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "deep_link_opened",
        payload: {
          scope: resolvedScope,
          project: resolvedProject?.id ? resolvedProject : null,
          reconciled: false,
          deeplink_project_id: dlProjectId,
          deeplink_session_id: dlSessionId,
          intent_resource_id: dlResourceId,
          intent_resource_type: dlResourceType,
        },
        correlation_id: input.correlation_id,
      });
    }

    // The empty/invalid-name guard arm writes `project_validation_error`
    // onto the machine context only — harvest it (US-201 inline-error AC).
    const settledValidationError =
      switchHarvest?.project_validation_error ??
      projectionCtx.project_validation_error;
    // `capturePendingProjectName` likewise lands only on the machine
    // context; harvest it so `project_creation_started` /
    // `project_context_recoverable_error` carry the composer text across
    // the `creating_project ↔ error_recoverable` retry boundary.
    const settledPendingProjectName =
      switchHarvest?.pending_project_name ||
      projectionCtx.pending_project_name;

    // Cross-machine `project_ready` hook stays pump-fired (§3/§4B) — the
    // `project_selected` arm sets this and the pump fires
    // `maybeFireProjectReady` AFTER settle returns.
    let projectReady: SettleOutcome["projectReady"] = null;

    if (stateValue === "no_projects" && settledValidationError) {
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "project_validation_failed",
        payload: { error: settledValidationError },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "no_projects") {
      // Re-resolved into no_projects (e.g., after back_to_projects_clicked).
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "no_projects_displayed",
        payload: {
          org_id: orgId,
          user: { first_name: projectionCtx.user.first_name },
        },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "creating_project") {
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "project_creation_started",
        payload: {
          pending_project_name: settledPendingProjectName,
        },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "project_selected") {
      // Emit `project_selected` (not `project_created`) when this
      // transition is a re-resolve (open_deep_link or
      // back_to_projects_clicked). The reducer handles both similarly; the
      // distinction is semantic for downstream consumers.
      const isFromCreate = input.type === "create_project_submitted";
      // D-MR4-06: on the switch-settle path the resolved project lives
      // only on the harvested machine context.
      const settledProject =
        switchSettledProject ?? projectionCtx.project;
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: isFromCreate ? "project_created" : "project_selected",
        payload: {
          org_id: orgId,
          project: settledProject,
        },
        correlation_id: input.correlation_id,
      });
      // ---- project_ready broadcast hook (DWD-13 §3.2.B; pump-fired) ----
      // The pump calls `maybeFireProjectReady` AFTER settle returns this
      // signal (cross-machine FIRING stays central — leaf-3-plan §3/§4B).
      projectReady = {
        org_id: orgId,
        project: settledProject,
        deeplink_session_id: projectionCtx.deeplink_session_id,
        intent_resource_id: projectionCtx.intent_resource_id,
        intent_resource_type: projectionCtx.intent_resource_type,
      };
      // MR-4 — when the entry was a switch settle (prior state
      // `switching_project`), also emit `project_switched` so SSE
      // consumers can distinguish "initial select" from "switch settle".
      // Discriminated by input.type (switching_project_intent is the ONLY
      // event that lifts switching_project → project_selected).
      if (input.type === "switching_project_intent") {
        await pump.deps.eventLog.append(input.flow_id, {
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
      // MR-4 / IC-J002-4 — emit `switching_project_started` atomically
      // with the state surface so SSE consumers see
      // (state=switching_project, session_id=null, resource=null) in the
      // same projection tick.
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "switching_project_started",
        payload: {
          org_id: orgId,
          deeplink_project_id: projectionCtx.deeplink_project_id,
        },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "error_recoverable") {
      await pump.deps.eventLog.append(input.flow_id, {
        ts: new Date().toISOString(),
        type: "project_context_recoverable_error",
        payload: {
          underlying_cause_tag:
            switchSettledCause ??
            projectionCtx.underlying_cause_tag ??
            "transient",
          pending_project_name: settledPendingProjectName,
        },
        correlation_id: input.correlation_id,
      });
    } else if (stateValue === "scope_mismatch_terminal") {
      await pump.deps.eventLog.append(input.flow_id, {
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

    return { projectReady };
  },

  /**
   * Deep-link re-resolve emission (`appendDeepLinkEvents`). Carved verbatim
   * from the `appendDeepLinkEvents` body in MR-L3b/N9 — the
   * machine-agnostic `for (ev of input.events) eventLog.append(...)` loop
   * (deep-link is a project-context concern; ADR-040 §4B). BEHAVIOR-NEUTRAL
   * — same FlowEvents, same order; `settle→emit` STILL appends to the
   * Redis-Streams event-log (LEAF-5 swap is out of scope).
   *
   * The pump calls this UNCONDITIONALLY (the imported strategy ref,
   * mirroring the MR-L3a `loginOrgSetupStrategy` precedent). The pre-carve
   * `appendDeepLinkEvents` had NO machine guard (it appended for any
   * machine), so this has none either → byte-identical for every machine.
   * The pump RETAINS the LEAF-1 `FLOW_STRATEGY_REGISTRY.resolve(machine)`
   * validation (UnknownMachineError → 404) and the FE projection-read
   * (`parsePrincipal` + `projectionFor`) — both stay central (§3).
   */
  async applyDeepLink(
    pump: PumpContext,
    input: {
      machine: string;
      flow_id: string;
      correlation_id: string;
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    },
  ): Promise<void> {
    for (const ev of input.events) {
      const flowEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: ev.type,
        payload: ev.payload,
        correlation_id: input.correlation_id,
      };
      await pump.deps.eventLog.append(input.flow_id, flowEvent);
    }
  },

  /**
   * Per-frozen-flow FREEZE emission tail (the broadcast LOOP stays central
   * per ADR-040 §D2 / AMB-3). Carved verbatim from the `broadcastFreeze`
   * `project_context_frozen` tail in MR-L3b/N10. BEHAVIOR-NEUTRAL — same
   * FlowEvent, same payload; `settle→emit` STILL appends to the
   * Redis-Streams event-log.
   *
   * The pump's FREEZE broadcast LOOP stays central (§3 / AMB-3) and
   * pre-gates `J002 && state==="freeze"`, dispatching the session-chat
   * `session_chat_frozen` tail inline (N15 / MR-L3c, §7 scope-fence) and
   * this for project-context. `harvestSettledFreezeState` is re-derived
   * here (the sanctioned snapshot boundary, AMB-1) — idempotent, identical
   * to the pump's prior `h`.
   */
  async settleFreeze(
    pump: PumpContext,
    actor: AnyActorRef,
    flow_id: string,
  ): Promise<void> {
    const h = harvestSettledFreezeState(actor);
    await pump.deps.eventLog.append(flow_id, {
      ts: new Date().toISOString(),
      type: "project_context_frozen",
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
      correlation_id: h.correlation_id,
    });
  },

  /**
   * Per-frozen-flow THAW emission tail (broadcast LOOP stays central per
   * ADR-040 §D2 / AMB-3). Carved verbatim from the
   * `appendProjectContextThawTerminal` body in MR-L3b/N10 — the MR-6 /
   * US-210 project-context THAW history-target re-entry terminal
   * (`project_switched` / `scope_mismatch_displayed` /
   * `project_context_recoverable_error` when the re-run invoke settles).
   * BEHAVIOR-NEUTRAL — same FlowEvents, same payloads, same order;
   * `settle→emit` STILL appends to the Redis-Streams event-log.
   *
   * Only the successful-thaw history-target re-entry (`kind === "thaw"`);
   * the abandoned path's `replay_abandoned` / `*_recoverable_error`
   * emission stays in the central broadcast loop (§7 scope-fence — it is
   * machine-generic loop bookkeeping; full symmetry is MR-L3c). The pump
   * pre-gates `machine === PROJECT_CONTEXT_WIRE_NAME &&
   * PC_TRANSIENTS.has(last_live_state)`.
   *
   * `settledState` is read from `.value` (allowed; not `.context`);
   * `correlation_id` from `harvestSettledFreezeState` (the sanctioned
   * boundary) — both byte-identical to the pump's prior `settledState` /
   * `h.correlation_id` (idempotent). The cross-machine `project_ready`
   * re-broadcast (`maybeFireProjectReady`) stays pump-fired AFTER this
   * returns (leaf-3-plan §3 — it was the LAST statement of the
   * `project_selected` arm, so no reorder).
   */
  async settleThaw(
    pump: PumpContext,
    actor: AnyActorRef,
    flow_id: string,
    kind: "thaw" | "abandoned",
  ): Promise<void> {
    if (kind !== "thaw") return;
    const settledState = actor.getSnapshot().value as string;
    const correlation_id = harvestSettledFreezeState(actor).correlation_id;
    const h = harvestSettledProjectContextState(actor);
    if (settledState === "project_selected") {
      await pump.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "project_switched",
        payload: { org_id: h.org_id ?? "", project: h.project },
        correlation_id,
      });
      // Re-broadcast project_ready so a frozen-then-thawed session-chat
      // re-binds to the switched project (idempotent on same id) — stays
      // pump-fired AFTER this returns (leaf-3-plan §3 / §4B).
    } else if (settledState === "scope_mismatch_terminal") {
      await pump.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "scope_mismatch_displayed",
        payload: {
          org_id: h.org_id ?? "",
          underlying_cause_tag: h.underlying_cause_tag ?? "access_revoked",
        },
        correlation_id,
      });
    } else if (settledState === "error_recoverable") {
      await pump.deps.eventLog.append(flow_id, {
        ts: new Date().toISOString(),
        type: "project_context_recoverable_error",
        payload: {
          underlying_cause_tag: h.underlying_cause_tag ?? "transient",
        },
        correlation_id,
      });
    }
  },
};
