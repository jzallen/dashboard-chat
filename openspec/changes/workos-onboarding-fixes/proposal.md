# WorkOS Onboarding Fixes: Invitations, Authoritative Org Claim, Admin Portal

## Why

Audit bead **dc-v4d** mapped the dashboard-chat onboarding flow against current WorkOS AuthKit guidance and surfaced one Blocker and two Major gaps that collectively break team onboarding:

1. **Blocker — No invitation acceptance.** The post-auth router in `frontend/src/ui/components/AuthCallback/index.tsx:36-40` branches only on `result.org_id`; a teammate-invited user who clicks a WorkOS invitation email, signs in, and arrives with no `org_id` claim is routed to `/org/create` and creates a duplicate workspace. WorkOS documents the correct shape: `GET /user_management/invitations?email=...` to list pending invites and `POST /user_management/invitations/{id}/accept` to accept (https://workos.com/docs/authkit/invitations, https://workos.com/docs/reference/user-management/invitation). The app implements neither.

2. **Major — `enrich_org_id` fabricates org membership from local project ownership.** `backend/app/auth/__init__.py:27-58` queries `ProjectRecord` for any project `created_by == user.id` and returns its `org_id` as the user's organization when the JWT omits the claim. This contradicts AuthKit's own contract — AuthKit places `org_id` on the access token when the user is in an organization-scoped session (https://workos.com/docs/authkit/sessions) — and for any multi-org user or revoked-membership case it silently assigns the wrong org. The JWT should be the single source of truth.

3. **Major — No Admin Portal integration.** IT admins for enterprise customers have no in-app path to configure SSO or directory sync. WorkOS exposes the Admin Portal via `workos.portal.generateLink({ organization, intent })` returning a 5-minute link (https://workos.com/docs/admin-portal); the app neither generates nor surfaces these links.

These three changes tell a single UX story — "a new or invited user lands in the right place" — and are the Now-tier of dc-v4d's sequencing. The Next-tier items (silent refresh with `organization_id`, multi-org membership model, org switcher) are deliberately deferred to follow-up changes to keep this proposal shippable.

## Scope

### In scope
- **Invitation acceptance flow.** Proxy `GET /user_management/invitations?email=...` through a new backend endpoint on the pre-org allowlist; render an accept screen in the app that calls `POST /user_management/invitations/{id}/accept` and then refreshes the session so the access token carries the new `org_id`. Applies when the post-auth session has no `org_id` claim.
- **Authoritative `org_id` from JWT.** Remove `enrich_org_id` (`backend/app/auth/__init__.py:27-58`). The JWT's `org_id` claim — which WorkOS sets when the user authenticates in an organizational context — is the only source of truth. The middleware continues to return 403 "Organization required" for org-scoped routes when the claim is absent; the frontend already handles that by routing to the onboarding decision point.
- **Admin Portal link generation.** New backend endpoint that returns a short-lived Admin Portal URL for the current user's org (intents: `sso`, `dsync`, `domain_verification`). New frontend surface — an Org Settings page or section — that exposes "Set up Single Sign-On" / "Set up Directory Sync" / "Verify Domain" buttons.

### Out of scope (deferred to follow-up changes)
- Silent refresh with `organization_id` to replace full re-login after create-org (already working via full re-login; dc-v4d Major but not blocking).
- Multi-org membership model + org switcher (dc-v4d Major; requires new domain model, bigger surface).
- 3-step create-org wizard (dc-v4d Minor; CreateOrg works today as a single input).
- Invite-teammates step inside CreateOrg (dc-v4d Minor; product decision).
- Domain-policy handling for verified-domain JIT UX ("We added you to Acme Inc." toast).
- Invite-only sign-up mode toggle (product/go-to-market choice).

### Scope rationale
Narrow — the three in-scope items are tightly coupled to one user-visible outcome (no duplicate workspaces, correct org claim, admin self-service) and can ship behind one PR. Splitting invitation and Admin Portal into separate proposals would multiply OpenSpec ceremony without reducing implementation risk; bundling Next-tier items would blow up the surface. The `enrich_org_id` removal belongs here because the invitation flow's correctness depends on trusting the JWT `org_id` end-to-end — leaving the heuristic in place would let the backend paper over a missing claim and mask bugs in the new path.

## What Changes

### Backend
- Add `GET /api/invitations/pending` returning the caller's pending invitations (queries WorkOS `GET /user_management/invitations?email={email}`). Pre-org: added to `ORG_LESS_PATHS` (`backend/app/auth/middleware.py:28-29`).
- Add `POST /api/invitations/{invitation_id}/accept` that calls WorkOS `POST /user_management/invitations/{id}/accept`, ensures a local `OrganizationRecord` row exists for the accepted org, and returns `{org_id, org_name, requires_reauth: true}`. Pre-org.
- Add `GET /api/orgs/{org_id}/admin-portal?intent={sso|dsync|domain_verification}` that calls WorkOS `POST /portal/generate_link` with the current user's org_id and returns `{url, expires_at}`. Requires org.
- Remove `enrich_org_id` from `backend/app/auth/__init__.py` and its call site in `backend/app/auth/middleware.py:82`. Middleware continues to gate on `user.org_id is None` for non-org-less paths.
- Remove the one-off `auto_provision_org` setting + `ensure_org_provisioned` helper (dev-only convenience that only made sense alongside the enrich heuristic). Dev mode continues to mint a JWT with `org_id=dev-org-001`; the local org row for that ID is created by migration seed data instead.

### Frontend
- Extend `AuthCallback` (`frontend/src/ui/components/AuthCallback/index.tsx`) post-auth branching:
  - If `org_id` present → `/` (unchanged).
  - Else → fetch `/api/invitations/pending`:
    - 0 results → `/org/create` (unchanged).
    - ≥1 results → `/invitations` (new route with accept UI).
- New `InvitationAccept` component + route at `/invitations`. Lists pending invites, one-click accept per entry, on success calls `login(org_id)` (full re-login to pick up the new claim — same pattern as CreateOrg today; silent refresh is out of scope).
- New `OrgSettings` page or section surfacing "Set up Single Sign-On", "Set up Directory Sync", "Verify Domain" buttons. Each triggers `GET /api/orgs/{org_id}/admin-portal?intent=...` and redirects to the returned URL immediately (5-min expiry).
- Expose pending-invitation-count in the auth context so the callback isn't the only place that can route on it.

### Auth-proxy
- No changes required. The new backend endpoints are behind standard Bearer-token auth (post-login; pre- or post-org depending on route) and the proxy's existing forwarding handles them transparently. The proxy's `PUBLIC_PATHS` allowlist (`auth-proxy/lib/auth.ts:36-43`) stays as-is.

## Capabilities

### New Capabilities
- `invitation-acceptance` — backend endpoints for listing and accepting pending WorkOS invitations, plus the frontend accept UI and the post-auth routing hook that branches on invitation presence.
- `admin-portal-integration` — backend endpoint wrapping `workos.portal.generateLink()` and frontend surface to embed the generated short-lived URL.
- `organization-provisioning` — the authoritative contract that `user.org_id` derives solely from the JWT's `org_id` claim; removes the `enrich_org_id` and `auto_provision_org` side channels.

### Modified Capabilities
None directly. `auth-context-decomposition`, `auth-proxy`, `token-refresh`, and `router-layer-authorization` stay untouched — their requirements continue to hold, they just operate against an auth context whose `org_id` now comes from the JWT alone. The new capabilities are additive.

## Impact

- `backend/app/routers/invitations.py` — NEW router module
- `backend/app/use_cases/invitation/` — NEW use case package (list_pending, accept)
- `backend/app/routers/organizations.py` — MODIFIED (add admin-portal route)
- `backend/app/use_cases/organization/admin_portal.py` — NEW use case
- `backend/app/auth/__init__.py` — MODIFIED (remove `enrich_org_id`, `ensure_org_provisioned`, `auto_provision_org` gating)
- `backend/app/auth/middleware.py` — MODIFIED (remove `enrich_org_id` call, add `/api/invitations/*` to `ORG_LESS_PATHS`)
- `backend/app/auth/workos_provider.py` — UNCHANGED (JWT claims already populate `org_id`)
- `backend/app/config.py` — MODIFIED (remove `auto_provision_org` setting)
- `backend/app/repositories/metadata/` — MODIFIED if needed (org lookup-or-create for accepted invitations)
- `frontend/src/ui/components/AuthCallback/index.tsx` — MODIFIED (add invitation-pending branch)
- `frontend/src/ui/components/InvitationAccept/` — NEW component + tests
- `frontend/src/ui/components/OrgSettings/` — NEW component + tests (or inline on OrgView)
- `frontend/App.tsx` — MODIFIED (add `/invitations` route)
- `frontend/src/ui/hooks/useInvitationsQuery.ts` — NEW hook
- `frontend/src/ui/hooks/useAdminPortalLink.ts` — NEW hook (or inline mutation)
- `frontend/src/ui/context/AuthContext/` — MODIFIED (expose pending-invitation count if needed)
- `openspec/changes/workos-onboarding-fixes/` — this change
- No database migrations. `OrganizationRecord` row for an accepted invitation is lookup-or-create, keyed on WorkOS org_id (same pattern as `create_organization._create_workos_org`).

## References

- **dc-v4d** — full onboarding + WorkOS audit with file:line citations and URLs (private bead; see bead notes for the original scorecard and best-practice synthesis)
- https://workos.com/docs/authkit/users-organizations — five-step first-sign-in flow
- https://workos.com/docs/authkit/invitations — invitation lifecycle + email-match rules
- https://workos.com/docs/reference/user-management/invitation — list + accept endpoints
- https://workos.com/docs/authkit/sessions — JWT claims, refresh rotation, organization_id param
- https://workos.com/docs/admin-portal — `portal.generateLink`, 5-minute expiry, intents
- https://workos.com/docs/authkit/jit-provisioning — JIT behavior when domain is verified (referenced, not implemented here)
