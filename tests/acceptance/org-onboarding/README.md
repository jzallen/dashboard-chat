# Acceptance suite — org-onboarding

Drives the empty-org onboarding journey at the **most honest seam**: real HTTP against the
local compose stack (auth-proxy → ui-state → backend), asserting both the
`ChatAppStateDocument` (region states + identity) and the app-DB side effects (org row,
`created_by`, project existence).

Scope: **org + single default project ONLY** (no invites, no extra project naming).

## How it runs

```bash
cd tests/acceptance/org-onboarding
uv run --no-project pytest            # the suite (RED until DELIVER builds the feature)
```

This suite is **NOT** run by the refinery `--auto` gate (per CLAUDE.md, acceptance suites
run separately, locally, before submission). DISTILL ships it **RED-by-design**: it fails
when the stack is up and the feature is unbuilt, and **skips** cleanly when the stack is
down (so it never blocks a no-stack run).

## Preconditions for a meaningful (non-skipped) run

1. **Compose stack up** — `docker compose up -d` from the repo root. Scenarios marked
   `needs_compose_stack` skip when the reverse-proxy is unreachable.
2. **`AUTH_MODE=dev`** + **`DEV_NO_ORG=true`** on the backend (the PRIMARY acceptance
   target). `DEV_NO_ORG` is delivered in slice **S1** — until then these scenarios are RED.
3. **A dev principal with no org in the DB** — `created_by == dev-user-001` resolves to no
   org. Repeatable runs need a reset affordance that does not exist today; see
   `../../../docs/feature/org-onboarding/distill/upstream-issues.md` (UI-2). The
   `fresh_dev_principal` fixture is best-effort and documents the gap.

## Environment overrides

| Var                | Default                  | Meaning                                   |
|--------------------|--------------------------|-------------------------------------------|
| `REVERSE_PROXY_URL`| `http://localhost:5173`  | user-facing ingress (`/api`, `/ui-state`) |
| `AUTH_PROXY_URL`   | `http://localhost:1042`  | auth-proxy (`/api/auth/callback` mint)    |

## Layout

```
org-onboarding/
├── pyproject.toml
├── README.md
├── conftest.py                 # fixtures: base urls, dev jwt, driver, stack/precondition skips
├── driver.py                   # OnboardingDriver: mint JWT, post events, read /state + /api
├── features/
│   └── org-onboarding.feature  # Gherkin scenario SSOT (business language)
├── test_walking_skeleton_org_then_default_project.py   # @walking_skeleton — full journey
├── test_orgless_principal_routes_to_onboarding.py      # session_begin → needs_org + identity
├── test_org_creation_persists_created_by.py            # org_form_submitted → ready; created_by row
├── test_default_project_completes_onboarding.py        # no_projects → create_project_submitted
├── test_invalid_org_name_stays_needs_org.py            # validation error stays needs_org
├── test_post_orgs_no_longer_auto_creates_project.py    # D2 regression
└── test_org_absent_from_db_routes_to_onboarding.py     # app-DB-existence contract
```
