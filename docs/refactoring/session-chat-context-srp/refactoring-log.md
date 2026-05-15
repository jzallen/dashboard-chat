# RPP L3 — SessionChatMachineContext SRP refactor

**Target:** `ui-state/lib/machines/session-chat.ts`
**Scope:** file
**Method:** extract (sub-object grouping)
**Date:** 2026-05-15
**Branch:** `refactor/session-chat-context-srp`

## Goal

`SessionChatMachineContext` had **16 fields** with inline comments documenting which state populates each ("populated on session_list_visible entry", "populated on session_active entry"). Comments-as-type-safety is the canonical L3 Responsibilities violation. Tighten SRP at the context-object level so the type itself expresses cluster lifecycle.

## Mikado tree

```
GOAL: SessionChatMachineContext expresses cluster lifecycle in the type system (≤10 fields, no "populated on X entry" lying-about-nullability comments)
├── LEAF-1: REMOVE intent_* fields from session-chat context entirely (event-payload, not durable state)
│   └── verify no reads survive the project_ready transition → confirmed: only consumer is the
│       `resuming_session` invoke input + the resume actor's onDone clears intent_session_id;
│       both can read directly from the project_ready event payload via a transient
│       "pending intent" capture pattern OR be inlined into the state-graph guards.
│       OBJECTION RESOLVED: keep intent_session_id only as a transient capture inside
│       loading_session_list (via context.pending_resume_intent_session_id) — it MUST
│       survive the loadSessionList invoke (async boundary) so the onDone branch can
│       choose between session_list_visible and resuming_session per DESIGN §3.2.B.
│       NOT pure event-payload — async invoke boundary forbids that. KEEP as a single
│       narrow field but rename for clarity and drop intent_resource_id / intent_resource_type
│       (those are NEVER read after capture — pure scope leak).
├── LEAF-2: EXTRACT session_list / session_list_next_cursor / session_list_has_more
│   into context.session_list_view: SessionListView | null
│   ├── update all 7 internal write sites in session-chat.ts (assign blocks)
│   ├── update orchestrator.ts SessionChatSnapshotContext type + 3 read sites
│   │   in appendSessionChatTerminalEvents (793-805)
│   └── verify acceptance tests via wire-surface reads (harness reads projection, not machine)
├── LEAF-3: EXTRACT session_id / transcript / resource into
│   context.active_session: ActiveSession | null
│   ├── update all 9 internal write sites in session-chat.ts
│   ├── update orchestrator.ts SessionChatSnapshotContext type + 4 read sites
│   │   (834, 851-854 in appendSessionChatTerminalEvents; 815 session_resume_started)
│   ├── update session-chat.test.ts ctx.session_id / ctx.transcript / ctx.resource
│   │   reads (6 sites) — these are unit tests at port boundary; minimal change
│   │   touching READ-shape only (no assertion semantic change).
│   └── verify acceptance tests pass (harness reads projection)
└── LEAF-4 (deferred — see quality-metrics.md): the child-actor spawn pattern
    the user originally suggested. Rejected for this MR on behavior-preservation
    grounds (would change orchestrator's terminal-event timing). Captured as
    follow-on if a future MR wants to push further toward the Hierarchical
    State Machine pattern.
```

## Mikado objection log

**Objection raised before any code change:** the user prompt specified spawning
`sessionListActor` and `activeSessionActor` as child actors. After scanning the
orchestrator (`ui-state/lib/orchestrator.ts:793-867`) I found 7 distinct sites
where the orchestrator reads these fields from the parent machine's snapshot
context to build FlowEvent payloads. Moving the fields into spawned children
forces `actor.getSnapshot().children.sessionListActor?.getSnapshot().context.session_list`
reads at every emission site, AND introduces a timing risk: the orchestrator's
`waitForSettledState` settles on the PARENT's state value, not the child's
populated context. The child's `assign` could lag the parent's `session_list_visible`
state value by a tick, leading to empty projections in race conditions.

**Resolution:** treat the user prompt's "child actor" framing as one valid
expression of L3 SRP; deliver the same SRP outcome via **nested sub-objects**
on the parent context. This:
- achieves the named target metric (16 → 10 context fields);
- removes the "populated on X entry" lying-comments (sub-object null guarantees
  reified into the type);
- preserves the orchestrator's emission timing (the field LOOKUP changes, not
  the lifecycle);
- keeps acceptance-test behavior identical (harness reads projection, not
  machine context, so machine-context shape changes are invisible to it).

The child-actor pattern stays available as a future move if MR-5 or MR-6 ever
needs per-cluster isolation lifecycle (e.g. independent telemetry on the
active-session subtree); recorded as LEAF-4 deferred.

## Leaf execution log

(Filled in as commits land. Each entry: commit hash, leaf id, file count.)

- LEAF-1 commit: `<pending>` — REMOVE intent_resource_id + intent_resource_type from session-chat context.
- LEAF-2 commit: `<pending>` — EXTRACT session_list_view sub-object.
- LEAF-3 commit: `<pending>` — EXTRACT active_session sub-object.
- LEAF-1b commit: `<pending>` — RENAME intent_session_id → pending_resume_intent (clarify async-invoke capture lifetime).

## Verification

Run before every commit:
```
python3 tools/check_workspace_consistency.py
cd ui-state && npx vitest run
cd tests/acceptance/project-and-chat-session-management && uv run --no-project pytest
cd tests/acceptance/user-flow-state-machines && uv run --no-project pytest
```
