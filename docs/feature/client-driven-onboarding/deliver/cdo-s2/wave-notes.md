# CDO-S2 DELIVER — Wave Notes

**Slice:** CDO-S2 — Backend pure-resource contracts: OrgCreate name validation (422),
availability endpoint, X-Provisioned-Org-Id carry, WorkOS shrink, compose env deltas.
**Branch:** `crew/quartermaster` · **Issue:** `dc-qw4` · **Date:** 2026-06-11
**Method:** Outside-In TDD via DES-monitored crafters (DES-PROJECT-ID `client-driven-onboarding`).
**Rigor:** standard (no project rigor profile in `.nwave/des-config.json`).

## Steps delivered (atomic commits)

| Step | Commit | Subject |
|------|--------|---------|
| 02-01 | `2f52083c` | feat(backend): validate OrgCreate name (strip + non-empty → 422) |
| 02-02 | `939773ee` | refactor(backend): drop WorkOS write path + AUTH_MODE/requires_reauth (pure resource store) |
| 02-03 | `ad058b58` | feat(backend): honour trust-gated X-Provisioned-Org-Id as org row id |
| 02-04 | `a258c16c` | feat(backend): add GET /api/orgs/availability name-availability route |
| 02-05 | `18f39122` | chore(compose): drop api/api-full AUTH_MODE + WORKOS_* (auth-proxy sole reader) |

Each step ran PREPARE → RED_ACCEPTANCE → RED_UNIT → GREEN → COMMIT and logged phases to
`docs/feature/client-driven-onboarding/deliver/execution-log.json` (shared with CDO-S1;
step ids `02-01`..`02-05`). RED_ACCEPTANCE was logged SKIPPED (CHECKPOINT_PENDING /
NOT_APPLICABLE) per step because the real-stack acceptance suite is the orchestrator's
post-merge gate — see "Acceptance gate" below.

## Acceptance criteria → evidence (ADR-048 §2/§3/§4, ADR-050 §b/§c)

- **Blank/whitespace org name → 422 (not 201).** `OrgCreate` (router) gained a Pydantic
  field validator: strip + non-empty (min length 1 after strip); FastAPI maps the
  request-body ValidationError to 422. Stored value is the stripped name. *(02-01)*
- **Duplicate org name → still 409.** The use case's `get_organization_by_name` pre-check
  + `OrganizationNameTakenError` are untouched. *(unchanged; covered by surviving tests)*
- **Org create no longer auto-creates a project.** Untouched dev path; regression-lock
  acceptance test `test_post_orgs_no_longer_auto_creates_project.py` is the SSOT. *(held)*
- **`GET /api/orgs/availability?name=` → 200 {"available": bool}.** New thin read over
  `metadata.get_organization_by_name` (available == lookup is None); same identity-header
  auth (`get_current_user` + `use_db_context`); plain body (not JSON:API). *(02-04)*
- **`POST /api/orgs` honours `X-Provisioned-Org-Id`, gated on `trust_proxy_headers`.**
  Router reads the header only when the trust gate is on → use case `provisioned_org_id`
  → repo `id=`; absent or trust-off → backend-generated id. The trust-OFF-ignored arm is
  asserted (proves the gate gates). *(02-03)*
- **Backend grep-clean of AUTH_MODE + WORKOS_*.** `_create_workos_org`, the `auth_mode`
  dispatch, `httpx` usage, `requires_reauth` (use case + controller envelope),
  `ExternalServiceError`, and config.py `auth_mode`/`workos_api_key`/`workos_api_url`/
  `workos_client_id`/`workos_redirect_uri` all deleted. `grep -rn -i 'auth_mode|workos'
  backend/app` → 0. *(02-02)* The only surviving `AUTH_MODE` mentions in `backend/tests`
  are docstrings in `tests/integration/` describing **auth-proxy** (a different service
  that legitimately keeps AUTH_MODE) — accurate cross-service documentation, not backend
  config reads; left intact (tests/integration is excluded from the gate).
- **Compose env deltas (ADR-048 §4).** `AUTH_MODE` + `WORKOS_*` removed from the `api`
  and `api-full` blocks in `docker-compose.yml`; the `api` `AUTH_MODE: dev` pin (whose
  comment names this feature as its sunset) deleted from `docker-compose.override.yml`.
  `agent`/`auth-proxy`/`ui-state` env untouched (later slices / ADR-048 R3 agent caveat).
  The split-brain class is now unrepresentable in compose config. *(02-05)*

## Sanctioned contract-change test rework (Iron Rule compliance)

The WorkOS-mode dispatch tests asserted a production contract this slice deliberately
**removes** (ADR-048). They die WITH the code — this is not "modifying a failing test to
pass":
- Deleted `TestCreateOrganizationWorkosErrors` (3 tests) + `httpx`/`ExternalServiceError`
  imports from `test_create_organization.py`.
- Deleted `test_workos_requires_reauth_surfaces_as_attribute`; reworked the two
  failure-mapping char tests to a surviving `OrganizationNameTakenError` (409) in
  `test_organization_controller_char.py`.
- Removed the `ExternalServiceError → 502` row + import from `test_result_mapper_char.py`
  (`QueryEngineUnreachable` still covers the 502 family).
Surviving uniqueness / created_by / dev-path assertions were preserved verbatim.

## UPSTREAM-3 (HIGH) — WorkOS org-name-uniqueness assumption: RESOLVED

ADR-048 R1 assumed WorkOS does **not** enforce organization-name uniqueness (A+B layered
compensation stays best-effort). **Web-verified this slice** against the WorkOS Create
Organization API reference: the `name` field **"does not need to be unique"** — no
uniqueness constraint on name. **The assumption HOLDS.** Compensation remains best-effort,
NOT mandatory-blocking; the Spec-5 "uncompensated retry still succeeds" property in
CDO-S3/CDO-S5 stands. **No redesign required.** Source:
https://workos.com/docs/reference/organization/create

## Gate results (refinery `--auto` → `--backend`)

- `cd backend && uv run ruff check .` → PASS · `uv run ruff format --check .` → PASS
- `uv run --extra test pytest -x --ignore=tests/integration` → **1426 passed** at HEAD.
- `python3 tools/check_workspace_consistency.py` → run pre-submit (no package.json changed).

## Acceptance gate (real stack) — RESULTS

Stack: `docker-compose.yml` + `docker-compose.override.yml` (api build-from-source + the
`./backend/data:/data` mount) + `docker-compose.dev-no-org.yml`, project `quartermaster`,
services `api auth-proxy ui-state redis` (+ `query-engine` dep). Driven through the
auth-proxy ingress (`:1042` → `/api` + `/ui-state`). Trap hit + fixed: the bind-mounted
`./backend/data` auto-created **root-owned** → api `sqlite OperationalError: unable to open
database file` (Exited 3); fixed by `chown 1000:1000 + chmod 777` via a root helper
container (container appuser = uid 1000), then `up -d api`.

Live smoke (through `:1042`): `GET /api/orgs/availability?name=<free>` → `{"available":true}`;
`POST /api/orgs {"name":"   "}` → **422**; `GET /api/orgs/me` → 404 (fresh principal).

Suite results (`uv run --no-project pytest`):

- **`cdo_s1` marker: 5 passed** — walking skeleton + S1 happy path do NOT regress under the
  backend changes (the user's "must not regress" guard).
- **`cdo_s2` marker: 1 passed, 1 failed (RED-awaiting-S3, by design):**
  - `test_post_orgs_no_longer_auto_creates_project.py` → **PASSED** (regression lock held —
    a CDO-S2 deliverable).
  - `test_invalid_org_name_stays_needs_org.py` → clears the backend **422** assertion (this
    slice's contract — verified GREEN), then fails at the next line posting the
    `org_create_failed{cause:org_name_invalid}` ui-state report: the ui-state closed union
    still lists only the S1 happy members (`org_found|org_not_found|org_created|
    org_form_submitted|__force_failure__`) and rejects `org_create_failed` with HTTP 400
    `invalid_union_discriminator`. `org_create_failed` + its cause enum + the `needs_org`/
    `org_validation_error` re-edit arm are **CDO-S3** (ADR-050 §c / distill roadmap CDO-S3).
    **Per the slice contract this arm stays RED awaiting S3 and is NOT weakened.** The
    backend-422 half (CDO-S2) is proven.

Conclusion: every CDO-S2 acceptance obligation is satisfied (backend 422 live; regression
lock green; S1 non-regression green). The single RED is a known, sequenced S3 dependency.

### RED-awaiting-S3 note (do not weaken)

`test_invalid_org_name_stays_needs_org.py` asserts the backend **422** (CDO-S2 — MINE,
must pass) AND then reports `org_create_failed{cause:org_name_invalid}` and asserts the
onboarding region stays `needs_org` with `org_validation_error` set. Those report arms ride
the **CDO-S3** failure wire-members + machine arms (`org_create_failed` is not yet a closed-
union member; the ui-state ACL rejects it pre-S3). So the test as a whole may remain RED at
the report line **awaiting CDO-S3** — that is expected and the assertion must NOT be
weakened. The backend-422 contract (this slice) is what CDO-S2 owns and is verified.
