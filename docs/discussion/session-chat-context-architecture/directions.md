# Session-Chat Context Architecture — Divergence Directions

**Status:** DESIGN-wave divergence artifact. Not a decision. Not a refactor dispatch.
**Date:** 2026-05-15
**Trigger:** L3 refactor on `session-chat.ts` stalled — both "spawn state-scoped child actors" and "nested sub-objects on parent context" were rejected by review. Underlying question: *why is the god context there in the first place?*
**Scope:** `ui-state/lib/machines/session-chat.ts` (16-field ctx) and its sibling `ui-state/lib/machines/project-context.ts` (16-field ctx); the orchestrator's snapshot-read pipeline; the projection's mirror of context shape.
**Reading time:** ~30 minutes. Suitable for a follow-up DESIGN-wave session.

---

## 1. The phenomenon — what we're actually looking at

`SessionChatMachineContext` (`session-chat.ts:69`) carries 16 fields whose meaningful lifetime spans **a single state apiece**:

| Field group              | Populated on entry to              | Read by                             | Lives in ctx across      |
|--------------------------|------------------------------------|-------------------------------------|--------------------------|
| `org_id` / `project_id` / `project_name` | `loading_session_list` (via `project_ready`) | every projection emit | whole flow              |
| `session_list` / `next_cursor` / `has_more` | `session_list_visible`         | `appendSessionChatTerminalEvents` lines 791-793 | session-list states only |
| `session_id` / `transcript` / `resource` | `session_active`                | lines 832, 849-852                  | active-session states only |
| `intent_session_id`      | `waiting_for_project` (forwarded) | `loadSessionList` onDone guard, line 349 | until first onDone branch settles |
| `pending_first_message`  | `session_active_no_messages` (composer)  | `createSessionEagerly` input, line 575 + error-recover passback | welcome ↔ error round-trips |
| `underlying_cause_tag` / `last_live_state` / `retries` | `error_recoverable` entry | retry guards (lines 600/609/621) | error subgraph             |
| `stale_intents_dropped_count` | observability                | counter — never read by transitions  | whole flow (write-only)    |

`project-context.ts` is structurally identical: 16 fields, same shape, with the additional pathology that **`intent_resource_id` / `intent_resource_type` are stored in project-context's ctx but never read by project-context** — pure pass-through for the orchestrator's `project_ready` payload to session-chat. The pre-LEAF-1 codebase did the same for session-chat's symmetric intent fields.

The inline comments in `session-chat.ts:79-84` are the smoking gun:

```ts
  // Session list state — populated on session_list_visible entry:
  session_list: SessionSummary[];
  // Active session — populated on session_active entry (MR-2 read path; MR-3 write path):
  session_id: string | null;
  transcript: TranscriptMessage[];
```

The developer is using comments to express **state-scoped typestate** that XState v5's single-context model cannot encode. The type system says all fields are always present. The comments say "actually, only in states X / Y / Z."

## 2. What JOB is the god context currently doing for the team?

Before generating directions, surface the JTBD — eliminate the job and the pressure for the artifact dissolves.

**Functional job:** *"Let me read the machine's settled state at one well-known place (the snapshot's `context`) so that I can serialize it into a projection FlowEvent without coordinating across spawned children, async boundaries, or external stores."*

That is what the god context does. Specifically:

- **J1 — snapshot-driven projection serialization.** `appendSessionChatTerminalEvents` (orchestrator.ts:780-897) reads `ctx.session_list`, `ctx.session_id`, `ctx.transcript`, `ctx.resource`, `ctx.intent_session_id`, `ctx.underlying_cause_tag`, `ctx.pending_first_message` — 7 read sites — at the moment the machine settles. The function's contract is "give me everything I need to emit the right FlowEvent for whatever state we just landed in." A god context is the simplest data shape that satisfies this.
- **J2 — async-invoke continuation carrier.** `intent_session_id` must survive the `loadSessionList` async boundary so the `onDone` guard at line 349 can branch. XState's `event.output` *could* carry this, but only if the actor itself is restructured — that's an L4-module-scope change.
- **J3 — error-recovery state restoration.** `last_live_state` lets the `retry_clicked` guards (lines 600/609/621) replay the user back into the failed live state. Without this field, error_recoverable would need either a sub-statechart per source state OR an event-sourced replay.
- **J4 — composer-text preservation across welcome ↔ error round-trips.** `pending_first_message` is the only thing keeping the user's typed message alive when `createSessionEagerly` fails and they retry. Component-local FE state is per-mount and would be lost on remount.
- **J5 — emotional / social: defensible reviewability.** When a reviewer asks "where does the resumed session's dataset_id come from?" the answer "line 90 of the context interface" is the *fastest* answer in the codebase. A scattered architecture pays a navigation tax.

**The directions below each propose a different way to discharge J1–J5.** If you don't discharge J1, the god context grows back regardless of the architecture you pick.

---

## 3. The five directions

Each direction answers: (a) why does the god-context pressure not arise here, and (b) what's the migration story?

### Direction A — Event-sourced state: machines are pure transition validators, projection log IS the state

**Architectural shape.** XState machines hold a *minimal* context (correlation_id, principal_id, and any literal continuation pointers needed mid-invoke). All durable state lives in the FlowEvent log. The orchestrator reads from the **projection** (already built from the log via `buildProjection`) to emit downstream events, not from the machine's snapshot context. Async-invoke onDone branches emit a domain event into the log, and the projection answers "what state are we in now" by replaying.

```
ui-state/lib/
├── machines/
│   ├── session-chat.ts          (ctx: { correlation_id, principal_id })
│   └── project-context.ts       (ctx: { correlation_id, principal_id })
├── orchestrator.ts              (reads from projection.context, never from snapshot.context)
├── projection.ts                (already exists — promoted to authoritative read model)
└── repositories/                (NEW — adapters wrapping projection reads for use cases)
```

**Pressure-relief mechanism.** J1 evaporates: the orchestrator stops reading from `snapshot.context` entirely. There's nothing TO put in context because the projection (which is rebuilt by replay anyway — DWD-9 SSOT) already holds the answer. J2 (async continuation) is solved by emitting a `session_list_loaded` event *before* the guard fires — the guard reads from `projection.context.intent_session_id`. J3 (error restore) and J4 (composer preservation) are projection-resident the same way the existing `pending_first_message` already round-trips through `session_chat_recoverable_error` → projection.

**Cost.**
- *Migration scope:* substantial but bounded. The projection reducer already mirrors context fields 1:1 — projection.ts is 90% of the destination. The orchestrator's 7 read sites become 7 reads against `getProjection(flow_id).context.*` instead of `snapshot.context.*`.
- *ADR amendments:* ADR-030 (orchestrator pattern) needs an amendment promoting projection-as-read-model from "downstream side effect" to "primary read model". ADR-028 (XState v5 actor model) needs an amendment loosening "machines own state" to "machines own transitions; the log owns state."
- *Test-shape changes:* the existing `waitForSettledState` helpers settle on machine-state; they'd need a sibling helper that settles on projection-sequence-id. Acceptance tests already read from the projection (see `tests/acceptance/.../test_us_*.py`), so the user-facing test surface is largely unchanged.
- *Team-learning surface:* "the machine doesn't hold the answer — the log does" is a real model shift. Onboarding cost ~1 week per new contributor.

**Reversibility.** *Moderate to low.* Once acceptance tests assert "the projection at sequence_id N has shape X," reverting to snapshot-driven serialization means re-establishing those assertions against a different read model. The harder reversal is cultural: contributors stop thinking of the machine as "where the data lives."

**Taste verdict — moderate fit.** Event-sourcing is *idiomatic in this codebase already*: the projection layer was built as an event-sourced read model from day 1 (DWD-9: "the projection is rebuilt from the log; the snapshot is a cache"). The FastAPI backend uses Alembic-versioned migrations + Success/Failure-wrapped use cases — not event-sourced. But the **ui-state tier specifically** has always treated the log as the SSOT; this direction makes that explicit rather than dual-truthed with the snapshot context. Risk: developer reflex to "just stash one more field in ctx" is hard to break with linting alone.

### Direction B — Aggregate-per-cluster: split into 4 machines orchestrated by a coordinator

**Architectural shape.** Each state-scoped cluster becomes its own machine in `ui-state/lib/machines/<cluster>/`:

```
ui-state/lib/machines/
├── coordinator.ts               (thin: which-cluster-is-active + cross-cluster events)
├── session-list/                (states: idle, loading, visible; ctx: list, cursor, has_more)
├── active-session/              (states: resuming, active, switching_dataset; ctx: session_id, transcript, resource)
├── composer/                    (states: empty, draft, sending; ctx: pending_first_message)
└── error-recovery/              (states: idle, recoverable, terminal; ctx: cause_tag, last_live_state, retries)
```

The coordinator's context is thin (just `correlation_id`, `principal_id`, `org_id`, `project_id`, and which cluster is currently "live"). Each cluster machine has a context bounded by *its own state graph* — a session-list machine cannot grow a `transcript` field because transcripts belong to active-session.

**Pressure-relief mechanism.** The compiler enforces what the comments currently document: cluster machines literally cannot declare fields that don't belong to their cluster. Cross-cluster reads happen via **published events** (cluster A sends `list_refreshed` event to the coordinator; coordinator broadcasts to cluster B), not snapshot introspection. The 7 orchestrator read sites become 7 event-subscription handlers — same surface count, but each handler reads from a narrow, locally-scoped snapshot.

**Cost.**
- *Migration scope:* large. Four new machine files, coordinator scaffolding, event-routing rules between clusters. The implementing agent's earlier concern about `.children.X?.getSnapshot().context.field` accessor noise comes back — but now with named, typed accessors per cluster (`sessionList.context`, `activeSession.context`) rather than anonymous spawned-child lookups.
- *ADR amendments:* **ADR-028 must amend** the "no machine imports another" invariant — the coordinator imports four cluster machines. The invariant's *spirit* (no peer-to-peer machine coupling) is preserved (clusters don't import each other), but the *letter* is broken. A new ADR likely needed: "coordinator-aggregate pattern for FSMs with disjoint state clusters."
- *Test-shape changes:* `waitForSettledState` becomes `waitForCoordinatorSettled` + per-cluster settle helpers. The timing hazard the original implementing agent flagged (parent settles before child's assign completes) is real and must be solved at the coordinator level (e.g., coordinator does not declare itself settled until all child clusters report settled).
- *Team-learning surface:* coordinator-aggregate is a well-known pattern (DDD aggregate roots, Akka guardian actors) — onboarding cost is documentation, not paradigm shift.

**Reversibility.** *Moderate.* The split is mostly a refactor; collapsing back to a single machine is mechanical. The hard-to-reverse piece is the coordinator's event-routing rules — those become the de facto cross-cluster contract and grow API surface.

**Taste verdict — moderate-to-low fit.** Coordinator-aggregate is idiomatic in actor frameworks (Akka, Erlang) but XState v5 in 2026 is **not** organized around hierarchical aggregates. XState's idiom is **single-machine-with-states** (or invoked/spawned actors as *workers*, not as *peers*). This direction borrows from a different paradigm and pays the borrowing tax (custom coordinator scaffolding, custom settle semantics). The L3 reviewer's "law of Demeter" concern lands here: every cross-cluster read crosses a coordinator hop.

### Direction C — Typestate via discriminated-union context (TS-only)

**Architectural shape.** No runtime change. The context type becomes a discriminated union:

```ts
type SessionChatContext =
  | { _tag: "WaitingForProject"; correlation_id: string; principal_id: string; intent_session_id: string | null }
  | { _tag: "LoadingSessionList"; correlation_id: string; principal_id: string; org_id: string; project_id: string; project_name: string; intent_session_id: string | null }
  | { _tag: "SessionListVisible"; ...; session_list: SessionSummary[]; session_list_next_cursor: string | null; ... }
  | { _tag: "ResumingSession"; ...; intent_session_id: string }
  | { _tag: "SessionActive"; ...; session_id: string; transcript: TranscriptMessage[]; resource: {...} }
  | { _tag: "SessionActiveNoMessages"; ...; pending_first_message: string }
  | { _tag: "ErrorRecoverable"; ...; underlying_cause_tag: SessionChatCauseTag; last_live_state: SessionChatState; retries: number };
```

Each `assign` is wrapped in a type-guard that narrows the union; the orchestrator's read sites become exhaustive switch statements over `ctx._tag` and benefit from compile-time field-presence checks.

**Pressure-relief mechanism.** The type system enforces what the comments document. Adding a 17th field requires choosing which variant(s) it belongs to. Reading `ctx.session_list` in a `WaitingForProject` variant is a compile error.

**Cost.**
- *Migration scope:* smallest of any direction. No new files, no ADR amendments to the architecture (ADR-028 is unchanged — machines still don't import each other, single context per machine), no test-shape changes.
- *ADR amendments:* none.
- *Test-shape changes:* none, except acceptance tests gain type-safety at the orchestrator read sites.
- *Team-learning surface:* TypeScript discriminated unions are a familiar pattern. Cost is in the *XState v5 idiom mismatch* — see below.

**Reversibility.** *Very high.* TS-only; revert is a `git revert` plus removing the `_tag` propagation.

**Taste verdict — poor fit, despite low cost.** XState v5 documentation is explicit: **typestate was dropped from v4 because every `assign` would need union narrowing at the call site, and XState's `assign` API does not lend itself to that ergonomically.** The v5 team's stated alternative is "use spawned child actors or invoked machines for state-scoped data" — i.e., they explicitly point you at Direction B (or a variant). Attempting typestate in v5 means writing type-guards at every `assign` site and casting to the correct variant on every read; the boilerplate scales linearly with field count. Worse: `assign` itself returns the whole context object, so a partial assign that doesn't touch all variant-required fields is a type error. The library is fighting you. This is the option that **looks cheap and turns expensive at the 50th assign site.**

### Direction D — State-as-data: orchestrator owns state, machines are stateless guards

**Architectural shape.** Invert the relationship between orchestrator and machine. The orchestrator (or a sibling "session-state actor") owns all state in its own actor-context. The XState machines become **stateless transition validators**: given (current_state, event), they publish "I'd allow this transition" verdicts.

```
ui-state/lib/
├── session-state-actor.ts       (owns ALL J-002 state; the only stateful actor)
├── machines/
│   ├── session-chat-rules.ts    (pure rules: which transitions are legal from which states)
│   └── project-context-rules.ts (same)
└── orchestrator.ts              (still mediates events, but reads/writes session-state-actor directly)
```

**Pressure-relief mechanism.** There is exactly one place state lives (the session-state actor). The machines literally cannot have a god context — they don't have context at all. Async-invokes become commands sent to the session-state actor, which holds the intent_session_id between dispatching the command and receiving the result.

**Cost.**
- *Migration scope:* very large. This is an inversion of the architecture, not a refactor. XState's value (compiler-checked statecharts, visualizable diagrams, declarative transition tables) survives in the rules files, but the *runtime* role of the machine collapses.
- *ADR amendments:* **ADR-027 (XState v5 adoption) is materially altered** — we're using XState as a rules engine, not as a state container. ADR-030 (orchestrator pattern) is rewritten — the orchestrator becomes a state owner, not a mediator.
- *Test-shape changes:* every test that reads from `getMachineSnapshot()` is rewritten to read from `getSessionStateActor().getSnapshot()`. The acceptance tests' projection-shape assertions are largely unchanged (they read from the projection, not from the machine).
- *Team-learning surface:* "the machine is not where the data lives" is again a real model shift, with the added wrinkle that this direction is *uncommon in the XState ecosystem*. There are few external references to learn from.

**Reversibility.** *Low.* Once the session-state actor owns the writes, reverting to machine-owned context means re-establishing all the locking / atomicity invariants that the actor's serial mailbox currently provides for free.

**Taste verdict — poor fit.** This direction throws away the thing XState is best at (managing transitions *with* their state) to solve a problem (god context) that smaller directions also solve. It's a sledgehammer. It also positions us *against* the ecosystem — every external XState v5 example assumes machine-owned context. We'd be a permanent outlier.

### Direction E — DDD aggregate roots: model Session as an aggregate, FSM is the protocol

**Architectural shape.** Model `Session` as a DDD aggregate root with state members (List, Active, Composer, Recoverable). The FSM is the aggregate's *protocol* — the legal command sequences — not its data store. Data is held by repository-shaped adapters that the FSM coordinates.

```
ui-state/lib/
├── domain/
│   ├── session-aggregate.ts     (Session aggregate; state members; commands)
│   ├── session-list-view.ts     (read-model adapter)
│   └── session-repository.ts    (port; backed by FlowEvent log + transcript cache)
├── machines/
│   └── session-protocol.ts      (XState; ctx holds only aggregate references, not data)
└── orchestrator.ts              (commands → aggregate; aggregate emits events; events project)
```

**Pressure-relief mechanism.** The aggregate enforces invariants the FSM cannot (e.g., "a Session in ListView state has no transcript"). Data fields live on state-member objects (`session.activeState.transcript`), which only exist when the aggregate is in that state. The FSM holds a reference to the aggregate; reading `transcript` requires `session.requireActive().transcript` which throws a typed error when called in the wrong state — runtime + compile-time discipline.

**Cost.**
- *Migration scope:* large. Domain layer is new in `ui-state/`. Backend already has a domain/use-case structure (per CLAUDE.md), but ui-state has been deliberately thin (BFF pattern).
- *ADR amendments:* a new ADR for "ui-state domain layer" — currently ui-state has no domain layer, by design. ADR-030 (orchestrator pattern) is amended: the orchestrator dispatches to the aggregate rather than reading from the machine.
- *Test-shape changes:* unit tests on the aggregate become possible (and valuable). The acceptance tests are unchanged (they still drive through HTTP / SSE). Characterization tests on the existing machine would be needed before migration to preserve behavior.
- *Team-learning surface:* DDD is well-documented but **opinionated**. The codebase currently uses use-case-per-module on the backend (functions, not aggregates). Introducing aggregates only in ui-state creates a paradigm split between backend and BFF.

**Reversibility.** *Moderate-to-low.* Aggregates become the model contributors think in; reverting to "the machine owns the data" feels like a regression once the aggregate is in place.

**Taste verdict — low fit.** dashboard-chat's backend uses **functional use-cases with Success/Failure wrappers** (see `app/use_cases/<domain>/` per CLAUDE.md) — not DDD aggregates. The project deliberately picked a leaner paradigm. Introducing DDD aggregates only on the ui-state side creates two divergent modeling philosophies in one repo. Worth considering only if we also re-paradigm the backend, which is out of scope for this discussion.

---

## 4. Cross-direction matrix (at a glance)

| Direction | Discharges J1 (proj. read) | Discharges J2 (async continuation) | Discharges J3 (error restore) | Discharges J4 (composer preserve) | ADR-027 | ADR-028 | ADR-030 | Reversibility |
|-----------|----------------------------|------------------------------------|-------------------------------|-----------------------------------|---------|---------|---------|---------------|
| A — Event-sourced | yes (projection is the read model) | yes (event-resident) | yes (event-resident) | yes (event-resident) | unchanged | amend | amend | moderate |
| B — Aggregate-per-cluster | partial (events between clusters) | per-cluster | per-cluster | composer-cluster | unchanged | **amend (no-import invariant)** | amend | moderate |
| C — Typestate union | no (ctx still holds it, just narrower) | yes (variant carries it) | yes (variant carries it) | yes (variant carries it) | unchanged | unchanged | unchanged | very high |
| D — State-as-data | yes (actor owns it) | yes (actor holds intent) | yes (actor holds last_live_state) | yes (actor holds composer) | **rewrite** | rewrite | **rewrite** | low |
| E — DDD aggregates | partial (aggregate state-members) | aggregate command-result | state-member-resident | composer state-member | unchanged | unchanged | amend | moderate-to-low |

## 5. Surfacing additional candidates the question didn't list

Two further directions surfaced during this analysis. Including for completeness; neither was in the original prompt's candidate list.

### Direction F (bonus) — Output-channelled invokes: don't store, pass

**Shape.** The pressure on `intent_session_id` specifically (the J2 job — async-invoke continuation) is solved by restructuring the `loadSessionList` invoke so its **output** carries the branch decision rather than reading from context. The invoke takes `intent_session_id` as input, the actor returns `{ items, next_cursor, has_more, resume_target: string | null }`, and the onDone branch chooses target purely from `event.output.resume_target`. No `intent_session_id` field in context at all.

**Why it's worth listing.** This is a **leaf-scope tactic** that could be applied to Direction A, B, or C *in addition*. Worth a separate ADR-amendment paragraph in whatever direction wins: "async-invoke continuations should be carried by `event.output`, not by ctx fields that survive across the boundary."

**Taste verdict — high fit, narrow scope.** This is just good XState v5 hygiene. Doesn't solve the broader god context problem (the projection-serialization job J1 dwarfs J2 in field count), but eliminates the LEAF-1-shaped scope leak in both machines without architectural commitment.

### Direction G (bonus) — Two-tier projection: snapshot the projection, never the machine

**Shape.** Keep machines as-is (with their god contexts), but **forbid the orchestrator from reading `snapshot.context.*`**. Instead, the orchestrator emits a *minimal-payload* "state entered" event on every transition, and the projection reducer's existing handlers (which already mirror context shape) produce the read model. Linting rule: `snapshot.getContext()` is banned outside test fixtures.

**Why it's worth listing.** This is the **smallest possible change that breaks the god context's grip on the orchestrator** without rewriting machine internals. The pressure to grow ctx by one more field for serialization-convenience evaporates: the orchestrator literally cannot read it. Over time the unused fields can be removed (LEAF refactors, one per field).

**Taste verdict — high fit, gradual.** This is the "boil the frog" path. It doesn't make any commitment, doesn't amend any ADR, and lets the team evaluate over time whether the remaining context fields are truly needed. Effectively a **policy direction rather than an architecture direction.** Worth seriously considering as a first move before any of A–E.

---

## 6. Bringing it together — what the discussion should consider

The directions cluster naturally:

- **Low cost, low reach:** F (output-channelled invokes), G (forbid snapshot reads), C (typestate — but XState v5 fights it).
- **Medium cost, structural:** A (event-sourced), B (aggregate-per-cluster).
- **High cost, paradigm-shifting:** D (state-as-data), E (DDD aggregates).

The 80/20 take, surfaced for the converging session: **A + F + G are mutually compatible and address the actual job-to-be-done.** Direction G is a *policy* that constrains future change; F is a *tactic* that resolves the LEAF-1-shaped leaks; A is the *architecture* that makes both stable over time. Directions B, C, D, E each commit to a different philosophy that doesn't match the rest of dashboard-chat.

The DELIVER team's pushback ("god context is the simplest data shape") is correct **for J1 (snapshot-driven projection)**. The question to converge on is: *do we agree that J1 should not exist?* If yes → A. If no → G (limit the damage). If "we need to think more" → F (defensible regardless).

The in-flight `refactor/session-chat-context-srp` branch (LEAF-1: intent_resource_id/type removed) is consistent with F — that branch is defensible under any direction picked and should not be discarded.

---

## 7. Reading recommendations before convergence

- ADR-027 (XState v5 adoption rationale) — confirms the paradigm we committed to.
- ADR-028 (no machine imports another) — Direction B's main casualty.
- ADR-030 (orchestrator pattern) — Direction A and D both amend this.
- DWD-9 (SSOT-via-log invariant) — Direction A makes this load-bearing rather than nice-to-have.
- The XState v5 docs on `spawn`/`invoke` and the v5 changelog on typestate removal — confirms Direction C is fighting the library, not extending it.

---

*This artifact is exploratory. It does not recommend a direction. A follow-up DESIGN-wave session should converge on one (or a hybrid) with a fresh ADR captured.*
