# ADR-030: UI-State Tier Topology and Scaling Stance

**Status:** Accepted (ratified 2026-05-11)
**Date:** 2026-05-11
**Originating wave:** DESIGN — `user-flow-state-machines` (system-scope pass)
**Author:** Titan (nw-system-designer)
**Companion artifacts:**
- System-scope deliverable: `docs/feature/user-flow-state-machines/design/system-architecture.md`
- Sibling ADRs (same wave): ADR-027 (host tier + framework), ADR-028 (XState v5 actor model), ADR-029 (`active_scope` propagation), ADR-031 (frontend tier transition)
- Inherited: ADR-016 (auth-proxy as sole production ingress), ADR-018 (capability-presence dispatch)

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
