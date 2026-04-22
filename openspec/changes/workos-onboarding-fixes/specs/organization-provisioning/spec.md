## ADDED Requirements

### Requirement: JWT org_id claim is the authoritative source of user organization membership

The backend SHALL derive `AuthUser.org_id` exclusively from the `org_id` claim on the verified access token JWT. No database heuristic, email-domain match, or side lookup SHALL populate `org_id` when the claim is absent.

- The auth provider's `verify_token` method SHALL return an `AuthUser` whose `org_id` equals the JWT's `org_id` claim, or `None` when the claim is absent.
- The auth middleware SHALL NOT mutate `user.org_id` after `verify_token` returns.
- The auth middleware SHALL treat a missing `org_id` claim as "user has no organization" and SHALL gate access to non-org-less routes with a `403` response carrying `detail: "Organization required"`.

#### Scenario: JWT with org_id claim populates AuthUser.org_id

- **WHEN** a verified access token carries `org_id: "org-123"`
- **THEN** the `AuthUser` produced by `verify_token` SHALL have `org_id = "org-123"`

#### Scenario: JWT without org_id claim yields None

- **WHEN** a verified access token has no `org_id` claim
- **THEN** the `AuthUser` produced by `verify_token` SHALL have `org_id = None`
- **AND** the middleware SHALL NOT attempt to enrich `org_id` from local database state

#### Scenario: Org-less user hitting an org-scoped route is rejected

- **WHEN** a request arrives with a valid JWT whose `org_id` is `None`
- **AND** the path is not in the org-less allow list
- **THEN** the middleware SHALL return `403` with `detail: "Organization required"`

---

### Requirement: Legacy enrich_org_id heuristic is removed

The backend SHALL NOT contain any code path that derives a user's `org_id` by inspecting records other than the JWT. The previously-existing `enrich_org_id` helper in `backend/app/auth/__init__.py` SHALL be removed; no replacement heuristic SHALL be introduced.

- Code that walked `ProjectRecord` to look up an `org_id` for a user SHALL be deleted.
- No new helper SHALL perform an equivalent DB-side lookup.

#### Scenario: No enrich_org_id helper exists

- **WHEN** the backend codebase is searched for `enrich_org_id`
- **THEN** no definition or call site SHALL be found

#### Scenario: A user's JWT is the single source of their org membership

- **WHEN** a user has created projects under `org_id = "org-123"` in the past
- **AND** the user's current JWT carries `org_id = None` (e.g., membership revoked in WorkOS)
- **THEN** the middleware SHALL treat the user as having no organization
- **AND** SHALL NOT re-assign them to `org-123` from the project history

---

### Requirement: Dev auto-provision helper is removed

The backend SHALL NOT contain an `auto_provision_org` setting or an `ensure_org_provisioned` helper that creates local `OrganizationRecord` rows as a side effect of authentication. Dev-mode local org rows SHALL be seeded through migrations or explicit test fixtures, not via middleware side effects.

- The `auto_provision_org` field SHALL be removed from the Settings config.
- The `ensure_org_provisioned` function and its callers SHALL be deleted.
- Dev-mode local setup SHALL rely on an Alembic seed or dev fixture inserting the dev organization explicitly.

#### Scenario: auto_provision_org setting does not exist

- **WHEN** the backend Settings object is inspected
- **THEN** no `auto_provision_org` attribute SHALL exist

#### Scenario: ensure_org_provisioned does not exist

- **WHEN** the backend codebase is searched for `ensure_org_provisioned`
- **THEN** no definition or call site SHALL be found

#### Scenario: Dev org row is seeded explicitly, not auto-provisioned

- **WHEN** a fresh dev database is initialized via migrations and seeds
- **THEN** the seed SHALL include an `OrganizationRecord` with `id = "dev-org-001"` and a human-readable name
- **AND** no login-time code path SHALL create that row as a side effect
