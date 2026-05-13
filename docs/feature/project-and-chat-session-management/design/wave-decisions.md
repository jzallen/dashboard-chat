# Wave Decisions — DESIGN — `project-and-chat-session-management` (J-002)

> **Wave**: DESIGN (propose mode)
> **Date**: 2026-05-13
> **Architect**: nw-solution-architect (J-002 DESIGN wave)
> **Inherited from DISCUSS**: 18 artifacts under `docs/feature/project-and-chat-session-management/discuss/`; DISCUSS wave-decisions D1–D12 are IMMUTABLE inputs.
> **Companion deliverables**: `application-architecture.md` (binding architecture document), `c4-diagrams.md`, `handoff-design-to-distill.md`.

This document records the DESIGN-wave decisions (DWD-1..DWD-12) that resolve the two blocking open questions DISCUSS deferred (OQ-J002-1 storage shape; OQ-J002-6 stale-intent filter), the four non-blocking open questions (OQ-J002-2..OQ-J002-5), and the architectural variables that DISCUSS left for DESIGN.

J-002's DESIGN scope is **application-level** (per the command-args directive). System-tier substrate is amortized from J-001 (ADR-027/028/029/030 ratified 2026-05-11). DWD-* below sit inside that envelope.

---

## DWD-1 — J-002 machine structure: flat-compound (not parallel-region)

**Decision**: The J-002 XState machine is a single compound machine with **14 sibling states** (12 from the journey YAML + `error_recoverable` reachable via invoke errors + `freeze` reachable via top-level `on.FREEZE`). No parallel regions, no nested compound substates beyond what XState v5's standard `states:` block expresses.

The journey YAML's `no_sessions_empty_state` (kind `interactive`, sub-shape of `session_list_visible`) **collapses into `session_list_visible`** as a derived UI predicate: `context.session_list.length === 0`. The journey YAML calls it out as a separate name for emotional-arc clarity per DISCUSS D8, but it has no distinct transitions (`new_session_clicked`, `session_clicked`, `switching_project_intent`, `FREEZE` are all already declared on `session_list_visible`). Promoting it to a separate XState state would create a name that adds no behavior, only a derived UI shape — bad split.

**Rationale**:

1. **No concurrent sub-region exists.** Every J-002 transition runs to completion before the next event is processed. XState v5's single-event-at-a-time semantics already handle the rapid-fire dataset-pick case (US-209 Example 5); no `parallel: true` is needed.
2. **Flat-compound = best TypeScript inference.** XState v5's typed-events surface produces narrowest types when state values are string literals at the top level. Nested or parallel states make typed transitions less ergonomic without a behavioral payoff.
3. **Flat machines compose better with the orchestrator.** The orchestrator's `priorState` map (`ui-state/lib/orchestrator.ts:91-94`) reads string state values; nested states would force the orchestrator to enumerate paths.
4. **Mirrors J-001's shape** (per `ui-state/lib/machines/login-and-org-setup.ts:225-396`) — the team has one pattern, not two. The `nw-architectural-styles-tradeoffs` skill's "consistency over local optimization" heuristic applies.

**Why:** XState v5's idiomatic actor model maps one machine per flow; the orchestrator owns cross-machine coordination. Reusing J-001's pattern minimizes learning curve and review effort.

**How to apply:** Slice 1 lands the 5 initial states as siblings; Slice 2 adds 4 more siblings; Slices 3-6 add the rest. No restructuring needed mid-stream.

---

## DWD-2 — Resolution of **OQ-J002-1**: session-metadata storage shape → **Option A (column on session row)**

**Decision**: Add a single nullable column `active_dataset_id String(36)` to the `sessions` table via a new Alembic migration (`backend/migrations/versions/009_add_session_active_dataset_id.py`). Extend the `update_session.py` allowlist to include `"active_dataset_id"`. Read via the existing `get_session(session_id)` path.

**Why:** Three options were on the table per DISCUSS D11 and the product-owner's posture in `handoff-design.md` (Luna recommended Option A):

| Option | Smallest delta | Future-extensible | DELIVER-blocking dependencies |
|---|---|---|---|
| **A — column on session row** | ✓ Single column + allowlist line + null read | Single-value (no history); upgradable to Option B without losing data | None — Alembic migration + 2 file edits |
| B — side-log `session_dataset_attachments` table | ✗ New aggregate + new repository method + new use case | ✓ History-aware | New aggregate + index design |
| C — session-event-stream denormalization | ✗ Requires Stream.io reader (today's `event_replay.py` is noop) | ✓ Highest conceptual purity | Stream.io adapter must ship first (separate cross-cutting project) |

The user-observable contract (US-205: "dataset context survives session resume") is satisfied identically by all three. The differentiator is migration scope and infrastructure dependencies.

DISCUSS commits to behavior; storage shape is a DESIGN call. The product surface (US-205, US-209) does not require history or auditability — Luna's discovery noted "history queries are NOT in J-002's scope." Option A's reversibility (Option A → Option B is a future Alembic migration; the column would be left in place during transition) is acceptable. Option C's infrastructure dependency on Stream.io adapter is a separate concern that should not gate J-002 DELIVER.

**How to apply:** Slice 2 lands migration 009 BEFORE its stories enter DELIVER (slice-internal prerequisite). The migration's `downgrade()` is a dev-only escape hatch — production policy is forward-only (DWD-2 corollary). Slice 5 writes the column; Slice 2's resume path reads it. Both reads/writes happen via the existing repository surface.

**Risk acknowledged**: if a future feature surface adds dataset-attachment history (e.g., "show me datasets I attached to this session over time"), the column's single-value shape will be insufficient and a forward-migration to Option B will be needed. That migration is bounded — the existing data becomes the latest row in the side-log; no data is lost. ([R2 in DISCUSS handoff-design.md noted this is acceptable.](../discuss/handoff-design.md))

---

## DWD-3 — Agent X-Active-Scope contract: header preferred, body fallback with **compile-time sunset**

**Decision**: The agent's `handleChat` reads `org_id` + `project_id` (+ optional `resource_*`) **EXCLUSIVELY from the `X-Active-Scope` request header**. The request body's `project_id` field becomes a backward-compat fallback during a **one-release migration window**, gated by env flag `SCOPE_HEADER_FALLBACK_ENABLED`. The flag's enabled-state has a hard sunset enforced at compile time: `agent/lib/chat/handleChat.ts` includes a module-load assertion `Date.now() < SCOPE_HEADER_FALLBACK_SUNSET.getTime()` that fails-fast the agent's startup if the date has passed AND the flag is still in the codebase. This is the R8 mitigation Luna flagged in the DISCUSS review.

The header value is JSON-encoded `{org_id, project_id, resource_type, resource_id}` per ADR-029 §4. The header is set EXCLUSIVELY by the FE's `uiStateClient.activeScopeHeader(projection): string` helper (DWD-4 ratifies the lint rule). The agent additionally validates `X-Active-Scope.org_id === X-Org-Id` (auth-proxy-injected) and returns 403 on mismatch — defense in depth.

**Why:** The contract is specified by ADR-029 §4 already. What's new is two things:

1. **The mechanism for closing the migration window.** Flag-gated kill-switches without a hard sunset routinely outlive their useful purpose — Luna's R8 names this exact failure mode. A compile-time check is a forcing function: the engineer landing the J-002 DELIVER MR for Slice 4 also sets the sunset date and adds it to the team's calendar; the next dependency-bump MR will fail to build if the flag-removal hasn't landed by then.
2. **The choice to keep extraction inline (function call) rather than as Hono middleware.** Application-architecture.md §4.4 ratifies: Hono middleware would apply to non-chat routes too (e.g., `/health`); since scope is only relevant to chat endpoints, inline extraction has the right blast-radius. This is also why the validation lives at the start of `handleChat` rather than as a separate middleware function.

**How to apply:** Slice 4 DELIVER lands the middleware refactor + the flag (default true) + the compile-time check. The sunset date is set to ~6 weeks post-J-002-DELIVER (rough estimate; the engineer sets the literal date at MR-time). DEVOPS instruments `scope_header_fallback_used { calling_client }` per K-J002-5 — when the rate trends to zero, the flag's removal is a one-line PR. The compile-time check ensures it doesn't drift.

**The fallback semantics during the window** (per US-208 Example 6):
- If `X-Active-Scope` header present with `org_id` AND `project_id` → use header values; body `project_id` ignored.
- If header missing AND `SCOPE_HEADER_FALLBACK_ENABLED=true` AND body has `project_id` → use body; emit `scope_header_fallback_used` log event identifying the User-Agent.
- If header missing AND flag disabled (post-sunset) → 400.
- If header present but malformed → 400 (no fallback to body).

---

## DWD-4 — RRv7 loader migration per route

**Decision**: 5 routes graduate from library-mode to framework-mode (gain `loader` exports) across Slices 1 + 2:

| Route | File | Slice | Reads |
|---|---|---|---|
| `/` (root) | `frontend/app/root.tsx` | **Slice 1** | J-001 projection — `active_scope.org_id` + `user.first_name` |
| `/projects/:projectId` | `routes/project-detail.tsx` | **Slice 1** | J-002 projection with `intent_project_id = params.projectId` |
| `/projects/:projectId/datasets/:datasetId` | same (`id: project-dataset-detail`) | **Slice 1** | J-002 projection with `intent_project_id` + `intent_resource_id` |
| `/projects` | `routes/projects.tsx` | **Slice 1** | J-002 projection — `context.most_recent_session_per_project` |
| `/` (index → chat-shell) | `routes/chat.tsx` | **Slice 2** | J-002 projection — last-used resolution per US-202 |
| `/chat/:channelId` | `routes/chat.tsx` (`id: chat-with-channel`) | **Slice 2** | J-002 projection with `intent_session_id = params.channelId` |
| `/sessions` | `routes/sessions.tsx` | **Slice 2** | J-002 projection — `context.session_list` paginated |

The 5 J-001 routes (`/login`, `/logout`, `/auth/callback`, `/org/create`) are already wired by Phase 02 of frontend-coexistence and are NOT graduated by J-002. The 5 J-003+ routes (`/table/:datasetId`, `/view/:viewId`, `/report/:reportId`, `/query-engines`, `/query-engines/:nodeId`) **stay library-mode** — they are not in J-002's scope, and per ADR-034 the migration is opt-in.

The **`useScope` hook contract** (ADR-029 §2 Option D) is wired at Slice 1 with two implementations:
- `useJ001Scope()` reads from `useRouteLoaderData("root")` — returns `{active_scope_org, user_first_name}`. Slice 1.
- `useJ002Scope()` reads from `useRouteLoaderData("project-detail" | "projects" | "chat" | "sessions")` (route-specific) — returns the J-002 `FlowProjection.active_scope`. Slice 1 + 2.

The ESLint rule (DWD-3 corollary, leveraging ADR-029 §2's specified lint contract): forbid `useParams<"projectId" | "datasetId" | ...>()` reads outside route-loader scope; forbid manual `X-Active-Scope` header sets outside `uiStateClient.activeScopeHeader`.

**Why:** The 5 route choices follow OQ-J002-3's recommendation from handoff-design.md ("J-002 projection for routes inside the app-shell layout; direct read for the top-level Chats page that is org-wide"). **DESIGN diverges from the handoff posture for `/sessions`**: Luna recommended direct-read from `list_sessions` for the Chats page; DESIGN routes it through J-002's projection because (a) the page is reached only from inside the app-shell where `active_scope.project_id` is already established, AND (b) the projection's `context.session_list` already carries the first page from `loading_session_list` — reusing it avoids a duplicate fetch. The pagination boundary (post-page-1) calls the existing `list_sessions(project_id, user, cursor)` directly via the loader; the loader stays the single fetch site.

**How to apply:** Slice 1 lands 4 loaders + the root loader; Slice 2 lands 3 more. Each loader is a few lines (call `uiStateClient.getJ002Projection`; return `json({...})`). The component bodies need NO changes (they already consume props from React hooks; `useLoaderData` is a drop-in for `useEffect`-fetch).

---

## DWD-5 — Dataset-context surfaces via X-Active-Scope header (NOT body)

**Decision**: The agent receives `resource_type` and `resource_id` for the active dataset (when set) via the **`X-Active-Scope` header**, not via a separate body field or a per-session backend fetch. The header value's `resource_type`/`resource_id` come directly from the J-002 projection's `active_scope.resource_*` field, which is populated by the machine's `session_active` entry (from session metadata) OR `switching_dataset_context` exit (from user pick).

The agent's body schema **drops** `contextId` and `contextType` post-migration-window (Slice 4 sunset). During the window, both header and body shapes work; header wins on conflict.

**Why:** Two options:

| Option | Mechanism | Pros / Cons |
|---|---|---|
| **A** — `X-Active-Scope` header carries `resource_*` | Same JSON header used for project_id; resource fields are nullable | Single source; mechanical consistency with the project_id path; no duplicate type definitions |
| B — Header carries only org+project; body carries dataset context | Two contracts; the agent reads dataset from body | Easier migration for clients that don't update their FE soon; but: dataset-context is the cross-tenant exposure surface, so splitting it across body+header weakens R8's mitigation |

Option A makes the whole scope a single contract — one header, one validation path, one fallback flag. Option B preserves a partial-body-read path post-sunset, undermining DWD-3's compile-time check.

**How to apply:** The FE's `uiStateClient.activeScopeHeader(projection)` returns `JSON.stringify(projection.active_scope)` — the entire scope object including resource fields. The agent's `extractActiveScope` reads `parsed.resource_type` and `parsed.resource_id` (with null fallback). Slice 5's `switching_dataset_context → session_active` transition flows the new resource into `context.resource`, which the projection's `active_scope` derivation surfaces — the next FE-originated chat turn naturally sets the new header value.

---

## DWD-6 — FREEZE/THAW handler design: top-level `on.FREEZE` + history-target THAW via `last_live_state`

**Decision**: The J-002 machine declares a single top-level `on.FREEZE` handler (XState v5's top-level `on` is inherited by every state, satisfying US-210 AC "reachable from every non-terminal state"). The handler's transition records `context.last_live_state` via an `assign` action. The `freeze` side-state declares `on.THAW` with a target derived from `last_live_state` (one-arm conditional transition).

The `j001_ready` entry mechanism (orchestrator-broadcast on J-001 settling in `ready`) lands at the same time the orchestrator's `priorState` watcher is taught to spawn J-002 — a single hook on the same lifecycle pattern that drives FREEZE/THAW.

**Hook lineage (per Praxis review F-1 clarification):** The `j001_ready` broadcast hook **does not exist in live code today** — the orchestrator (`ui-state/lib/orchestrator.ts`) carries only a `priorState` watcher. MR-1 DELIVER lands this hook alongside the MachineRegistry refactor at the same lifecycle point the watcher observes J-001's `ready` entry. Until MR-1 ships, J-002 does not auto-spawn on J-001 ready; DISTILL's spawning-assertion test should assert the post-MR-1 behavior (auto-spawn) explicitly, and the test must remain `@skip` until MR-1 lands (mirroring the un-skip-on-target-step pattern from `frontend-coexistence` DISTILL).

**Why:** Three implementation patterns were considered:

| Pattern | Mechanism | Verdict |
|---|---|---|
| **A** — Top-level `on.FREEZE` + explicit `last_live_state` assign | XState v5 idiom; the harness asserts on `last_live_state` directly | **Chosen.** Explicit; testable; matches the journey YAML's freeze description |
| B — Per-state `on.FREEZE` declarations (one per state) | Verbose but explicit; allows per-state opt-out | Rejected: all non-terminal states need the handler per US-210; the per-state declaration is duplication |
| C — XState `history: "shallow"` on the parent state | Built-in; no explicit context field | Rejected: history targets in XState v5 don't expose the prior-state value to the harness — the `harness.j002.assert_no_stale_intents_dropped()` operation needs `last_live_state` as a queryable field |

Pattern A also makes the `replay_abandoned → error_recoverable` transition (US-210 Example 3) mechanical: when the orchestrator emits `replay_abandoned`, the J-002 machine reads `last_live_state` for the cause-tag payload.

**How to apply:** Slice 6 declares the top-level handler and the `freeze` state in a small machine-config patch. The orchestrator's broadcast logic is unchanged.

---

## DWD-7 — Resolution of **OQ-J002-6**: stale-intent filter rule — applied at REPLAY time per intent type (silent-drop semantics)

**Decision**: The orchestrator's replay buffer captures intent events as `(intent_event, original_correlation_id, queued_at)` triples (unchanged from today's shape per `ui-state/lib/orchestrator.ts:54-56`). On THAW, the buffer is drained FIFO. For each replayed intent, J-002's machine receives the event normally. **The stale-intent filter is applied at the J-002 side** — not at the orchestrator — by a guarded transition on each intent type:

| Intent type | Stale condition | Drop behavior |
|---|---|---|
| `session_clicked { session_id }` | `context.session_list.find(s => s.id === session_id) === undefined` (the target session is not in the post-THAW session list — typically because the user switched projects during freeze) | Drop silently; emit `stale_intent_dropped_after_thaw { intent_type: "session_clicked", target_id: session_id }` |
| `switching_project_intent { new_project_id }` | ScopeResolver invariant 4 fails for the new project | Transition to `scope_mismatch_terminal` with `underlying_cause_tag = "access_revoked"` (US-204 path; not a silent drop because it's user-meaningful — they tried to navigate somewhere they can't go) |
| `dataset_resolved_by_agent { resource_id }`, `dataset_picked_directly { resource_id }` | ScopeResolver invariant 4 fails for the dataset | Drop with `stale_intent_dropped_after_thaw`; the prior `context.resource` is preserved |
| `new_session_clicked` | Never stale — the intent only requires `project_id` which is guaranteed by post-THAW state | Always honor |
| `first_message_sent` | `context.session_id !== null` AND prior `session_active_no_messages` was replaced during freeze (another `first_message_sent` or `session_clicked` settled first) | Drop with `stale_intent_dropped_after_thaw`; the user's typed message is discarded (the alternative — creating a duplicate session — is worse) |
| `create_project_submitted` | Never stale (no precondition beyond org context) | Always honor |
| `retry_clicked`, `back_to_projects_clicked` | Never stale (always valid for the current state) | Always honor |

The filter is implemented as **guards on the J-002 machine's transitions** (XState v5 `guard:` keyword). XState v5's single-event-at-a-time semantics ensure the post-THAW state is fully settled before each replayed intent is processed — the filter sees the live state, not a stale snapshot.

The `stale_intent_dropped_after_thaw` event is **observability-only** (no UX surface) per Luna's recommended posture in DISCUSS handoff. The user-meaningful case (scope_mismatch) gets a panel; the muscle-memory-stale case gets silence ("the user's click that no longer makes sense is dropped without ceremony, matching the muscle-memory shape of clicking-during-network-blip" — handoff-design.md §OQ-J002-6).

**Why:** Three sub-questions from handoff-design.md:

- **Which intents are stale?** — Per-intent rule above. The pattern is "target id must resolve in the post-THAW state."
- **Replay order?** — FIFO (handoff-design.md recommendation; XState's machine semantics naturally produce last-write-wins per intent type).
- **User-visible behavior?** — Silent observability (handoff-design.md recommendation).

The rule's mechanical shape — guard at the J-002 side, not at the orchestrator — preserves ADR-028:46-48 (no machine introspection from the orchestrator). The orchestrator doesn't know what counts as stale; J-002 does. This keeps the orchestrator generic for J-003+.

**How to apply:** Slice 6 declares the guards in the J-002 machine config. The TS harness gains `harness.j002.assert_stale_intent_dropped(intent_type, target_id)` for explicit assertion; the projection's `context.stale_intents_dropped_count` is the cumulative counter.

---

## DWD-8 — Orchestrator machine registry: strategy table replaces hardcoded conditional

**Decision**: Replace today's `if (input.machine !== "login-and-org-setup") throw new Error("unknown machine")` in `ui-state/lib/orchestrator.ts:104-107` with a `MachineRegistry` strategy table keyed by machine name. Each entry is a factory function `(input: { correlation_id: string; principal_id: string }) => AnyStateMachine`. The orchestrator's `begin()` looks up the factory; an unknown machine still throws (preserves the existing safety net) but the registry is the addition point for future flows.

```ts
// ui-state/lib/orchestrator.ts — DWD-8 (Slice 1 DELIVER)
type MachineFactory = (input: { correlation_id: string; principal_id: string }) => AnyStateMachine;
interface MachineRegistry {
  "login-and-org-setup": MachineFactory;
  "project-and-chat-session-management": MachineFactory;
}
```

**Why:** Today's orchestrator hardcodes machine names in two places (`begin()` and `appendDeepLinkEvents()` per the code survey). Adding J-002 without refactor would mean a second hardcoded conditional. Adding J-003 would be a third. The strategy table makes the addition O(1) per future flow.

**Alternative considered**: introduce a separate machine-config module and have the orchestrator import it. Rejected: same effect with one more file; not worth the indirection.

**How to apply:** Slice 1 lands the registry refactor as part of the same MR that adds the J-002 machine. The registry is initialized in the orchestrator's constructor; the two machines are wired at composition root.

---

## DWD-9 — Projection shape: envelope unchanged; J-002 fields live in `context.*`; SSE projection-stream lands in Slice 2

**Decision**: The `FlowProjection` envelope (`ui-state/lib/projection.ts:22-30`) is **unchanged by J-002**. J-002-specific fields live inside `context.*` per the type at `application-architecture.md` §2.1 (J002MachineContext). The projection-level `active_scope` field is derived from `context.project.id`/`context.resource.*`/`context.org_id` by the existing derivation logic in `projection.ts:280-293`, extended per `application-architecture.md` §7.4.

**The SSE projection-stream endpoint** (`GET /ui-state/flow/{machine}/projection/stream` per ADR-027 §1) **does not exist today** (per the code survey). DESIGN ratifies that Slice 2 DELIVER ships it; Slice 1 ships polling-as-fallback if the SSE endpoint is not ready at slice-boundary. The endpoint shape: a Hono SSE handler that uses Redis Streams `XREAD BLOCK` to subscribe to the flow-event log key; on each new event, it rebuilds the projection and pushes it down the SSE channel.

**Cross-tab refresh contract** (US-203 Example 4): each tab opens its own `EventSource` from a `useEffect` in the chat-shell route. Both receive the same broadcast events. The same mechanism extends to projection-driven UI refresh for the session-list during/after `loading_session_list → session_list_visible`.

**Why:** The envelope shape is the SSOT contract every consumer (FE, TS harness, Python harness, acceptance tests) reads. Changing it would force coordinated updates across all consumers. Keeping it stable per ADR-027 §4 is a guardrail.

The SSE-stream-in-Slice-2 sequencing follows the slice-by-slice scope discipline: Slice 1's stories (US-201, US-202, US-204) work fine without cross-tab refresh; Slice 2's US-203 Example 4 needs it; landing the endpoint then keeps the slice scope tight.

**How to apply:** Slice 1 + 2 DELIVER extends `EVENT_HANDLERS` with J-002 entries (`application-architecture.md` §7.3). Slice 2 lands the SSE endpoint + the FE EventSource subscription.

---

## DWD-10 — Lazy session creation: no backend write on `new_session_clicked`; eager on `first_message_sent`

**Decision**: The `session_active_no_messages` state is **purely client-side** — no `POST /api/projects/:id/sessions` call fires. The session row is created on `first_message_sent` via `create_session(project_id, user)`. The session title is set from the first message (truncated to 80 chars) via fire-and-forget `update_session(id, {title: first_message[:80]})`.

If `create_session` fails transiently (5xx), J-002 transitions to `error_recoverable` with `last_live_state = "session_active_no_messages"`. The FE's composer-state preserves the typed text (component-local `useState`); the "Try again" CTA re-fires `first_message_sent` with the same content.

**Why:** Today's eager-create produces ghost rows (US-206 Problem statement). The lazy-create pattern matches the chat-first-ui.feature's combined declarations: "New Session starts a fresh conversation" (line 36-41) AND "session title defaults to first message" (lines 142-145) — both are honored only if the session row exists at the first-message boundary, not earlier.

The first-message dispatch latency (single `create_session` round-trip; ~50-100ms p95) is well within the "first message" UX budget (US-206 Technical notes).

**How to apply:** Slice 3 DELIVER lands the state + the invoke at `first_message_sent`. The chat-view component's first-message handler awaits the projection's `session_id` settle before dispatching `POST /chat`.

---

## DWD-11 — Cross-tab session-list cache invalidation: handled implicitly by RRv7 loader re-run + SSE projection stream

**Decision**: J-002 routes are framework-mode (DWD-4); the loader re-runs on every navigation, so navigating from `/chat/:Q4-session` to `/projects/:Q3-id` causes the Q3 project-detail loader to fetch a fresh J-002 projection — no Q4 session-list data is ever rendered against the Q3 route. Cross-tab cases use the SSE projection-stream (DWD-9) to push updates.

For the legacy TanStack Query path (J-001-era code that hasn't migrated yet), the cache key shape is `["sessions", project_id, cursor]` (per `frontend/app/lib/sessionsApi.ts` if it exists in the repo). Slice 4's `switching_project` event handler in the FE invokes `queryClient.invalidateQueries({queryKey: ["sessions", oldProjectId]})` AT THE STATE-TRANSITION BOUNDARY, before the new project's loader fires — closing R9 from handoff-design.md.

**The mechanical sequence on project switch**:
1. User clicks Q3 → FE calls `uiStateClient.postJ002Event({type: "switching_project_intent", payload: {new_project_id: q3Id}})`.
2. The post-call updates J-002's projection; the projection's `state` becomes `switching_project`.
3. The chat-view component's `useEffect` (subscribed to projection updates) sees `state === "switching_project"` and calls `eventSource.close()` (closing the in-flight SSE for Q4).
4. The chat-view ALSO calls `queryClient.invalidateQueries(["sessions", oldProjectId])` for any legacy consumers.
5. The route's `useNavigate('/projects/:q3Id')` fires.
6. RRv7's lifecycle unmounts Q4 chat-view (which would already have closed the SSE in step 3).
7. The new route's loader runs; J-002's projection has settled in `project_selected → loading_session_list → session_list_visible` for Q3.

**Why:** ADR-029's contract is "the FE reads from one projection; there is no parallel state." RRv7 loaders enforce this for framework-mode routes by construction. The TanStack Query invalidation is a transitional concern for legacy code; it lives at the state-transition boundary so the contract holds even during the strangler-fig window.

**How to apply:** The invalidation call is one line in the FE's chat-view's `useEffect` that watches projection state; Slice 4 lands it alongside the SSE-close. Library-mode legacy routes consume `useScope()` from a transitional Context populated by the chat-shell loader (per `application-architecture.md` §6.6).

---

## DWD-12 — No new ADR for J-002; pure substrate reuse

**Decision**: J-002 does NOT introduce a new top-level Architecture Decision Record. Every J-002 architectural concern fits inside the existing envelope:
- Topology: ADR-027 (ui-state tier) + ADR-030 (single-replica) + ADR-034 (frontend coexistence).
- Engine: ADR-028 (XState v5 actor model).
- Scope contract: ADR-029 (`active_scope` propagation).
- Auth path: ADR-031 §7 inheritance.
- Persistence: ADR-018 capability-presence dispatch inheritance.
- Wire format: ADR-027 §4 (`FlowProjection` envelope) — unchanged.

The DWD-* decisions above resolve J-002-internal questions (state shape, schema column, header contract specifics, RRv7 route migrations, FREEZE handler design, machine registry refactor, projection extension scope, lazy-create, cache invalidation) without introducing new architectural patterns.

**The escape hatch**: if DELIVER surfaces a need (e.g., the SSE-subscribe adapter shape is more substantial than a single method addition; or the migration window for `SCOPE_HEADER_FALLBACK_ENABLED` needs a sunset-extension policy expressed as ADR-shaped guidance), the J-002 DELIVER MR proposing the change should also propose ADR-035. DESIGN does not pre-bake one.

**Why:** Per the nw-design skill's "Don't introduce abstractions beyond what the task requires" guidance. ADRs ratify architectural decisions; J-002's decisions are application-level refinements of an architecture already ratified at the system level by J-001's DESIGN wave. Inventing ADR-035 for "J-002 chose Option A for the dataset column" would clutter the decision record without proportional epistemic value.

**See also DWD-13** (SRP amendment, 2026-05-13): reaffirms "no new ADR" while ratifying a project-wide convention ("One bounded responsibility per state machine") via a wave-decision rather than an ADR. The convention is now the cite path future DESIGN waves use when deciding whether to split a flow machine.

---

## DWD-13 — Split the J-002 machine into `project-context` + `session-chat` BEFORE MR-2 (SRP amendment)

**Status**: AMENDMENT (2026-05-13) — supersedes the single-machine assumption baked into DWD-1, DWD-6, DWD-7, DWD-8, DWD-9, DWD-11, DWD-12 to the extent indicated below. Other DWD-* entries remain valid as written.

**Triggered by**: `docs/feature/project-and-chat-session-management/design/review-by-software-crafter-srp.md` (overseer-dispatched nw-software-crafter-reviewer pass, 2026-05-13). MR-1 has shipped at `cd4103e`; MR-2..MR-6 have NOT shipped. This DWD lands BEFORE MR-2 begins so subsequent DELIVER work proceeds against the new shape.

### Decision

The single machine `project-and-chat-session-management` (planned for 14 states across 5 behavioral domains by MR-6) is split into **two cohesive sibling machines** under the ADR-028 actor model:

| New machine | Source-tree file (post-refactor) | States | Single load-bearing responsibility |
|---|---|---|---|
| `project-context` | `ui-state/lib/machines/project-context.ts` | 8 — `resolving_initial_scope`, `no_projects_empty_state`, `creating_project`, `project_selected`, `switching_project`, `scope_mismatch_terminal`, `error_recoverable`, `freeze` | **"Which project am I in?"** — initial scope resolution, project creation, mid-flow project switching, cross-tenant terminal failure, and the deep-link entry path. Owns the `org_id` + `project_id` halves of `active_scope`. |
| `session-chat` | `ui-state/lib/machines/session-chat.ts` | 9 — `waiting_for_project` (initial), `loading_session_list`, `session_list_visible`, `resuming_session`, `session_active_no_messages`, `session_active`, `switching_dataset_context`, `error_recoverable`, `freeze` | **"What's happening in my current session?"** — session list visibility, resume, new-session lifecycle, dataset attachment within the session, and the chat-turn-emitting states. Owns the `resource_*` half of `active_scope`. |

Both machines are spawned by the orchestrator (ADR-028 mediation); neither imports the other (ADR-028:46–48). Coordination is via a new orchestrator broadcast hook (see §Coordination contract below).

### What was rejected, and why

**Rejected: keep the single 14-state machine.** The SRP review made the case definitively. Counter-summary:

1. By MR-6, **4–5 distinct behavioral domains** would coexist in one machine: scope-resolution, session-lifecycle, transcript, resource-context, project-switching, freeze. Context fields balloon from 1 cohesive group to 4+ logical groups.
2. **Divergent change** becomes the dominant smell: a bug in session-resume forces understanding of project-resolution states; a bug in resource-context switching forces understanding of session-state to know if the switch is allowed.
3. **Pattern teaching is the most important downstream concern** — if J-002 ships as a composite machine, J-003+ workers will adopt that as the team's convention. ADR-028 §"Cross-machine signaling" exists precisely to enable decoupling at the orchestrator layer, not to avoid it.

**Rejected: split into THREE machines (`project-context` + `session-chat` + `resource-context`).** A `resource-context` machine would own `switching_dataset_context` alone. Counter-arguments:

1. In J-002 scope, the dataset attachment is **per-session** (DWD-2: `session.active_dataset_id` is a column on the `sessions` row). The dataset has no lifecycle without a session.
2. `switching_dataset_context` always runs from `session_active` and returns to `session_active`. The state's natural home is the lifecycle it loops inside.
3. A standalone 1-state `resource-context` would need to coordinate with session-chat on every transition (it must wait for `session_active`; it must invalidate when session ends). The coordination overhead exceeds the cohesion benefit.
4. If a future feature decouples the dataset's lifecycle from a session (e.g., per-project sticky datasets), `resource-context` becomes a legitimate carve-out at that time. Today it is premature.

**Rejected: split `error_recoverable` into a third orchestrator-level concern.** The two machines' transient-error contracts are NOT the same:
- project-context's transient errors retry into `creating_project`, `resolving_initial_scope`, or `switching_project` invokes with their respective state's user-action payload preserved (`pending_project_name`, `intent_project_id`).
- session-chat's transient errors retry into `loading_session_list`, `resuming_session`, `session_active_no_messages` (eager-create), or `switching_dataset_context` invokes with their respective payloads (`pending_first_message`, `intent_session_id`, `intent_resource_id`).
- The originating state and the retry payload differ per machine. Conflating them into one orchestrator-level `error_recoverable` would require the orchestrator to know each machine's transition map — a violation of ADR-028's "no machine introspection from the orchestrator" stance.

**Each machine therefore declares its own `error_recoverable`**, both modeled identically (XState v5 idiom; `last_live_state` history-target on `retry_clicked`). They never share state.

### Why `login-and-org-setup` (J-001) is NOT amended

The SRP review explicitly approves `login-and-org-setup`. The "and" denotes a strict sequence dependency: JWT reissue MUST complete before `ready` because downstream machines read `org_id` from the JWT claim (ADR-029 invariant I1). Splitting J-001 reintroduces a race condition the orchestrator broadcast contract is designed to avoid. **J-001 stays as-is. No production code change to `login-and-org-setup.ts` or its DESIGN.**

The contrast — J-001 "and" denotes sequence; J-002 "and" denoted collocation — is the precedent for the convention statement below.

### Coordination contract (orchestrator broadcast hooks)

The orchestrator's `priorState` watcher (today: 1 hook for `j001_ready`) gains a **second** hook for `project_ready`. Both follow the same pattern: observe a target state transition; broadcast a typed event to the consumer machine(s).

| Event | Origin (watched transition) | Receivers | Payload | Idempotency |
|---|---|---|---|---|
| `j001_ready` | login-and-org-setup → `ready` | project-context only | `{ org_id, user_first_name }` | Idempotent — re-emissions are ignored by a project-context actor already past `resolving_initial_scope`. (Existing behavior per `orchestrator.ts:320-336`.) |
| **`project_ready`** *(NEW per this DWD)* | project-context → `project_selected` | session-chat only | `{ org_id, project_id, project_name, correlation_id }` | Idempotent on the SAME `project_id` (session-chat ignores the event when its `context.project_id` already matches). Re-emission with a DIFFERENT `project_id` triggers session-chat's `project_switched` event handler — invalidates `session_id` + `resource_*` and re-enters `loading_session_list`. |
| `FREEZE` | login-and-org-setup → `expired_token` | ALL spawned actors except origin | `{}` | Existing ADR-028 broadcast (`orchestrator.ts:550-563`, `:796-820`). Both project-context AND session-chat receive it; each declares its own top-level `on.FREEZE` handler. |
| `THAW` | login-and-org-setup → `ready` (after `expired_token`) | All previously-frozen actors | `{}` | Existing broadcast. Each machine's `freeze` state's `on.THAW` returns via its own `last_live_state`. |
| `replay_abandoned` | orchestrator (5 s timeout, no THAW) | All previously-frozen actors | `{}` | Existing. Each machine's `freeze` → `error_recoverable` with cause `replay_abandoned`. |

**No machine-to-machine imports.** project-context never imports session-chat; session-chat never imports project-context. The `dependency-cruiser` rule from ADR-027 §7 already covers this; the rule does not need to change.

**`project-context` is spawned on `j001_ready` (as today).** `session-chat` is spawned by the orchestrator on the FIRST `project_ready` event it observes for a given principal. Spawning is idempotent (`orchestrator.ts:beginIfNotStarted`). Subsequent `project_ready` events (on project switch) are forwarded to the existing session-chat actor.

### What changes vs DWD-1..DWD-12 (delta list)

| Prior DWD | Original assumption | Amendment | Why |
|---|---|---|---|
| **DWD-1** (flat-compound 14-state) | One machine, 14 sibling states. | **Amended**: TWO machines, each flat-compound. project-context has 8 sibling states; session-chat has 9. The flat-compound rationale (TypeScript inference, orchestrator-readable state values, mirror of J-001's shape) carries through machine-by-machine. | The single 14-state shape was load-bearing for the old assumption. With the split, each smaller chart is closer to J-001's 8-state precedent and is the cohesion sweet spot per the reviewer. |
| **DWD-6** (FREEZE/THAW: top-level `on.FREEZE` + `last_live_state`) | One handler at one root. | **Amended**: BOTH machines declare top-level `on.FREEZE` and a `freeze` side-state. Each carries its own `last_live_state` field. The orchestrator broadcast loop (`orchestrator.ts:796-820`) is byte-unchanged — it enumerates spawned actors, so adding a second actor per principal "just works." | ADR-028's broadcast model is machine-agnostic. The amendment is editorial — duplicate the pattern, don't change it. |
| **DWD-7** (stale-intent filter at J-002 guard side) | Guards on one machine. | **Amended**: Guards on the relevant machine. Project-switch intent (`switching_project_intent`) guards live on project-context; session/dataset intents (`session_clicked`, `dataset_resolved_by_agent`, `dataset_picked_directly`, `first_message_sent`) live on session-chat. The per-intent rules in DWD-7 are unchanged in semantics, just routed to their owning machine. | The reviewer's "stale-intent at the J-002 side, not the orchestrator side" principle is preserved; J-002 now means "the machine that owns the intent." |
| **DWD-8** (MachineRegistry strategy table) | Two entries: `login-and-org-setup` + `project-and-chat-session-management`. | **Amended**: Three entries — `login-and-org-setup`, **`project-context`**, **`session-chat`**. The registry itself is unchanged in shape — adding entries is mechanical, which was the point of the registry. The hardcoded conditional at `orchestrator.ts:158-164` that gates direct `/begin` posts to login-only continues to apply; both J-002 machines are spawned exclusively via `beginIfNotStarted` from broadcast hooks. | The registry pays off here exactly as DWD-8 promised. The amendment touches one factory wiring per new machine; no orchestrator-supervision change. |
| **DWD-9** (FlowProjection envelope + SSE) | One projection at `/ui-state/flow/project-and-chat-session-management/projection`. | **Amended**: TWO projection endpoints — `/ui-state/flow/project-context/projection` and `/ui-state/flow/session-chat/projection`. Each is a standalone `FlowProjection` envelope (shape unchanged per DWD-9's "envelope unchanged" guarantee). The SSE projection-stream gets TWO endpoints too. The FE loaders read both; `uiStateClient.activeScopeHeader` (the single header writer) composes the union. The Redis key prefix doubles per principal (`ui-state:project-context:<principal>:events` + `ui-state:session-chat:<principal>:events`). | Per ADR-030, `flow_id = {machine-name}:{principal_id}`. Two machines → two flows → two log keys → two projections. The flow-event log discipline is preserved. The cost is one extra HTTP call per loader and roughly 2× the Redis key cardinality per principal — both negligible at the planning horizon (ADR-030 §3 ceiling triggers do NOT fire under this fan-out). |
| **DWD-11** (cross-tab cache invalidation) | RRv7 loader re-run on framework-mode routes; explicit `invalidateQueries` for legacy routes. | **Reinforced, not amended**: the loader fetches BOTH projections on every navigation. A project-switch updates `project-context` first (orchestrator hook re-emits `project_ready`); session-chat receives the new `project_ready`, invalidates `session_id`/`resource_*`, transitions through `waiting_for_project` (briefly — see §coordination semantics below) → `loading_session_list`. The FE's loader awaits both projections to settle. | The split makes the contract MORE legible: project-context is the authoritative project source; session-chat is the authoritative session-and-resource source. The FE has two sources of truth that compose deterministically. |
| **DWD-12** (no new ADR) | One machine; no new ADR. | **Reaffirmed; this amendment introduces no new ADR**, but ratifies a project-wide convention (next paragraph). The convention is recorded here in DWD-13 and surfaced in `application-architecture.md`'s preamble. If a future feature challenges the convention, the next DESIGN wave can propose ADR-035 ("Bounded responsibility per state machine") at that point with concrete evidence. Today, DWD-13 plus the application-architecture preamble carries sufficient force. | Per nw-design "Don't introduce abstractions beyond what the task requires." A DWD with strong language + a preamble note + a cross-reference from this DESIGN amendment is enough; ADRs ratify project-wide stances when feature-level DWDs accumulate. We have one accumulation event so far (this one). |

**Stories US-201..US-210 are NOT amended.** Acceptance criteria, KPIs, JTBD, journey YAML — all unchanged. The split is **implementation-layer only**; the user-facing surface is byte-identical.

**The journey YAML's IMMUTABLE 14-state contract is NOT broken.** The same 14 states exist; they are partitioned across two machines instead of one. The FE / TS harness / acceptance tests read the union via the projection composition (the FE loader composes both projections; the harness exposes `harness.j002.assert_state(machine, name)` per-machine and `harness.j002.assert_unified_state(name)` for the legacy single-state-string callers). See `handoff-design-to-distill.md` §Scenario-to-machine mapping addendum for the per-scenario routing.

### Coordination semantics — three key moments

1. **Cold sign-in (US-201, US-202, US-204).** Orchestrator observes J-001 → `ready` → emits `j001_ready` → spawns project-context. Project-context resolves → enters `project_selected` (or `no_projects_empty_state` / `scope_mismatch_terminal`). Orchestrator observes the `project_selected` transition → emits `project_ready` → spawns session-chat (which immediately receives `project_ready` and transitions `waiting_for_project → loading_session_list`).
   - For the `no_projects_empty_state` path (no project to coordinate around): session-chat is NEVER spawned. The user sees the welcome panel from project-context's projection alone; session-chat does not exist in the actor tree.
   - For the `scope_mismatch_terminal` path: session-chat is NEVER spawned. The user sees the named-diagnostic panel; pressing "Back to projects" re-enters project-context's `resolving_initial_scope`.

2. **Mid-flow project switch (US-207).** User clicks a different project in nav rail → FE posts `switching_project_intent` to project-context's `/event`. project-context: `session_active (no, wait — project-context doesn't have session_active; the user is in session-chat's session_active. Let me clarify the FE-to-machine routing.)`.
   
   **Correction**: the FE's `switching_project_intent` event goes to **project-context**, not session-chat. project-context handles project-switching as a first-class concern (it owns the `project_id` half of `active_scope`). The chat-view component (which is rendered when session-chat is in `session_active`) observes the project-context projection — when project-context's state becomes `switching_project`, the chat-view's `useEffect` cleanup closes the SSE stream (per `application-architecture.md` §6.3 — unchanged in spirit, just routed to the right projection). Project-context settles → `project_ready` re-broadcast → session-chat receives it → invalidates `session_id` + `resource_*` → re-enters `loading_session_list`. The atomicity guarantee (US-207 AC: "no Q4 session ever appears in Q3's projection after the switch") is satisfied because session-chat's `loading_session_list` invoke begins WITH the new `project_id` — the old list is gone from session-chat's context the moment `project_ready` is processed.

3. **Token expiry mid-mutation (US-210).** J-001 → `expired_token` → orchestrator broadcasts FREEZE to project-context AND session-chat (and any other spawned actors). Each transitions into its OWN `freeze` side-state, captures its OWN `last_live_state`, and pauses its OWN outgoing mutations. J-001's silent re-auth completes → orchestrator broadcasts THAW. Each machine's `freeze` → `last_live_state` history-target. The replay buffer (per-flow, in the orchestrator at `orchestrator.ts:54-56,161-192`) drains intents for the right flow (the buffer is already keyed by `flow_id`; no orchestrator change). Per-machine stale-intent guards (DWD-7) drop muscle-memory-stale intents silently.

### Naming convention — pattern statement (RATIFIED HERE; cited from future DESIGNs)

> **One bounded responsibility per state machine. Coordinate via orchestrator broadcast hooks.**
>
> Composite names (`X-and-Y-machine`) are a smell unless the conjunction denotes a strict sequence dependency that cannot be expressed via orchestrator broadcast (e.g., `login-and-org-setup`: JWT reissue MUST complete before downstream machines can read `org_id` from the claim).
>
> When in doubt, prefer two machines + a broadcast event over one machine with a composite name. The actor model (ADR-028) exists to make decoupling at the orchestrator layer free.
>
> **Test**: if naming the machine requires more than ONE noun phrase, or if its context groups would split cleanly along the conjunction, split it.

This convention applies to all future flow machines. The cite path is: this DWD-13 + ADR-028 §"Cross-machine signaling" + `application-architecture.md` §"Pattern statement for future flow machines" (preamble). Future DESIGN waves should read this DWD before designing composite machines.

### MR-to-machine implementation guidance

The split lands as a **DELIVER MR-1.5 (recommended) or as part of MR-2 (alternative)**. This DESIGN amendment is agnostic about WHICH; both shapes are compatible with the post-amendment design. The overseer/team chooses based on rollout risk. The author of this amendment **recommends MR-1.5** for the following reasons:

1. **MR-1.5 is a pure refactor**: same behavior, two source files instead of one. All MR-1 acceptance tests pass without modification (the projection-composition layer makes the unified state surface byte-identical). Lower regression risk.
2. **MR-2 starts clean**: implements the four new session-chat states (`loading_session_list`, `session_list_visible`, `resuming_session`, `session_active`) in a file that already exists with its substrate (`session-chat.ts`'s `waiting_for_project` initial state). No cross-cutting refactor pressure during a feature MR.
3. **The Mikado roadmap is shorter**: split first, then build, vs. split-while-building.

Per-MR scope under the new shape:

| MR | Machine(s) touched | What lands |
|---|---|---|
| MR-1 *(SHIPPED at `cd4103e` 2026-05-13)* | (pre-split single machine — to be refactored) | The 5 substrate states already live: `resolving_initial_scope`, `no_projects_empty_state`, `creating_project`, `project_selected`, `scope_mismatch_terminal`, plus `error_recoverable`. **Behavior is preserved verbatim after the MR-1.5 split.** |
| **MR-1.5 (NEW — refactor)** | Both | Split the current file into `ui-state/lib/machines/project-context.ts` (5 states + error_recoverable) and `ui-state/lib/machines/session-chat.ts` (only `waiting_for_project` initial state — a stub that awaits MR-2's content). Orchestrator gains the `project_ready` broadcast hook (analogous to today's `j001_ready` hook at `orchestrator.ts:550-563`). MachineRegistry gains the `session-chat` entry. The `frontend/app/lib/ui-state-client.ts` gets `getProjectContextProjection` + `getSessionChatProjection` methods (the existing `getJ002Projection` becomes a thin composer). All existing acceptance tests pass with minor harness extension (the harness gains a `harness.j002.assert_state_in(machine, state)` API; the legacy `harness.j002.assert_state(state)` continues to work by inspecting both projections). |
| MR-2 | session-chat only | Adds `loading_session_list`, `session_list_visible`, `resuming_session`, `session_active`. Migration 009 (DWD-2) lands at this MR exactly as before. The session-chat machine's `waiting_for_project` initial state already exists from MR-1.5; MR-2 extends it. project-context is byte-unchanged by MR-2. |
| MR-3 | session-chat only | Adds `session_active_no_messages`. project-context byte-unchanged. |
| MR-4 | project-context (machine), agent, FE (loader fan-out + ESLint rule) | Adds `switching_project` to project-context. The agent's `extractActiveScope` middleware (DWD-3) and the compile-time sunset check are byte-identical to the pre-split design. The FE's `activeScopeHeader` composer now reads both projections (project-context for `org_id`+`project_id`; session-chat for `resource_*`). session-chat byte-unchanged in code (its existing `project_ready` handler from MR-1.5 already does the invalidate-on-new-project_id work). |
| MR-5 | session-chat only | Adds `switching_dataset_context`. project-context byte-unchanged. |
| MR-6 | Both | Each machine declares top-level `on.FREEZE` + `freeze` side-state + per-intent stale-guards (DWD-7). The orchestrator's broadcast logic remains byte-unchanged. |

### Risks introduced by the amendment

| # | Risk | Mitigation |
|---|---|---|
| RD13-1 | The `project_ready` orchestrator hook is novel (a second cross-machine broadcast hook). It must fire exactly when project-context enters `project_selected` and re-fire on EVERY entry (i.e., on `switching_project → project_selected` too). | MR-1.5 lands a unit test that asserts: (a) project_ready fires on initial `project_selected` entry; (b) project_ready re-fires with new `project_id` on the second entry (after switching_project); (c) the broadcast is idempotent against an already-spawned session-chat actor (same project_id → no transition); (d) the broadcast invalidates session-chat's `session_id`+`resource_*` on a different project_id. The hook is a pure additive copy of the J-001 → `j001_ready` pattern (`orchestrator.ts:550-563` — `priorState`-watcher + `beginIfNotStarted`). |
| RD13-2 | The FE loader now fetches TWO projections per route — modest fan-out increase. | Per ADR-030's back-of-envelope (system-architecture.md §0): the ui-state tier has 2-3 orders-of-magnitude headroom on every dimension. Doubling per-principal projection fetches is negligible. Praxis F-3's loader fan-out concern (handoff-design-to-distill.md O7) gains one extra hop — recommend the slate crew confirms the cumulative loader budget before MR-1.5 lands (carrying forward the same coordination already noted for MR-1). |
| RD13-3 | The TS harness must distinguish "which machine is in state X" — `assert_state("session_active")` is ambiguous if the unified state list grew. | The harness's `harness.j002.*` namespace adds `assert_state_in(machine, state)` (per-machine). The legacy `harness.j002.assert_state(state)` continues to work by inspecting both projections and asserting the state appears in EITHER (the 14-state unified set is partitioned with no overlap, so the per-machine projection unambiguously tells which side the assertion lands on). The DISTILL handoff addendum lists the per-machine routing per scenario. |
| RD13-4 | DISTILL's existing acceptance tests (drafted against the unified machine assumption in `roadmap.json`) need a routing update for some scenarios — but **no acceptance scenario is invalidated**. The behavior under test is unchanged. | The DISTILL handoff addendum (`handoff-design-to-distill.md` §Scenario-to-machine mapping addendum) enumerates which scenarios target which machine. Most scenarios already assert on the projection envelope (state + context), which works identically against per-machine projections via the harness composer. A DISTILL revisit MR may follow to refine per-scenario harness calls, but the test bodies are stable; the IRON RULE holds (no failing test is modified to make it pass). |
| RD13-5 | The MR-1.5 refactor itself is a load-bearing change immediately after MR-1 shipped (`cd4103e`). | MR-1.5 lands as a pure refactor: zero behavior change, all existing tests pass, no schema change. The refactor scope is bounded (one source file → two; one orchestrator hook addition; one ui-state-client method extension). If the refactor surfaces unforeseen complexity, the alternative (split-during-MR-2) remains available. The pattern matches J-001's MR-by-MR cadence. |

### How to apply

1. **This DESIGN amendment ships first** (as the current branch/MR `design/j002-machine-split`).
2. After merge, the overseer schedules **MR-1.5** as a pure-refactor DELIVER MR. Estimated size: M (~1-2 days). Recommended scope: split file + orchestrator hook + ui-state-client method extension + harness extension + unit test for `project_ready` hook. **No DISTILL revisit required at MR-1.5** — all existing MR-1 acceptance tests pass without modification.
3. **MR-2** then DELIVERs against `session-chat.ts` per the per-MR table above.

### Why no new ADR (final summary)

Per nw-design "Don't introduce abstractions beyond what the task requires": DWD-13 carries the architectural commitment (machine-per-bounded-responsibility) within the J-002 design record. The convention statement at §Naming convention above is the cite path for future DESIGNs. Adding ADR-035 today would document one accumulation event (this one) — the bar for ADRs is project-wide commitment surfaced by multiple feature surfaces. If J-003+ DESIGN waves cite DWD-13 as binding and the citation graph grows, **then** the convention earns ADR-035; not before.

---

## Reuse Analysis (HARD GATE — repeated from application-architecture.md §13)

Per nw-design skill mandatory step 5, every overlap is decision-gated. **Default = EXTEND; CREATE NEW requires impossibility-not-complexity justification.**

| Existing component | File | Overlap with J-002 concern | Decision | Justification |
|---|---|---|---|---|
| `FlowOrchestrator` | `ui-state/lib/orchestrator.ts` | Spawns flow actors; broadcasts FREEZE/THAW; owns replay buffer | **EXTEND** (DWD-8) | Add machine-registry strategy table replacing hardcoded conditional. ~15 LOC change. CREATE NEW orchestrator would be ~600 LOC duplicate. |
| `LoginAndOrgSetupMachine` | `ui-state/lib/machines/login-and-org-setup.ts` | Per-flow XState v5 statechart with FREEZE/THAW handlers | **CREATE NEW** sibling file `project-and-chat-session-management.ts` | ADR-028:46-48 forbids machine-to-machine imports — the two flows are independent actors per the actor model. Reuse via shared types only (`ActiveScope`, `ResourceType`). NOT a complexity argument; a structural one. |
| `buildProjection` + `EVENT_HANDLERS` | `ui-state/lib/projection.ts:107-242` | Pure fold from `FlowEvent[]` to `FlowProjection` | **EXTEND** (DWD-9) | Add J-002 entries to the existing strategy table. 0 changes to `applyEvent` / `buildProjection`. |
| `resolveActiveScope` | `ui-state/lib/active-scope.ts:80-142` | Pure-function scope resolution per ADR-029 invariants 1-5 | **REUSE VERBATIM** (default empty `machineContext`) | J-002 call sites pass `(route, jwt, {})` — the optional `machineContext` parameter (`active-scope.ts:83`) is left at its default empty object. **Invariants I1, I3, I4 are exercised by J-002 in PR-0; invariant I5 (stale-link reconciliation for project-rename-while-bookmarked) is NOT exercised in PR-0** because J-002's machine context does not populate `{bookmarked_project_name, current_project_name}` (those fields are out of scope for the 10 stories US-201..US-210 — none of which describes a "project was renamed since the bookmark was saved" case). The journey YAML's `scope_reconciled` event mentions in `switching_dataset_context` describe observability-only emissions surfaced by the existing `deep_link_opened` handler (`projection.ts:201-220`) with `reconciled: false`. Future J-NNN flows that DO want I5 can populate the fields without changing the resolver. Zero changes to the resolver itself. |
| `FlowEventLog` port + Redis adapter | `ui-state/lib/persistence/redis.ts` | Append-only event log per ADR-018 dispatch | **REUSE VERBATIM** + **EXTEND adapter** with `subscribe(key, since): AsyncIterable<FlowEvent>` for SSE | Port shape unchanged; new method is idiomatic Redis Streams `XREAD BLOCK`. The probe extends to cover subscribe. |
| `FlowProjection` envelope | `ui-state/lib/projection.ts:22-30` | Wire format: `{flow_id, state, context, active_scope, ...}` | **REUSE VERBATIM** (DWD-9) | J-002 is a second tenant; `context` is opaque to the envelope. |
| `uiStateClient` | `frontend/app/lib/ui-state-client.ts` | HTTP client to ui-state tier | **EXTEND** with 3 methods | `getJ002Projection`, `postJ002Event`, `activeScopeHeader`. ~30 new LOC. |
| `frontend/app/root.tsx` | same | RRv7 root component | **EXTEND** with a `loader` export (DWD-4) | Existing component body unchanged. ~25 LOC added. |
| `agent/lib/chat/handleChat.ts` | same | Chat-turn entry point | **EXTEND** with `extractActiveScope` helper (DWD-3) | Add ~50 LOC; refactor body destructure to honor header-first. NOT Hono middleware (per app-arch §4.4 rationale). |
| `update_session` use case | `backend/app/use_cases/session/update_session.py` | Session metadata writes | **EXTEND** allowlist (DWD-2) | Add `"active_dataset_id"` — one-line change. No new use case. |
| Session SQLAlchemy model | `backend/app/repositories/metadata/session_record.py` | Session row schema | **EXTEND** column + Alembic migration 009 (DWD-2) | One nullable column with a non-CASCADE index. |
| `frontend/app/lib/ui-state-client.ts` (X-Active-Scope writer) | same | Outbound-request header setting | **EXTEND** (DWD-3) | `activeScopeHeader(projection)` method on the SAME helper. |
| `ScopeResolver` fn signature | `ui-state/lib/active-scope.ts:80` | `(route, jwt, machineContext) → ScopeResolution` | **REUSE VERBATIM** | Same triple shape; no signature change. |
| TS `UserFlowHarness` | `tests/acceptance/user-flow-state-machines/.../harness.ts` (J-001 deliverable) | Headless flow driver | **EXTEND** with `harness.j002.*` namespace | 12 operations per the journey YAML's `testing_surface.ts_harness.operations` list. |
| Python `DatasetLayerHarness` | `backend/tests/integration/dataset_layer/harness.py` | Backend+agent integration driver | **EXTEND** with `chat_turn_with_scope_header(scope, message)` method per US-208 acceptance | One method addition. |

**Reuse summary**: J-002 introduces exactly **3 new files** (`project-and-chat-session-management.ts` machine; `agent/lib/chat/scope.ts` helper; `backend/migrations/versions/009_add_session_active_dataset_id.py`) and **9 file extensions**. Zero new ports. Zero new adapters.

---

## Architecture Summary

- **Pattern**: Brownfield extension of the actor-model substrate; ports-and-adapters preserved.
- **Paradigm**: TypeScript / functional-first for the ui-state tier (XState v5 actor functions + pure projection fold + pure ScopeResolver). Object-oriented for the backend (FastAPI + SQLAlchemy + `RepositoryContainer` decorator stack). This is the project's established pattern per CLAUDE.md; J-002 doesn't change it.
- **Key components added**: One XState v5 machine; one Alembic migration; one agent middleware function; one `uiStateClient` helper extension; 5 RRv7 route loaders.
- **No new ADR**: pure substrate reuse (DWD-12).

---

## Technology Stack (additions / extensions)

| Component | Library | Status |
|---|---|---|
| State-machine engine | `xstate@^5` | Already in repo (J-001) — no change. |
| Web framework (ui-state tier) | `hono@^4` | Already in repo — no change. |
| Frontend framework | `react-router-dom@^7.13` (RRv7 framework mode per ADR-034) | Already in repo; J-002 graduates 5 routes to framework-mode. |
| Persistence (Tier 1) | `ioredis` | Already in repo; new key prefix only. New method `subscribe()` on the existing adapter for SSE. |
| Backend ORM | `sqlalchemy[asyncio]` | Already in repo; one column added via Alembic. |
| Test harness | Vitest (TS) + pytest-bdd (Python acceptance) | Already established pattern from J-001's DISTILL/DELIVER. |

**No new dependencies.** Every library used by J-002 is already vendored.

---

## Constraints established

The following constraints carry into DISTILL and DELIVER:

| # | Constraint | Effect |
|---|---|---|
| C1 | J-002 machine does NOT import J-001 machine (ADR-028:46-48) | Communication via orchestrator only |
| C2 | The agent reads scope from `X-Active-Scope` exclusively post-sunset (DWD-3) | Body `project_id` is removed from request schema after the migration window |
| C3 | The `update_session` allowlist is the only write path for `active_dataset_id` (DWD-2) | Other paths (direct SQL, separate use case) are forbidden |
| C4 | `uiStateClient.activeScopeHeader` is the only writer of the `X-Active-Scope` header (DWD-3 + DWD-4 lint) | Manual header sets in FE components are ESLint errors |
| C5 | Routes that need `project_id` graduate to framework-mode (DWD-4) | Library-mode routes that need it use a transitional `useScope()` Context |
| C6 | The SSE projection-stream endpoint lands in Slice 2 (DWD-9) | Slice 1 ships polling as fallback if needed |
| C7 | Slices DELIVER in order 1→2→3→4→5→6 | Per the dependencies in application-architecture.md §9 |
| C8 | The `FlowProjection` envelope shape is unchanged (DWD-9) | J-002 fields are inside `context.*` |
| C9 | The orchestrator's broadcast logic is byte-unchanged (DWD-6 + DWD-7) | J-002's FREEZE handling is at the machine side; the stale-intent filter is at the J-002 guard side |
| C10 | Migration 009 is forward-only in production (DWD-2 corollary) | The `downgrade()` is a dev-only escape hatch |
| **C11** | **Two machines per J-002 flow** (`project-context` + `session-chat`) — neither imports the other (DWD-13) | Coordination via orchestrator `project_ready` broadcast hook; project-context owns `org_id`+`project_id`; session-chat owns `resource_*` and the chat-emitting states |
| **C12** | **One bounded responsibility per state machine** (DWD-13 convention) | Future J-NNN flow designs cite DWD-13; composite names are a smell unless the "and" denotes strict sequence (per `login-and-org-setup` precedent) |
| **C13** | **The MR-1.5 refactor MR is a pure rename + split** with no behavior change (DWD-13) | All MR-1 acceptance tests pass against the post-split shape; if behavior diverges, the refactor is reverted before MR-2 begins |

---

## Upstream Changes (vs DISCUSS)

| DISCUSS assumption | Status | Change | Where documented |
|---|---|---|---|
| OQ-J002-1 storage shape deferred | **Resolved** | Option A (column on session row) — `wave-decisions.md` DWD-2 | This file + `application-architecture.md` §5 |
| OQ-J002-6 stale-intent filter deferred | **Resolved** | Filter at J-002 guard side, per intent type, silent-drop semantics — DWD-7 | This file + `application-architecture.md` §10 |
| OQ-J002-3 direct route vs J-002 projection for /projects + /sessions | **Resolved** — diverges from Luna's posture for /sessions | Both /projects AND /sessions go through J-002 projection — DWD-4 + DWD-9 | This file + `application-architecture.md` §6.2 |
| OQ-J002-4 partial-result last-used resolution | **Resolved (per handoff posture)** | Partial-result (max-of-successful); single failure emits `last_used_resolution_degraded` but does not block sign-in | application-architecture.md §10 (failure modes); not a DWD because the posture is unchanged from DISCUSS |
| OQ-J002-5 most-recent-session-per-project read shape | **Resolved (per handoff posture)** | Lazy (N `list_sessions(limit=1)` calls; N typically <10) | application-architecture.md §2.1 (J002MachineContext); §12 (Performance row) |
| OQ-J002-2 multi-tab safety (`flow_id` tab_id extension) | **Deferred** (per DISCUSS posture) | Today's product has no multi-tab affordance; flagged for future without ADR change | DWD-12 carries the deferral; not implemented |
| US-208 backward-compat fallback (Luna's R8) | **Refined** | Compile-time sunset check added; date set at MR-time | DWD-3 |
| R9 (TanStack Query cache invalidation on project-switch) | **Resolved** | RRv7 loader re-run handles framework-mode routes; explicit `invalidateQueries` for legacy routes at the state-transition boundary | DWD-11 + application-architecture.md §6.5 |
| **SRP review (2026-05-13, `review-by-software-crafter-srp.md`)** | **Amended** | J-002's single machine is split into `project-context` + `session-chat` BEFORE MR-2 begins. The split lands as MR-1.5 (pure refactor) or as part of MR-2. Stories US-201..US-210 are NOT amended. Journey YAML is NOT amended. | DWD-13 + `application-architecture.md` Preamble + `application-architecture.md` §2 + `application-architecture.md` §3 + `c4-diagrams.md` §2 + `handoff-design-to-distill.md` scenario-to-machine addendum |

**No DISCUSS user story is invalidated.** US-201..US-210 land exactly as written. **The journey YAML's IMMUTABLE 14-state contract is preserved** — the same 14 states exist, partitioned across two machines instead of one.

**No DISCUSS wave-decision D1-D12 is overridden.** All 12 are inherited verbatim. **DWD-13 amends DWD-1, DWD-6, DWD-7, DWD-8, DWD-9, DWD-11 to the extent noted in DWD-13's "What changes vs DWD-1..DWD-12" table.** DWD-12 is reaffirmed (no new ADR).

---

## References

- DISCUSS: `docs/feature/project-and-chat-session-management/discuss/` (all 18 artifacts)
- Journey YAML (state contract): same dir, `journey-project-and-chat-session-management.yaml`
- Per-story AC: same dir, `stories/US-{201..210}.md`
- Companion DESIGN artifacts: `application-architecture.md`, `c4-diagrams.md`, `handoff-design-to-distill.md`
- ADRs (binding): ADR-014, ADR-015, ADR-016, ADR-018, ADR-027, ADR-028, ADR-029, ADR-030, ADR-031 §7, ADR-034
- J-001 design template: `docs/evolution/2026-05-12-user-flow-state-machines/design/`
- **SRP review (binding input for DWD-13)**: `./review-by-software-crafter-srp.md` (overseer-dispatched nw-software-crafter-reviewer, 2026-05-13)
- **DESIGN amendment review (this branch)**: `./review-by-solution-architect-srp-amendment.md` (nw-solution-architect-reviewer pass on DWD-13 + companions)
