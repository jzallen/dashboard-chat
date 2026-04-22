## ADDED Requirements

### Requirement: Admin Portal link generation endpoint

The backend SHALL expose `GET /api/orgs/{org_id}/admin-portal?intent={intent}` that returns a short-lived WorkOS Admin Portal URL for the specified organization and configuration intent.

- The endpoint SHALL require the authenticated caller's JWT `org_id` to equal the path `{org_id}`; otherwise it SHALL return `403`.
- The endpoint SHALL accept `intent` values `sso`, `dsync`, and `domain_verification`. Any other value SHALL return `400` with a domain error of type `INVALID_INTENT`.
- The endpoint SHALL call WorkOS `POST /portal/generate_link` with `{organization: org_id, intent}` server-side.
- The response body SHALL be `{url, expires_at}` where `expires_at` is `generated_at + 300` seconds (WorkOS-documented link expiry).
- The endpoint SHALL log `(user_id, org_id, intent, generated_at)` at INFO level for audit.

#### Scenario: SSO setup link for the caller's own org

- **WHEN** an authenticated user with JWT `org_id = "org-123"` calls `GET /api/orgs/org-123/admin-portal?intent=sso`
- **THEN** the backend SHALL call WorkOS `POST /portal/generate_link` with `{organization: "org-123", intent: "sso"}`
- **AND** the response SHALL be `200` with body `{url, expires_at}` where `expires_at` is approximately 300 seconds in the future

#### Scenario: DSync intent

- **WHEN** the caller requests `intent=dsync`
- **THEN** the backend SHALL forward `intent: "dsync"` to WorkOS

#### Scenario: Domain verification intent

- **WHEN** the caller requests `intent=domain_verification`
- **THEN** the backend SHALL forward `intent: "domain_verification"` to WorkOS

#### Scenario: Cross-org access is rejected

- **WHEN** an authenticated user with JWT `org_id = "org-123"` calls `GET /api/orgs/org-999/admin-portal?intent=sso`
- **THEN** the endpoint SHALL return `403` with a domain error of type `ACCESS_DENIED`
- **AND** SHALL NOT call WorkOS

#### Scenario: Invalid intent is rejected

- **WHEN** the caller requests `intent=audit_logs` (not in the allowed set)
- **THEN** the endpoint SHALL return `400` with a domain error of type `INVALID_INTENT`
- **AND** SHALL NOT call WorkOS

#### Scenario: WorkOS error is propagated

- **WHEN** WorkOS returns an error response (e.g., 5xx)
- **THEN** the endpoint SHALL return `502` (or equivalent external-service error per existing conventions) with a domain error of type `EXTERNAL_SERVICE_ERROR`

---

### Requirement: Admin Portal frontend surface

The frontend SHALL expose an org-settings surface that lets an authenticated org member launch the Admin Portal for SSO, DSync, or domain-verification setup.

- The surface SHALL render three actionable entries: "Set up Single Sign-On" (intent `sso`), "Set up Directory Sync" (intent `dsync`), "Verify Domain" (intent `domain_verification`).
- Activating an entry SHALL call `GET /api/orgs/{org_id}/admin-portal?intent=...` for the user's current `org_id`.
- On a successful response the frontend SHALL redirect the browser to the returned `url` immediately via `window.location.assign(url)` — no intermediate navigation and no caching.
- On a failure response the frontend SHALL surface the error to the user without redirecting.

#### Scenario: SSO setup redirects immediately to Admin Portal URL

- **WHEN** an authenticated user activates "Set up Single Sign-On"
- **THEN** the frontend SHALL call `GET /api/orgs/{org_id}/admin-portal?intent=sso`
- **AND** on `200` response with `{url, expires_at}` SHALL call `window.location.assign(url)` immediately

#### Scenario: Admin Portal link is not cached

- **WHEN** the user activates the same intent button twice in succession
- **THEN** the frontend SHALL issue two independent `GET /api/orgs/{org_id}/admin-portal?intent=...` calls
- **AND** SHALL NOT reuse a previous response (each link is single-use and time-bound)

#### Scenario: Error surfacing on failure

- **WHEN** the backend returns `403` (cross-org) or `502` (external service)
- **THEN** the frontend SHALL display the error message to the user
- **AND** SHALL NOT redirect
