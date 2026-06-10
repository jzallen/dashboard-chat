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

---

# org-onboarding — DELIVER wave decisions (slices S2–S4, MR-2 — FINAL)

Orchestration decisions made during the S2–S4 DELIVER run (2026-06-10, worker
usher). This MR closes the feature: the walking skeleton is GREEN. Finalize
(archive to docs/evolution) is deliberately deferred until this MR merges.

## DLV-8 — Crafter + rigor (inherited)

Same as DLV-1: `@nw-software-crafter`, standard rigor defaults (no `rigor` key
in `.nwave/des-config.json`). Roadmap extended in place with Phase 02 (5 steps,
02-01..02-05), re-approved by `nw-acceptance-designer-reviewer` (no orphan
S2–S4 scenarios; walking skeleton mapped to 02-05).

## DLV-9 — UI-1 resolution (the create_project_submitted name field)

Verified in code: the ui-state router posts `child_event:{type,payload}` and
the ChatApp parent SPREADS the payload to top level
(`forwardChildEventToActiveChild`, ui-state/lib/machines/chat-app/setup/
actions.ts), so project-context's `capturePendingProjectName` +
`projectNameValid` read `event.org_name`. Resolution: ui/ posts
`{type:"create_project_submitted", payload:{org_name:<project name>}}`, and a
NAMED member documenting the misnomer was added to
`shared/ui-state-wire/wire-event.ts` (type-only; ui-state runtime untouched).
The DISTILL both-keys stopgap in the acceptance suite was tightened to the
resolved contract during the Phase-4 revision pass and re-proven live twice.

## DLV-10 — Phase 2.5 integration-gate findings (two live-browser fix cycles on 02-05)

The API-seam suite alone went GREEN after a test-harness fix (JSON:API rows
nest `name` under `attributes`; three parse sites read it flat — assertions
unchanged, one previously-vacuous check now exercised). The live BROWSER pass
then exposed a real handoff defect the API seam cannot see: on onboarding
completion the shell rendered a stale "No projects yet" because
(a) /onboarding navigated without refreshing the org-global catalog, and
(b) — root cause — `metadataApiSource` memoizes the org-global `projectsPromise`
with no invalidation, so `refreshOrgGlobal()` could never observe new data.
Fix cycles (both DES-logged under 02-05): (1) await `refreshOrgGlobal()` before
navigating; (2) `invalidateOrgGlobal()` on the catalog source port, called by
`revalidateOrgGlobal` before its reads. Verified live: onboarding now lands
directly in `/project/<id>` with the new project scoped.

## DLV-11 — Browser-flow reset recipe (dev principal)

A repeatable browser walk-through of onboarding needs THREE resets, not one:
the DB janitor (delete dev-principal-owned orgs + their projects), CLEARING
ui-state actor persistence — Redis **db 1** (`redis://redis:6379/1`), keys
`ui-state:*` (a db-0 scan finds nothing) — and a ui-state container restart
(in-memory actors). Without the Redis/restart step, session_begin rehydrates
the stale `project_selected` actor and the gate correctly (per its contract)
enters the shell. The acceptance suite avoids this with `force_restart:true`;
the production surface deliberately posts plain `session_begin`.

## DLV-12 — Phase 4 adversarial review triage

Verdict REVISION_REQUIRED with 6 findings; orchestrator triage:
- D1 "postEvent/SSE race" — REFUTED: the router's write handler awaits
  `settle(actor)` before responding (ADR-046; router.ts settle); the POST
  response IS the settled document. Same semantics as the frozen frontend/
  reference the port mandates.
- D2 "SSE error frames not bubbled to postEvent" — REFUTED: machine validation
  errors arrive inline in the returned document (proven live by the blank-name
  scenario); SSE `error` frames as observer notifications match the reference;
  ACL rejections are non-2xx and DO reject postEvent.
- D3 "unit test too loose" — REFUTED (factually wrong): both wire-shape
  assertions use exact `toEqual`.
- D4 "module-level defaultProxy survives a logout→login user switch" — REFUTED
  as blocker: ui/ has no production logout (signOut is a test scaffold) and the
  login round-trip is a full page load, resetting module state. Recorded in
  upstream-issues.md as a defense-in-depth note for a future logout feature.
- D5 acceptance both-keys stopgap — ACCEPTED and fixed (cff1155f).
- D6 missing SSE error-path unit tests — ACCEPTED and fixed (c6cd618f).

## DLV-13 — Phase 5 mutation testing: SKIPPED (no tooling, DLV-7 precedent)

No mutation tooling exists for the TS/vitest layer (no Stryker config) or in
the repo generally. Same disposition as DLV-7; recommended follow-up unchanged.

## DLV-14 — Verification evidence (2026-06-10, live stack: api rebuilt from
source with DEV_NO_ORG=true via docker-compose.dev-no-org.yml — now committed)

- ui vitest: 21 files / 221 tests green; `tsc --noEmit` clean.
- DES integrity: `verify_deliver_integrity` exit 0 — all 11 steps complete.
- Acceptance org-onboarding: 7/7 PASS, run twice back-to-back, BOTH before and
  after the Phase-4 payload tightening (4 green double-runs total). The
  @walking_skeleton scenario is GREEN — the feature's done-signal.
- Regression: tests/acceptance/ui-cookie-session 10/10.
- Browser pass (vite dev server :5173 with the new /ui-state proxy +
  standalone fake-workos :14299): sign-in → gate redirect → /onboarding org
  form (identity shown) → default-project form → lands in /project/<id> with
  the project scoped. PASSED.
- Pre-existing failures NOT chased (excluded from gate): test_auth_proxy_m2m,
  test_upload_pipeline FHIR (tests/integration, on clean main).
