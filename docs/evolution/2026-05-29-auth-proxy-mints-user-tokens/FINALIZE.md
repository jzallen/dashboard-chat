# Finalize — `auth-proxy-mints-user-tokens`

> **Feature shipped**: 2026-05-29 (all three stages merged on `main`)
> **Wave path**: DESIGN → DISTILL → DELIVER (via headless merge-queue workers) → FINALIZE
> **Final `main` HEAD at finalize**: `db52304` (the chat-app-machine Phase-4 docs commit; the last auth-proxy commit is `73120ec`)
> **Companion decision**: [ADR-043 Amendment 2026-05-27 — auth-proxy as issuer](../../decisions/adr-043-retire-ui-state-token-lifecycle-modeling.md#amendment-2026-05-27--auth-proxy-as-issuer)
> **Archived artifacts**: this directory (`design/`, `distill/`) is the verbatim feature-workspace snapshot, moved here via `git mv` from `docs/feature/auth-proxy-mints-user-tokens/` so blame and rename history survive. The ADR stays in `docs/decisions/` (referenced, not moved).

> **Provenance note (no `deliver/execution-log.json`).** This feature was delivered by **headless merge-queue workers**, not the standard `nw-execute` flow, so there is no `deliver/execution-log.json` to gate on. Completeness is established from **git history on `main`** (the merged commits below), the **accepted ADR**, and the DISTILL `roadmap.json`. The `roadmap.json` status fields are **stale** — they record Stage 2 as `in_progress` and Stage 3 as `not_started` because the file was authored mid-flight during the Stage-2 DISTILL run. **Git is the source of truth: all three stages are merged and complete** (§2 reconciles this explicitly).

---

## 1. Summary

`auth-proxy-mints-user-tokens` consolidated **all user-token issuance into auth-proxy** and reduced the backend to a **pure resource server**. The repo previously ran *two JWT issuers for the same audience*: auth-proxy already minted M2M and PAT tokens through the shared `getKeypair()`/`jose` path, while the backend independently minted user tokens on `/api/auth/{callback,refresh,reissue}`. The split was incidental, not designed — WorkOS was wired through the backend when it landed, and auth-proxy was later given its own minting kit for service credentials without ever pulling user-token minting back ([design.md §1](design/design.md)).

The feature closed that gap in the direction [ADR-016](../../decisions/adr-016-auth-proxy-in-test-stack.md) always pointed (*"auth-proxy is the single home for auth, by design"*): auth-proxy gained **issuance**, not just verification. It is the symmetric backend-side counterpart to [ADR-043](../../decisions/adr-043-retire-ui-state-token-lifecycle-modeling.md)'s original decision — where ADR-043 said *"ui-state stops pretending to participate in token management,"* this says *"backend stops pretending to participate in token issuance."* Same architectural arrow, broader scope.

A third motivation was that the **reissue flow was non-functional top-to-bottom** ([design.md §1 F3](design/design.md)): the backend returned `501` for WorkOS org-reissue in production (the `WorkOSAuthProvider.reissue_with_org` was a `NotImplementedError` stub), and even in dev the FE's `reissueOrgJwtFn` discarded the response body so the stored JWT was never updated. The entire `creating_org → error_recoverable → error_terminal` onboarding retry subgraph existed to handle a failure mode the design itself produced. Moving issuance to auth-proxy **and** delivering the new org-scoped token on the org-create *response* (an `X-New-Access-Token` header, no extra round-trip) made that subgraph **unreachable by construction**, and Stage 3 deleted it.

The feature shipped as **three sequenced stages** ([design.md §4](design/design.md)) — issuance moves; response-header reissue lands; the dead path is deleted — each independently mergeable, with the order non-negotiable (Stage 2 depends on Stage 1's keypair contract; Stage 3 depends on Stage 2's response-header injection).

## 2. The three-stage delivery arc

> **Completeness reconciliation.** The DISTILL [`roadmap.json`](distill/roadmap.json) was authored during the Stage-2 run and records Stage 2 `in_progress` / Stage 3 `not_started`. That snapshot is **superseded by git**: Stage 2's three commits (`ef30c4c`, `b35a7cc`, `4df88a9`) and Stage 3's two commits (`d9627b1`, `73120ec`) are all merged on `main`. The table below is the authoritative record.

### Stage 1 — Move user-token issuance to auth-proxy

**Shipped in** (the issuance build-out, sequenced crew commits): `038a4c0` (mint user tokens for the OAuth login flow — `/api/auth/{login,callback,refresh,logout}` + the new `auth-proxy:user:1` JWT kid), `932d0bd` (persist sessions to JSONL for restart survival), `d5d590e` (extract WorkOS auth into an injectable provider), `f4602fd` (inject the dev auth provider with env-var identity overrides), `884880c` (share the session-store across replicas), `595f20c` (publish `/api/auth/*` in the OpenAPI spec). Plus the design + test-plan commits (`59ec6c2`, `d05425f`, `5231d3f`) and several behavior-preserving refactors of the m2m/workos/secrets test surfaces.

**What changed**: auth-proxy gained the full user-token issuance surface joining its existing M2M/PAT capability — **one process mints; one keypair signs**. User tokens carry `{sub, email, name, org_id, sid}` and verify through the same `kid`-dispatch as M2M/PAT (`f3ec2f4` pins the `auth-proxy:user:1` dispatch). Per **OQ1 (resolved → server-held)**, the WorkOS `refresh_token` is stored server-side in a JSONL session store keyed by the `sid` claim — the FE **never sees a raw WorkOS token** (the BFF OAuth2 pattern; avoids the `localStorage` XSS anti-pattern). `GET /api/auth/login` returns the WorkOS authorize URL with a CSRF state in workos mode and the FE redirect URL in dev mode; `POST /api/auth/callback` exchanges-then-re-mints in workos mode and mints from env vars (no WorkOS round-trip) in dev mode; `POST /api/auth/refresh` rotates the WorkOS refresh-token server-side and returns only a fresh auth-proxy token; `POST /api/auth/logout` deletes the session entry (idempotent).

**Co-requisite (OQ4)**: the `tests/acceptance/project-and-chat-session-management/` suite — the one non-compliant suite of the 11 surveyed, which hit backend's direct `:8000` port — had to migrate to auth-proxy's `:1042` in the same landing, because once auth-proxy signs with `auth-proxy:user:1`, backend's JWKS no longer recognises those tokens and direct-`:8000` calls 401.

**Backend at Stage 1**: untouched — its `/api/auth/*` endpoints and providers were kept as dead-code-but-importable for a soft cutover (deleted in Stage 3b). The direct-JWT-verification middleware branch and backend keypair stayed live during the brief overlap so in-flight backend-signed tokens verified until natural expiry (R1).

### Stage 2 — Response-header reissue on org-create

**Shipped in**: `ef30c4c` (DISTILL roadmap + RED tests), `b35a7cc` (auth-proxy `X-New-Access-Token` reissue), `4df88a9` (frontend `withAuth` consumption).
**What changed**: auth-proxy observes `POST /api/orgs → 201` and mints a fresh user token carrying the new `org_id` (via the existing `mintUserToken`/`getKeypair()` path — **no second signing path**), attaching it to the response as `X-New-Access-Token` + `X-New-Token-Expires-In`. The caller's `sub`/`email`/`name`/`sid` are preserved from their verified token; **only `org_id` changes**. This dissolves the FE's separate `/api/auth/reissue` round-trip — the stored token updates atomically with org-create success ([design.md §3.4](design/design.md)). The reissue decision is a **path-and-status-specific pure hook** (`auth-proxy/lib/post-response-reissue.ts`); generalizing it to org-switch / invite-accept / role-change is **deferred to OQ2 at N≥3 cases** (§8).
**The load-bearing security control (R7)**: auth-proxy **strips any upstream-supplied** `X-New-Access-Token` / `X-New-Token-Expires-In` from responses before relaying — mirroring the inbound identity-header strip — so a compromised backend cannot smuggle a token. Only auth-proxy's own keypair-verifiable injection survives. The integration suite is intentionally edge-heavy: 6 of 12 integration rows are negative/security (DWD-4).
**FE consumer (P2)**: `frontend/src/core/auth/withAuth.ts` — the single authenticated-`fetch` wrapper — reads the headers off *every* response and, when present and non-empty, adopts the new token via the existing `tokenStorage` primitives (`setToken` + `setTokenExpiry`). The read is **defensive** (it wraps arbitrary fetch fns including the SSE chat client, so inspecting an optional header must never crash a response that lacks a headers bag).
**R6**: `X-New-Access-Token` documented as sensitive in `auth-proxy/README.md` alongside `Authorization` (operators apply the same header-logging redaction).
**Independence**: backend and ui-state were untouched; the onboarding machine still called `/api/auth/reissue` (now a harmless no-op), so Stage 2 was independently deployable.

### Stage 3 — Dissolve the onboarding retry loop and delete the dead path

Split into two independently-revertable MRs by deletion target ([design.md §4 Stage 3](design/design.md)).

**Stage 3a — ui-state (`d9627b1`)**: with reissue gone, the `creating_org → error_recoverable → error_terminal` retry subgraph that existed *solely* to handle reissue failures became unreachable and was removed. `reissueOrgJwtFn` deleted; `getOrgAndReissue → getOrg` (create only); `CreateOrgAndReissueInput → CreateOrgInput` (dropping `attempt`/`force_reissue_failures`); the `REISSUE_BUDGET`/`USER_RETRY_BUDGET` guards + their increment/reset actions deleted; `creating_org` `onError` collapsed to `{name_taken → needs_org; otherwise → error_recoverable(partial-setup)}`; `error_terminal` + the `retry_clicked` handler deleted; the `force_reissue_failures` threading dropped from router/strategy/orchestrator `BeginFlowInput`/chat-app, and `error_terminal` dropped from the chat-app projection map. The `__force_failure__ → error_recoverable` harness coverage was **kept** (honest test deletion — only the retired retry-loop assertions went). **ui-state vitest green (221).**

**Stage 3b — backend (`73120ec`)**: the entire minting + verification surface had no callers after 3a, so it was deleted. `app/routers/auth.py` (all six endpoints) deleted + unregistered; `dev_provider.py`, `workos_provider.py`, `provider.py` (the now-implementer-less `AuthProvider` Protocol), `dev_keys.py` (backend keypair), and `rate_limiter.py` (refresh rate-limiting moved to auth-proxy in Stage 1) all deleted. `AuthMiddleware` lost its direct-JWT-verification branch — it **now only trusts the proxy-injected `X-User-Id`/`X-Org-Id`/`X-User-Email` headers**; the dead JWKS endpoint and the `/api/auth/*` + `/.well-known/jwks.json` `PUBLIC_PATHS` entries were removed. `app/auth/__init__.py` dropped `get_auth_provider`/`enrich_org_id`/`ensure_org_provisioned`, keeping the dev identity as a `DEV_USER` constant (the dev seed + the M2M receiving-half test reference it). Test suites for the deleted minting code (`test_auth_routes`, `test_dev_provider`, `test_workos_provider`, `test_auth_reissue`) were deleted; `test_middleware` + `test_auth_proxy_m2m` + `test_api` were reworked to the resource-server (proxy-header) contract. **Backend gate green: ruff + 1348 pytest. Frontend vitest green (604).**

---

## 3. Decision ratified by this feature

| Decision | Where it lives | Status |
|---|---|---|
| **[ADR-043 Amendment 2026-05-27 — auth-proxy as issuer](../../decisions/adr-043-retire-ui-state-token-lifecycle-modeling.md#amendment-2026-05-27--auth-proxy-as-issuer)** | `docs/decisions/` (not moved) | Accepted, fully applied across Stages 1–3 |

No new ADR file was opened — the decision is recorded as an amendment to ADR-043 because it is the symmetric (backend-side) completion of the same bounded-context cleanup. Cross-ADR composition (from the amendment): **ADR-016** (auth-proxy = single ingress/home for auth — extended to issuance), **ADR-029** (`active_scope.org_id` MUST equal the JWT `org_id` claim — *who* mints is what changed, not *whether* the claim is carried; invariant preserved), **ADR-041** (the entry-handshake half of the same leak). The in-wave decision detail lives in [`design/design.md`](design/design.md) (§4 staging, §5 risk register R1–R9, §7 resolved open questions) and [`distill/wave-decisions.md`](distill/wave-decisions.md) (DWD-1..DWD-4, test-level choice).

## 4. Architecture deltas

- **Single issuer / single keypair**: auth-proxy mints **all** tokens (M2M, PAT, user) through one `getKeypair()`/`jose` path. The user-token `kid` is `auth-proxy:user:1`, dispatched by the same `verifyToken` machinery as the M2M/PAT kids.
- **Backend is a pure resource server**: one auth path — trust the `X-User-Id`/`X-Org-Id`/`X-User-Email` headers auth-proxy injects. The second `AuthMiddleware` branch, the backend keypair (`dev_keys.py`), the JWKS endpoint, and the WorkOS provider are all gone. A real perf win in production: auth-proxy no longer performs the per-request WorkOS-JWKS verification path for user tokens — every user token now matches the local-keypair branch.
- **New auth-proxy modules**: `lib/user-token.ts` (`mintUserToken`), `lib/session-store.ts` (JSONL, `SESSION_STORE_PATH`, replica-shared), `lib/user-auth/{dev,workos}.ts` (injectable providers), `lib/post-response-reissue.ts` (the path+status-specific reissue hook).
- **Server-held WorkOS refresh token (BFF pattern, OQ1)**: the WorkOS `refresh_token` lives in the session store keyed by `sid`; the FE only ever holds an auth-proxy-minted access token + the opaque refresh round-trip. `/api/auth/logout` revokes by deleting the `sid` entry.
- **Server-driven org reissue**: `X-New-Access-Token` + `X-New-Token-Expires-In` ride the `POST /api/orgs` 201 response. The FE's single `withAuth` seam consumes them. R7 outbound strip is the enforcement that only auth-proxy's own mint can reach the FE.
- **Onboarding simplification**: the `creating_org → error_recoverable → error_terminal` retry subgraph and its reissue-budget plumbing are deleted from `session-onboarding`; org-create now drives straight to `ready` (or `needs_org` on name-taken, or `error_recoverable` on partial-setup).

## 5. Test approach (brownfield convention — DWD-1)

The nwave default (pytest-bdd `.feature` files) does **not** match this repo's auth surface. Acceptance/integration coverage is expressed as **co-located vitest suites driving the real Hono app with the real keypair** (`auth-proxy/*-issuance.test.ts` precedents). Stage 2's RED suites were therefore:
- `auth-proxy/lib/post-response-reissue.test.ts` — unit, the reissue-decision hook (DI mint).
- `auth-proxy/org-create-reissue.test.ts` — integration, full Hono app + real keypair + mock upstream backend, **including the R7 smuggle-defense rows** (the load-bearing security tests).
- `frontend/src/core/auth/__tests__/tokenReissueOnResponse.test.ts` — unit, `withAuth` consumes the headers and mutates real `tokenStorage`.

No running-stack acceptance suite under `tests/acceptance/auth-proxy-mints-user-tokens/` was created — the port contracts (P1 auth-proxy HTTP ingress `POST /api/orgs`; P2 frontend `withAuth(fetchFn)`) are fully expressible at the service-test level, per design.md §Stage 2's "prefer the lightest test level" directive (DWD-1/DWD-2). Final gate state at Stage 3 close: **backend 1348 pytest green, ui-state 221 vitest green, frontend 604 vitest green.**

---

<a id="deferred-items"></a>
## 6. Deferred items / open follow-ons

These are explicit **deferred follow-ons**, not blockers.

### OQ2 — Generalizing the response-header reissue to other scope-changing operations
- **Status**: DEFERRED until the third such operation lands ([design.md §7 OQ2](design/design.md)). Stage 2 implements a path-specific case for `POST /api/orgs`; the right abstraction is only legible once ≥3 cases exist.
- **Known future candidates**: `POST /api/users/me/active-org` (org-switch — likely case #2, same claim-update shape), invite-accept (path TBD — *confirm whether WorkOS handles membership server-side before building*, in which case the next refresh re-fetches claims and no header pattern is needed), role-change (different dimension — may include claim *removal*; watch for this as the case that justifies the abstraction).
- **Follow-on owner**: the MR that lands case #3.

### Stage 3 pre-flight — out-of-suite hardcoded backend ports
- **Status**: flagged in [design.md §7 OQ4](design/design.md) as a Stage 3b pre-flight item — spot-check operations/migration scripts for hardcoded backend `:8000` references before relying on the proxy-only path. Out of the design's scope; surfaced here for the next operator sweep.

### `TRUST_PROXY_HEADERS` env var
- **Status**: now always-on implicitly (backend has only the proxy-header path). [design.md §4 Stage 3](design/design.md) notes the env var itself can be removed in a follow-up — a trivial cleanup not yet done.

---

## 7. Outcome

- **One issuer, one keypair.** auth-proxy mints M2M + PAT + user tokens through a single signing path; the incidental dual-issuer state is gone.
- **Backend is a pure resource server.** Its entire minting + verification surface (router, providers, keypair, JWKS, rate-limiter, the second middleware branch) is deleted; it trusts auth-proxy's identity headers and nothing else.
- **The non-functional reissue flow is dissolved, not patched.** The org-scoped token rides the org-create response (`X-New-Access-Token`); the FE consumes it at one seam; the onboarding retry subgraph that existed only to paper over the broken reissue is deleted as unreachable-by-construction.
- **Security control proven**: R7 outbound header-strip means a compromised upstream cannot smuggle a token — only auth-proxy's own keypair-verifiable mint reaches the FE, exercised by 6 negative integration rows.
- **All gates green at landing**: backend 1348 pytest + ruff; ui-state 221 vitest; frontend 604 vitest. ADR-043's amendment is fully applied; reversibility is documented (re-add the backend router + FE reissue call → Stage-2 behaviour).
