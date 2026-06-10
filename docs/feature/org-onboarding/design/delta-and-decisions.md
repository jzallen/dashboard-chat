# org-onboarding — Design Bridge (delta + decisions)

**Status:** Design SSOT for the DISTILL acceptance tests.
**Why this doc instead of a DESIGN wave:** the architecture this feature rides on is
already ratified in **accepted ADRs** — ADR-044 (ChatApp coordinator) and ADR-046
(StateProxy `/state` surface). The onboarding state machine + the wire surface are
**done and correct**. This feature is a thin *wiring* slice (a `/onboarding` surface in
`ui/`, plus a small backend affordance so the dev principal can actually reach the
empty-org state). No new architecture is introduced; this doc records the **delta** the
acceptance tests trace to.

Scope boundary (hard): **org + single default project ONLY.** No member invites, no
project naming beyond the one default project. Work targets `ui/` (React 18 + RRv7
framework-mode CSR SPA) — **not** `frontend/`.

---

## 1. The wire contract the tests assert against

`ui-state` exposes ONE surface behind the auth-proxy `/ui-state/*` prefix (auth-proxy
strips the prefix before forwarding):

| Method + path                       | Effect                                                            |
|-------------------------------------|-------------------------------------------------------------------|
| `GET  /ui-state/state`              | Returns ONE `ChatAppStateDocument`. Does **not** cold-start.      |
| `POST /ui-state/state/events`       | Accepts ONE `ChatAppWireEvent`; returns the new document.         |
| `GET  /ui-state/state/stream` (SSE) | Pushes each fresh document as an `event: state` frame.            |

`ChatAppStateDocument` (`shared/ui-state-wire/state-document.ts`):

```jsonc
{
  "phase": "onboarding | project_context | chat | rejected",
  "active_scope": { "org_id", "project_id", "resource_type", "resource_id" },
  "sequence_id": 0,
  "last_event_at": "",
  "request_id": "",
  "regions": {
    "onboarding":     { "state", "context" },
    "projectContext": { "state", "context" },
    "sessionChat":    { "state", "context" }
  }
}
```

- **Onboarding region states** (`ui-state/lib/machines/onboarding/machine.ts`):
  `verifying | needs_org | creating_org | ready | error_recoverable | session_rejected`.
- Identity + org live at `regions.onboarding.context.{user, org}`
  (`user.{email, display_name, first_name}`, `org.{id, name}`).
- **GET `/state` does NOT cold-start the actor.** On authenticated entry the FE MUST
  `POST {type:"session_begin"}` to start the flow (the router cold-starts on
  `session_begin`, settles, persists, and returns the document → enters `verifying`,
  then settles to `needs_org` or `ready`).

### Events this feature uses (`shared/ui-state-wire/wire-event.ts`)

| Event                                | Region consumed by | Payload                       |
|--------------------------------------|--------------------|-------------------------------|
| `session_begin`                      | (router cold-start)| `{ force_restart?: boolean }` |
| `org_form_submitted`                 | onboarding         | `{ org_name: string }`        |
| `create_project_submitted`           | project-context    | carries the project name (see §5 / upstream-issues) |

**ACL note (ADR-046 Decision 3):** while `phase === "onboarding"`, the router enforces a
**closed onboarding vocabulary** server-side — only `org_form_submitted` and
`__force_failure__` validate; any other `type` → **HTTP 400**. Once the phase advances
past onboarding (org exists), the project-context vocabulary (`create_project_submitted`)
forwards verbatim to the active child.

---

## 2. The region flow (happy path)

```
authenticated entry (token in localStorage)
      │  POST /ui-state/state/events {type: session_begin}
      ▼
onboarding.verifying ──(GET /api/orgs/me 404)──▶ onboarding.needs_org      phase=onboarding
      │  POST {type: org_form_submitted, payload:{org_name}}
      ▼
onboarding.creating_org ──(createOrg → POST /api/orgs)──▶ onboarding.ready  phase advances
      │
      ▼  (project-context region now active)
projectContext.no_projects
      │  POST {type: create_project_submitted, payload:{<name>}}
      ▼
projectContext.creating_project ──(createProject → POST /api/projects)──▶ projectContext.project_selected
      │
      ▼
ENTER APP  (onboarding complete = org in app DB AND a default project exists)
```

**Onboarding complete** ≙ org row exists in the app DB **AND** a default project exists
for that org. The two creation steps live in **different regions** — org in *onboarding*,
default project in *project-context* (`create_project_submitted` carries the name; do
**not** use `create_project_clicked`, which carries no name → empty-name project →
backend validation failure).

`needs_org` is derived from an **app-DB lookup** (`GET /api/orgs/me`, 404 → `needs_org`),
**not** the token claim. `createOrg → POST /api/orgs` and `createProject →
POST /api/projects` are real + production-wired. **ui-state needs ZERO changes.**

---

## 3. The frontend/ reference (port, do not modify)

`frontend/app/lib/state-proxy.ts` + `frontend/app/root.tsx` already implement the
StateProxy + `useSelector` pattern for SSR + cookie auth:

- `createStateProxy({ seed, fetchImpl, eventSourceFactory })` — a hand-built ActorRef
  (`getSnapshot` / `send` / `postEvent` / `subscribe`) that caches the document and
  slices it via `useSelector`. The machine never leaves the server.
- `fetchStateDocument(request)` forwards the inbound `Authorization` header for the SSR
  seed.

`ui/` must **port** this, adapted from **SSR/cookie → CSR/localStorage Bearer**:
forward `Authorization: Bearer <token>` (from `ui/app/auth/tokenStorage.ts`) on
`session_begin`, on every `POST /ui-state/state/events`, and on the `GET /state(+/stream)`
calls. Do **not** modify `frontend/`.

---

## 4. The six resolved decisions (fixed inputs)

| # | Decision |
|---|----------|
| **D1** | **DEV reachability — backend-only `DEV_NO_ORG` affordance.** Add a NULLABLE `created_by` (owner user id) column to `organizations` (Alembic migration; SQLite-dev + Postgres-prod compatible). Stamp it = the creating user on org create (both dev + workos paths; harmless in workos). Backend env flag `DEV_NO_ORG=true`: for the dev principal, **IGNORE the injected `X-Org-Id` header** and instead resolve `org_id` from the DB by `created_by == user.id`. Result: `None` before the user creates an org → `GET /api/orgs/me` 404 → `needs_org`; resolves after creation → onboarding exits. **Closes the otherwise-infinite dev loop** (a static "always ignore header" loops forever because there is currently NO DB link between a dev user and the org they create — and `DEV_USER.org_id` is hardcoded to `dev-org-001`). **No auth-proxy change.** Entirely in `backend/`. |
| **D2** | **DROP the backend auto-create of "My First Project"** (`create_organization.py` — the `create_project` call + the dev path). The project-context `creating_project` step now **solely** owns first-project creation (user-driven via `create_project_submitted`). Update every backend test/suite that asserts a default project appears after `POST /api/orgs`. |
| **D3** | **`ui/` ONLY.** Port the StateProxy integration FROM `frontend/` as reference; do not touch `frontend/`. |
| **D4** | **StateProxy singleton in `ui/`.** A `StateProxyProvider` React context created once at app entry, shared by the app-shell gate and the `/onboarding` route. Adapt the `frontend/` proxy from SSR/cookie → CSR/localStorage: forward `Authorization: Bearer <token>` (from `ui/app/auth/tokenStorage.ts`) on `session_begin`, every `/ui-state/state/events` POST, and the `GET /state(+/stream)` calls. |
| **D5** | **Token reissue.** The DEV flow needs NONE (DB resolution per D1). For WorkOS mode, the `ui/` proxy defensively adopts an `X-New-Access-Token` response header (if present) via `setToken` — but this slice is **NOT gated** on a WorkOS e2e. PRIMARY acceptance target is `AUTH_MODE=dev` + `DEV_NO_ORG`. |
| **D6** | **Routing.** Add `/onboarding` as a top-level route **OUTSIDE** the app-shell layout in `ui/app/routes.ts` (sibling of `/login`, `/auth/callback`) so it renders without Topbar/Overlays. Gate: on authenticated entry, after `session_begin` settles, if `phase === "onboarding"` (`regions.onboarding.state ∈ {needs_org, creating_org, error_recoverable}`) → redirect to `/onboarding`; `verifying` is **transient** — wait, do not redirect. After `ready` → if `regions.projectContext.state === "no_projects"`, drive the default-project form (in `/onboarding`) before entering the app. |

---

## 5. File-by-file delta

### backend/ (S1 — gate-tested by backend pytest)

| File | Change |
|------|--------|
| `backend/app/repositories/metadata/organization_record.py` | Add `created_by: Mapped[str \| None]` nullable column. |
| `backend/migrations/versions/018_add_organizations_created_by.py` | **NEW** migration: `op.add_column('organizations', sa.Column('created_by', sa.String(length=36), nullable=True))`; `down_revision = "d7e8f9a0b1c2"` (017 head). SQLite + Postgres compatible. |
| `backend/app/repositories/metadata/repository.py` (`create_organization`) | Accept `created_by: str \| None = None` and persist it. |
| `backend/app/use_cases/organization/create_organization.py` | Pass `created_by=user.id` to `create_organization`; **DELETE** the `create_project(name="My First Project", …)` auto-create (D2). |
| `backend/app/config.py` (`Settings`) | Add `dev_no_org: bool = False` (env `DEV_NO_ORG`). |
| `backend/app/routers/deps.py` (`get_current_user`) **or** a resolver in the org read path | When `settings.dev_no_org` and the dev principal: ignore `X-Org-Id`, resolve `org_id` from the DB by `created_by == user.id` (None before creation → 404 / `needs_org`). DB-touching resolution belongs at a layer with session access; keep `get_organization` / `/api/orgs/me` correct under the flag. |
| `backend/tests/use_cases/organization/test_create_organization.py` | Update the test that asserts "My First Project" appears (now asserts **zero** projects after `POST /api/orgs`); add `created_by` assertion. **DELIVER does this** so the gate stays green during DISTILL. |

### ui/ (S2–S4 — NOT gate-run; vitest is outside the refinery `--auto` gate)

| File | Change |
|------|--------|
| `ui/app/lib/state-proxy.ts` | **NEW** — port of `frontend/app/lib/state-proxy.ts`, adapted to CSR + `Authorization: Bearer` (token from `tokenStorage.getToken()`) on every call. Inject `fetchImpl`/`eventSourceFactory` for unit-testability. Defensively adopt `X-New-Access-Token` → `setToken` (D5). |
| `ui/app/lib/StateProxyProvider.tsx` | **NEW** — React context creating the proxy **once** at app entry (D4); shared by the gate + `/onboarding`. |
| `ui/app/auth/bootstrap.ts` (or a new bootstrap hook) | On authenticated entry, `POST {type: session_begin}` then await settle. |
| `ui/app/routes.ts` | Add `route("/onboarding", "routes/onboarding.tsx")` as a top-level sibling of `/login` + `/auth/callback`, OUTSIDE the `app-shell` layout (D6). |
| `ui/app/routes/onboarding.tsx` | **NEW** — the onboarding surface: `needs_org` org-name form → `org_form_submitted`; after `ready` + `no_projects`, the default-project form → `create_project_submitted`; on completion, navigate into the app. Uses `createLogger` (never `console.*`). |
| `ui/app/routes/app-shell.tsx` (the gate) | After `session_begin` settles, redirect to `/onboarding` when `phase === "onboarding"`; wait on `verifying`; drive default-project step when `ready` + `no_projects`. |

---

## 6. Acceptance seam + walking-skeleton strategy

The honest seam is **API-level against the live compose stack**: mint a dev JWT
(`POST /api/auth/callback`), drive `/ui-state/state(+/events)` with the Bearer, and assert
both the **document** (region states, identity) and the **app-DB side effects**
(`GET /api/orgs/me`, org row `created_by`, project existence). This exercises the real
auth-proxy → ui-state → backend path end to end — the path TBU defects hide in.

- **WS strategy = C (real local / `@real_io`)** — the feature's dependencies are a real
  DB + container services (backend, ui-state, Redis, auth-proxy). All adapters are real;
  no in-memory doubles. The single `@walking_skeleton` scenario is the full happy path
  (org-less dev principal → org → default project → app entry).
- The suite **skips** (not fails) when the compose stack is unreachable
  (`needs_compose_stack`), so it never blocks a no-stack CI/gate run; it is **RED** when
  the stack is up and the feature is unbuilt (the intended DISTILL posture).
- **PRIMARY target:** `AUTH_MODE=dev` + `DEV_NO_ORG=true`. WorkOS reissue (D5) is **not**
  gated by an e2e in this slice.

See `../distill/roadmap.json` for the slice plan and `../distill/upstream-issues.md` for
HIGH-severity blockers discovered while reading (notably the `create_project_submitted`
name-field misnomer and the dev-principal org-reset affordance needed for repeatable runs).

## Changed Assumptions (2026-06-10 — cookie baseline)

`ui-cookie-session` landed between this DISTILL and DELIVER (commits `d34e67d1` C1+C2,
`7d04209c` C3, `79fb2d60` C4; see `docs/feature/ui-cookie-session/`). `ui/` auth is now an
**httpOnly cookie session** (`auth_token` cookie + JS-readable `session=1` flag; gate =
`hasSession()`; `tokenStorage` writes retired; catalog requests ride `credentials:"include"`).
Three assumptions above are superseded:

1. **§3 / D4 — "adapt the proxy from SSR/cookie → CSR/localStorage Bearer; forward
   `Authorization: Bearer <token>` on every call"** → SUPERSEDED. The `ui/` StateProxy port
   uses **`credentials:"include"` + `EventSource(url, {withCredentials:true})`** — the same
   transport shape as the `frontend/` reference, making S2 a near-verbatim port. No Bearer
   headers; no `tokenStorage.getToken()` (the function yields null post-migration). Bootstrap
   gates on `hasSession()` instead of token truthiness.
2. **D5 — "the `ui/` proxy defensively adopts `X-New-Access-Token` via `setToken`"** →
   PARKED. Post-migration `ui/` has no consumer of the reissue header (`setToken` is retired);
   the WorkOS reissue→Set-Cookie conversion is an explicit auth-proxy follow-up
   (ui-cookie-session D8/UC-4). The DEV flow needs no reissue (D1 DB resolution) — unchanged.
3. **upstream-issues UI-3 (SSE auth under CSR + Bearer)** → DISSOLVED. The credential is a
   cookie now; `EventSource` carries it with `withCredentials`. No query-param token, no
   fetch-based SSE reader, no POST-settled-docs-only constraint needed.

The roadmap's S2 slice (`../distill/roadmap.json`, `revised` field) was rewritten
accordingly. D1/D2/D6 and slices S1/S3/S4 are unaffected (S3's app-shell gate now composes
with `hasSession()` rather than a readable token — behaviorally identical at the gate seam).
