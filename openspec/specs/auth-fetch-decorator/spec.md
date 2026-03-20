## MODIFIED Requirements

### Requirement: Backend API client uses withAuth decorator
The backend API client (`lib/api/client.ts`) SHALL use `withAuth(fetch)` for all requests instead of manually calling `getAuthHeaders()` and `withAuthRetry()`.

#### Scenario: GET request uses decorator
- **WHEN** `client.get()` is called
- **THEN** it SHALL use `withAuth(fetch)` which handles auth header injection and 401 retry
- **AND** the function SHALL NOT directly call `getAuthHeaders()` or `withAuthRetry()`

#### Scenario: Session expired converted to ApiError
- **WHEN** the `withAuth` decorator throws `Error("Session expired")`
- **THEN** `client.ts` SHALL catch it and throw `ApiError(401, "Session expired")`

#### Scenario: File upload uses decorator
- **WHEN** `client.uploadFile()` is called
- **THEN** the `FormData` body SHALL be sent through `withAuth(fetch)` without a `Content-Type` header (letting the browser set multipart boundary)
- **AND** auth headers SHALL be injected by the decorator

## ADDED Requirements

### Requirement: Frontend proxy target routes through auth proxy
The Vite dev server proxy SHALL route `/api/*` requests through the auth proxy instead of directly to the backend.

#### Scenario: Vite proxy target in Docker Compose
- **WHEN** the frontend dev server proxies `/api/*` requests
- **THEN** the proxy target SHALL be `http://auth-proxy:3000` instead of `http://api:8000`

#### Scenario: Auth headers still injected by withAuth
- **WHEN** a frontend API request is made via `withAuth(fetch)`
- **THEN** the `Authorization: Bearer <token>` header SHALL still be injected by the decorator
- **AND** the auth proxy SHALL validate this token before forwarding to the backend
