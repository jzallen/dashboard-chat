# ADR-016: Auth-Proxy in the api-driven-user-flow-tests Compose Stack

**Status:** Ratified
**Date:** 2026-04-29
**Originating wave:** Phase 0 DIVERGE — D-3
**Ratification trail:** Mail `dc-wisp-z02g` (mayor approved + user provided strengthened production-topology rationale), `dc-wisp-n6ar` (caveat dropped, user's quote folded into Decision Outcome verbatim), `dc-66o` (no further changes).

## Context

The `worker-tool-dispatch-refactor` design document (`docs/feature/worker-tool-dispatch-refactor/design/design.md`) routes worker calls through `AUTH_PROXY_URL` — i.e., the worker assumes auth-proxy is an in-network service in front of the backend. The `api-driven-user-flow-tests` design document at §6 enumerates 4 services in the test compose stack (backend, worker, query-engine, MinIO) and does **not** include auth-proxy. These two documents are in conflict.

This decision reconciles the conflict: should the api-driven-user-flow-tests compose stack include auth-proxy, or should the test stack route worker calls directly to backend, bypassing auth-proxy?

## Decision drivers — production topology is load-bearing

The user's framing in `dc-wisp-z02g` is the load-bearing driver:

> "In the production cloud build, we will only allow ingress to backend and worker through the auth-proxy, so there's little risk of an exposed backend receiving an unauthorized token. The auth-proxy was added to make it easier for multiple apps to share the same auth."

This is two facts, both critical:

1. **Auth-proxy is the *only* allowed ingress path** to backend and worker in production. There is no alternate path. A compose stack that bypasses auth-proxy is testing a topology production does not run.
2. **Auth-proxy's purpose is auth-sharing across multiple apps**, not just defensive middleware. Removing it from the test stack collides directly with the architectural rationale for its existence.

Combined: tests that don't go through auth-proxy verify a code path production has no entry point for. The cost of "test runs different middleware than prod" is not just middleware-branch divergence — it's *topology* divergence.

The backend implements dual-mode auth (`backend/app/auth/middleware.py:48-94`): direct JWT verification (no proxy) and proxy-trusted headers when `TRUST_PROXY_HEADERS=true`. The dev compose stack runs `TRUST_PROXY_HEADERS=true`. Dropping auth-proxy in tests means tests exercise the direct-JWT-verification path; production runs the proxy-trusted-headers path. That is divergence, not equivalence.

## Considered options

1. **Drop auth-proxy from the test stack (4 services).** Match the api-driven-user-flow-tests design.md §6 as written. Tests run a different ingress topology than production.
2. **Add auth-proxy to the test stack (5 services).** Match the worker-tool-dispatch-refactor design.md and production. Tests run production-fidelity ingress.
3. **Refactor auth-proxy responsibilities into backend middleware; remove auth-proxy as a separate service entirely.** Eliminates the topology question by eliminating one side of it. Architectural change well outside the scope of api-driven-user-flow-tests.

## Decision outcome

**Option 2 — keep auth-proxy in the api-driven-user-flow-tests compose stack (5 services: backend, worker, query-engine, MinIO, auth-proxy).** Update `docs/feature/api-driven-user-flow-tests/design/design.md` §6 as a DISTILL fix-up to enumerate 5 services.

The user's quote, folded into the decision verbatim:

> "In the production cloud build, we will only allow ingress to backend and worker through the auth-proxy, so there's little risk of an exposed backend receiving an unauthorized token. The auth-proxy was added to make it easier for multiple apps to share the same auth."

This is not just defensive middleware. Auth-proxy is the **only** ingress path for backend and worker in production. Tests that bypass it verify a topology production does not run. Tests that include it verify the actual topology.

### Why not Option 1 (drop auth-proxy)

Tests would verify a backend code path that has no production entry point. Backend's direct-JWT-verification middleware branch is exercised in tests; production's proxy-trusted-headers branch is not. Net effect: green tests + production breakage from a middleware-branch bug is a real failure mode the test stack would not catch.

Additionally: dropping auth-proxy collides with the architectural rationale "to make it easier for multiple apps to share the same auth." The proxy is the single home for auth, by design. Test fidelity requires running through it.

### Why not Option 3 (refactor away auth-proxy)

A bigger architectural change well outside the api-driven-user-flow-tests feature scope. If auth-proxy ever becomes vestigial (e.g., backend grows direct WorkOS integration that supersedes proxy-trusted-headers), this ADR is superseded. Today, auth-proxy does real cryptographic JWT verification (`auth-proxy/app.ts:13-52`) using `jose@6.1.3`; it is not a thin pass-through.

## Consequences

**Positive**
- Test stack matches production ingress topology. Auth-proxy code paths are exercised in tests.
- Backend's `TRUST_PROXY_HEADERS=true` middleware branch (the production branch) is the one tests run through.
- Auth-proxy is the natural M2M home for Phase 1 Epic A (service-account / PAT issuer). Test stack already runs it, so Epic A's E2E tests reuse the same compose stack.

**Negative / accepted trade-offs**
- One additional service in the compose stack to boot and maintain. Cost is small (auth-proxy is a thin Hono service).
- `JWKS_URL` wiring needed in test compose so auth-proxy can verify tokens (one-line env wiring; verify before declaring D-3 fully "compose-config only" — see OQ #1).

## Notable surprise during diverge

`auth-proxy` is not vestigial. It does real cryptographic JWT verification with `jose@6.1.3` and strips/injects identity headers (`auth-proxy/app.ts:13-52`). Backend runs in dual-mode auth (`backend/app/auth/middleware.py:48-94`) with `TRUST_PROXY_HEADERS=true` in dev compose. This was the decision-shifting fact for D-3 — dropping auth-proxy means tests run a code path production doesn't.

## Cross-decision composition (intentional)

- **ADR-016 ↔ ADR-014** — independent. Wire-schema decision unrelated to compose-stack topology.
- **ADR-016 ↔ ADR-015** — `api-driven` test harness (per ADR-016, retains auth-proxy) reads the presentation-state log (per ADR-015) over the production-fidelity auth path. First-class headless assertions on chat-driven presentation state with production-fidelity auth.
- **ADR-016 ↔ Phase 1 Epic A** — auth-proxy becomes the home for the Phase 1 WorkOS M2M auth path (service-account / PAT issuer). Test stack already runs auth-proxy, so Epic A's E2E tests reuse the same compose stack without modification.

## Open questions

1. **`JWKS_URL` wiring for auth-proxy in api-driven test compose.** One-line env wiring; verify before declaring D-3 fully "compose-config only." Decided at DISTILL fix-up time (api-driven-user-flow-tests §6 update).

2. **Long-term production direction for auth-proxy.** Keep `TRUST_PROXY_HEADERS=true` (current) or move to direct JWT verification in backend (with auth-proxy demoted to a thin pass-through or removed)? Owner: whoever shapes Phase 1 Epic A. Outside this ADR's scope.

## References

- Conflict source A: `docs/feature/worker-tool-dispatch-refactor/design/design.md` (worker → AUTH_PROXY_URL → backend).
- Conflict source B: `docs/feature/api-driven-user-flow-tests/design/design.md` §6 (4 services listed; no auth-proxy).
- Auth-proxy implementation: `auth-proxy/app.ts:13-52`.
- Backend dual-mode auth: `backend/app/auth/middleware.py:48-94`.
- Phase 0 DIVERGE source: mail `dc-wisp-vp79` (mayor GO), `dc-wisp-ctyh` (dave's reply with the three ADRs).
- Ratification trail: `dc-wisp-z02g` ("RATIFIED ✓ with strengthened rationale" — user's production-topology quote folded in), `dc-wisp-n6ar` (caveat dropped), `dc-66o` (no further changes).
