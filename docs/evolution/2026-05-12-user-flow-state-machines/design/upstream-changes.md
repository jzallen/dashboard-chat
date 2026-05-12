# Upstream Changes — DESIGN — `user-flow-state-machines`

> **Wave**: DESIGN (propose mode)
> **Date**: 2026-05-11
> **Architect**: Morgan
> **Purpose**: Document where DESIGN diverged from DISCUSS assumptions, for traceability.

This file is short by design — DISCUSS was rigorous and Round-2 surfaced the load-bearing constraints before DESIGN began. The architectural decisions are additive resolutions of DISCUSS-deferred OQs rather than re-frames.

---

## Change 1 — Inertia.js (user's signalled lean) → Remix

**DISCUSS state**: The user's "FE reloads after API call → same state as backend" framing pointed hardest at Inertia.js. DISCUSS recorded this as the user's lean but did not commit; the framework choice was the DESIGN-wave deliverable.

**DESIGN state**: Inertia is **cut at ADR-027**; **Remix is recommended**.

**Why** (one-paragraph rationale; full version in ADR-027):
The maintained Inertia adapters in 2026-05 are Laravel, Rails, Adonis, Express, and Phoenix. There is no maintained Hono Inertia adapter. Adopting Inertia requires either (a) writing and maintaining an Inertia-Hono shim ourselves (lock-in to a single-author shim), (b) regressing on ADR-001 (Hono over Express), or (c) abandoning Inertia entirely. The user's underlying preference — server-resolved state propagated through the FE without per-component plumbing — is satisfied by Remix's `useRouteLoaderData("root")` pattern with substantially less adapter risk. The architectural intent the user described is preserved; the framework that carries it is Remix.

**User decision required**: confirm Option D (Remix), or override to Option B (BFF + plain SPA). ADRs 027/028/029 are written to apply to both.

---

## Change 2 — `agent/` extension explicitly rejected as a host

**DISCUSS state**: Round-2 D8 hard-constrained the agent out of contention.

**DESIGN state**: ADR-027 ratifies this verbatim; the agent is unmodified. The ui-state tier is a NEW Hono service in compose, peer to the agent.

**Why this is a documented "non-change"**: Worth recording because the design temptation (one Node process for both flow state and chat brain) is real and the cost (two responsibilities one container, hot stateful service for an otherwise stateless one) is real. The architecture does NOT take the bait.

---

## Change 3 — OQ-2 resolution (XState v5 with actor model)

**DISCUSS state**: OQ-2 ("what runs the machines?") was deferred from iteration 1 and not resolved in Round-2.

**DESIGN state**: **XState v5 with the actor model** (ADR-028).

**Why**: US-005's cross-machine FREEZE/THAW requirement is the v5 actor model's native idiom. v4 leaves cross-machine signaling as hand-rolled imperative coordination — exactly the race-condition shape this feature retires. The replay-buffer-in-orchestrator pattern (vs scattered across N machines) is also a natural v5 fit.

---

## Change 4 — OQ-5 resolution (cross-machine freeze + replay buffer)

**DISCUSS state**: OQ-5 was open. The DISCUSS handoff suggested "framework-level pause/resume signal" without specifying mechanism.

**DESIGN state**: Specified in ADR-027 §5:
- FREEZE is broadcast by the orchestrator to all spawned actors via XState v5's `system.get(id).send` enumeration.
- Replay buffer lives in the orchestrator (not the FE). Bounded: 5s timeout, 16 max queued mutations per flow.
- Buffer overflow / timeout emits a `replay_abandoned` event; the FE surfaces a UX path (preserve original input in chat composer).

---

## Change 5 — OQ-3 (projection wire format) → JSON + SSE, full-state-per-event

**DISCUSS state**: OQ-3 was open; DISCUSS recommended extending ADR-015's pattern but left the exact shape open.

**DESIGN state**: Specified in ADR-027 §4: JSON projection at `GET /api/flows/{id}/projection`; SSE push at `/projection/stream`. Full-state-per-event (no delta encoding in PR-0; deltas are additive future).

---

## Change 6 — OQ-4 (persistence) → Redis-via-ADR-018 inheritance

**DISCUSS state**: OQ-4 was open; DISCUSS recommended mirroring ADR-017's dispatch (since superseded by ADR-018).

**DESIGN state**: **No new ADR for persistence.** ADR-027 §3 explicitly inherits ADR-018's policy verbatim: `REDIS_URL` set → Redis tier; unset → noop. New key prefix (`ui-state:{flow_id}:events`); same compose Redis container; same `selectThreadPersister`-shaped dispatch helper.

---

## Change 7 — OQ-6 (TS harness composition pattern) → kept as DISCUSS recommended

**DISCUSS state**: One harness class per machine, composed into a top-level facade.

**DESIGN state**: Unchanged — `UserFlowHarness` is the facade; per-machine helpers compose into it. The HTTP surface (projection endpoint) is the integration surface; the harness wraps it. See `handoff-design-to-distill.md` §"TS UserFlowHarness public surface."

---

## Change 8 — OQ-8 (scope-chain expressibility) → ADR-029

**DISCUSS state**: OQ-8 was the central scope-chain criterion in Round-2. DISCUSS named the variants per framework but did not commit to a shape.

**DESIGN state**: ADR-029 specifies the contract end-to-end:
- `ActiveScope` typed object as the SSOT.
- Server-resolved at the ui-state tier's ScopeResolver.
- Propagated via `useRouteLoaderData("root")` (Option D) or `<ScopeProvider>` (Option B).
- Five invariants (`org_id` equals JWT claim; cross-tenant 403; etc.) enforced uniformly.
- Agent receives scope via `X-Active-Scope` header injected at the auth-proxy.
- TS harness's `assert_scope({...})` reads from the same projection.

---

## What DESIGN did NOT change

- US-001 through US-005 are accepted as written; no AC was invalidated.
- The journey state machine (`docs/product/journeys/login-and-org-setup.yaml`) is the contract the implementation honors. No state added or removed.
- The shared-artifacts registry (DISCUSS) remains the integration-validation root. `active_scope` is now mechanically enforced (vs hand-validated).
- JOB-002 statement is unchanged; outcome statements O1–O5 are unchanged.
- The DEVOPS instrumentation list from DISCUSS `outcome-kpis.md` is unchanged; this feature ADDS ui-state-tier-specific events (see `handoff-design-to-distill.md` §"Instrumentation list").

---

## Decisions not yet made (carried to DISTILL or user)

- **User ratification of Option D vs Option B.** ADRs are written for either; the difference is the FE propagation primitive (loader data vs Context).
- **Whether `POST /api/auth/reissue` already exists.** A 10-minute spike resolves this at DELIVER kickoff.
- **`role="alertdialog"` accessibility implementation for US-003.** Implementation-level; DISTILL's acceptance test asserts focus management.

---

## Appended by Titan (system-scope pass, 2026-05-11)

The system-scope pass surfaced four design points in Morgan's deliverable that needed sharpening, plus one wholly-new contract refinement. None invalidate Morgan's application-scope architecture; all are additive or clarifying.

### Change 9 — Container diagram: Remix as a separate container, not a replacement for nginx

**Morgan's state**: `application-architecture.md` §2 C4 Container diagram shows `Container(frontend, "Frontend (Remix on Vite)", ...)` — implying the single existing `frontend` container's process model changes from nginx-serving-static to Node-running-Remix.

**Titan's state**: **Remix runs as a NEW separate container** (`ui-presentation`). nginx in the existing `frontend` container is byte-unchanged. nginx gains one new upstream rule for migrated routes; ALL existing rules — including ADR-015's load-bearing `/api/channels/:id/presentation-state` rule — are preserved verbatim. Ratified in **ADR-031**.

**Why this matters at system scope**: replacing nginx means re-implementing four routing rules + gzip + asset caching + late-binding DNS resolution in JavaScript. Doable, but unnecessary churn with no system-level payoff. The strangler-fig migration is also far cleaner with two containers (per-route rollback is a one-line nginx.conf revert) than with a single rewritten container.

**Source**: `frontend/nginx.conf` (6 routing rules); ADR-015 §"Decision outcome" (the presentation-state routing rule is load-bearing).

### Change 10 — "Auth-proxy is sole ingress" is aspirational today; ADR-030 makes it honored for the new tier from day 1

**Morgan's state**: `application-architecture.md` §"Key callouts" claims "Auth-proxy is the only ingress for the FE, the harness, the ui-state tier, the agent, and the backend. ADR-016 is honored."

**Titan's state**: this is **mechanically not true for the agent today** — the agent is reached via `frontend/nginx.conf:35-47` (`/worker/` rule, direct to `agent:8787`) and via `frontend/nginx.conf:16-23` (`/api/channels/:id/presentation-state` rule, direct to `agent:8787`). Auth-proxy is the sole ingress for the backend, not for the agent.

**Resolution**: ADR-030 ratifies routing the **ui-state tier** behind auth-proxy from day 1 (honoring ADR-016 for the new tier). The agent's bypass is documented as a pre-existing inconsistency; ADR-030 does not perpetuate it but also does not fix it (out of scope). The ui-state tier sits behind auth-proxy correctly from PR-0.

**Source**: `auth-proxy/app.ts:19` (single `BACKEND_URL`); `frontend/nginx.conf:16-47` (`/worker/` + `/api/channels/:id/presentation-state` bypass routes).

### Change 11 — `flow_id` schema mandates `principal_id` for per-user flows

**Morgan's state**: ADR-027 §3 specifies the Redis key prefix as `ui-state:{flow_id}:events` but leaves `flow_id` schema open. The implication in the seed example (`flow_id = "login-and-org-setup"`) suggests machine-name-only is acceptable.

**Titan's state**: this is **multi-tenant-unsafe**. A `freeze` event broadcast to actors under `ui-state:loginAndOrgSetup:events` would freeze ALL users' login flows. ADR-030 amends:

- Singleton flows (none in PR-0): `flow_id = <machine-name>`.
- Per-user flows (all PR-0 flows): `flow_id = <machine-name>:<principal_id>`.

This is a correctness invariant, parallel to ADR-029 invariant 1 (`active_scope.org_id` equals JWT claim). ScopeResolver enforces the cross-tenant boundary from one angle; the `flow_id` namespace enforces it from the other.

**Source**: ADR-027 §3 (schema gap); ADR-030 §"Decision outcome / 6. `flow_id` schema clarification" (the amendment).

### Change 12 — Replica count is single by mandate, not by implementation choice

**Morgan's state**: `application-architecture.md` is silent on replica count. The deployment section §11 shows compose env vars but no scaling stance.

**Titan's state**: the ui-state tier deploys as **exactly one replica**, enforced by a fixed compose host port (`1043:8788` — same pattern as the agent's `1041:8787`). XState v5's in-process actor model + back-of-envelope estimation jointly require single-replica at the planning horizon. Multi-replica migration is documented in ADR-030 §3 with scaling-ceiling triggers and a pre-costed migration path (1-2 weeks engineering).

**Why this matters at system scope**: Morgan's design did not say "single replica" but ALSO did not say "any replica can serve any request." The latter (the stateless assumption) would have been wrong — XState v5 actors are in-process; cross-process FREEZE/THAW requires Redis pub/sub re-implementation. Making the constraint explicit avoids a future operator running `docker compose up --scale ui-state=2` and discovering the cross-replica FREEZE failure at incident time.

**Source**: ADR-028's actor model + `system-architecture.md` §0 estimation + ADR-030 §"Decision outcome / 2".

### Change 13 — Compose acceptance count is 5+2, not 5+1

**Morgan's state**: `application-architecture.md` §11 claims "(was 5; +1 for ui-state)" → 6 services.

**Titan's state**: with the ui-presentation container added per ADR-031, the count is **5+2 → 7 services** in the compose acceptance stack.

ADR-016 (compose-stack acceptance test parity with production) requires the test stack to include all 7 services. Compose acceptance test's structural assertions must verify byte-identical startup of all 7.

**Source**: ADR-031 §8 (compose acceptance impact).

---

## What Titan did NOT change

- Morgan's framework choice (Remix v2) is unchanged. Option B fallback unchanged.
- Morgan's engine choice (XState v5 actor model) is unchanged.
- Morgan's `active_scope` propagation contract (ADR-029) is unchanged.
- Morgan's projection wire format (ADR-027 §4) is unchanged.
- Morgan's adapter probe semantics (ADR-027 §6) are unchanged.
- DESIGN-wave commitment to inheriting ADR-018's capability-presence dispatch is unchanged.

The application-scope architecture is sound. The system-scope pass tightens the deployment surface, the scaling stance, the multi-tenant safety of the persistence key namespace, and the frontend tier's process model — without altering any application-scope decision.
