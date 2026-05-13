# SRP/SOLID Review — J-002 Machine Decomposition

**Reviewer**: nw-software-crafter-reviewer (overseer-dispatched)
**Date**: 2026-05-13
**Files reviewed**: `ui-state/lib/machines/login-and-org-setup.ts` (660 LOC) and `ui-state/lib/machines/project-and-chat-session-management.ts` (733 LOC)
**Review angle**: SRP / RPP L3 (Responsibilities) — does the conjoined naming hide independent responsibilities?

---

## Machine 1: `login-and-org-setup`

**Verdict: SRP INTACT — keep as-is.**

### Evidence

1. **Single load-bearing responsibility**: user authentication + first-org provisioning + JWT reissue. These are inseparable at the state boundary:
   - `authenticating` (line 245-252) → `onDone` assigns user data from WorkOS.
   - `authenticated_no_org` (line 268-284) waits for org-form submission + name validation.
   - `creating_org` (line 299-336) invokes `createOrgAndReissue`. JWT MUST be reissued before transitioning to `ready` (line 310), because downstream machines read `org_id` from the JWT claim (ADR-029 invariant I1).

2. **No feature envy**: context fields align with state group. `authenticated_no_org` never touches `reissue_attempts` (line 268-296); only `creating_org` does (line 323).

3. **No divergent change trigger**: a change to WorkOS integration vs. a change to org-creation validation touch *different state paths*, not the same code.

4. **The name is honest**: the "and" denotes sequence dependency, not collocation. Per the FINALIZE.md and journey contract, these steps are not optional, not parallel, not independently interesting downstream.

### Counterfactual — why not split?

A hypothetical `authentication` + `org-provisioning` split would require orchestrator-level coordination to enforce "after authentication completes, invoke org-provisioning, only then emit `j001_ready`." Three defects:

1. **Race condition**: J-002 could receive `j001_ready` before org-provisioning completes if broadcast timing is off.
2. **Complexity inversion**: ADR-028 introduced the actor model to avoid hand-rolled cross-machine coordination. Splitting J-001 reverses that decision.
3. **Tested invariant violation**: the orchestrator broadcast hook (orchestrator.ts ~line 290) listens for J-001 `ready` and fires `j001_ready` atomically. Splitting fragments invariant ownership.

---

## Machine 2: `project-and-chat-session-management`

**Verdict: SRP INTACT now (MR-1) — AT RISK by MR-6.**

### Current state (MR-1 substrate)

5 live states (lines 287-439): `resolving_initial_scope`, `no_projects_empty_state`, `creating_project`, `project_selected`, `scope_mismatch_terminal`, `error_recoverable`. All tightly coupled to ONE concern: **project resolution + creation on initial scope entry**. The machine does not yet do session management, dataset switching, or chat lifecycle. Naming is forward-looking but not misleading at MR-1.

### Future state (MR-2..MR-6 roadmap)

The same machine will add 9 new states across 5 distinct behavioral domains:

| Cluster | States | MR |
|---|---|---|
| **Scope Resolution** | resolving_initial_scope, no_projects_empty_state, creating_project, project_selected, scope_mismatch_terminal | MR-1 (current) |
| **Session Lifecycle** | loading_session_list, session_list_visible, resuming_session | MR-2 / MR-3 |
| **Transcript / Active Session** | session_active_no_messages, session_active | MR-2 / MR-3 |
| **Resource Context** | switching_dataset_context | MR-5 |
| **Project Switching** | switching_project | MR-6 |
| **Freeze/Thaw Coordination** | freeze | MR-6 (cross-machine) |

### Context field analysis (lines 75-125)

Today's context is tight: `org_id`, `project`, `intent_*`, `pending_project_name`, errors. By MR-6, the same context will carry:

- `session_list`, `session_list_next_cursor`, `most_recent_session_per_project` (session domain)
- `session_id`, `transcript` (transcript domain)
- `resource` (resource domain)
- `last_live_state`, `scope_reconciled_count`, `stale_intents_dropped_count`, `last_used_degraded_project_ids` (observability plumbing)

**4+ logical context groups in ONE machine.** The session-lifecycle branch will never touch `project`; the resource-context branch will never touch `session_id`.

### Smells that emerge by MR-6

- **Divergent change**: bug in session-resume requires understanding project-resolution states.
- **Shotgun surgery**: a bug in resource-context switching requires understanding session-state to know whether a resource switch is allowed.
- **Feature envy** between context fields and states.

---

## Pattern implication for future machines

If J-002 ships as `project-and-chat-session-management` with 14 states across 5 responsibilities, future workers will learn this as the team's convention for composite state machines. They'll create:

- J-003: `search-and-export-and-versioning` (3 concerns)
- J-004: `transform-and-scheduling-and-monitoring` (3 concerns)

instead of:

- J-003: `search` + orchestrator coordination
- J-004: `transform` + orchestrator coordination

**This pattern is teachable from the code.** ADR-028's actor-model commitment was exactly to enable decoupling at the orchestrator layer, not to avoid it.

---

## Recommended split (proposed seam)

Split BEFORE MR-2 implementation begins:

```
project-context-machine (MR-1 current + MR-6 switching_project)
  States: resolving_initial_scope, no_projects_empty_state,
          creating_project, project_selected, scope_mismatch_terminal,
          switching_project, error_recoverable
  Context: org_id, project, intent_project_id, pending_project_name,
           last_used_degraded_project_ids, errors/retries

session-chat-machine (MR-2..MR-5 responsibility)
  States: loading_session_list, session_list_visible, resuming_session,
          session_active_no_messages, session_active,
          switching_dataset_context, error_recoverable
  Context: session_id, transcript, resource, session_list, errors/retries

Orchestrator coordination:
  - project-context emits "project_ready" on project_selected entry
  - session-chat receives input {org_id, project_id} from broadcast
  - Both machines receive FREEZE/THAW from orchestrator (unchanged)
```

### Justification

1. Each machine has a single load-bearing responsibility (project selection vs. session lifecycle).
2. No feature envy: project-context never touches transcripts; session-chat never initiates project changes.
3. Divergent change is isolated: changes to session-resume don't require understanding project resolution.
4. Naming becomes honest: `project-context-machine` + `session-chat-machine` are clear, not adorned.
5. Testability improves: unit tests of session-resume don't set up 6 project-resolution states.
6. **Future workers learn**: "One machine, one flow. Coordinate via orchestrator."

### Concrete handoff mechanism

The handoff is `project_selected` → broadcast `project_selected` event to session-chat machine with payload `{ org_id, project_id }`. Session-chat waits for this event before moving out of a "waiting-for-project" state. **Same pattern as J-001 → J-002 today** (orchestrator.ts ~line 290 `j001_ready` broadcast hook).

---

## Summary table

| Machine | Verdict | Action |
|---|---|---|
| **login-and-org-setup** | SRP INTACT | APPROVE; keep as-is, name is architecturally correct |
| **project-and-chat-session-management** | SRP AT RISK (by MR-6) | APPROVE MR-1; REQUIRE split before MR-2 begins. Propose `project-context` + `session-chat` machines coordinated via orchestrator. |

**Pattern impact**: Interrupt J-002's conjoined-machine pattern now. ADR-028's actor-model commitment exists precisely to enable this decoupling.
