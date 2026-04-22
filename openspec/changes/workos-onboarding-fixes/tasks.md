## 1. Backend — Invitation Endpoints

- [ ] 1.1 Create `backend/app/use_cases/invitation/list_pending.py` with `list_pending_invitations(user)` that calls WorkOS `GET /user_management/invitations?email={user.email}&status=pending`, deduplicates by `organization_id` keeping the latest `expires_at`, and returns a list of `{id, organization_id, organization_name, expires_at, email}` dicts. Use the `httpx` + `ExternalServiceError` pattern from `backend/app/use_cases/organization/create_organization.py:79-108`.
- [ ] 1.2 Create `backend/app/use_cases/invitation/accept_invitation.py` with `accept_invitation(invitation_id, user)` that calls WorkOS `POST /user_management/invitations/{invitation_id}/accept`, upserts a local `OrganizationRecord(id=accepted.org_id, name=accepted.org_name)`, and returns `{org_id, org_name, requires_reauth: True}`. Wrap in the standard `@handle_returns` + `@with_repositories` decorator stack.
- [ ] 1.3 Create `backend/app/use_cases/invitation/exceptions.py` with `InvitationNotFound`, `InvitationExpired`, `InvitationEmailMismatch` domain exceptions that map to HTTP 404 / 410 / 403 per `app/use_cases/exceptions.DomainException`.
- [ ] 1.4 Add `backend/app/routers/invitations.py` exposing `GET /api/invitations/pending` and `POST /api/invitations/{invitation_id}/accept`. Pending endpoint requires only authenticated user (no org). Register the router in `backend/app/main.py` alongside existing routers.
- [ ] 1.5 Update `backend/app/auth/middleware.py` to allow pre-org access to invitation endpoints. Replace the exact-match `ORG_LESS_PATHS` set with a predicate that accepts `path in ORG_LESS_PATHS or path.startswith("/api/invitations/")`, and document the change inline. Public paths remain unchanged.
- [ ] 1.6 Unit tests: `backend/tests/use_cases/test_list_pending_invitations.py` and `test_accept_invitation.py` covering success, external-service error, email-mismatch (relay WorkOS 403), and idempotent accept (local org row already exists).
- [ ] 1.7 Router tests: `backend/tests/routers/test_invitations.py` exercising auth (401 without Bearer), pre-org access (200 with no `org_id` claim), and middleware behavior for `ORG_LESS_PATHS` prefix matching.

## 2. Backend — Admin Portal Endpoint

- [ ] 2.1 Create `backend/app/use_cases/organization/admin_portal.py` with `generate_admin_portal_link(org_id, intent, user)` that calls WorkOS `POST /portal/generate_link` with `{organization: org_id, intent: "sso"|"dsync"|"domain_verification"}`. Verify `user.org_id == org_id` before calling; raise `AuthorizationError` otherwise. Return `{url, expires_at}` where `expires_at` is computed as `now + 300s` (WorkOS documented expiry).
- [ ] 2.2 Validate intent against the allowed set `{"sso", "dsync", "domain_verification"}`. Raise `InvalidIntent` (new domain exception in `backend/app/use_cases/organization/exceptions.py`) for anything else.
- [ ] 2.3 Add `GET /api/orgs/{org_id}/admin-portal?intent={intent}` to `backend/app/routers/organizations.py`. Requires authenticated user with matching `org_id`. Log `(user_id, org_id, intent, generated_at)` at INFO level for the audit trail (per design D4 + open question 4).
- [ ] 2.4 Unit tests: `backend/tests/use_cases/test_admin_portal.py` covering success for each of the 3 intents, org-mismatch 403, invalid-intent 400, and WorkOS error propagation.
- [ ] 2.5 Router test: verify `GET /api/orgs/{id}/admin-portal` requires user's `org_id` to match the path `org_id`.

## 3. Backend — Drop enrich_org_id + auto_provision_org

- [ ] 3.1 Delete `enrich_org_id` function from `backend/app/auth/__init__.py` (lines 27-58). Delete its call site in `backend/app/auth/middleware.py:82` and the import line. The middleware's `if user.org_id is None and path not in ORG_LESS_PATHS: return 403` gate (lines 85-90) stays.
- [ ] 3.2 Delete `ensure_org_provisioned` function from `backend/app/auth/__init__.py` (lines 60-108). Delete its call in `backend/app/routers/auth.py:callback` handler.
- [ ] 3.3 Delete `auto_provision_org` field from `backend/app/config.py` Settings. Delete the `.env` reference if present.
- [ ] 3.4 Add a dev-only Alembic seed or test fixture that inserts `OrganizationRecord(id="dev-org-001", name="Dev Organization")` so the dev JWT's `org_id` claim resolves against local DB without relying on the deleted auto-provision path. Place in `backend/migrations/versions/` as an idempotent data seed (or in the dev-seed script if one exists).
- [ ] 3.5 Update backend tests that mocked or asserted `enrich_org_id` / `ensure_org_provisioned` / `auto_provision_org` behavior; delete obsolete assertions, update remaining tests to set `org_id` on the test-user fixture directly.
- [ ] 3.6 Grep for remaining references: `grep -rn "enrich_org_id\|ensure_org_provisioned\|auto_provision_org" backend/` must return zero hits after this task.

## 4. Frontend — Post-Auth Routing + Invitation Accept

- [ ] 4.1 Add `frontend/src/ui/hooks/useInvitationsQuery.ts` exposing `usePendingInvitationsQuery()` that calls `GET /api/invitations/pending` via `withAuth(fetch)`; cache key `invitationKeys.pending(userEmail)`. Add `invitationKeys` factory to `frontend/src/lib/queryKeys.ts`.
- [ ] 4.2 Update `frontend/src/ui/components/AuthCallback/index.tsx` post-auth branching (currently lines 36-40): on callback success with no `org_id`, fetch `/api/invitations/pending`; if results ≥ 1 → `navigate("/invitations")`; else → `navigate("/org/create")`. Preserve the existing state/CSRF and `code` handling.
- [ ] 4.3 Create `frontend/src/ui/components/InvitationAccept/` with `index.tsx` + `InvitationAccept.module.css` + `__tests__/InvitationAccept.test.tsx`. Lists pending invitations (org name, expires_at), provides an "Accept" button per entry that POSTs `/api/invitations/{id}/accept` and, on `requires_reauth: true`, calls `login(org_id)` from `AuthContext`. Surfaces expired/email-mismatch errors from the backend verbatim.
- [ ] 4.4 Add `<Route path="/invitations" element={<RequireAuth><InvitationAccept /></RequireAuth>} />` in `frontend/App.tsx` between the `/org/create` and `AppShell` routes.
- [ ] 4.5 Frontend component test for `AuthCallback` post-auth branching: mock the pending-invitations query to return 0 / 1 / 2 results and assert the navigation target.

## 5. Frontend — Admin Portal Surface

- [ ] 5.1 Add `frontend/src/ui/hooks/useAdminPortalLink.ts` with a mutation hook that calls `GET /api/orgs/{orgId}/admin-portal?intent={intent}` and returns the URL. Do not cache — links are single-use.
- [ ] 5.2 Create `frontend/src/ui/components/OrgSettings/` (or a section inside `OrgView`) surfacing three buttons: "Set up Single Sign-On", "Set up Directory Sync", "Verify Domain". Each button triggers `useAdminPortalLink({ orgId, intent })` and on success calls `window.location.assign(url)` immediately (no intermediate UI — WorkOS 5-min expiry).
- [ ] 5.3 Add route `<Route path="settings/org" element={<OrgSettings />} />` nested under `AppShell` in `frontend/App.tsx`. Link from the existing nav or OrgView.
- [ ] 5.4 Component test for `OrgSettings` buttons with mocked hook: click → hook called with correct intent → `window.location.assign` called with the returned URL.

## 6. Integration Tests

- [ ] 6.1 Backend integration test: sign-in as a user with no org + seed a pending WorkOS invitation (mock WorkOS HTTP); call `GET /api/invitations/pending` → 200 with the invitation; `POST /api/invitations/{id}/accept` → 200 with `requires_reauth: true`, local `OrganizationRecord` created.
- [ ] 6.2 Frontend integration test: render `AuthCallback` with a mocked handleCallback returning `org_id: null`, mock the invitations API to return one invitation, assert navigation to `/invitations`, mount `InvitationAccept`, click Accept, assert `login(org_id)` called.
- [ ] 6.3 Backend integration test: `GET /api/orgs/{org_id}/admin-portal?intent=sso` as an authenticated user with matching org → 200 with URL; same endpoint with wrong org → 403.

## 7. Documentation

- [ ] 7.1 Update `docs/architecture/frontend-layers.md` post-auth routing section to document the invitation branch. Reference `/invitations` route.
- [ ] 7.2 Add `docs/architecture/onboarding-flow.md` with the three branches (JWT org_id set → home; no org_id + pending invitations → /invitations; no org_id + none → /org/create) and a sequence diagram for the invitation accept path.
- [ ] 7.3 Update `CLAUDE.md` Auth section to note that `user.org_id` derives solely from the JWT claim; remove any lingering reference to `enrich_org_id` or `auto_provision_org`.
- [ ] 7.4 Document the Admin Portal flow in `docs/domain/admin-portal.md` (or a relevant architecture page): three supported intents, 5-minute expiry, "redirect immediately" contract.
