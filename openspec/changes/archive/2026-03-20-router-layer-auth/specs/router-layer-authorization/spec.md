## ADDED Requirements

### Requirement: get_current_user dependency reads identity from proxy headers
The `get_current_user()` FastAPI dependency SHALL read user identity from trusted proxy headers (`X-User-Id`, `X-Org-Id`, `X-User-Email`), falling back to the contextvar-based `get_auth_user()` when headers are absent.

#### Scenario: Identity from proxy headers when TRUST_PROXY_HEADERS is true
- **WHEN** a request contains `X-User-Id` header and `TRUST_PROXY_HEADERS` setting is true
- **THEN** `get_current_user()` SHALL return an `AuthUser` with `id`, `org_id`, and `email` from the respective headers

#### Scenario: Fallback to contextvar when proxy headers absent
- **WHEN** a request does not contain `X-User-Id` header or `TRUST_PROXY_HEADERS` is false
- **THEN** `get_current_user()` SHALL fall back to `get_auth_user()` from the auth context

#### Scenario: Proxy headers ignored when TRUST_PROXY_HEADERS is false
- **WHEN** a request contains `X-User-Id` header but `TRUST_PROXY_HEADERS` setting is false
- **THEN** `get_current_user()` SHALL ignore the proxy headers and use `get_auth_user()` from contextvar

### Requirement: authorize_project_access dependency verifies org ownership
The `authorize_project_access()` FastAPI dependency SHALL verify that the current user's org_id matches the project's org_id before allowing the request to proceed.

#### Scenario: User's org matches project org
- **WHEN** a request targets a project and the user's `org_id` matches the project's `org_id`
- **THEN** the dependency SHALL return the `(user, project_dict)` tuple

#### Scenario: User's org does not match project org
- **WHEN** a request targets a project and the user's `org_id` does not match the project's `org_id`
- **THEN** the dependency SHALL raise `AuthorizationError`

#### Scenario: Legacy project without org_id
- **WHEN** a request targets a project whose `org_id` is None
- **THEN** the dependency SHALL allow access (lenient check for backward compatibility)

#### Scenario: Project not found
- **WHEN** a request targets a project_id that does not exist
- **THEN** the dependency SHALL raise `ProjectNotFound`

### Requirement: authorize_dataset_access dependency verifies org ownership via project
The `authorize_dataset_access()` FastAPI dependency SHALL verify that the current user's org_id owns the dataset's parent project.

#### Scenario: User authorized for dataset's parent project
- **WHEN** a request targets a dataset and the user's org owns the dataset's parent project
- **THEN** the dependency SHALL return `(user, dataset_dict)`

#### Scenario: User not authorized for dataset's parent project
- **WHEN** a request targets a dataset and the user's org does not own the parent project
- **THEN** the dependency SHALL raise `AuthorizationError`

### Requirement: Global AuthorizationError exception handler returns 403
The FastAPI application SHALL register a global exception handler for `AuthorizationError` that returns a 403 response in JSON:API error format.

#### Scenario: AuthorizationError raised in any layer
- **WHEN** an `AuthorizationError` is raised during request processing
- **THEN** the application SHALL return HTTP 403 with a JSON:API error body containing `status: "403"`, `title: "Forbidden"`, and `detail` from the exception message

#### Scenario: AuthorizationError no longer returns 500
- **WHEN** an `AuthorizationError` is raised inside a use case wrapped by `@handle_returns`
- **THEN** the response status code SHALL be 403, not 500

### Requirement: Use cases accept user as explicit parameter
After migration, use case functions SHALL accept `user: AuthUser` as an explicit parameter instead of calling `get_auth_user()` internally.

#### Scenario: Use case receives user from router
- **WHEN** a router endpoint calls a use case
- **THEN** it SHALL pass the `AuthUser` obtained from `Depends(get_current_user)` as a parameter
- **AND** the use case SHALL NOT call `get_auth_user()`

#### Scenario: Use case testable without auth context
- **WHEN** a test calls a migrated use case directly
- **THEN** it SHALL pass an `AuthUser` instance as a parameter
- **AND** SHALL NOT need to call `set_auth_user()` for that use case to function
