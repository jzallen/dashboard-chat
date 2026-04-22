# Design: WorkOS Onboarding Fixes

## Context

The audit in dc-v4d established that dashboard-chat has a working AuthKit integration (login → callback → tokens → refresh → revoke, all verified JWT-based via JWKS) and a working create-org-on-first-signin flow that calls WorkOS' `POST /organizations` and `POST /user_management/organization_memberships`, then re-authenticates the user to pick up the new `org_id` claim. Three pieces are missing: invitation acceptance, an authoritative JWT-based `org_id`, and Admin Portal integration. They are addressed together because invitation acceptance is unsafe without trusting the JWT end-to-end (otherwise a buggy or missing claim is papered over by the `enrich_org_id` heuristic), and because a new OrgSettings surface for Admin Portal fits naturally alongside the existing Org management use cases.

## Goals / Non-Goals

**Goals**
- An invited teammate clicks an invitation email, signs in, lands on an accept screen listing their pending invitations, accepts with one click, and arrives at the team workspace — no duplicate org created.
- `user.org_id` in any request context derives from the JWT alone. Any absence of the claim is treated as "not in an organization" and routed to onboarding rather than guessed at from the local database.
- An org admin can one-click "Set up Single Sign-On" (or DSync, or Verify Domain) from an org settings view and land in WorkOS Admin Portal without involving engineering.

**Non-Goals**
- Multi-organization memberships per user (app still one-org-per-user; WorkOS-side multi-membership remains invisible to the app for now).
- Silent refresh with `organization_id` (full re-login continues to be acceptable; dc-v4d marked this Minor-to-Major but not blocking).
- Invite-teammates step in CreateOrg.
- Org switcher UI.
- Automatic invitation-ticket parsing from the AuthKit callback URL. WorkOS forwards the invited user through AuthKit with the user already signed-in and the invitation still in `pending` state; listing pending invites by the user's email is the contractually supported path.

## Decisions

### D1. Trust the JWT `org_id` claim; remove `enrich_org_id`

**What:** Delete `enrich_org_id` from `backend/app/auth/__init__.py:27-58` and its call site in `backend/app/auth/middleware.py:82`. The middleware's existing `if user.org_id is None and path not in ORG_LESS_PATHS: return 403` gate (`middleware.py:85-90`) is sufficient once the heuristic is removed. Callers of `get_current_user()` see `org_id` = `None` exactly when the JWT lacks the claim.

**Why:** AuthKit sets `org_id` on the access token whenever the user has authenticated into an organizational context (https://workos.com/docs/authkit/sessions). The heuristic walks `ProjectRecord.created_by` and picks the first matching project's `org_id`, which is a local-DB guess that has no relationship to WorkOS membership. For a legitimate multi-org user, for a user whose membership was revoked in WorkOS but who still has a project they created, for a user imported from a prior-product-state before WorkOS existed, the heuristic returns a stale/wrong value. Any code that depended on the heuristic to paper over a missing claim was masking a real bug.

**Migration:** Any installation today that has `auth_mode="workos"` and users whose JWTs carry `org_id` is fine — the heuristic was a no-op for them. For dev installs that relied on `auto_provision_org=True` to self-heal a missing `dev-org-001` row, the Alembic seed for the dev database now inserts the `dev-org-001` organization explicitly. (No migration is needed for existing deployments — dev is a greenfield case.)

**Alternative considered:** Keep the heuristic but mark it dev-only. Rejected because the heuristic runs unconditionally in `middleware.py:82` and dev-only gating adds a production-test divergence. Better to remove and rely on the claim.

### D2. Invitation pending-list endpoint is pre-org

**What:** `GET /api/invitations/pending` is added to `ORG_LESS_PATHS` so a user with a valid JWT but no `org_id` claim can call it immediately after sign-in. It queries WorkOS `GET /user_management/invitations?email={user.email}&status=pending` and returns a filtered list of `{id, organization_id, organization_name, expires_at, email}`.

**Why:** A just-signed-in user who was invited has not yet accepted the invitation, so their JWT has no `org_id`. The middleware must let them call the listing endpoint or they will hit a 403 and the accept flow can't start. This mirrors `/api/orgs` (already pre-org) for the identical reason.

### D3. Invitation acceptance requires re-authentication

**What:** `POST /api/invitations/{id}/accept` calls WorkOS, upserts a local `OrganizationRecord` for the accepted org, and returns `{org_id, org_name, requires_reauth: true}`. The frontend calls `login(org_id)` which routes through WorkOS `authorize` with `organization_id` query param, producing a new access token carrying the new `org_id` claim.

**Why:** The user's existing access token pre-dates the membership and has no `org_id`. WorkOS does not retroactively update a live session. The existing CreateOrg flow already uses this exact pattern (`frontend/src/ui/components/CreateOrg/index.tsx:33`) — we adopt the same contract for invitations rather than invent a new one. Silent refresh with `organization_id` (covered in WorkOS session docs) is a valid optimization but is out of scope for this change; full re-login is user-acceptable and already battle-tested.

**Email mismatch handling:** WorkOS enforces email-match rules server-side (https://workos.com/docs/authkit/invitations): corporate domains accept any email in the domain; consumer domains require exact match. We surface WorkOS' error response verbatim to the user if accept fails — no client-side mismatch pre-check.

### D4. Admin Portal link is an org-scoped endpoint

**What:** `GET /api/orgs/{org_id}/admin-portal?intent=sso` calls WorkOS `POST /portal/generate_link` with the org_id and intent, returns `{url, expires_at}` where `expires_at` is now + 5 minutes (WorkOS' documented expiry, https://workos.com/docs/admin-portal). The frontend issues the request and immediately `window.location.assign(url)` — no intermediate UI, per the WorkOS "redirect immediately" guidance.

**Intents supported:** `sso`, `dsync`, `domain_verification`. `audit_logs` and `log_streams` are documented by WorkOS but deferred — no product surface today.

**Authorization:** Standard `authorize_project_access`-style check — the caller's JWT `org_id` must equal the path's `{org_id}`. Unrelated to project auth but identical org-boundary semantics.

**Why scoped to `/api/orgs/{org_id}/...` rather than `/api/admin-portal`:** anticipates multi-org-per-user eventually; the org boundary is explicit in the URL.

### D5. Proxy-vs-app split

Restating the dc-v4d finding so implementers pick the right layer:

- **Stateless identity plane (proxy / AuthKit hosted UI):** JWT verification, token refresh rate-limiting, identity-header injection, CSRF state handshake. None change in this proposal.
- **Stateful provisioning plane (in-app):** anything that writes to WorkOS + local DB atomically. Invitation accept, Admin Portal link generation (writes to WorkOS side-effectfully — creates a time-bound session link), and org-row upsert on accept all live in the backend `app/use_cases/`. The frontend owns the UI and the `/invitations` route.

The proxy is not touched because no new endpoints require JWT-less access, no public paths change, and no new identity headers are introduced.

### D6. Order of operations in `middleware.py`

The middleware path gating assumes `ORG_LESS_PATHS` matches are checked before any JWT verification side-effects like `enrich_org_id` run. Removing `enrich_org_id` simplifies this:

```
verify Bearer → set_auth_user(user) → if path in ORG_LESS_PATHS: continue ; elif user.org_id is None: 403 ; else continue
```

No change to ordering, only to the body — `enrich_org_id` is simply deleted.

## Data flow

### Post-auth routing (updated)

```
AuthCallback.handleCallback(code)
  └─ POST /api/auth/callback → {user, token, refresh_token, expires_in}
     ├─ if user.org_id is set:
     │    └─ navigate("/")
     └─ else:
          ├─ GET /api/invitations/pending (auth: Bearer; pre-org allowed)
          ├─ if results.length ≥ 1:
          │    └─ navigate("/invitations", { state: { invitations: results } })
          └─ else:
               └─ navigate("/org/create")   # unchanged
```

### Invitation accept

```
InvitationAccept (user clicks "Accept" on invitation X)
  └─ POST /api/invitations/{X}/accept
     └─ backend calls WorkOS POST /user_management/invitations/{X}/accept
     └─ backend upserts OrganizationRecord(id=accepted.org_id, name=accepted.org_name)
     └─ returns {org_id, org_name, requires_reauth: true}
  └─ frontend: await login(org_id)  # re-auth through WorkOS with organization_id=org_id
  └─ AuthProvider picks up new JWT, user.org_id now populated → navigate("/")
```

### Admin Portal link

```
OrgSettings (admin clicks "Set up Single Sign-On")
  └─ GET /api/orgs/{org_id}/admin-portal?intent=sso
     └─ backend calls WorkOS POST /portal/generate_link {organization, intent: "sso"}
     └─ returns {url, expires_at}
  └─ frontend: window.location.assign(url)  # 5-min link, redirect immediately
```

## Tradeoffs

1. **Full re-login vs silent refresh after accept.** Silent refresh (passing `organization_id` to `/api/auth/refresh`) is faster and avoids a WorkOS-side redirect. Full re-login is what CreateOrg already does; it works, it's user-visible as a brief loader, and it shares one code path with every other post-provisioning flow. Choosing full re-login now, adding silent refresh in a follow-up.

2. **Remove `enrich_org_id` vs keep as a kill switch.** Keeping it behind a feature flag would buy graceful rollout. But its correctness was always dubious, it's been running unconditionally in production, and any code that depended on it is incorrect in other ways too. Removing it surfaces those dependencies now. No flag.

3. **Admin Portal in OrgSettings vs dedicated `/admin` route.** A dedicated route is cleaner but requires more scaffolding. OrgSettings is a single page that can host sections; add the portal section there and revisit if other admin-only features accumulate.

4. **Invitation dedupe when multiple invitations exist to the same org.** Rare but possible (re-invited after decline). Deduplicate by `organization_id` in the listing response, keeping the most-recent `expires_at`. This is a backend responsibility so the frontend sees one entry per org.

## Prior art in the codebase

- `backend/app/use_cases/organization/create_organization.py:79-108` — the `_create_workos_org` pattern (httpx to WorkOS API + handled errors + local DB upsert + `requires_reauth`) is the direct template for the new `accept_invitation` and `generate_admin_portal_link` use cases. Reuse its error handling (`ExternalServiceError`) and structure.
- `frontend/src/ui/components/CreateOrg/index.tsx:33-42` — the `requires_reauth → login(org_id)` loop is the template for the frontend accept flow.
- `backend/app/auth/middleware.py:26-29` — `ORG_LESS_PATHS` is a hand-curated set. We add `/api/invitations/pending` and `/api/invitations/{id}/accept` (note the path-template gotcha — middleware matches on exact path, so the acceptance route needs a prefix match or explicit registration).

## Open questions

1. **Path-template match in `ORG_LESS_PATHS`.** The current set uses exact-string matching (`backend/app/auth/middleware.py:28-29`). `/api/invitations/{id}/accept` varies by id. Implementers should either switch to a prefix-based check (`path.startswith("/api/invitations/")`) or decorate routes. Noted as a tasks-level decision; specs don't pin the implementation.

2. **Invitation expiry display.** WorkOS invitations expire. Surface `expires_at` on the accept screen so the user knows they need to act before a given time. Copy TBD; not in the spec requirements (implementation detail of the frontend).

3. **Should `/api/invitations/pending` 200-with-empty-array when the user is org-less but has no invitations, or 404?** 200 + empty array is standard REST; the AuthCallback branching is cleaner that way. Go with 200.

4. **Admin Portal audit logging.** `POST /portal/generate_link` creates a time-bound privileged link. We should log `(user_id, org_id, intent, generated_at)` to the backend's standard request log so there's a trail. Specs don't require it; tasks do.

## Rollout

1. Land spec + design (this change).
2. Implement backend endpoints behind feature-flagless release (they're additive and gated by existing auth).
3. Implement frontend after backend lands (needs the new endpoints).
4. Before removing `enrich_org_id`, audit production logs for cases where the heuristic returned a non-None `org_id` that was not in the JWT — if any, surface those users as "legacy no-org" via a one-off migration that adds explicit WorkOS memberships. This is a dev-time check, not a migration.
