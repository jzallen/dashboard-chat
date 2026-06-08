# org-onboarding — walking skeleton notes

The `.feature` file is the scenario SSOT; this is supplementary notes.

## The skeleton

**Scenario:** "A new person creates an organisation and a first project, then enters the
app" — `tests/acceptance/org-onboarding/test_walking_skeleton_org_then_default_project.py`
(`@walking_skeleton @real_io @needs_compose_stack`).

It is the thinnest end-to-end slice that proves the whole feature: an empty-org dev
principal begins a session, is routed to onboarding (`needs_org`), creates an organisation
(`org_form_submitted` → `ready`), then creates the first project (`create_project_submitted`
→ `project_selected`), and onboarding completes (org exists AND a default project exists).

## End-to-end path exercised

```
dev JWT (POST /api/auth/callback)
  → POST /ui-state/state/events {session_begin}        (auth-proxy → ui-state cold-start + settle)
  → GET  /api/orgs/me  → 404                            (DEV_NO_ORG: header ignored, DB lookup empty)
  → onboarding.needs_org
  → POST /ui-state/state/events {org_form_submitted}    (ui-state createOrg → POST /api/orgs)
  → backend create_organization stamps created_by=user.id, NO auto-project
  → onboarding.ready ; GET /api/orgs/me → 200           (DB resolution via created_by)
  → projectContext.no_projects
  → POST /ui-state/state/events {create_project_submitted}  (ui-state createProject → POST /api/projects)
  → projectContext.project_selected ; GET /api/projects → exactly one project
  → ENTER APP
```

## GREEN condition

The skeleton goes GREEN only when **S1 + S2 + S3 + S4** are all delivered AND the suite is
run with `AUTH_MODE=dev` + `DEV_NO_ORG=true` against a fresh-DB compose stack. Until then it
is RED at the first assertion that depends on an unbuilt slice (`needs_org` requires S1's
DEV_NO_ORG resolution).

Note: S2–S4 are `ui/` slices, but the API-seam skeleton does not import `ui/` — it proves
the same ui-state + backend wiring the `ui/` surface drives. The `ui/` render layer (route
gate + forms) is covered by the non-gated vitest scaffolds named in `roadmap.json`.

## Adapter coverage (Mandate 6)

All driven dependencies are real in every scenario (Strategy C). No driven adapter is
doubled, so there are no `NO — MISSING` rows.

| Driven dependency | `@real_io` scenario | Covered by |
|-------------------|---------------------|------------|
| auth-proxy (identity injection + JWT mint) | YES | every scenario (mint_dev_jwt + Bearer on each call) |
| ui-state actor surface (`/ui-state/state*`) | YES | walking skeleton + routing/creation scenarios |
| backend `/api/orgs` (create + me) | YES | created_by + no-auto-create + org-absent scenarios |
| backend `/api/projects` (create + list) | YES | default-project + walking-skeleton scenarios |
| metadata DB (organizations.created_by, projects rows) | YES | asserted via the API side effects (+ direct column assertion in the gate-tested S1 unit test) |
