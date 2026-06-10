# org-onboarding — DELIVER wave decisions (slice S1, MR-1)

Orchestration decisions made during the S1 DELIVER run (2026-06-10). Slices
S2–S4 (ui/) are a separate later MR by another worker; this feature is NOT
finalized (no archive to docs/evolution) until they land.

## DLV-1 — Crafter + paradigm + rigor

No `## Development Paradigm` section in CLAUDE.md; backend is Python with the
OOP use-case/repository structure → `@nw-software-crafter` (default). No
`rigor` key in `.nwave/des-config.json` → standard defaults (review enabled,
refactor pass enabled, 5-phase TDD).

## DLV-2 — Seam for the DEV_NO_ORG resolution (roadmap 01-03)

Ratified `get_current_user` (backend/app/routers/deps.py) as the seam, NOT the
org read use case: every router resolves identity through it, so the resolved
org is consistent across GET /api/orgs/me, the POST /api/orgs already-has-org
guard, and /api/projects scoping. It gains `db: AsyncSession =
Depends(use_db_context)` (FastAPI caches the dependency per request; direct
non-DI calls in existing tests remain valid because the flag-off path never
touches `db`).

## DLV-3 — RED_ACCEPTANCE posture per step (stack-down honesty)

The acceptance suite is @real_io/@needs_compose_stack (DWD-1/3): with the
stack down it SKIPS by design. Per-step RED_ACCEPTANCE therefore ran the
linked scenario and recorded the honest observed state (SKIP for 01-01..04;
honest business FAIL for 01-05/01-06, which ran against the live stack);
the step-level RED driver was the gate-run unit/round-trip test. The full
acceptance pass ran against the rebuilt live stack at Phase 2.5 (below).

## DLV-4 — Roadmap amendments 01-05 + 01-06 (DELIVER-discovered gaps)

- 01-05: the DISTILL suite was not self-contained — no fake-WorkOS userinfo
  server (deliver/upstream-issues.md DUI-1). Fixed in-suite (conftest fixture).
- 01-06: pre-existing POST /api/orgs 500-on-success (controller/use-case shape
  mismatch, masked by theater char-tests + ui-state's 500-rule; DUI-3). Fixed;
  char tests re-pinned to the real shape.

## DLV-5 — Phase 3.5 / verification evidence (single target environment)

No `devops/environments.yaml` and no DISCUSS user-stories exist for this
brownfield feature (entered at DESIGN; the Elevator-Pitch demo gate is N/A).
The declared primary target env (distill/roadmap.json: AUTH_MODE=dev +
DEV_NO_ORG=true) was verified live on 2026-06-10:

- Backend gate: `./tools/test/test.sh --backend` → ruff clean, 1418 passed.
- Migration 018 reversibility: 4/4 round-trip tests (upgrade → downgrade →
  upgrade on scratch SQLite).
- The three S1 scenarios PASS against the live compose stack (api rebuilt from
  source, DEV_NO_ORG=true), TWICE back-to-back — UI-2 repeatability proven by
  the 01-04 janitor.
- Full org-onboarding suite: 5 passed / 2 failed — the failures are the S4
  default-project scenario + the @walking_skeleton, RED-by-design until S2–S4.
- Regression: tests/acceptance/ui-cookie-session 10/10 passed (Bearer + cookie).
- Stack note: the reverse-proxy bazel image is absent on fresh workers; the
  suite ran with REVERSE_PROXY_URL=http://localhost:1042 (auth-proxy ingress —
  equivalent seam for /api/* + /ui-state/*; DUI-2).

## DLV-6 — Phase 4 adversarial review triage

Verdict REVISION_REQUIRED with three findings; orchestrator triage:
- D1 "test budget exceeded (33 new tests)" — REFUTED: the reviewer counted
  pre-existing test files as new (test_deps.py, test_create_organization.py,
  test_organization_controller_char.py, test_organization_repository.py all
  pre-date the MR). Net-new tests ≈ 14 for 11 behaviors — within budget.
- D2 created_at tie-break nondeterminism — ACCEPTED and fixed (82884550):
  secondary `id.asc()` ordering + a RED-verified regression test.
- D3 TOCTOU on org-name uniqueness — pre-existing, explicitly accepted in the
  pre-MR code comment (unique constraint is the DB backstop); out of MR scope.

## DLV-7 — Phase 5 mutation testing: SKIPPED (no tooling in repo)

Strategy defaults to per-feature (no `## Mutation Testing Strategy` in
CLAUDE.md), but the repo has no mutation tooling (no cosmic-ray, no
`.venv-mutation/`, no prior mutation runs in docs/evolution). Introducing the
toolchain is out of scope for this MR. Recorded honestly as skipped;
recommended follow-up: configure cosmic-ray per `nw-mutation-test` and run it
feature-scoped when S2–S4 close the feature.
