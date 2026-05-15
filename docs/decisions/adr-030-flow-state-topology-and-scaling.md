# ADR-030: UI-State Tier Topology and Scaling Stance

**Status:** Accepted (ratified 2026-05-11; amended 2026-05-15 — see "Amendment 2026-05-15" sections at the end)
**Date:** 2026-05-11
**Originating wave:** DESIGN — `user-flow-state-machines` (system-scope pass)
**Author:** Titan (nw-system-designer)
**Companion artifacts:**
- System-scope deliverable: `docs/feature/user-flow-state-machines/design/system-architecture.md`
- Sibling ADRs (same wave): ADR-027 (host tier + framework), ADR-028 (XState v5 actor model — amended in lockstep 2026-05-15), ADR-029 (`active_scope` propagation), ADR-031 (frontend tier transition)
- Inherited: ADR-016 (auth-proxy as sole production ingress), ADR-018 (capability-presence dispatch)
- Divergence artifact that motivated the 2026-05-15 amendment: `docs/discussion/session-chat-context-architecture/directions.md` (Direction A + Direction F + Direction G convergence)

## Context

ADR-027 establishes that the `ui-state/` tier is a new Hono service peer to the agent. It does NOT specify:

- **Topology**: where the tier physically sits in the request graph (behind auth-proxy? Behind reverse-proxy nginx? Direct host port?)
- **Scaling shape**: how many replicas; sticky vs round-robin; stateless rehydration vs in-process actors.

These two questions are **inseparable**. XState v5's actor model places actors in-process: cross-process `system.get(actor_id).send(...)` is not a v5 primitive. Multi-replica deployment therefore requires either (a) sticky routing per `flow_id`, (b) stateless tiers with per-request Redis rehydration, or (c) single replica.

A separate finding makes the topology decision urgent: **today's auth-proxy is single-upstream** (`auth-proxy/app.ts:19` hardcodes `BACKEND_URL`; line 178's `app.all("*")` forwards everything to that one upstream). ADR-016 claims "auth-proxy is the sole production ingress for backend and worker" but the agent (`/worker/*`) is reached via the frontend container's nginx directly today. Adding the ui-state tier behind auth-proxy (per ADR-016 spirit) requires extending auth-proxy to support multi-upstream routing — a small but visible change to a production-critical service.

## Decision drivers

- **Estimation governs choice.** Back-of-envelope (system-architecture.md §0): single 256 MB container at 1 CPU handles 10x load with 2-3 orders of magnitude headroom on every dimension (RAM, CPU, Redis QPS, projection QPS, SSE connections). The capacity case for multi-replica does not exist at the planning horizon.
- **XState v5 actor in-process semantics.** Multi-replica requires either cross-process actor coordination (re-implementation via Redis pub/sub — a load-bearing piece of synthetic infrastructure with no consumer outside this feature) or sticky routing (auth-proxy gains a sticky-routing layer + per-flow rebalance on crash).
- **ADR-016 fidelity.** The ui-state tier handles privileged operations (mutating flow state; invoking backend writes during transitions). It MUST sit behind auth-proxy.
- **Auth-proxy concerns separation.** Auth-proxy is stateless and does JWT verification + identity-header injection. Adding stateful flow-machine ownership to it would muddle two concerns. Auth-proxy MUST NOT host the ui-state tier in-process.
- **Reversibility.** The single-replica decision must be reversible. Migrating to multi-replica should be a feature-isolated change, not a re-architecture.

## Considered options

### Topology (SQ-1)

1. **Behind the frontend's nginx as a `/ui-state/*` upstream.** Bypasses auth-proxy. Contradicts ADR-016 for privileged-operation traffic. Rejected.
2. **Behind auth-proxy as a second upstream.** Honors ADR-016. Requires auth-proxy to learn multi-upstream routing. **Selected.**
3. **Co-tenanted in the auth-proxy container.** Muddles auth-proxy's single concern. Rejected — same rationale as rejecting `agent/` as a host (D8).
4. **Direct host port via a new ingress.** Operational mass with no value at this scale. Rejected.

### Scaling shape (SQ-2)

1. **Option α — Single replica.** Actor tree lives in one process. Crash recovery via Redis FlowEventLog rehydration. MTTR ~30s. **Selected.**
2. **Option β — Multi-replica stateless** (per-request actor rehydration from Redis). Higher latency (~15ms p95 vs 5ms), substantial new code surface (rehydration helper, Redis pub/sub fan-out for FREEZE/THAW), no capacity case at planning horizon. Rejected.
3. **Option γ — Multi-replica with sticky routing** (consistent hash on `flow_id`). Solves the capacity case but adds a sticky-routing layer to auth-proxy. No capacity case at planning horizon. **Held in reserve** as the documented migration path when scaling-ceiling triggers fire.

## Decision outcome

### 1. Topology: behind auth-proxy, with auth-proxy extended to multi-upstream

**The ui-state tier sits behind auth-proxy.** Auth-proxy gains a routing table mapping path prefixes to upstream URLs:

| Path prefix | Upstream | Behavior |
|---|---|---|
| `/api/auth/*` | (auth-proxy local) | Token + PAT lifecycle (existing) |
| `/api/*` | `BACKEND_URL` | Default — existing behavior preserved |
| `/ui-state/*` | `UI_STATE_URL` (NEW env var) | New rule for this feature |
| `/worker/*` | `AGENT_URL` (NEW env var, FUTURE) | Out of scope for PR-0; door is open |

The auth-proxy `app.all("*", ...)` handler grows from "proxy to BACKEND_URL" to "proxy to the upstream matching the path prefix." The change is ~30 lines of Hono routing + tests. The auth-proxy's auth verification logic is unchanged.

Auth-proxy upstream rule selection is **purely path-prefix-based, deterministic, no body inspection**. This keeps the auth-proxy fast (no proxy-level parsing) and reviewable.

### 2. Scaling shape: single replica, with documented ceiling

The ui-state tier deploys as **exactly one replica** in compose (and in any production equivalent until the scaling-ceiling triggers fire):

```yaml
# docker-compose.yml addition
ui-state:
  image: dashboard-chat/ui-state:bazel
  pull_policy: never
  environment:
    AUTH_MODE: ${AUTH_MODE:-dev}
    JWKS_URL: ${JWKS_URL:-}
    AUTH_PROXY_URL: http://auth-proxy:3000
    BACKEND_URL: http://api:8000
    WORKOS_API_KEY: ${WORKOS_API_KEY:-}
    REDIS_URL: redis://redis:6379/0
    FLOW_EVENT_MAXLEN: ${FLOW_EVENT_MAXLEN:-1000}
  ports:
    # Fixed host port (per agent precedent) — precludes scaling > 1 replica
    - "${UI_STATE_HOST_PORT:-1043}:8788"
  depends_on:
    redis:
      condition: service_healthy
    auth-proxy:
      condition: service_started
```

The fixed host port (`1043:8788`) is **intentional**: matches the agent's pattern (`docker-compose.yml:48`); precludes `--scale=N` for this service; documents the single-replica decision at the topology level.

### 3. Scaling ceiling — triggers that force migration to Option γ

The single-replica decision is revisited when ANY of the following fire:

| Trigger | Indicator | Action |
|---|---|---|
| CPU > 60% sustained for >5 min | `ui_state.cpu_utilization_p95` alarm | Begin Option γ migration |
| RAM > 200 MB sustained | `ui_state.heap_used_bytes` alarm | Begin Option γ migration |
| Active actors > 10,000 | `ui_state.actors_active` alarm | Begin Option γ migration |
| Required SLO > 99.5% | Product decision | Begin Option γ migration |
| Cross-region deployment introduced | Topology decision | Re-evaluate (per-region replica may suffice) |

Option γ migration cost: **estimated 1-2 weeks engineering** — sticky-routing logic in auth-proxy (hash `flow_id` from path → upstream replica index), removal of fixed host port from compose, addition of per-replica health-aware routing in auth-proxy. The tier itself is unchanged (already event-sourced); the migration is auth-proxy + compose only.

### 4. Failover behavior (single replica)

On tier crash:

1. Compose `restart: on-failure` (or `unless-stopped`) restarts the container.
2. Tier startup runs `probe()` (Redis, auth-proxy, backend; WorkOS SOFT-fails per ADR-027 §6).
3. **No global rehydration on startup** — actors are rehydrated lazily on first projection request per flow_id.
4. MTTR ~30s (container restart ~10s + first user navigation triggers rehydration ~1s).

Compose acceptance test (ADR-016 mirror) MUST assert:

- `docker compose restart ui-state` mid-flow → flow recovers within 60s.
- During the restart window, projection reads return 503 (the FE's `ErrorBoundary` handles).
- After the restart, the next projection read rehydrates from Redis and reflects the pre-crash state.

### 5. Observability folded in (resolves SQ-4)

Every tier transition emits a structured stdout JSON record at INFO:

```json
{ "ts": "...", "event": "flow.transition", "flow_id": "...", "machine_id": "...",
  "from_state": "...", "to_state": "...", "machine_event": "...",
  "sequence_id": N, "correlation_id": "...", "principal_id": "...", "org_id": "...",
  "duration_ms": N }
```

FREEZE/THAW have their own event names (`flow.freeze.broadcast`, `flow.thaw.broadcast`) per system-architecture.md §3.2.

Health endpoints:
- `GET /health` → 200 if all HARD probes passed; 503 otherwise.
- `GET /health/probes` → per-adapter probe status (Redis, auth-proxy, backend, WorkOS).
- `GET /health/actors` → aggregate actor counts by machine_id (no per-user enumeration).

Metrics derived from structured logs by an external aggregator (Vector/Promtail). NO in-tier metrics endpoint at PR-0 (avoid operational cost of a metrics scraper for a single-replica service).

OpenTelemetry deliberately DEFERRED — system-wide decision, not feature-local.

### 6. `flow_id` schema clarification (amends ADR-027 §3)

ADR-027 §3 implies `flow_id` may be machine-name only (`ui-state:loginAndOrgSetup:events`). This is **multi-tenant-unsafe** for per-user flows. ADR-030 amends:

- Singleton flows (none in PR-0): `flow_id = <machine-name>`.
- Per-user flows (all PR-0 flows): `flow_id = <machine-name>:<principal_id>`.

So a `freeze` event on `loginAndOrgSetup:user-001` MUST NOT affect `loginAndOrgSetup:user-002`. This is a correctness invariant; the ScopeResolver also enforces it from a separate angle (per ADR-029 invariant 1).

## Consequences

### Positive

- **Single replica is the right size at the planning horizon.** Operational complexity stays bounded; the team's mental model is one container, one Redis, one FlowEventLog.
- **No load-bearing synthetic infrastructure built today** — cross-process actor coordination via Redis pub/sub is the largest piece of code Option α avoids; we don't write it until we have a consumer who needs it.
- **Auth-proxy gains multi-upstream as a documented capability.** Future migration of `/worker/*` from frontend-nginx to auth-proxy is a follow-on path, not blocked by this feature.
- **Migration path to Option γ is documented and pre-costed.** When the ceiling triggers fire, the team knows the path and the budget (1-2 weeks).
- **Observability landed at PR-0** — every transition is observable; the FlowEventLog is the audit SSOT; KPI K1-K5 (Morgan's KPI list) are instrumentable from day 1.

### Negative / accepted trade-offs

- **Single-replica SPOF for sign-in and scope transitions.** MTTR ~30s. Acceptable for 99.5% SLO; revisit per ceiling triggers.
- **Auth-proxy code change is in PR-0's critical path.** Multi-upstream routing is small but auth-proxy is production-critical; needs careful review + contract tests. Mitigated by: contract tests against `auth-proxy/openapi.json` (Morgan's ADR-027 §6 already requires this); compose acceptance test verifies the new `/ui-state/*` rule end-to-end.
- **Fixed host port `1043` precludes `--scale=N` for the ui-state tier**, by design. If the team wants multi-replica later, this becomes a compose-config change (drop the fixed port) plus the auth-proxy sticky-routing change.
- **Redis blast radius grows.** Redis now backs three logs (`ui-state:`, `session:`, `presentation-state:`). A Redis outage takes down all three; Redis was already a SPOF, but the consequence widens. Mitigation: operator runbook should add Redis HA before the next service joins the substrate.

### Cross-decision composition

- **ADR-030 ↔ ADR-016**: ADR-030 honors ADR-016's "auth-proxy is sole ingress" spirit by routing the new tier through auth-proxy. ADR-030 also documents that today the agent bypasses auth-proxy (via frontend-nginx's `/worker/` rule) — this is a pre-existing inconsistency that ADR-030 does not fix but does not perpetuate (the ui-state tier sits behind auth-proxy from day 1).
- **ADR-030 ↔ ADR-018**: persistence inherits ADR-018 verbatim (Redis-or-noop). The probe contract (XADD/XRANGE/DEL round-trip on startup) is mandatory per the Earned Trust principle.
- **ADR-030 ↔ ADR-027**: ADR-030 ratifies the specific topology + scaling shape ADR-027 left open. ADR-030 amends ADR-027 §3's `flow_id` schema to mandate `principal_id` for per-user flows (multi-tenant correctness).
- **ADR-030 ↔ ADR-028**: ADR-028's in-process actor model is what makes single-replica the right answer at planning horizon. ADR-030 documents the constraint and the migration path when it no longer holds.
- **ADR-030 ↔ ADR-031**: ADR-031's ui-presentation container talks to the ui-state tier via auth-proxy, per ADR-030's routing table.

## Open questions

1. **When should Redis HA (Sentinel or Cluster) land?** Not feature-blocking, but the Redis blast radius now spans three logs. Recommendation: pick a target SLO for the substrate; Redis HA is the path. Owner: DEVOPS. Out of this ADR's scope.

2. **Should auth-proxy's `/worker/*` route migrate from frontend-nginx to auth-proxy in PR-0?** No — it works today and migrating is a separate concern. Document the path but do not bundle.

3. **Per-org partitioning of the flow-event log.** PR-0 uses per-`flow_id` keys (where `flow_id` includes `principal_id`). If a future consumer needs to enumerate flows for a single org, a secondary index becomes necessary. Not blocking.

## References

- System-architecture.md (this wave's system-scope deliverable)
- `auth-proxy/app.ts` (current single-upstream behavior — line 19, line 178)
- `docker-compose.yml` (agent fixed-port pattern at line 48)
- `reverse-proxy/nginx.conf` (current de-facto multi-upstream router)
- ADR-016 (auth-proxy ingress claim), ADR-018 (Redis dispatch), ADR-027 (tier + framework), ADR-028 (XState v5 actor model)

---

## Amendment 2026-05-15 — Projection as primary read model (Direction A + Direction G)

**Status:** Accepted (2026-05-15)
**Wave:** DESIGN — ratification of `docs/discussion/session-chat-context-architecture/directions.md` Direction A (event-sourced; projection IS the state) + Direction G (forbid orchestrator from reading `snapshot.context.*`, folded in here as a sub-policy of A).
**Companion:** ADR-028 §"Amendment 2026-05-15 — Machines own transitions; the log owns state" (the symmetric letter on the machine-shape side).

### What changed

The original §1 ("Topology") and §4 ("Failover behavior") treated the **projection** as the FE-facing read shape derived from the log on demand — a downstream consumer. This amendment **promotes the projection from downstream side effect to primary read model** for orchestrator FlowEvent emission.

Concretely:

- Before: the orchestrator's `appendSessionChatTerminalEvents` (and peers) read from `snapshot.getContext()` / `snapshot.context.*` at the moment a machine settles, and emitted FlowEvents using those values directly.
- After: the orchestrator emits FlowEvents using values read from `projection.context.*` (the projection is rebuilt from the log via `buildProjection`; DWD-9 SSOT invariant). The machine snapshot is no longer a read target for the orchestrator's emission path.

This makes DWD-9 ("the log is SSOT; the snapshot is a cache") **load-bearing rather than nice-to-have**. The snapshot stops being a place data lives.

### The snapshot-read prohibition (Direction G policy, folded in)

**The orchestrator MUST NOT read from `snapshot.getContext()` or `snapshot.context.*` outside test fixtures.**

This is the lint-enforceable boundary. Specifically:

- **Production code in `ui-state/lib/orchestrator.ts`** (and any file it imports for FlowEvent emission) MUST NOT contain `snapshot.getContext()` or `snapshot.context.<field>` reads. The single legal read source is the projection (`buildProjection(flowId)` or the equivalent live-projection accessor for the emission path).
- **Test fixtures** in `ui-state/lib/**/*.test.ts` MAY read `snapshot.context.*` to assert that internal handler state (per ADR-028 amendment's discriminating test) settled as expected — that is the appropriate read site for machine-internal state.
- **`event.output` payloads inside guard predicates** are NOT a snapshot read and are permitted (see "Direction F" amendment below). The output channel is the contract surface between states.

The existing snapshot-read sites in `appendSessionChatTerminalEvents` (approximately `ui-state/lib/orchestrator.ts:780-897` — 7 read sites per the divergence artifact's audit; line numbers and exact count will drift post-LEAF-1 of `refactor/session-chat-context-srp` and as subsequent LEAFs land) are **migration targets, NOT new precedent**. New PRs MUST NOT add to the count. The orchestrator file also contains several `snapshot.context.*` reads in non-terminal-event paths (e.g., projection-update handlers around lines 324, 342, 1001, 1002, 1066, 1082, 1102, 1254 at the time of writing); those are in scope for the same prohibition once the terminal-event migration is complete (LEAF-A and LEAF-B in "Migration sequencing" below).

### Enforcement (Earned Trust)

Per principle 12, the prohibition is enforced empirically, not by convention:

- **Recommended tooling:** an ESLint custom rule (e.g., `no-restricted-syntax` over `MemberExpression[object.property.name="context"][object.object.name="snapshot"]` with a path-scoped allow-list for `ui-state/lib/**/*.test.ts`) is the lowest-ceremony fit for the TS source tree. Alternative: `eslint-plugin-boundaries` element-type tagging of orchestrator vs test source.
- **Probe contract:** the lint rule's own coverage is itself a probe — a synthetic test under `ui-state/lib/lint-probes/` that introduces a deliberate `snapshot.context.x` read in a non-test file and asserts the rule flags it. Without the probe the rule is faith, not evidence; per principle 12 every enforcement layer needs a probe that proves it can catch the violation it claims to catch.
- **CI gate:** the lint rule runs in the standard pre-commit eslint pass (existing infrastructure; no new gate needed). The probe runs in the standard ui-state vitest suite.

### What this amendment does NOT change

- **Topology** (§1) — unchanged. ui-state stays single-replica behind auth-proxy.
- **Scaling shape** (§2) — unchanged. Single replica, with documented ceiling.
- **`flow_id` schema** (§6) — unchanged. Per-user flows still use `<machine-name>:<principal_id>`.
- **The FlowEvent log as Redis Streams** — unchanged. The amendment narrows what *reads* from the projection, not how the log is stored.
- **The projection's existing FE-facing role** — unchanged. The FE continues to read `GET /api/flows/{flow_id}/projection` (ADR-027 §1); the projection's role just widens to also serve orchestrator emission.

---

## Amendment 2026-05-15 — Async-invoke continuations via `event.output` (Direction F)

**Status:** Accepted (2026-05-15) — folded into this ADR rather than a standalone ADR-039. Rationale: Direction F is a narrow tactical policy (one paragraph of normative content) that is the symmetric input-side rule to the projection-read amendment above. Co-locating them keeps the discriminating test in one ADR. The 039 slot remains available for the next genuinely independent decision.

### The rule

**Async-invoke continuations are carried by `event.output`. Context fields MUST NOT survive an async-invoke boundary except where the field encodes pre-invoke caller identity (`correlation_id`) or pre-invoke configuration that the invoke needs as `input`.**

Concretely:

- A machine's invoked actor (`fromPromise`, `fromCallback`, or a spawned child) receives its data via `input` and returns its branch-relevant data via `output`. The `onDone` transition's `guard` and `actions` read from `event.output.*`.
- A context field set before the invoke and read by `onDone` after the invoke (e.g., the pre-LEAF-1 `intent_session_id` in `SessionChatMachineContext` read by `loadSessionList`'s `onDone` guard at the historical `session-chat.ts:349`) is the failure mode this rule prohibits. The branch-relevant data MUST be returned by the invoked actor as part of its output payload.
- The narrow exception: a field that names *the caller of the invoke* (e.g., `correlation_id` for log threading; `principal_id` for ScopeResolver enforcement per ADR-029) may live in context across the invoke boundary because it is *internal handler state* (per ADR-028 amendment's discriminating test) — the machine itself needs it for its own logging/auth concerns, not as a contract between states.

### Why this is "just XState v5 hygiene"

XState v5's `fromPromise` actor returns its resolved value as `event.output` on `onDone`. Storing the same value in context before the invoke and re-reading it after the invoke is **dual storage of one truth** — and the failure mode the divergence artifact's J2 job (async-invoke continuation carrier) named explicitly. The rule above eliminates J2 as a justification for context fields.

### Relationship to LEAF-1 of `refactor/session-chat-context-srp`

LEAF-1 (intent_resource_id + intent_resource_type dropped from `SessionChatMachineContext`) is consistent with this rule and is **defensible regardless of which directions are ultimately ratified**. It lands independently and does not require this ADR amendment as a prerequisite. Subsequent LEAFs that restructure `loadSessionList` (and peers) to carry continuation via `event.output` ARE post-ratification work (see "Migration sequencing" below).

---

## Amendment 2026-05-15 — Migration sequencing (deferred journey)

**Status:** Sketched (2026-05-15). This is NOT a DISTILL or DELIVER plan; the actual stories/tests live in a future wave. The sequence below is the **shape** of the migration so future contributors know what landed when.

### Already in flight (no ADR ratification required)

- **LEAF-1** of `refactor/session-chat-context-srp`: drops `intent_resource_id` + `intent_resource_type` from `SessionChatMachineContext`. Consistent with Direction F. Lands independently; not blocked by this ADR amendment.

### Post-ratification roadmap

A 3-4 step migration journey, to be sequenced by a future DISTILL pass when the team is ready to commit delivery capacity:

1. **LEAF-A — Redirect orchestrator's session-list reads to projection.** Replace `snapshot.context.session_list` / `session_list_next_cursor` / `has_more` reads in `appendSessionChatTerminalEvents` with reads against the live projection accessor. Acceptance: existing `tests/acceptance/project-and-chat-session-management/` scenarios pass unchanged; orchestrator unit tests assert no `snapshot.context.session_*` reads remain. *Size estimate: small (~1 day; the projection already mirrors these fields 1:1).*

2. **LEAF-B — Redirect orchestrator's active-session reads to projection.** Same shape for `session_id`, `transcript`, `resource`, `pending_first_message`, `underlying_cause_tag`. Acceptance: same. *Size estimate: small-to-medium (~2-3 days; some fields require projection-reducer adjustments).*

3. **LEAF-C — Restructure `loadSessionList` invoke to carry continuation via `event.output`.** The actor returns `{ items, next_cursor, has_more, resume_target: string | null }`; the `onDone` guard reads from `event.output.resume_target` rather than `ctx.intent_session_id`. The `intent_session_id` field is then removable from `SessionChatMachineContext`. Acceptance: existing scenarios pass; new unit tests assert the invoke's output shape. *Size estimate: small (~1-2 days; the actor is one file).*

4. **LEAF-D — Install the lint rule + probe.** Add the `no-restricted-syntax` rule (or equivalent), add the lint-probe synthetic test, document the override path for test fixtures. Acceptance: probe passes; introducing a deliberate violation in a non-test file fails the lint gate. *Size estimate: small (~0.5-1 day).*

The sequence is intentionally LEAF-A → LEAF-B → LEAF-C → LEAF-D: orchestrator-read migrations land before the lint rule, so the rule can be turned on at a point where the codebase already passes it. Each LEAF is independently shippable; the team may interleave with feature work.

This roadmap does NOT need DISTILL or DELIVER planning at the time of this ADR amendment. It is a deferred journey, recorded here so future contributors can pick it up without re-deriving the sequence.
