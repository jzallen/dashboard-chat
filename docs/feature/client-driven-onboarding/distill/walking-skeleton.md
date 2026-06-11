# Walking Skeleton — client-driven-onboarding (notes)

> The `.feature` file is the scenario SSOT
> (`tests/acceptance/org-onboarding/features/org-onboarding.feature`,
> `@walking_skeleton`). This file is notes only.

## The one skeleton scenario

`test_walking_skeleton_org_then_default_project.py::test_orgless_principal_completes_org_and_default_project`
(`@walking_skeleton @real_io @happy_path @cdo_s1`).

The single end-to-end journey that gates the feature: an org-less authenticated
principal probes, creates an organisation and an automatic first project, reports
each outcome, and enters the app — all through the real ingress, exercising
auth-proxy → backend and auth-proxy → ui-state with no in-memory doubles.

## Strategy

**C — real local (`@real_io`).** The full compose stack (auth-proxy + backend +
ui-state + Redis), `AUTH_MODE=dev` + `DEV_NO_ORG=true` (DWD-1). The suite's
`driver.py` plays the **client** (the ratified driving party): it performs the real
backend writes (`POST /api/orgs`, `POST /api/projects`) AND narrates the outcomes to
ui-state (`org_not_found` / `org_created` / `project_created`). ui-state has zero
egress — it only transitions on those reports.

## The e2e path (the producer changes; the hand-offs do not)

```
orgless principal
  → session_begin                         → onboarding.awaiting_org_report (no I/O; identity header-seeded)
  → GET /api/orgs/me (404) + org_not_found → onboarding.needs_org (phase=onboarding)
  → POST /api/orgs (201)   + org_created   → onboarding.ready → parent advances login→engaged
                                             → projectContext.awaiting_scope_report (phase=project_context)
  → POST /api/projects(201)+ project_created → projectContext.project_selected
                                             → parent advances engaged.project_context→engaged.chat
                                               (isInitialProjectSelected — UNCHANGED guard)
  → app entry on the project_created POST's OWN response document (the (f) triple):
      regions.projectContext.state == "project_selected"
      active_scope.project_id        != null
      phase                          == "chat"
```

The parent coordinator's `onSnapshot` hand-offs (`isUserReady`,
`isInitialProjectSelected`) are **reused verbatim** — only the *producer* of the
child state changes from an invoke `onDone` to a client report (ADR-049 §5.2). The
client observes "enter the app" on the POST response document itself — no extra
read, no race (ADR-046 Decision 3).

## Green when

CDO-S1 (closed-union happy vocabulary + ui-state report-driven realignment) **and**
CDO-S2 (backend pure-resource contracts the dev happy path rides) are delivered.
CDO-S3..S5 add robustness, the auth-proxy/ui surfaces, and the workos path — not the
skeleton.

## Driving-adapter coverage

The skeleton exercises the **user-facing ingress** via real HTTP (httpx over the
reverse-proxy) for every step — the actual invocation path a browser client uses
(status codes, JSON:API bodies, the `/ui-state/state/events` wire, the
`/state` response document). It is not a service-function call. Adapter real-I/O
coverage for the dev path is total (the whole suite is `@real_io`); the workos-mode
externals (WorkOS provisioning/compensation) are the documented exception covered by
auth-proxy unit + fake-WorkOS at DELIVER (DWD-6).

## INV-PCO discipline

The ui-state document is never a resource oracle: every resource claim is re-asserted
against the backend SSOT (`GET /api/orgs/me` for the org; `GET /api/projects` for the
project) — exactly as the shipped suite did.
