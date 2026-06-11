# CDO-S4 — DELIVER summary

**Slice:** CDO-S4 — auth-proxy mode discovery + reissue Set-Cookie (D8 un-park) + retry-KPI cleanup
**Layer:** auth-proxy ONLY
**ADRs:** ADR-050 (§a reissue dual emission, §d mode discovery, §e KPI fallout / AR-5), ADR-048 (§3 local routes, §5 observability), ui-cookie-session D1/D8/UC-6
**Delivered:** 2026-06-11 · branch `crew/doorman` · issue `dc-c6u`
**Crafter:** nw-software-crafter (Outside-In TDD, DES-monitored)

## What shipped (3 atomic commits)

| Step | Commit | Change |
|------|--------|--------|
| 04-01 | `126187c4` | `feat(auth-proxy): add GET /api/auth/config mode discovery (CDO-S4)` |
| 04-02 | `cb77be81` | `feat(auth-proxy): reissue Set-Cookie on org-create (CDO-S4, D8)` |
| 04-03 | `e7a24f47` | `refactor(auth-proxy): retire dead auth_retry_clicked KPI trigger (CDO-S4)` |

### 04-01 — GET /api/auth/config (ADR-050 §d)
A new local auth-proxy route `GET /api/auth/config → 200 {"mode": "dev" | "workos"}`, registered BEFORE the
catch-all `app.all('*')` (co-located with `GET /api/auth/me`, app.ts ~306) so it is served locally and never
proxied. Reads `mode` from `AUTH_MODE` (auth-proxy is the sole reader). Requires NO credential (pre-auth — the
login surface calls it before any sign-in affordance). **Side-effect-free** — mints NO CSRF login state (unlike
`/api/auth/login`, which mints a one-shot state per call; that is exactly why §d keeps the two separate).
`Cache-Control: public, max-age=300`. Synchronous handler, no fetch.

### 04-02 — applyOrgCreateReissue dual emission (ADR-050 §a, ui-cookie-session D8 un-park, UC-6)
On the existing trigger (`POST /api/orgs → 201`, user token, `computeOrgCreateReissue` returns a reissue),
`applyOrgCreateReissue` (app.ts ~839-911) now appends — **in addition to** the retained
`X-New-Access-Token` / `X-New-Token-Expires-In` headers — two distinct `Set-Cookie` headers built with the same
`buildSetCookie` the callback uses:
- `auth_token=<reissue.token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<expiresIn>` (+`Secure` iff `AUTH_MODE != dev`)
- `session=1; SameSite=Lax; Path=/` (+`Secure` iff `AUTH_MODE != dev`) — NOT HttpOnly (the JS-readable flag)

Emitted via `Headers.append` so the two are **never collapsed** into one comma-joined header (UC-6). The hook
stays **MODE-AGNOSTIC** — emission is gated only by path/method/status + `isUserToken`/`baseClaims`; **only the
`Secure` attribute is dev-gated** (the documented HIGH risk note honored). This un-parks ui-cookie-session D8.

### 04-03 — retire the auth_retry_clicked KPI trigger (ADR-050 §e / AR-5)
`retry_clicked` left the closed `ChatAppWireEvent` union in CDO-S3, so the inbound-keyed `auth_retry_clicked`
KPI trigger in `emitKpiEventsForResponse` was unreachable dead code. Removed the emission branch plus its
now-orphaned `peekInboundEventType` helper, the `inboundEventType` parameter, and the call site. The two
surviving K3 emitters (`auth_recoverable_error_shown` ← state==error_recoverable, `ready_reached` ← state==ready)
read the upstream `/state` projection and are untouched. The retry funnel re-derives from
`org_create.intercepted` (ADR-048 §5), which lands in CDO-S5.

## Verification

- **auth-proxy vitest (MANDATORY pre-merge gate):** `cd auth-proxy && SKIP_DOCKER_ACCEPTANCE=1 npx vitest run`
  → **252 passed / 5 skipped** (the 5 skips are the `test/multi-replica.test.ts` docker suite, skipped because
  no `dashboard-chat/auth-proxy:bazel` image is loaded + `SKIP_DOCKER_ACCEPTANCE=1`). The retained reissue-header
  contract + the R7 backend-cannot-smuggle security tests + the ui-cookie callback/me/logout/credential-read tests
  all stay green. **This local run is the ONLY pre-merge verification — the refinery `--auto` gate routes
  auth-proxy diffs to the backend selector and does NOT run auth-proxy vitest.**
- **cdo_s4 acceptance (real dev compose stack):** `pytest -m cdo_s4` → **2 passed**
  (`test_mode_discovery.py::test_auth_config_reports_dev_mode_without_side_effects`,
  `test_reissue_sets_cookie.py::test_org_create_201_reissues_auth_token_cookie`).
- **Full org-onboarding acceptance suite:** 13 passed, **1 failed** — the failure is the pre-existing
  `UPSTREAM-S3-1` backend `AuthorizationError→500` issue (`test_org_name_taken_reedit.py`), carried forward from
  CDO-S3, in backend code untouched by this slice and already RED at the CDO-S3 gate. See `upstream-issues.md`.
  The CDO-S1 walking skeleton + all cdo_s1/cdo_s2 + the other cdo_s3 scenarios stay GREEN — **no CDO-S4 regression.**
- **tsc:** the project's bare `npx tsc --noEmit` is not clean over auth-proxy test files at baseline (pre-existing
  es2022 `.at()` lib mismatch, stale `jose` `KeyLike` export, the `duplex` `@ts-expect-error` directives at app.ts
  930/959). CDO-S4 introduces **no new** type errors in app.ts/app.test.ts/org-create-reissue.test.ts. Vitest is
  the operative gate.

## Stack recipe used (for reproduction)
```
mkdir -p backend/data && chmod 777 backend/data       # the root-perms 401 trap
AUTH_MODE=dev docker compose \
  -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.dev-no-org.yml \
  up -d --build auth-proxy api ui-state redis query-engine
# auth-proxy is the ingress on :1042 (no reverse-proxy:bazel needed):
cd tests/acceptance/org-onboarding && \
  REVERSE_PROXY_URL=http://localhost:1042 AUTH_PROXY_URL=http://localhost:1042 \
  uv run --no-project --with httpx --with pytest --with pytest-asyncio pytest -m cdo_s4
docker compose ... down   # leave images
```
The `docker-compose.override.yml` supplies the build-from-source contexts (auth-proxy ← `./auth-proxy`,
api ← `./backend` + `./backend/data:/data` bind mount) + `AUTH_MODE: dev`; the dev-no-org file adds
`DEV_NO_ORG: true` to api. All three `-f` files are required (explicit `-f` disables override auto-merge).

## Scope boundary held
auth-proxy/app.ts + its two vitest files only. `lib/cookies.ts` reused unchanged. No backend, ui-state, shared,
or ui/ files touched. NON-GOALS deferred to CDO-S5: WorkOS org-create interception, `lib/org-create-workflow.ts`,
`x-provisioned-org-id` strip-list, ui/ surfaces (login mode consumption, onboarding-driver), session-chat egress,
compose env deltas + the override AUTH_MODE-pin deletion.
