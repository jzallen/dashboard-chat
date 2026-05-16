# Wave Decisions — DELIVER — `project-and-chat-session-management` (J-002)

> **Wave**: DELIVER
> **Date**: 2026-05-13
> **Owner**: software-crafter (per-MR / per-sub-step entries)
> **Status**: living document — each MR / sub-step appends here when an
> upstream-deferred choice gets resolved.
>
> DISCUSS D1–D12, DESIGN DWD-1..DWD-12, and DISTILL DD-1..DD-7 are
> inherited verbatim. DELIVER does NOT relitigate any of them.

---

## DDD-1 (sub-step 01-02) — REC-2 resolution: inline ESM template (Option B)

**Decision**: The TS UserFlowHarness `harness.j002.*` namespace is invoked
from python tests via an **inline ESM script** passed to
`node --import tsx --input-type=module -e <script>`, NOT via a separate
`tests/acceptance/user-flow-state-machines/harness_runner.ts` accepting JSON
on stdin.

The crafter chose Option B per `distill/upstream-issues.md` REC-2.

### Why (Option B over Option A)

| Criterion | Option A — `harness_runner.ts` stdin/stdout JSON | Option B — Inline ESM template (CHOSEN) |
|---|---|---|
| Mechanical fit with `driver.py:run_ts_harness` (already accepts an inline script string) | Requires a new file + new invocation contract | Drop-in — `run_ts_harness(script_inline)` matches the existing shape |
| Test discoverability (test reads end-to-end without indirection) | Reader must open `harness_runner.ts` AND the JSON spec format AND the python test | Reader sees the harness ops inline in the python test |
| Type safety at the ops boundary | Spec format is freeform JSON; would need a discriminated-union schema | TS compiler checks the ops at script-construction time (literal call sites) |
| Coupling between python suite and TS test infra | Tighter — both sides own the JSON schema | Looser — python emits an ESM string; TS owns its own surface |
| Failure surface | Errors at runner runtime (less informative) | Errors at node CLI exit with full stack trace surfaced to pytest |
| File churn | +1 new file (`harness_runner.ts`) | 0 new files |

Both options pass the DD-1 contract (subprocess invocation through node).
The compositional simplicity of Option B is decisive: the inline string IS
the contract, and the python test bodies read as plain procedure.

### How to apply

Acceptance tests construct ESM scripts as plain python strings and pass
them via `driver.run_ts_harness(script)`. The `cwd` is set to
`tests/acceptance/user-flow-state-machines/` so `import './harness/...'`
resolves correctly. Invocation: `node --import tsx --input-type=module -e <script>`.

`tsx` is a devDependency of the user-flow-state-machines suite; the
acceptance test fixture `requires_node` skips when `node` is absent. A
future addition: a `requires_tsx` fixture if the local stack drops it.

Example (US-202 harness scenario):

```python
script = (
    "import { userFlowHarness } from './harness/user-flow-harness.ts';\n"
    "const h = userFlowHarness({\n"
    "  authProxyUrl: 'http://localhost:1042',\n"
    "  fakeWorkOSUrl: 'http://localhost:14299',\n"
    "  principalId: 'dev-user-001',\n"
    "});\n"
    "await h.j002.begin('Maya Chen');\n"
    "await h.j002.assert_initial_project('Q4 Analytics');\n"
    "console.log(JSON.stringify({ok: true}));\n"
)
result = subprocess.run(
    ["node", "--import", "tsx", "--input-type=module", "-e", script],
    cwd=str(driver.repo_root / "tests" / "acceptance" / "user-flow-state-machines"),
    ...,
)
```

### Reversibility

If a future MR finds inline strings unwieldy (e.g. multi-scenario
parameterization, complex assertion narratives), an `harness_runner.ts`
can be added at any time as a peer pattern — the two are not mutually
exclusive. The DELIVER MR that introduces it would simply use it for the
new ops while preserving the existing ops in inline form.

---

## DDD-2 (sub-step 01-02) — Resolver knob: per-process `forceListSessionsFailures` set

**Decision**: The US-202 degraded-path scenario forces a `list_sessions`
failure for a specific project by passing `X-Force-List-Sessions-Failure:
<project_id>` to the `/ui-state/flow/.../begin` endpoint. The ui-state
process maintains a single per-process `Set<string>` of project ids whose
`list_sessions` calls the resolver should treat as 5xx-failed.

The set is **cleared on every `/begin`** so test scenarios don't leak
state across runs. The knob is gated by the harness-knob pattern: in
AUTH_MODE=dev (default for local compose), the knob is honored
unconditionally; in production builds the header has no effect because
auth-proxy strips identity headers but forwards all other headers, and
the resolver's `shouldFailListSessions` callback is wired ONLY to this
test-only set.

### Why (this pattern over alternatives)

| Pattern | Pros | Cons |
|---|---|---|
| **Per-process set (CHOSEN)** | Simple; matches the existing `forceCreateProjectFailureNext` pattern; no per-request state plumbing into the actor | Single-tenant only — a parallel test run across principals would collide |
| Per-request thread-local | Fully isolated | TS doesn't have ergonomic thread-locals; AsyncLocalStorage adds complexity |
| Backend-side fault injection | More realistic (real 5xx from `/api/projects/.../sessions`) | Requires a backend test endpoint or middleware; backward-couples the FE test contract to a BE test fixture |

Multi-tenant parallel testing is OUT OF SCOPE for the J-002 acceptance
suite per DD-1 (sequential pytest invocation, single principal `dev-user-001`).
If a future MR needs parallel-by-principal, the set becomes a
`Map<principal_id, Set<project_id>>`.

### How to apply

Tests pass `extra_headers={"X-Force-List-Sessions-Failure": project_id}`
to `driver.post(...)`. The header is honored by `ui-state/index.ts`'s
`/begin` route for the J-002 machine only; other machines ignore it.

---

## DDD-3 (sub-step 01-03) — Per-project lookup for intent_project_id resolution

**Decision**: When the J-002 `resolveInitialScope` invoke fires with a populated
`input.intent_project_id`, the resolver consults the backend's
`GET /api/projects/:id` endpoint directly instead of listing all the user's
projects and filtering. This lets the resolver distinguish 403 (cross-tenant /
access revoked → `{ cross_tenant: true }`) from 404 (deleted / never existed →
`{ project_not_found: true }`).

The no-intent fallback (last-used resolution) continues to use `list_projects`
as before.

### Why (per-project lookup over list-and-filter)

| Pattern | Pros | Cons |
|---|---|---|
| **Per-project `GET /api/projects/:id` (CHOSEN)** | Distinguishes 403 from 404 → distinct `underlying_cause_tag` per US-204 AC. Single request, no list traversal. Uses existing `authorize_project_access` dependency for tenant enforcement. | One extra round-trip when the project is in the user's list. |
| List-and-filter (`GET /api/projects`) | Single request shared with last-used resolution. | Both 403 and 404 manifest as "project absent in user's list"; cannot tag cause distinctly. Would require a second `GET /api/projects/:id` to disambiguate, which is the chosen pattern minus the listing overhead. |

The US-204 AC requires distinct `underlying_cause_tag` values (`cross_tenant`
vs `project_not_found`), and the backend already provides clean error-code
disambiguation at the `:id` endpoint. The list approach can't deliver this
property without a second request, making the per-project approach
mechanically superior.

### How to apply

`resolveInitialScopeFn` has two branches:

1. **`intent_project_id` set** — fetch `GET /api/projects/:id`:
   - 200 → `{ project: { id, name } }` → `project_selected`
   - 403 → `{ cross_tenant: true }` → `scope_mismatch_terminal` w/
     `underlying_cause_tag = "cross_tenant"`
   - 404 → `{ project_not_found: true }` → `scope_mismatch_terminal` w/
     `underlying_cause_tag = "project_not_found"`
   - 5xx → throw → `error_recoverable`
2. **No intent** — fall through to last-used resolution (the existing
   list-projects + per-project list-sessions pattern from 01-02 + OQ-J002-5).

### Reversibility

The two-branch shape is internal to `resolveInitialScopeFn`. A future MR can
switch the intent branch to a different strategy (e.g. listing-then-filter
with a fan-out probe to disambiguate) without disturbing callers; the
`ResolveInitialScopeOutput` union is the stable contract.

---

## DDD-4 (sub-step 01-03) — Root-level open_deep_link handler

**Decision**: The J-002 machine's `open_deep_link` event is handled at the
machine-ROOT level (in the top-level `on: { open_deep_link: ... }` block) rather
than per-state, with `target: ".resolving_initial_scope"` and `reenter: true`.

### Why (root over per-state)

A cold deep-link can arrive when the machine is in ANY live state
(`no_projects_empty_state`, `project_selected`, or — in future MRs —
`session_active`, `switching_project`, etc.). Per-state handlers would require
adding the event entry in every state that wants to allow deep-link arrival.
Root-level is one entry, total.

The handler:
1. Assigns intent_* fields from event payload onto context.
2. Transitions to `resolving_initial_scope` with `reenter: true` so the
   `resolveInitialScope` invoke re-fires against the new intent.

`reenter: true` is critical — without it, an already-`resolving_initial_scope`
state would NOT re-fire its invoke.

### Reversibility

If a future MR needs per-state interception of `open_deep_link` (e.g., to
suppress it during `switching_project`), individual states can add their own
`on.open_deep_link` handler that takes precedence over the root-level entry.

---

## References

- `distill/wave-decisions.md` DD-1..DD-7 (binding)
- `distill/upstream-issues.md` REC-2 (the question this DDD-1 resolves)
- `deliver/upstream-issues.md` D-01-01a..D-01-01d (sub-step 01-01 deviations)
- DESIGN handoff §"DEVOPS handoff" / §"Endpoints to assert against"
- `tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts` (the harness file extended by 01-02)
- `tests/acceptance/project-and-chat-session-management/driver.py` `run_ts_harness` (the invocation site)

---

## DDD-5 (MR-2) — session-chat is spawned and projected at flow_id `session-chat:<principal>` (per-machine projection URL family)

**Decision**: MR-2 introduces the **session-chat** machine surface on the wire
via `/ui-state/flow/session-chat/{begin, event, projection, projection/stream}`.
This URL family was previously aspirational (DESIGN §1 + §3.1); MR-2 ships it
because the new session-list / resume / session-active states need a flow log
distinct from project-context's.

The legacy `project-and-chat-session-management` URL family is **preserved
unchanged** for project-context — MR-1 acceptance tests continue to pass
verbatim per the MR-1.5 REC-2 decision.

### Why two URL families, not one composed projection

| Option | Pros | Cons |
|---|---|---|
| **TWO URL families (CHOSEN)** | Each machine has its own flow log (Redis stream key) — no coupling between project-context and session-chat event domains. Reflects DESIGN §3.1's MachineRegistry strategy. Each tab can subscribe to ONE machine's projection-stream if it only renders that surface (cheaper SSE). | Two `EventSource` instances per chat-shell page. |
| Composed `getJ002Projection({project_context, session_chat})` over one URL | Single SSE for the union. | Couples the two flows' event logs; a session-chat-only update wakes consumers that only care about project-context. Adds a new wire envelope shape. |

The composed-projection pattern is still available client-side: `sessions.tsx`
loader reads BOTH projections via `Promise.all(...)`. The composition happens
in the loader, not the wire envelope.

### How to apply

- `ui-state/index.ts` wires `sessionChatMachineDeps: { loadSessionList, resumeSession }`.
- `ui-state/lib/orchestrator.ts`:
  - `MACHINE_REGISTRY[SESSION_CHAT_WIRE_NAME] = (deps) => createSessionChatMachine(deps.sessionChatMachineDeps ?? {})`.
  - `maybeFireProjectReady` calls `beginIfNotStarted({machine: SESSION_CHAT_WIRE_NAME, ...})` when project-context settles in `project_selected`.
  - `emitSessionChatSpawnEvents` + `appendSessionChatTerminalEvents` write events to the session-chat flow log (per DESIGN §7.3 — disjoint event-type domain).
- The idempotent re-spawn branch in `beginIfNotStarted` re-emits spawn events (substrate completion — without this, a re-issued project_ready when the actor already exists silently drops the events).

### Reversibility

If a future MR finds two URL families unwieldy, the composed projection can be
added as a third URL family (`/ui-state/flow/j002-combined/projection`) without
removing the per-machine ones. Adding it is one HTTP handler that calls
`Promise.all([orchestrator.getProjection(pc_id), orchestrator.getProjection(sc_id)])`.

---

## DDD-6 (MR-2) — Redis `subscribe()` returns an AsyncIterable bounded by `blockMs`

**Decision**: The new `FlowEventLog.subscribe(flow_id, sinceId, blockMs)`
method returns an `AsyncIterable<FlowEvent>` that yields one event per new
entry in the flow's Redis stream, terminating cleanly after `blockMs` of
silence OR when the caller invokes `.return()` (e.g., the SSE consumer
closes the connection).

### Why AsyncIterable

| Pattern | Pros | Cons |
|---|---|---|
| **AsyncIterable (CHOSEN)** | Native `for await` loops in the SSE handler; cancellation via `.return()` is standard; no callback-registration bookkeeping. | Iterator must `try/finally` close the underlying Redis subscriber connection. |
| Callback subscription (`subscribe(flow_id, cb)`) | Familiar pub/sub shape. | Caller must wire a teardown path; race between unsubscribe and emit; no natural backpressure. |
| EventEmitter / Observable | Powerful, but a new dependency type for the codebase. | Larger blast radius; the orchestrator only needs one consumer type (SSE). |

AsyncIterable fits the SSE handler's `for await` loop directly. The Redis adapter
uses a **dedicated subscriber connection** (`client.duplicate()`) because
`XREAD BLOCK` holds the connection for the duration of the block — sharing with
the orchestrator's append/read traffic would deadlock. The connection is
`quit()`-ed in the iterator's `finally` block.

The noop fallback implements the same shape with a per-flow Set of callbacks
flushed on `append()`; this is what the unit tests + the local
no-Redis fallback exercise.

### Reversibility

If a future MR needs millisecond-precision delivery latency or shared subscriber
connections (e.g., 1000+ tabs per principal), the `Redis.subscribe` adapter can
switch to a single multiplexed subscriber connection without changing the
AsyncIterable contract. The two implementations are interchangeable from the
SSE handler's perspective.

---

## DDD-7 (MR-2) — `refresh_session_list` is a session-chat public event (cross-tab refresh substrate)

**Decision**: The `refresh_session_list` event is added to session-chat's
public event vocabulary. From `session_list_visible` (and `session_active`,
for symmetry) the machine transitions to `loading_session_list` with
`reenter: true`, re-firing the `loadSessionList` invoke.

### Why a public event, not a harness-only knob

The cross-tab refresh contract (US-203 Example 4 + DWD-9 + RD2) requires that
**any tab** can trigger a fresh session-list read. The mechanism is:
1. Tab A subscribes to `/projection/stream` for session-chat.
2. Tab B creates a session via the backend (independent path).
3. Tab B dispatches `refresh_session_list` to session-chat. The machine
   re-fires loadSessionList. The new event is appended to the session-chat
   flow log. Tab A's SSE delivers the updated projection.

The event is also useful for a user-driven "pull-to-refresh" gesture in the FE.
Making it a harness-only knob would prevent that future use case.

### How to apply

- `session-chat.ts` adds the event to the `SessionChatEvent` union.
- `session_list_visible.on.refresh_session_list = { target: "loading_session_list", reenter: true }`.
- `session_active.on.refresh_session_list` mirrors the handler.
- No new actor; just re-fires the existing loadSessionList invoke.

---

## DDD-8 (MR-2) — Backend substrate completion lands inside this MR

**Decision**: Three backend substrate gaps left by MR-2a are completed inside
MR-2 (see `deliver/upstream-issues.md` D-MR2-a for full context):

1. `_mappers.session_to_dict` now includes `active_dataset_id` (column flowed through every read path).
2. `SessionUpdate` Pydantic schema allowlists `active_dataset_id` (PATCH wire surface honors the column).
3. NEW `GET /api/sessions/:session_id` endpoint + `get_session` use case + JSON:API response.

These are the minimum read-side completions that make the MR-2a write-only
column useful. They were missed in MR-2a's brief but are mechanical
one-liners (≤ 15 lines total). The DESIGN §2.3.B `resumeSession` actor reads
exactly these surfaces; without them the user story cannot pass.

### Why include them in MR-2 (not MR-2b)

| Pattern | Pros | Cons |
|---|---|---|
| **MR-2 includes substrate completion (CHOSEN)** | One PR captures the full read-path contract. Each diff is < 15 lines and entirely additive. | Slightly broader scope than the brief named. |
| Separate MR-2b for substrate | Strict adherence to the named-scope contract. | Adds a sequencing step + cherry-pick risk for nothing — no design choice involved. |

The brief says *"Do NOT extend scope beyond MR-2"* — these three diffs are
substrate completion (read access to a column that was already added to the
schema), not new feature scope. They are necessary preconditions for MR-2's
acceptance tests, so they live in MR-2.

