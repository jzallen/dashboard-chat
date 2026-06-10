# org-onboarding — DELIVER upstream issues (back-propagation)

Gaps discovered during DELIVER (slice S1) that trace back to prior-wave artifacts.

---

## DUI-1 — DISTILL suite is not self-contained: no fake-WorkOS userinfo server (MEDIUM, RESOLVED in S1 step 01-05)

**Where:** `tests/acceptance/org-onboarding/conftest.py` (DISTILL artifact) vs
`ui-state/lib/machines/onboarding/setup/actors.ts` (`getWorkOSUserInfo`).

The onboarding machine's `verifying` step re-verifies the forwarded Bearer against
`${FAKE_WORKOS_URL}/oauth/userinfo` **unconditionally** (also in `AUTH_MODE=dev`).
The compose default is `FAKE_WORKOS_URL=http://host.docker.internal:14299` — "the
fake WorkOS server the acceptance suite starts in-process" (docker-compose.yml
ui-state comment). The sibling TS suite self-provisions it
(`tests/acceptance/user-flow-state-machines/steps/fake-workos.ts`); the
org-onboarding Python suite did **not**, so on a correctly-built stack every
`session_begin` settled `session_rejected` (`underlying_cause_tag: transient`,
userinfo fetch network-fails) instead of `needs_org` — RED for the wrong reason,
violating the suite's own honest-RED posture (DWD-3) and the repeatability goal
(UI-2).

**Resolution (DELIVER step 01-05, roadmap amendment):** a session-scoped,
stdlib-only fake-WorkOS fixture in the suite conftest serving
`GET /oauth/userinfo` → `200 {"email": "dev@localhost", "name": "Dev User"}` on
port 14299, no-op when the port is already bound (external fake running).

**Ask for S2–S4 worker:** none — the fixture is in place; the walking-skeleton
runs inherit it. If the suite is ever run on a host where Docker cannot reach
`host.docker.internal` (no host-gateway), override `FAKE_WORKOS_URL` instead.

---

## DUI-3 — pre-existing: POST /api/orgs 500s on its SUCCESS path (controller↔use-case shape mismatch) (HIGH, RESOLVED in S1 step 01-06)

**Where:** `backend/app/controllers/organization_controller.py` (`post_organization`)
vs `backend/app/use_cases/organization/create_organization.py`.

The use case returns `{"org_id", "org_name"(, "requires_reauth")}`; the controller
builds the JSON:API envelope from `serialized["id"]` → `KeyError` → 500 **after the
org row is committed**. Predates this feature (present at `2b26cfbd^`; verified in
container + worktree). It was invisible because (a) the characterization test
`test_organization_controller_char.py` mocks the use case with a fictional
`_Model("org-1","Acme")` that serializes to `{"id","name"}` — pinning a shape the
real use case never returns — and (b) ui-state's `createOrgFn` carries an explicit
500-rule that reconciles via `GET /api/orgs/me`, masking the defect on the
production path. Exposed the first time the S1 scenario
`test_post_orgs_no_longer_auto_creates_project` asserted `201` over the real
ingress.

**Resolution (DELIVER step 01-06, roadmap amendment):** controller maps the use
case's real shape into the envelope (`id ← org_id`, `name ← org_name`,
`requires_reauth` kept as an attribute when present); characterization tests
re-pinned to the real use-case return shape (test-theater correction, L2 of the
test-refactoring catalog — the old pin asserted behaviour that never existed over
HTTP). ui-state's 500-rule is untouched (out of scope; its 201-rule already parses
the envelope via `body.data.id` / `body.data.attributes.name`).

---

## DUI-2 — reverse-proxy image absent on fresh workers; auth-proxy is an equivalent S1 seam (LOW / informational)

`docker compose up reverse-proxy` requires `dashboard-chat/reverse-proxy:bazel`,
which only exists after a Bazel image build. For the S1 scenarios the
reverse-proxy adds no behaviour on `/api/*` + `/ui-state/*` (it fronts
auth-proxy); the suite's `REVERSE_PROXY_URL` env was pointed at the auth-proxy
host port (`http://localhost:1042`) for the S1 verification run, exercising the
full auth-proxy → ui-state → backend path. S2–S4 (ui/ render layer) WILL need the
real reverse-proxy image (`bazel build` of the frontend images) — plan for it.
