# DISTILL wave-decisions — auth-proxy-mints-user-tokens (Stage 2)

**Date:** 2026-05-28
**Wave:** DISTILL
**Scope:** Stage 2 (response-header reissue on org-create). Stage 3 recorded in roadmap.json but out of scope for this run.

## Prior-wave reading checklist

This is a **brownfield** feature; the SSOT `docs/product/` journey/architecture/KPI
tree does not apply. The authoritative inputs are the DESIGN artifact and the ADR.

- `+ docs/feature/auth-proxy-mints-user-tokens/design/design.md` (read in full)
- `+ docs/decisions/adr-043-retire-ui-state-token-lifecycle-modeling.md` (Amendment 2026-05-27)
- `- docs/product/journeys/*.yaml` (not applicable — brownfield, no SSOT journey tree)
- `- docs/product/architecture/brief.md` (not applicable — design.md is the brief)
- `- docs/product/kpi-contracts.yaml` (not applicable)
- `- docs/feature/auth-proxy-mints-user-tokens/discuss/*` (not present — design-first brownfield feature)
- `- docs/feature/auth-proxy-mints-user-tokens/spike/*` (not present — no spike)
- `- docs/feature/auth-proxy-mints-user-tokens/devops/*` (not present)

Reconciliation: **0 contradictions.** design.md §"Stage 2" and ADR-043's amendment agree on
scope (auth-proxy hook + ~10 FE lines, backend untouched, ui-state untouched).

## DWD-1 — Test level: co-located vitest, not pytest-bdd

The nwave default (pytest-bdd `.feature` files under `tests/{type}/{feature}/acceptance/`)
does **not** match this repo. The repo expresses acceptance/integration coverage as
co-located vitest suites that drive the **real Hono app** with the **real keypair**
(`auth-proxy/user-token-issuance.test.ts`, `auth-proxy/m2m-issuance.test.ts`,
`auth-proxy/pat-issuance.test.ts` are the established precedents).

design.md §"Stage 2" explicitly directs: *"Prefer the LIGHTEST test level that proves the
behavior: an auth-proxy integration test … + a frontend unit test for `withAuth`, over a
full-stack docker acceptance test."* A running-stack acceptance suite under
`tests/acceptance/auth-proxy-mints-user-tokens/` is therefore **not** created — the port
contracts are fully expressible at the service-test level.

**Decision:** Stage 2 RED tests are:
- `auth-proxy/lib/post-response-reissue.test.ts` — unit, the reissue-decision hook (DI mint).
- `auth-proxy/org-create-reissue.test.ts` — integration, full Hono app + real keypair + mock
  upstream backend; includes the R7 smuggle-defense rows (the load-bearing security tests).
- `frontend/src/core/auth/__tests__/tokenReissueOnResponse.test.ts` — unit, `withAuth`
  consumes the response headers and updates `tokenStorage`.

The first two test-plan stubs were pre-authored as `describe.todo` docstrings in the repo;
this wave fills them with executable RED specs.

## DWD-2 — Driving ports (port-to-port)

- **P1 — auth-proxy HTTP ingress.** The behavior is exercised end-to-end through
  `app.fetch(new Request("http://localhost/api/orgs", { method: "POST", ... }))` against a
  mocked upstream backend. This is the same port ui-state's `createOrgFn` uses in production
  (`createOrgFn` POSTs `${authProxyUrl}/api/orgs`), so the integration test pins the real wire
  contract, not an internal function call. TBU-proof: the header must appear on the actual
  HTTP response, not merely be computable by a helper.
- **P2 — frontend `withAuth(fetchFn)`.** The FE consumes the header through its single
  authenticated-fetch wrapper. The unit test drives `withAuth(mockFetch)` and asserts
  `localStorage` mutation via the real `tokenStorage` primitives.

## DWD-3 — RED-ready scaffold (Mandate 7 analog)

`auth-proxy/lib/post-response-reissue.ts` is created as a RED scaffold (`__SCAFFOLD__ = true`;
exported functions throw `AssertionError`) so the unit test is **RED, not BROKEN** (no
`ModuleNotFoundError`). The integration and FE tests are RED by absence of behavior
(`app.ts` does not yet wire the hook/strip; `withAuth` does not yet read the header). The
scaffold is replaced by the real implementation in DELIVER; zero `__SCAFFOLD__` markers
remain after Stage 2 lands.

## DWD-4 — Error/edge coverage

Stage 2's risk is concentrated in the *negative* space (R7 smuggling, wrong path, wrong
status, missing/malformed body, non-user caller). The RED suites are intentionally
edge-heavy: of the integration rows, 6/12 are negative/security (rows 5-11), and the unit
suite covers malformed-JSON, missing-id, and anonymous-caller no-fire paths.
