# ADR-048: Auth-Proxy Owns the WorkOS Write Workflow (Org-Create Interception + Credential/AUTH_MODE Consolidation)

**Status:** Accepted (user-ratified 2026-06-11 without amendment; R1–R5 ratified as recommended — R1 retains its DELIVER-validated WorkOS org-name-uniqueness assumption)
**Date:** 2026-06-10
**Originating wave:** DESIGN — `client-driven-onboarding` (system-scope pass)
**Author:** Titan (nw-system-designer), propose mode; grounded in the user-ratified seed `docs/feature/client-driven-onboarding/design-intent.md` and the live source
**Scope:** System architecture — where WorkOS interaction, WorkOS credentials, and the `AUTH_MODE` read physically live; the org-create failure/compensation strategy; removal of ui-state's direct-to-backend egress. Application-level contracts (org-id carry, outcome-event vocabulary, mode-discovery endpoint shape, reissue cookie attributes) are deliberately NOT decided here — they belong to the companion solution-architect pass.

**Supersedes (in part):** ADR-041's assignment of org creation to the backend Org/Project context and the onboarding machine's server-side `createOrg`/`getUserOrg` invokes (the domain realignment itself stands; the *write model* changes per the ratified design intent).
**Un-parks:** ui-cookie-session D8 (`docs/feature/ui-cookie-session/design/delta-and-decisions.md` §3/§6) — the reissue→`Set-Cookie` conversion.
**Honors:** ADR-016 (sole-ingress — this ADR *removes* the documented ui-state→backend bypass), ADR-030 (topology unchanged), ADR-044/046 (the `/state` surface and StateProxy transport are untouched; only the onboarding region's event sourcing changes from actor-driven to client-reported — next passes).

---

## Context

Three facts, all verified in the live tree on 2026-06-10, motivated the user-ratified boundary reassignment this ADR realizes at system scope:

1. **AUTH_MODE split-brain is a real, observed outage class.** auth-proxy and backend read `AUTH_MODE` independently; `docker-compose.override.yml` pinned auth-proxy to dev but (until an interim guard was added) not the api, so a stray `.env` with `AUTH_MODE=workos` put the backend in workos mode under a dev auth-proxy — org-create hit the real WorkOS API with a fixture user id → 404 → 502 → the onboarding machine's terminal-in-practice `partial-setup`. The override's api pin (`docker-compose.override.yml:30–37`) is explicitly commented as an "interim guard until auth-proxy becomes the sole AUTH_MODE reader" — this ADR is that sunset.
2. **The backend's WorkOS footprint is exactly one path.** Its only `auth_mode` read is the org-create dispatch (`backend/app/use_cases/organization/create_organization.py:72`); its only credential use is `_create_workos_org` (`:86–120`); `workos_client_id`/`workos_redirect_uri` in `backend/app/config.py:80–81` are read nowhere else (dead config). The footprint is small enough to relocate wholesale.
3. **ui-state violates ADR-016 by construction.** Its onboarding/project-context/session-chat actors call `${backendUrl}` directly with dev fixture identity headers (`ui-state/config.ts:13–29`, `ui-state/index.ts:117–133`) — in-network traffic that bypasses the sole ingress — and the machine-internal I/O produced real fragility (process crash on an event to a settled child; no retry from `partial-setup`).

The auth-proxy already owns every *other* WorkOS interaction (OIDC callback/refresh/logout via `lib/user-auth/workos.ts`) and already special-cases `POST /api/orgs` on the response side (the Stage-2 reissue hook, `app.ts:839–885` + `lib/post-response-reissue.ts`). The org-create *request* side is the missing half of a seam that exists.

## Decision

### 1. WorkOS write workflow moves to auth-proxy via org-create route interception

On `POST /api/orgs` in the catch-all proxy path (`auth-proxy/app.ts:785–826`), when `AUTH_MODE=workos`, auth-proxy: (i) pre-checks org-name availability with the backend, (ii) creates the WorkOS organization + organization-membership (the same two calls the backend makes today, relocated), (iii) forwards the request to the backend carrying the WorkOS-minted org id (carry contract: solution architect), (iv) on backend 201, mints the org-scoped token via the existing reissue seam — now emitted as `Set-Cookie` in addition to `X-New-Access-Token` (un-parking ui-cookie-session D8). Dev mode forwards straight through. The interception is path+method-guarded so every other proxied request is zero-overhead (same cheap-guard pattern as the existing reissue hook).

The WorkOS org-provisioning calls extend the existing `lib/user-auth/workos.ts` HTTP boundary (same `WORKOS_BASE` + `clientSecret` config, same injected-`fetch` pattern). Timeout posture: `AbortSignal.timeout(5000)` per WorkOS call; **no automatic retry on the org create** (not idempotent); one network-error retry on membership (idempotent by semantics) and on the compensation delete.

### 2. Credential + AUTH_MODE consolidation

- **backend:** loses `AUTH_MODE` and all `WORKOS_*` env (compose `api`/`api-full` blocks) and the matching `config.py` fields (`auth_mode`, `workos_api_key`, `workos_api_url`, `workos_client_id`, `workos_redirect_uri`); `_create_workos_org` and the mode dispatch are deleted. The backend becomes a pure resource store trusting auth-proxy's identity headers.
- **ui-state:** loses `BACKEND_URL`, `FAKE_WORKOS_URL`, `AUTH_MODE` (set-but-never-read), and the `extra_hosts` fake-WorkOS plumbing — **zero network egress remains**. Its startup config (`ui-state/config.ts`) shrinks to Redis only.
- **auth-proxy:** sole holder of `WORKOS_API_KEY` and sole `AUTH_MODE` reader on the org/onboarding path; gains an explicit `WORKOS_BASE` compose pin (already read at `app.ts:317`) as the relocated dev/acceptance fake-WorkOS seam.
- **Out of scope, documented:** the agent's independent `AUTH_MODE` read (`agent/lib/auth.ts:4`) guards its own middleware on a different path; it remains a pre-existing inconsistency in the ADR-016 tradition (ratification point R3).

The split-brain failure class becomes **unrepresentable in compose config** rather than guarded by an override pin.

### 3. Failure/compensation strategy: pre-check + best-effort compensation, layered

Considered options (full matrix: `docs/feature/client-driven-onboarding/design/system-architecture.md` §2):

- **A — backend name pre-check BEFORE the WorkOS create.** A user-typo 409 — the common failure — never touches WorkOS, so it cannot orphan an IdP org. Residual TOCTOU race backstopped by the DB unique constraint.
- **B — compensate after a failed backend persist.** On backend non-201 following a successful WorkOS create, best-effort `DELETE /organizations/{id}`; a failed compensation emits the alertable `workos.org_compensate.fail` event carrying the orphan id (the operator-driven reconcile signal).
- **C — accept-and-reconcile.** A scheduled IdP↔DB diff job. **Rejected:** a new component class for the rarest failure mode on a ~0.001 QPS path; an orphaned IdP org with no app-DB row is inert.

**Chosen: A+B layered.** Retry unit is the client re-submitting the org form; after a compensated failure the retry is clean; after an uncompensated one the orphan is inert + logged (WorkOS does not enforce org-name uniqueness — ASSUMPTION, validate during DELIVER; if false, compensation becomes mandatory-blocking — so the retry still succeeds). No idempotency-key machinery at this traffic level. The downstream machine-design requirement inherited by the next passes: every failure outcome must be representable as retryable — no terminal-in-practice `partial-setup`.

### 4. ADR-016 bypass removal

ui-state's direct `${backendUrl}` egress (and its WorkOS re-verify egress) is removed, not patched: the tier becomes a pure presentation-state coordinator receiving client-reported outcome events through its existing `/state` surface (ADR-046, unchanged). All onboarding-flow traffic now flows client → reverse-proxy → auth-proxy → {backend | ui-state}, restoring ADR-016's invariant for every in-network participant except the agent's documented caveat.

### 5. Topology: explicitly unchanged

No new containers, no replica changes, no new ports, no new persistence. The reverse-proxy nginx config requires **zero changes** — `location /api/` already routes the mode-discovery/login/org-create surface to auth-proxy (`frontend/nginx.conf:37–42`), and the load-bearing ADR-015 presentation-state rule is untouched. Org-create availability now traverses WorkOS through auth-proxy instead of through backend: the same external dependency, relocated, with one fewer in-network credential holder.

## Consequences

**Positive**

- The 2026-06-10 outage class (mode split-brain) is structurally eliminated; the override interim guard is deleted on schedule.
- One WorkOS credential holder, one AUTH_MODE authority, one WorkOS client module — auth surface shrinks to the tier named for it.
- ui-state loses all egress: its crash-prone machine-internal I/O disappears, its failure modes reduce to process+Redis, and the ADR-016 violation is removed.
- A 409 on org name can no longer orphan an IdP org (pre-check); rare orphans are alertable, inert, and operator-reconcilable.
- The reissue seam completes its cookie story (D8 un-parked) with no extra round-trip — the mint is local signing inside the existing response path.

**Costs / accepted trade-offs**

- Auth-proxy grows: ingress + token lifecycle + KPI sniffing + now an IdP write workflow. Accepted as one coherent concern (everything-auth/IdP); the next *non-auth* responsibility proposed for this tier should trigger a split discussion.
- Org-create latency (+300–600 ms p50 WorkOS egress in workos mode) moves into the sole ingress's request path — bounded by explicit 5 s per-call timeouts; at ≤1/min it cannot pressure the event loop.
- A small backend read affordance (name availability) is new surface, justified by the orphan-prevention layer it enables.
- The shipped org-onboarding acceptance suite and the onboarding machine's invoke-based internals will need rework in the next passes (known and sequenced — design-intent open points (c)/(e)).

## References

- Seed (fixed inputs): `docs/feature/client-driven-onboarding/design-intent.md`
- System-scope deliverable: `docs/feature/client-driven-onboarding/design/system-architecture.md` (estimation §0, option matrix §2, env deltas §4, observability §5, probes §7, C4 §8, reuse §9, ratification points §10)
- ADR-016 (sole ingress), ADR-030 (topology/scaling + observability inheritance), ADR-041 (domain realignment — write model partially superseded), ADR-043 (auth-proxy owns token lifecycle), ADR-044/046 (chat-app + `/state` surface, unchanged)
- ui-cookie-session D8: `docs/feature/ui-cookie-session/design/delta-and-decisions.md`
- org-onboarding (shipped surfaces, write path reworked): `docs/evolution/2026-07-09-org-onboarding/design/delta-and-decisions.md`
- Live code: `auth-proxy/app.ts` (catch-all :785–826, reissue :839–885, WorkOS config :316–324), `auth-proxy/lib/post-response-reissue.ts`, `auth-proxy/lib/user-auth/{dev,workos}.ts`, `backend/app/use_cases/organization/create_organization.py`, `backend/app/config.py:74–81`, `ui-state/config.ts`, `ui-state/index.ts:109–133`, `frontend/nginx.conf`, `docker-compose.yml`, `docker-compose.override.yml`
