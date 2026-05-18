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
import type { FlowStrategy, PumpContext } from "../../orchestrator.ts";
import { harvestSettledProjectContextState } from "../../orchestrator-harvester.ts";
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

export const projectContextStrategy: FlowStrategy = {
  machineName: PROJECT_CONTEXT_MACHINE,
  beginsDirectly: false,
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
};
