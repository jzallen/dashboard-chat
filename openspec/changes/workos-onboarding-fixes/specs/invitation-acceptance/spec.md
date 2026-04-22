## ADDED Requirements

### Requirement: Pending invitation listing endpoint

The backend SHALL expose `GET /api/invitations/pending` that returns the authenticated caller's pending WorkOS invitations. The endpoint SHALL be accessible to users without an `org_id` claim on their JWT (it SHALL be on the org-less allow path list alongside `/api/orgs` and `/api/orgs/me`).

- The endpoint SHALL call WorkOS `GET /user_management/invitations?email={user.email}&status=pending` server-side.
- The response SHALL be a JSON array of `{id, organization_id, organization_name, expires_at, email}` entries.
- When multiple pending invitations exist for the same `organization_id`, the endpoint SHALL return only the entry with the latest `expires_at`.
- The endpoint SHALL return `200` with an empty array when the user has no pending invitations.
- The endpoint SHALL NOT require the caller's JWT to carry an `org_id` claim.

#### Scenario: Authenticated user with no org and one pending invitation

- **WHEN** a user whose JWT has no `org_id` claim calls `GET /api/invitations/pending`
- **AND** WorkOS has one pending invitation matching their email
- **THEN** the endpoint SHALL return `200` with an array containing that invitation's `{id, organization_id, organization_name, expires_at, email}`

#### Scenario: Authenticated user with no pending invitations

- **WHEN** a user calls `GET /api/invitations/pending`
- **AND** WorkOS has no pending invitations matching their email
- **THEN** the endpoint SHALL return `200` with an empty array `[]`

#### Scenario: Duplicate invitations are deduplicated by organization

- **WHEN** WorkOS returns two pending invitations for the same `organization_id` (e.g., a re-send)
- **THEN** the endpoint SHALL return a single entry for that `organization_id` with the latest `expires_at`

#### Scenario: Unauthenticated request is rejected

- **WHEN** a request to `GET /api/invitations/pending` has no `Authorization` header or an invalid Bearer token
- **THEN** the endpoint SHALL return `401`

---

### Requirement: Invitation acceptance endpoint

The backend SHALL expose `POST /api/invitations/{invitation_id}/accept` that accepts a pending WorkOS invitation on behalf of the authenticated caller. The endpoint SHALL be accessible to users without an `org_id` claim on their JWT.

- The endpoint SHALL call WorkOS `POST /user_management/invitations/{invitation_id}/accept`.
- On success, the endpoint SHALL upsert an `OrganizationRecord` with `id = accepted.organization_id` and `name = accepted.organization_name` if no row for that ID exists locally.
- The response body SHALL be `{org_id, org_name, requires_reauth: true}`.
- When WorkOS returns a 404 (invitation not found), the endpoint SHALL return `404` with a domain error of type `INVITATION_NOT_FOUND`.
- When WorkOS returns a 410 or an expiry-related error, the endpoint SHALL return `410` with a domain error of type `INVITATION_EXPIRED`.
- When WorkOS returns a 403 indicating the caller's email does not match the invitation's allowed domain/email, the endpoint SHALL return `403` with a domain error of type `INVITATION_EMAIL_MISMATCH`.

#### Scenario: Successful acceptance creates local org row and requests re-auth

- **WHEN** a user calls `POST /api/invitations/{id}/accept` for a valid pending invitation
- **THEN** the backend SHALL call WorkOS' accept endpoint
- **AND** upsert a local `OrganizationRecord` with the accepted org's id and name
- **AND** return `200` with body `{org_id, org_name, requires_reauth: true}`

#### Scenario: Acceptance is idempotent when local org row already exists

- **WHEN** a user accepts an invitation for an org whose `OrganizationRecord` already exists locally (e.g., the admin who created the invitation was also the first user)
- **THEN** the backend SHALL NOT raise a uniqueness error
- **AND** SHALL return `200` with the same response body as a first-time accept

#### Scenario: Expired invitation returns 410

- **WHEN** the user attempts to accept an invitation that WorkOS reports as expired
- **THEN** the endpoint SHALL return `410` with RFC 9457 error body `{type: "INVITATION_EXPIRED", ...}`

#### Scenario: Email mismatch returns 403

- **WHEN** WorkOS rejects the accept call because the caller's email does not match the invitation (e.g., consumer-domain invite requires exact email match)
- **THEN** the endpoint SHALL return `403` with RFC 9457 error body `{type: "INVITATION_EMAIL_MISMATCH", ...}`

---

### Requirement: Post-auth routing branches on pending invitations

The frontend `AuthCallback` SHALL, after a successful callback that returns a user with no `org_id`, query `GET /api/invitations/pending` before routing to create-organization.

- When the returned user has `org_id` set, `AuthCallback` SHALL navigate to `/`.
- When the returned user has no `org_id` and the pending-invitations query returns at least one invitation, `AuthCallback` SHALL navigate to `/invitations`.
- When the returned user has no `org_id` and the pending-invitations query returns zero invitations, `AuthCallback` SHALL navigate to `/org/create`.
- Errors from the pending-invitations query SHALL fall back to the `/org/create` path rather than block login.

#### Scenario: User with pending invitation routes to accept screen

- **WHEN** `handleCallback(code)` returns a user with no `org_id`
- **AND** `GET /api/invitations/pending` returns one invitation
- **THEN** `AuthCallback` SHALL call `navigate("/invitations", { replace: true })`

#### Scenario: User with no pending invitations routes to create-org

- **WHEN** `handleCallback(code)` returns a user with no `org_id`
- **AND** `GET /api/invitations/pending` returns an empty array
- **THEN** `AuthCallback` SHALL call `navigate("/org/create", { replace: true })`

#### Scenario: User with existing org routes home

- **WHEN** `handleCallback(code)` returns a user with `org_id` set
- **THEN** `AuthCallback` SHALL call `navigate("/", { replace: true })`
- **AND** SHALL NOT call the pending-invitations endpoint

---

### Requirement: Invitation accept frontend surface

The frontend SHALL expose a `/invitations` route that lists the authenticated user's pending invitations and allows one-click acceptance.

- The route SHALL be gated by `RequireAuth` but NOT by `RequireOrg` (users reaching it by definition have no `org_id`).
- The UI SHALL render one accept-able entry per pending invitation with the organization name and expiry.
- Clicking Accept SHALL call `POST /api/invitations/{id}/accept`; on a `requires_reauth: true` response the frontend SHALL call `login(org_id)` from `AuthContext` to refresh the session.
- Backend error responses (`INVITATION_EXPIRED`, `INVITATION_EMAIL_MISMATCH`) SHALL be surfaced to the user as actionable messages.

#### Scenario: Single pending invitation renders and accepts

- **WHEN** the user lands on `/invitations` with one pending invitation
- **AND** clicks Accept
- **THEN** the frontend SHALL POST to `/api/invitations/{id}/accept`
- **AND** on `{requires_reauth: true}` response SHALL call `login(org_id)` triggering a WorkOS re-auth with `organization_id=org_id`

#### Scenario: Accept fails with expired invitation

- **WHEN** the user clicks Accept for an expired invitation
- **AND** the backend returns `410` with `type: "INVITATION_EXPIRED"`
- **THEN** the frontend SHALL display an error message indicating expiry and SHALL offer a link to `/org/create` as fallback

#### Scenario: Accept fails with email mismatch

- **WHEN** the backend returns `403` with `type: "INVITATION_EMAIL_MISMATCH"`
- **THEN** the frontend SHALL display an error message indicating the invitation requires a different email and SHALL NOT attempt re-auth
