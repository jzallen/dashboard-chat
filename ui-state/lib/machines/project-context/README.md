# project-context machine

> **Owner:** ui-state (Hono BFF actor system)
> **Source-of-truth:** `machine.ts` in this directory.
> **Related ADRs:** ADR-027 (flow-state tier + framework — XState v5 adoption), ADR-028 (XState v5 actor model — machines own transitions, the log owns state), ADR-030 (flow-state topology + scaling — orchestrator pattern + projection as primary read model).

## Purpose

Owns the "which project am I in?" half of journey J-002: initial-scope resolution, project creation, the deep-link entry path (US-204), mid-flow project switching (MR-4 / US-207), and the cross-tenant terminal failure surface. Maintains the `org_id` + `project_id` halves of `active_scope`; the `resource_*` half is owned by the sibling `session-chat` machine.

## State diagram

```mermaid
stateDiagram-v2
  [*] --> resolving_initial_scope

  resolving_initial_scope --> resolving_initial_scope: auth_ready (re-enter; absorbs org_id + user.first_name from J-001)
  resolving_initial_scope --> scope_mismatch_terminal: resolveInitialScope onDone {cross_tenant: true}
  resolving_initial_scope --> scope_mismatch_terminal: resolveInitialScope onDone {project_not_found: true}
  resolving_initial_scope --> no_projects: resolveInitialScope onDone {no_projects: true}
  resolving_initial_scope --> project_selected: resolveInitialScope onDone {project}
  resolving_initial_scope --> error_recoverable: resolveInitialScope onError (transient)

  no_projects --> creating_project: create_project_clicked
  no_projects --> creating_project: create_project_submitted [projectNameValid]
  no_projects --> no_projects: create_project_submitted [invalid] (inline error, no transition)

  creating_project --> project_selected: createProject onDone
  creating_project --> error_recoverable: createProject onError (transient)

  project_selected --> switching_project: switching_project_intent (captures new_project_id)

  switching_project --> scope_mismatch_terminal: switchProject onDone {access_revoked: true}
  switching_project --> scope_mismatch_terminal: switchProject onDone {project_not_found: true}
  switching_project --> project_selected: switchProject onDone {project} (clears intent_*; bumps scope_reconciled_count)
  switching_project --> error_recoverable: switchProject onError (transient)

  scope_mismatch_terminal --> resolving_initial_scope: back_to_projects_clicked (clears all intent_*)

  error_recoverable --> creating_project: retry_clicked (preserves pending_project_name; bumps retries_count)

  state any_state {
    [*] --> any_state
  }
  any_state --> resolving_initial_scope: open_deep_link (root-level handler; assigns intent_* from payload)
```

*Note: `open_deep_link` is registered at the machine root level (the `on:` block outside `states`) so it can arrive from any live state — `no_projects`, `project_selected`, `error_recoverable`, etc. The handler captures the four `intent_*` fields from the event payload and re-enters `resolving_initial_scope` so the resolver re-runs with the new intent.*

## States

| State | Purpose | Entered on | Exits on |
|---|---|---|---|
| `resolving_initial_scope` | Invokes `resolveInitialScope` to learn whether the user has any projects, owns one matching `intent_project_id`, or has cross-tenant intent | initial spawn; `auth_ready`; `open_deep_link`; `back_to_projects_clicked` | resolver `onDone` (4 branches) / `onError` (transient) |
| `no_projects` | Welcome-empty surface; user must create the first project | resolver `onDone {no_projects: true}` | `create_project_clicked` / valid `create_project_submitted` |
| `creating_project` | Invokes `createProject` against `POST /api/projects` with `pending_project_name` | `create_project_submitted` (valid) or `retry_clicked` | `createProject` `onDone` (settled) / `onError` (transient) |
| `project_selected` | Project chosen + materialized in `context.project`; the orchestrator's broadcast hook fires `project_ready` to session-chat on entry | `resolveInitialScope` `onDone {project}`; `createProject` `onDone`; `switchProject` `onDone {project}` | `switching_project_intent` (or root-level `open_deep_link`) |
| `switching_project` | Invokes `switchProject` to validate the user's access to a new `intent_project_id` (MR-4 / US-207) | `switching_project_intent` | `switchProject` `onDone` (4 branches) / `onError` (transient) |
| `scope_mismatch_terminal` | Terminal-style surface for `cross_tenant`, `project_not_found`, or `access_revoked` causes; not a sink — user can recover via `back_to_projects_clicked` | resolver / switcher `onDone` with mismatch verdict | `back_to_projects_clicked` |
| `error_recoverable` | Generic transient-failure landing zone; preserves `pending_project_name` for retry | any actor `onError` | `retry_clicked` (routes back to `creating_project`) |

## Events

### External (FE / orchestrator → machine)

| Event | Source | Payload | Purpose |
|---|---|---|---|
| `auth_ready` | Orchestrator broadcast hook (login → project-context) | `{ org_id, user: { first_name } }` | Inherit identity from the login machine's projection; triggers initial scope resolution. Payload-centric event name per [ADR-039](../../../../docs/decisions/adr-039-ui-state-naming-conventions.md) §C3 (cross-machine broadcasts name what they carry, not the sender) |
| `create_project_clicked` | FE composer | (none) | Move from welcome to the in-progress creation invoke (variant of explicit submit path) |
| `create_project_submitted` | FE composer | `{ org_name }` | Submit a project-name string; guard `projectNameValid` decides between transition and inline-error stay |
| `back_to_projects_clicked` | FE terminal-state escape hatch | (none) | Recover from `scope_mismatch_terminal`; clears all four `intent_*` |
| `retry_clicked` | FE error UI | (none) | Re-invoke `createProject` from `error_recoverable`, preserving `pending_project_name` |
| `switching_project_intent` | FE project picker / mid-session deep link (MR-4) | `{ new_project_id }` | Atomic project switch; the orchestrator emits `switching_project_started` so the projection invalidates `session_id` + `resource_*` BEFORE the new project's `loading_session_list` |

### Internal (machine-emitted; root-level)

| Event | Source | Payload | Purpose |
|---|---|---|---|
| `open_deep_link` | HTTP `/flow/:machine/open-deep-link` route → orchestrator → machine | `{ intent_project_id?, intent_session_id?, intent_resource_id?, intent_resource_type? }` | Root-level handler; captures the four intents and re-enters `resolving_initial_scope` |

### Cross-machine (orchestrator broadcasts FROM this machine)

This machine does not directly send events to siblings; the orchestrator's state-watcher branch observes `project_selected` entry and broadcasts a `project_ready` event to the session-chat machine (idempotent on same `project_id`; invalidates `session_id` + `resource_*` on different `project_id`). See `orchestrator.ts` `emitProjectContextSpawnEvents` and the `project_ready` broadcast hook.

## Actors invoked

| Actor | `input` shape | `output` shape | When invoked |
|---|---|---|---|
| `resolveInitialScope` | `{ org_id, intent_project_id, principal_id }` | `{ project } \| { no_projects: true } \| { cross_tenant: true } \| { project_not_found: true }` (optionally `most_recent_session_per_project`, `degraded_project_ids`) | On entry into `resolving_initial_scope` |
| `createProject` | `{ org_name, correlation_id, principal_id }` | `ProjectSummary` (id + name) | On entry into `creating_project` |
| `switchProject` | `{ new_project_id, correlation_id, principal_id }` | `{ project } \| { access_revoked: true } \| { project_not_found: true }` | On entry into `switching_project` (MR-4) |

## Context fields (current)

| Field | Type | When populated | Read by | Notes |
|---|---|---|---|---|
| `correlation_id` | `string` | construction | every emission | always |
| `principal_id` | `string` | construction | actor inputs | from auth-proxy `X-User-Id` |
| `org_id` | `string` | `auth_ready` | actor inputs; projection | `""` until J-001 settles |
| `user` | `{ first_name: string \| null }` | `auth_ready` | projection / FE | for greeting copy |
| `project` | `{ id: string \| null; name: string \| null }` | `project_selected` entry | projection; `project_ready` broadcast | both null until settled |
| `intent_project_id` | `string \| null` | `open_deep_link` / `switching_project_intent` | `resolveInitialScope`, `switchProject` inputs | cleared on `switchProject` `onDone` and on `back_to_projects_clicked` |
| `intent_session_id` | `string \| null` | `open_deep_link` | forwarded via `project_ready` payload to session-chat | cleared on `back_to_projects_clicked` |
| `intent_resource_id` | `string \| null` | `open_deep_link` | forwarded via `project_ready` payload | cleared on `back_to_projects_clicked` |
| `intent_resource_type` | `ResourceType \| null` | `open_deep_link` | forwarded via `project_ready` payload | cleared on `back_to_projects_clicked` |
| `underlying_cause_tag` | `ProjectContextCauseTag \| null` | mismatch / error transitions | projection; FE diagnostic copy | union of 6 cause kinds |
| `last_live_state` | `ProjectContextState \| null` | error transitions | retry routing (parallels session-chat) | unused in project-context's retry table (the retry path always returns to `creating_project`) — kept for shape parity |
| `retries_count` | `number` | `retry_clicked` | observability | bumps each retry |
| `pending_project_name` | `string` | `create_project_submitted` (valid) | `createProject` input on retry | preserved across `creating_project` ↔ `error_recoverable` |
| `project_validation_error` | `ProjectValidationError \| null` | `create_project_submitted` (invalid) | projection / inline error UI | `null` after a successful submit |
| `scope_reconciled_count` | `number` | `switchProject` `onDone {project}` | observability | OQ-J002-5 |
| `stale_intents_dropped_count` | `number` | (reserved) | observability | OQ-J002-5 |
| `most_recent_session_per_project` | `Record<string, string>` | `resolveInitialScope` `onDone` | orchestrator emits `last_used_resolution_degraded` from this | OQ-J002-5 |
| `last_used_degraded_project_ids` | `string[]` | `resolveInitialScope` `onDone` | orchestrator emits `last_used_resolution_degraded` | OQ-J002-5 |

NOTE: Per ADR-028 §"Amendment 2026-05-15", context should carry internal handler state only; cross-state communication rides on `event.output`. The current field set may include legacy "lying-about-nullability" fields targeted for LEAF-A through LEAF-D migration per ADR-030. In particular, `intent_session_id` / `intent_resource_id` / `intent_resource_type` are CARRIED transiently on this machine's context between `open_deep_link` and `project_selected`, where the orchestrator forwards them to session-chat via the `project_ready` payload — but per the amendment they should ride on the event surface, not context.

## Cross-machine wiring

- **Receives from orchestrator:** `auth_ready` (from login-and-org-setup `ready` entry — carries `org_id` + `user: { first_name }`).
- **Emits projection events** (via `orchestrator.appendProjectContextTerminalEvents` and adjacent emitters): `no_projects_displayed`, `project_creation_started`, `project_validation_failed`, `project_selected`, `project_switched`, `switching_project_started`, `scope_mismatch_displayed`, `deep_link_opened`, `last_used_resolution_degraded`.
- **Triggers downstream broadcast:** the orchestrator's state-watcher branch observes `project_selected` entry and broadcasts a `project_ready` event to the session-chat machine (idempotent on same `project_id`; invalidates `session_id` + `resource_*` on different `project_id` per IC-J002-4).

## Files in this directory

- `machine.ts` — the XState v5 machine factory + types + production actor factories (`resolveInitialScopeActor`, `createProjectActor`, `switchProjectActor`)
- `validation.ts` — `validateProjectName`, `ProjectValidationError`
- `index.ts` — barrel; re-exports the public surface (machine + actors + types + validation)
- `machine.test.ts` — vitest unit tests (port-to-port at the XState actor's `send` / snapshot surface)
- `README.md` — this file

## Related design docs

- `docs/evolution/2026-05-15-failure-simulation-consolidation/` — failure-simulation knobs this machine respects (`X-Force-Create-Project-Failure`, `X-Force-List-Sessions-Failure`)
- `docs/feature/project-and-chat-session-management/design/` — J-002 design wave (will migrate to docs/evolution/ on FINALIZE)
- `docs/decisions/adr-027-flow-state-tier-and-framework.md`, `adr-028-xstate-v5-actor-model.md`, `adr-030-flow-state-topology-and-scaling.md`
- `docs/discussion/session-chat-context-architecture/directions.md` — the JTBD analysis that motivated the A+F convergence
